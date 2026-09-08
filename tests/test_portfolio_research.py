from datetime import date
from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError

from api.v1.schemas.workspace import PortfolioResearchRequest
from src.services.portfolio_research_service import PortfolioResearchService, matching_context, portfolio_alerts, DEFAULT_RULES
from src.services.workspace_service import WorkspaceError
from tests.test_workspace_service import workspace, _empty_bindings  # noqa: F401


def holding(service, symbol="600519", market="cn", cost=100):
    account = service.portfolio.create_account(name="Test", broker=None, market=market, base_currency="CNY")
    service.portfolio.record_trade(account_id=account["id"], symbol=symbol, market=market,
                                   trade_date=date.today(), side="buy", quantity=10, price=cost, currency="CNY")
    return account["id"]


def test_account_context_preserves_separate_costs_and_normalizes_hk(workspace):
    service = PortfolioResearchService(workspace)
    a = holding(service, "HK00700", "hk", 100)
    b = holding(service, "hk00700", "hk", 200)
    context = matching_context(service.portfolio, "00700", market="HK")
    assert {p["account_id"] for p in context["positions"]} == {a, b}
    assert {p["avg_cost"] for p in context["positions"]} == {100, 200}
    assert "avg_cost" not in context
    assert matching_context(service.portfolio, "HK00700", a)["avg_cost"] == 100
    assert matching_context(service.portfolio, "600519") is None


@pytest.mark.parametrize("pnl,change,expected", [(-10, -6, ["loss_review", "sharp_fall"]),
                                               (20, 6, ["profit_review", "sharp_rise"]), (2, 1, [])])
def test_rules_are_review_labels_not_orders(pnl, change, expected):
    assert portfolio_alerts({"price_available": True, "price_stale": False, "unrealized_pnl_pct": pnl}, DEFAULT_RULES, change) == expected


def test_stale_or_missing_price_never_triggers_trade_review():
    assert portfolio_alerts({"price_available": True, "price_stale": True, "unrealized_pnl_pct": -99}, DEFAULT_RULES, -20) == ["price_unverified"]
    assert portfolio_alerts({"price_available": False}, DEFAULT_RULES) == ["price_unverified"]


def test_brief_text_never_serializes_raw_json():
    from src.services.portfolio_research_service import _brief_text
    assert _brief_text({"action": "sell"}) == ""
    assert _brief_text('{"action":"sell"}') == ""
    assert _brief_text('```json\n{}\n```') == ""
    assert _brief_text("a" * 500) == "a" * 400 + "…"


@pytest.mark.parametrize("payload", [{"rules": {"lossPct": float("nan")}}, {"runAt": "25:00"}, {"strategyVersionId": -1}])
def test_request_validation(payload):
    with pytest.raises(ValidationError):
        PortfolioResearchRequest(**payload)


def make_task(workspace, account_id, symbol="600519"):
    return workspace.create_task({"kind": "research", "name": "holding", "market": "CN", "objective": "review",
                                  "subject": {"stock": symbol}, "capabilities": _empty_bindings(),
                                  "config": {"portfolioHolding": {"accountId": account_id, "symbol": symbol}, "portfolioRules": DEFAULT_RULES}})


def test_run_dedup_freezes_context_and_closed_position_disables_schedule(workspace):
    service = PortfolioResearchService(workspace)
    account_id = holding(service)
    task = make_task(workspace, account_id)
    schedule = workspace.create_schedule({"taskId": task["id"], "scheduleMode": "daily", "runAt": "16:30", "timezone": "Asia/Shanghai"})
    with patch("src.services.workspace_service._WORKERS", Mock()):
        first = service.run(account_id, "600519")
        second = service.run(account_id, "600519")
    assert first["id"] == second["id"]
    assert first["taskSnapshot"]["portfolioContext"]["avg_cost"] == 100
    assert first["taskSnapshot"]["portfolioSession"]
    workspace._finish_run(first["id"], "completed", summary={})
    with patch("src.services.workspace_service._WORKERS", Mock()):
        assert workspace.create_run(task["id"], "schedule")["id"] == first["id"]
    service.portfolio.record_trade(account_id=account_id, symbol="600519", trade_date=date.today(), side="sell", quantity=10, price=110)
    with pytest.raises(WorkspaceError, match="清仓"):
        workspace.create_run(task["id"], "schedule")
    assert next(s for s in workspace.list_schedules() if s["id"] == schedule["id"])["enabled"] is False


def test_dashboard_no_llm_and_run_failure_remains_visible(workspace):
    service = PortfolioResearchService(workspace)
    account_id = holding(service)
    task = make_task(workspace, account_id)
    with patch("src.services.workspace_service._WORKERS", Mock()):
        run = service.run(account_id, "600519")
    workspace._finish_run(run["id"], "failed", error_code="data_missing", error_message="No prices")
    dashboard = service.dashboard()
    item = dashboard["items"][0]
    assert item["accountId"] == account_id
    assert item["run"]["error"] == "No prices"
    assert item["run"]["status"] == "failed"
    assert item["brief"] is None
    assert item["alerts"] == ["price_unverified"]


def test_normal_research_gets_holdings_automatically(workspace):
    service = PortfolioResearchService(workspace)
    account_id = holding(service)
    task = workspace.create_task({"kind": "research", "name": "research", "market": "CN", "objective": "review", "subject": {"stock": "600519"}, "capabilities": _empty_bindings()})
    with patch("src.services.workspace_service._WORKERS", Mock()):
        run = workspace.create_run(task["id"])
    assert run["taskSnapshot"]["portfolioContext"]["account_id"] == account_id


def test_generic_task_updates_cannot_break_holding_contract(workspace):
    service = PortfolioResearchService(workspace)
    task = make_task(workspace, holding(service))
    with pytest.raises(WorkspaceError, match="同一只股票"):
        workspace.update_task(task["id"], {"subject": {"stock": "000001"}})
    with pytest.raises(WorkspaceError, match="阈值"):
        workspace.update_task(task["id"], {"config": {**task["config"], "portfolioRules": {"lossPct": "10", "profitPct": 20, "dailyMovePct": 5}}})
    assert workspace.get_task(task["id"])["subject"]["stock"] == "600519"


def test_daily_plan_default_has_no_experts_and_persists_schedule(workspace):
    service = PortfolioResearchService(workspace)
    account_id = holding(service)
    plan = service.plan(account_id, "600519")
    assert plan["task"]["capabilities"]["expertIds"] == []
    saved = service.configure(account_id, "600519", {"dailyEnabled": True})
    assert saved["schedule"]["enabled"] is True
    assert saved["schedule"]["timezone"] == "Asia/Shanghai"
    assert saved["task"]["config"]["portfolioRules"] == DEFAULT_RULES
    again = service.configure(account_id, "600519", {"dailyEnabled": False})
    assert again["task"]["id"] == saved["task"]["id"]
    assert again["schedule"]["id"] == saved["schedule"]["id"]
    assert again["schedule"]["enabled"] is False


@pytest.mark.parametrize("symbol,market,tz", [("HK00700", "hk", "Asia/Hong_Kong"), ("AAPL", "us", "America/New_York")])
def test_non_cn_holdings_get_same_kernel_with_matching_market(workspace, symbol, market, tz):
    service = PortfolioResearchService(workspace)
    account_id = holding(service, symbol, market)
    saved = service.configure(account_id, symbol, {})
    assert saved["task"]["market"] == market.upper()
    assert saved["schedule"]["timezone"] == tz
    assert saved["schedule"]["enabled"] is False


def test_analysis_pipeline_receives_scoped_holdings(workspace):
    from src.services.analysis_service import AnalysisService
    from src.services.portfolio_research_service import ACTIVE_HOLDING_CONTEXT
    service = PortfolioResearchService(workspace)
    a = holding(service, cost=100)
    holding(service, cost=200)
    context = matching_context(service.portfolio, "600519", a)
    token = ACTIVE_HOLDING_CONTEXT.set(context)
    try:
        with patch("src.core.pipeline.StockAnalysisPipeline") as pipeline:
            pipeline.return_value.process_single_stock.return_value = None
            AnalysisService().analyze_stock("600519")
        assert pipeline.call_args.kwargs["portfolio_context"]["avg_cost"] == 100
        assert len(pipeline.call_args.kwargs["portfolio_context"]["positions"]) == 1
    finally:
        ACTIVE_HOLDING_CONTEXT.reset(token)


def test_api_plan_contract_and_unsupported_request_do_not_start_models(workspace):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.v1.endpoints import workspace as endpoint
    service = PortfolioResearchService(workspace)
    account_id = holding(service)
    app = FastAPI()
    app.include_router(endpoint.router)
    with patch.object(endpoint, "_holding_service", return_value=service), TestClient(app) as client:
        assert client.get("/portfolio-research").status_code == 200
        assert client.get(f"/portfolio-research/{account_id}/600519/plan").status_code == 200
        assert client.put(f"/portfolio-research/{account_id}/600519/plan", json={"runAt": "25:00"}).status_code == 422
        assert client.put(f"/portfolio-research/{account_id}/600519/plan", json={"strategyVersionId": 999999}).status_code == 422
        assert client.get("/portfolio-research/9999/600519/plan").status_code == 404
