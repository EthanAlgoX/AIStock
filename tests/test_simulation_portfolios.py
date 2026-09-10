"""Real simulation ledger tests, with a deterministic market-data boundary."""

import json
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import select, func
from api.v1.endpoints.simulation_portfolios import PortfolioCreate
from src.services.simulation_portfolio_engine import metrics, step
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.storage import SimulationFillRecord, SimulationPortfolioRunRecord, SimulationRunRecord, SimulationAccountRecord
from tests.test_workspace_service import workspace  # noqa: F401


def config(**kwargs):
    return PortfolioCreate(
        name="Test portfolio",
        template="low_volatility_quality",
        market="US",
        symbols=["AAPL"],
        mode="backtest",
        lotSize=1,
        startDate="2025-02-10",
        endDate="2025-02-14",
        **kwargs,
    ).model_dump()


def history(day="2025-02-10", close=100):
    return [
        {
            "date": (date.fromisoformat(day) - timedelta(days=20 - i)).isoformat(),
            "open": close,
            "close": close,
            "high": close,
            "low": close,
            "volume": 1000,
            "amount": 100000,
        }
        for i in range(21)
    ]


def test_next_open_costs_positions_and_daily_opinions():
    c = config()
    s, first = step(c, {"cash": 100000}, "2025-02-10", {"AAPL": history()}, 100)
    assert not first["trades"] and first["opinions"][0]["stance"] == "bullish"
    h = history("2025-02-11", 110)
    s, second = step(c, s, "2025-02-11", {"AAPL": h}, 101)
    trade = second["trades"][0]
    assert trade["signalDate"] == "2025-02-10" and trade["price"] == pytest.approx(110 * 1.001)
    assert second["cash"] + second["marketValue"] == pytest.approx(second["equity"])
    assert second["equity"] < 100000 and second["holdings"][0]["averageCost"] > trade["price"]
    s, third = step(c, s, "2025-02-12", {"AAPL": history("2025-02-12", 115)}, 102)
    assert not third["trades"]  # no needless sell/rebuy turnover
    assert third["opinions"][0]["held"]


def test_missing_bar_does_not_mutate_account():
    state = {"cash": 100000}
    with pytest.raises(ValueError, match="缺少"):
        step(config(), state, "2025-02-11", {"AAPL": history()}, 100)
    assert state == {"cash": 100000}


def test_metrics_sample_limits_zero_and_formulas():
    assert metrics([], 100)["dailyReturn"] is None
    days = [{"equity": 100, "tradedValue": 0} for _ in range(20)]
    m = metrics(days, 100)
    assert m["cumulativeReturn"] == 0 and m["annualizedVolatility"] == 0
    assert m["sharpe"] is None and m["calmar"] is None
    days[-1] = {"equity": 90, "tradedValue": 100}
    m = metrics(days, 100)
    assert m["maxDrawdown"] == pytest.approx(0.1)
    assert m["turnover"] == pytest.approx(100 / 2 / 99.5)
    assert m["calmar"] == pytest.approx(m["annualizedReturn"] / 0.1)
    assert metrics(days[:2], 100)["annualizedReturn"] is None


def fetcher():
    import exchange_calendars as xcals

    dates = xcals.get_calendar("XNYS").sessions_in_range("2024-10-01", "2025-02-14")
    frame = pd.DataFrame(
        [
            {
                "date": d.date(),
                "open": 100 + i,
                "close": 101 + i,
                "high": 102 + i,
                "low": 99 + i,
                "volume": 1000,
                "amount": 100000,
            }
            for i, d in enumerate(dates)
        ]
    )
    return SimpleNamespace(get_daily_data=lambda *args, **kwargs: (frame.copy(), "fixture"))


def run_sync(service, pid):
    with patch("src.services.simulation_portfolio_service._POOL.submit") as submit:
        assert service.enqueue(pid)
        token = submit.call_args.args[2]
        assert not service.enqueue(pid)
    service.execute(pid, token)


def test_real_ledger_daily_run_idempotency_and_retained_data(workspace):
    service = SimulationPortfolioService(workspace.db, fetcher())
    with patch.object(service, "_last_closed", return_value=date(2025, 2, 14)):
        created = service.create(config())
        run_sync(service, created["id"])
        detail = service.detail(created["id"])
        assert not detail["error"] and len(detail["days"]) == 5
        assert detail["status"] == "completed"
        assert detail["days"][1]["trades"][0]["status"] == "filled"
        with workspace.db.get_session() as s:
            count = s.scalar(select(func.count()).select_from(SimulationFillRecord))
            account = s.get(SimulationAccountRecord, 1)
            assert account.cash_balance == pytest.approx(detail["days"][-1]["cash"])
            assert len(list(s.scalars(select(SimulationRunRecord)))) == 5
        run_sync(service, created["id"])
        with workspace.db.get_session() as s:
            assert s.scalar(select(func.count()).select_from(SimulationFillRecord)) == count
        assert len(service.detail(created["id"])["days"]) == 5


def test_failure_releases_lease_and_preserves_error(workspace):
    service = SimulationPortfolioService(
        workspace.db, SimpleNamespace(get_daily_data=lambda *a, **k: (_ for _ in ()).throw(ValueError("provider down")))
    )
    item = service.create(config())
    with patch.object(service, "_last_closed", return_value=date(2025, 2, 14)):
        run_sync(service, item["id"])
    result = service.detail(item["id"])
    assert "provider down" in result["error"] and not result["busy"] and not result["days"]


def test_configuration_is_immutable_and_member_policy_narrow(workspace):
    from src.services.member_policy import member_api_allowed

    service = SimulationPortfolioService(workspace.db)
    item = service.create(config())
    with workspace.db.get_session() as s:
        row = s.get(SimulationPortfolioRunRecord, item["id"])
        assert json.loads(row.config_json)["engineVersion"] == 1
    assert member_api_allowed("/api/v1/simulation/portfolios", "POST")
    assert member_api_allowed("/api/v1/simulation/portfolios/1/control", "POST")
    assert not member_api_allowed("/api/v1/simulation/portfolios/1/source", "POST")
    assert not member_api_allowed("/api/v1/simulation/definition/strategies", "POST")
    with pytest.raises(ValueError):
        service.create({**config(), "market": "CN"})


def test_api_accounts_are_private_and_legacy_contract_still_serializes(members):
    owner, alice, bob, service = members
    result = alice.post("/api/v1/simulation/portfolios", json=config())
    assert result.status_code == 200, result.text
    pid = result.json()["id"]
    assert len(alice.get("/api/v1/simulation/portfolios").json()["items"]) == 1
    assert bob.get("/api/v1/simulation/portfolios").json()["items"] == []
    assert bob.get(f"/api/v1/simulation/portfolios/{pid}").status_code == 404
    assert owner.get("/api/v1/simulation/portfolios").json()["items"] == []
    assert alice.post("/api/v1/simulation/portfolios", json={**config(), "symbols": ["../../etc"]}).status_code == 422


from tests.test_member_workspaces import members  # noqa: F401,E402


def test_pause_marks_cash_without_executing_previous_intent(workspace):
    service = SimulationPortfolioService(workspace.db, fetcher())
    item = service.create(config())
    with patch.object(service, "_last_closed", return_value=date(2025, 2, 10)):
        run_sync(service, item["id"])
    with workspace.db.session_scope() as s:
        row = s.get(SimulationPortfolioRunRecord, item["id"])
        row.mode, row.status = "paper", "paused"
    with patch("src.services.simulation_portfolio_service._POOL.submit") as submit:
        service.enqueue(item["id"], automatic=True)
        token = submit.call_args.args[2]
    with patch.object(service, "_last_closed", return_value=date(2025, 2, 14)):
        service.execute(item["id"], token, automatic=True)
    detail = service.detail(item["id"])
    assert len(detail["days"]) == 5 and all(not d["trades"] for d in detail["days"])
    assert detail["days"][-1]["paused"] and detail["days"][-1]["equity"] == 100000


def test_sell_uses_yesterday_reason_and_cash_includes_cost():
    c = config()
    previous = {
        "cash": 1000,
        "equity": 2000,
        "positions": {"AAPL": {"quantity": 10, "averageCost": 100}},
        "pending": {"date": "2025-02-10", "selected": [], "reasons": {"AAPL": "昨日规则退出"}},
    }
    _, day = step(c, previous, "2025-02-11", {"AAPL": history("2025-02-11", 90)}, 100)
    t = day["trades"][0]
    assert t["side"] == "sell" and t["reason"] == "昨日规则退出" and t["quantity"] == 10
    assert day["cash"] == pytest.approx(1000 + 10 * 90 * (1 - c["slippageRate"]) * (1 - c["commissionRate"]))
    assert not day["holdings"]


def test_restart_releases_lease_and_recovers_completed_days(workspace):
    service = SimulationPortfolioService(workspace.db, fetcher())
    item = service.create(config())
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    with patch('src.services.simulation_portfolio_service._POOL.submit'):
        service.enqueue(item['id'])
    assert service.detail(item['id'])['busy']
    service.recover()
    detail = service.detail(item['id'])
    assert not detail['busy'] and len(detail['days']) == 5
    assert '服务重启' in detail['error']


def test_failed_provider_is_visible_in_task_history(workspace):
    from src.storage import WorkspaceRunRecord
    service = SimulationPortfolioService(workspace.db, SimpleNamespace(get_daily_data=lambda *a, **k: (_ for _ in ()).throw(ValueError('missing quotes'))))
    item = service.create(config())
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    with workspace.db.get_session() as session:
        runs = list(session.scalars(select(WorkspaceRunRecord)))
        assert len(runs) == 1 and runs[0].status == 'failed'
        assert 'missing quotes' in runs[0].error_message
        assert json.loads(runs[0].task_snapshot_json)['config']['portfolioId'] == item['id']


def test_portfolio_outcome_reports_account_updates_without_claiming_a_proposal():
    from src.services.workspace_outcomes import business_outcome
    artifact = {"type": "PortfolioUpdate", "content": {"portfolioId": 1, "engineVersion": 1, "processedDays": 5}}
    assert business_outcome('completed', 'trading', [artifact])['status'] == 'produced'
    artifact['content']['processedDays'] = 0
    assert business_outcome('completed', 'trading', [artifact])['status'] == 'empty'
    assert business_outcome('failed', 'trading', [artifact])['status'] == 'failed'
