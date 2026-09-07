from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.services.workspace_service import BUILTIN_EXPERTS, WorkspaceError, WorkspaceService
from src.storage import DatabaseManager, WorkspaceExpertRecord


class _ImmediateExecutor:
    def submit(self, function, *args):
        function(*args)
        return object()


@pytest.fixture()
def workspace():
    path = tempfile.mktemp(suffix=".sqlite")
    DatabaseManager.reset_instance()
    service = WorkspaceService(DatabaseManager(f"sqlite:///{path}"))
    try:
        yield service
    finally:
        DatabaseManager.reset_instance()
        if os.path.exists(path):
            os.unlink(path)


def _empty_bindings(**overrides):
    value = {
        "skillIds": [],
        "toolIds": [],
        "mcpIds": [],
        "dataSourceIds": [],
        "expertIds": [],
        "expertTeamIds": [],
    }
    value.update(overrides)
    return value


def test_expanded_experts_have_distinct_lenses_and_stable_defaults(workspace):
    experts = workspace.list_experts()
    assert len(experts) == 14
    assert [item["id"] for item in experts[:5]] == [-1005, -1004, -1003, -1002, -1001]
    assert len({item["key"] for item in experts}) == 14
    assert len({item["prompt"] for item in experts}) == 14
    assert {item["name"] for item in experts} >= {
        "查理·芒格", "李录", "彼得·林奇", "朱少醒", "谢治宇", "吉姆·柯林斯",
        "李国飞", "彼得·德鲁克", "马克·米勒维尼", "杰西·利弗莫尔",
    }
    for expert in experts:
        assert expert["prompt"] == expert["defaultPrompt"]
        for requirement in ("不得冒充本人", "事实、推断与假设", "流水线", "辩论", "投票", "Schema", "不得绕过账户风控"):
            assert requirement in expert["prompt"]
    assert workspace.get_expert(-1013)["prompt"].find("VCP") >= 0
    assert "不对所有公司套同一估值" in workspace.get_expert(-1007)["prompt"]
    assert "不自动等于股票低估" in workspace.get_expert(-1010)["prompt"]


def test_legacy_prompt_upgrade_is_exact_idempotent_and_preserves_customization(workspace):
    workspace.list_experts()
    with workspace.db.session_scope() as session:
        for expert in BUILTIN_EXPERTS[:5]:
            row = session.get(WorkspaceExpertRecord, expert["id"])
            row.prompt = expert["legacyPrompt"]
        row = session.get(WorkspaceExpertRecord, -1001)
        row.enabled = False
        row.name = "我的巴菲特"
        row.version = 7
        session.get(WorkspaceExpertRecord, -1002).prompt = "用户自定义风险清单"
    upgraded = workspace.get_expert(-1001)
    assert upgraded["prompt"] == upgraded["defaultPrompt"]
    assert upgraded["version"] == 8
    assert not upgraded["enabled"]
    assert upgraded["name"] == "我的巴菲特"
    assert workspace.get_expert(-1001)["version"] == 8
    customized = workspace.get_expert(-1002)
    assert customized["prompt"] == "用户自定义风险清单"
    assert customized["prompt"] != customized["defaultPrompt"]
    custom = workspace.create_expert({"name": "自建专家", "prompt": BUILTIN_EXPERTS[0]["legacyPrompt"]})
    assert workspace.get_expert(custom["id"])["prompt"] == custom["prompt"]
    restored = workspace.update_expert(-1002, {"prompt": customized["defaultPrompt"]})
    assert restored["prompt"] == customized["defaultPrompt"]


def _task_payload(kind="screening", **overrides):
    value = {
        "kind": kind,
        "name": "测试任务",
        "market": "CN",
        "objective": "基于真实可得数据完成任务",
        "subject": {},
        "config": {},
        "capabilities": _empty_bindings(),
    }
    value.update(overrides)
    return value


def test_restart_closes_observed_active_stage(workspace):
    task = workspace.create_task(_task_payload())
    with patch("src.services.workspace_service._WORKERS"):
        run = workspace.create_run(task["id"])
    workspace._set_run_stage(run["id"], "agent", "Agent 研究", "running")
    assert workspace.reconcile_interrupted_runs() == 1
    restored = workspace.get_run(run["id"])
    assert restored["status"] == "failed"
    assert restored["errorCode"] == "runtime_restarted"
    assert restored["resultSummary"]["stages"][0]["status"] == "failed"
    assert restored["resultSummary"]["stages"][0]["completedAt"]


def test_legacy_trade_aliases_produce_report_and_server_owned_execution_boundary(workspace):
    task = workspace.create_task(_task_payload(kind="trading", config={"executionMode": "paper"}))
    result = SimpleNamespace(success=True, content='{"TradeProposal":{"proposals":[{"ticker":"000333","side":"BUY","shares":1700}]},"RiskAssessment":{"approved":true},"PaperTradingRun":{"simulatedFillsCreated":99}}',
                             backend="test", model="test", tool_calls_log=[], error_code=None, error=None)
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result):
        run = workspace.create_run(task["id"])
    assert run["outcome"]["status"] == "proposal"
    artifacts = {a["type"]: a["content"] for a in run["artifacts"]}
    assert artifacts["TradeProposal"]["actions"][0]["symbol"] == "000333"
    assert artifacts["RiskAssessment"]["proposalRiskEvaluated"] is False
    assert artifacts["PaperTradingRun"]["simulatedFillsCreated"] == 0
    assert workspace.get_run(run["id"])["outcome"] == run["outcome"]
    assert workspace.list_runs()[0]["outcome"] == run["outcome"]


def test_capability_registry_persists_custom_skills_and_allowlist(workspace):
    catalog = workspace.capability_catalog()
    assert catalog["skills"]
    assert catalog["tools"]
    assert {item["name"] for item in catalog["experts"]} >= {"沃伦·巴菲特", "查理·芒格"}
    assert "screen_stock_universe" in catalog["defaults"]["screening"]["toolIds"]
    assert catalog["defaults"]["research"]["dataSourceIds"] == [
        "system_market_data",
        "system_news",
        "system_fundamentals",
        "system_macro_data",
    ]
    assert "get_macro_indicators" in catalog["defaults"]["research"]["toolIds"]

    created = workspace.create_skill({
        "id": "cash-flow-review",
        "name": "现金流审查",
        "category": "research",
        "description": "检查盈利质量",
        "instructions": "对经营现金流、自由现金流和应收项目进行交叉验证。",
    })
    assert created["builtIn"] is False
    workspace.set_preferences("skill", ["cash-flow-review"])

    skills = {item["id"]: item for item in workspace.list_skills()}
    assert skills["cash-flow-review"]["enabled"] is True
    assert sum(item["enabled"] for item in skills.values()) == 1

    workspace.update_skill("cash-flow-review", {"enabled": False})
    assert {item["id"]: item for item in workspace.list_skills()}["cash-flow-review"]["enabled"] is False


def test_data_source_probe_persists_observed_health_separately_from_configuration(workspace):
    before = {item["sourceId"]: item for item in workspace.list_data_sources()}
    assert before["kline:akshare"]["availability"] == "configured"
    assert before["kline:akshare"]["healthStatus"] == "not_tested"
    assert before["kline:akshare"]["operational"] is False

    probe_result = {
        "status": "available",
        "recordCount": 12,
        "errorCode": None,
        "error": None,
        "detail": {"provider": "AkshareFetcher", "latestDate": "2026-09-03"},
    }
    with patch.object(workspace, "_run_data_source_probe", return_value=probe_result):
        checked = workspace.probe_data_source("kline:akshare")

    assert checked["availability"] == "configured"
    assert checked["healthStatus"] == "available"
    assert checked["operational"] is True
    assert checked["lastRecordCount"] == 12
    assert checked["lastCheckedAt"]
    assert checked["healthDetail"]["provider"] == "AkshareFetcher"

    persisted = {item["sourceId"]: item for item in workspace.list_data_sources()}
    assert persisted["kline:akshare"]["healthStatus"] == "available"


def test_custom_data_source_does_not_claim_runtime_health_without_adapter(workspace):
    created = workspace.create_data_source({
        "name": "私有研究仓",
        "description": "仅登记连接身份",
        "connectionKey": "private_research_v1",
        "setupUrl": "https://data.example.com/docs",
        "accessMode": "account",
        "kind": "other",
        "markets": ["cn"],
    })
    assert created["availability"] == "registered"
    assert created["healthStatus"] == "not_tested"
    assert created["probeSupported"] is False
    assert created["operational"] is False
    assert created["setupUrl"] == "https://data.example.com/docs"
    assert created["accessMode"] == "account"

    with pytest.raises(WorkspaceError) as unsupported:
        workspace.probe_data_source(created["sourceId"])
    assert unsupported.value.code == "data_source_probe_unsupported"


def test_macro_source_probe_is_source_pinned_and_reports_series(workspace):
    with patch("data_provider.DataFetcherManager") as manager_cls:
        manager_cls.return_value.get_macro_indicators.return_value = [
            {"key": "china_pmi", "current": 49.8, "source": "ApocData 公共宏观接口"}
        ]
        result = workspace._probe_macro_source({
            "kind": "macro",
            "markets": ["cn", "hk"],
            "selectionMode": "provider",
            "providerName": "ApocDataMacroFetcher",
        })

    manager_cls.return_value.get_macro_indicators.assert_called_once_with(
        region="cn",
        preferred_fetcher="ApocDataMacroFetcher",
    )
    assert result["status"] == "available"
    assert result["detail"]["series"] == ["china_pmi"]


def test_task_contracts_reject_incomplete_or_unsafe_definitions(workspace):
    with pytest.raises(WorkspaceError, match="绑定一只股票"):
        workspace.create_task(_task_payload("research"))

    with pytest.raises(WorkspaceError, match="至少需要绑定"):
        workspace.create_task(_task_payload("expert_review"))

    with pytest.raises(WorkspaceError, match="只允许模拟盘"):
        workspace.create_task(_task_payload("trading", config={"executionMode": "live"}))

    with pytest.raises(WorkspaceError, match="风险边界"):
        workspace.create_task(_task_payload(
            "trading",
            config={"executionMode": "paper", "riskPolicy": {"maxPositions": 0}},
        ))

    with pytest.raises(WorkspaceError) as invalid_binding:
        workspace.create_task(_task_payload(
            capabilities=_empty_bindings(toolIds=["tool-that-does-not-exist"]),
        ))
    assert invalid_binding.value.code == "capability_binding_invalid"

    with pytest.raises(WorkspaceError) as missing_industry:
        workspace.create_task(_task_payload("industry_analysis"))
    assert missing_industry.value.code == "industry_required"


def test_market_and_industry_analysis_use_workspace_artifact_contracts(workspace):
    market_task = workspace.create_task(_task_payload(
        "market_analysis",
        name="A 股宏观分析",
        subject={"scope": "CN"},
    ))
    industry_task = workspace.create_task(_task_payload(
        "industry_analysis",
        name="半导体产业分析",
        subject={"industry": "半导体"},
    ))

    assert market_task["kind"] == "market_analysis"
    assert industry_task["subject"]["industry"] == "半导体"
    assert "get_macro_indicators" in workspace.default_bindings("market_analysis")["toolIds"]


def test_run_freezes_context_and_persists_structured_artifacts(workspace):
    task = workspace.create_task(_task_payload(
        "research",
        subject={"stock": "600519", "stockName": "贵州茅台"},
        capabilities=_empty_bindings(dataSourceIds=["system_market_data"]),
    ))
    result = SimpleNamespace(
        success=True,
        content='{"ResearchReport":{"conclusion":"继续研究","confidence":0.71}}',
        backend="litellm",
        model="test-model",
        tool_calls_log=[],
        error_code=None,
        error=None,
    )
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(
        workspace,
        "_call_agent",
        return_value=result,
    ):
        run = workspace.create_run(task["id"])

    assert run["status"] == "completed"
    assert run["dataSnapshot"]["sourceIds"] == ["system_market_data"]
    assert run["dataSnapshot"]["quality"]["status"] == "unverified"
    assert run["resultSummary"]["stages"][0]["status"] == "completed"
    assert run["taskSnapshot"]["runContext"]["dataSnapshotId"] == run["dataSnapshotId"]
    assert run["taskSnapshot"]["capabilitySnapshot"]["dataSources"][0]["id"] == "system_market_data"
    assert run["artifacts"][0]["type"] == "ResearchReport"
    assert run["artifacts"][0]["content"]["conclusion"] == "继续研究"
    assert run["outcome"]["status"] == "unverified"
    assert workspace.list_runs()[0]["outcome"] == run["outcome"]


def test_unstructured_screening_is_preserved_once_without_fabricated_contracts(workspace):
    task = workspace.create_task(_task_payload())
    result = SimpleNamespace(success=True, content="本次无法扫描，没有执行筛选。", backend="litellm", model="test", tool_calls_log=[])
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result):
        run = workspace.create_run(task["id"])
    assert [a["type"] for a in run["artifacts"]] == ["AgentResponse"]
    assert run["resultSummary"]["artifactTypes"] == ["AgentResponse"]
    assert run["outcome"]["status"] == "unverified"


def test_legacy_blocked_result_matches_list_and_detail(workspace):
    task = workspace.create_task(_task_payload())
    result = SimpleNamespace(success=True, content='{"CandidateList":{"status":"not_executed","candidates":[]}}', backend="litellm", model="test", tool_calls_log=[])
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result):
        run = workspace.create_run(task["id"])
    assert run["status"] == "completed"  # Execution enum remains compatible.
    assert run["outcome"]["status"] == "blocked"
    assert workspace.list_runs()[0]["outcome"] == run["outcome"]


def test_unsupported_screening_market_is_rejected_before_creating_run(workspace):
    task = workspace.create_task(_task_payload(market="HK", capabilities=_empty_bindings(toolIds=["screen_stock_universe"])))
    with patch("src.services.workspace_service._WORKERS") as workers:
        with pytest.raises(WorkspaceError) as error:
            workspace.create_run(task["id"])
    assert error.value.code == "screening_invalid_market"
    workers.submit.assert_not_called()
    assert workspace.list_runs() == []


def test_trading_run_is_proposal_only_and_never_fabricates_fills(workspace):
    task = workspace.create_task(_task_payload(
        "trading",
        config={
            "executionMode": "paper",
            "riskPolicy": {
                "maxPositions": 8,
                "maxPositionPercent": 12,
                "maxDailyLossPercent": 2,
            },
        },
    ))
    result = SimpleNamespace(
        success=True,
        content='{"TradeProposal":{"actions":[{"symbol":"600519","side":"WATCH"}]}}',
        backend="litellm",
        model="test-model",
        tool_calls_log=[],
        error_code=None,
        error=None,
    )
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(
        workspace,
        "_call_agent",
        return_value=result,
    ):
        run = workspace.create_run(task["id"])

    artifacts = {item["type"]: item["content"] for item in run["artifacts"]}
    assert artifacts["RiskAssessment"]["realOrderExecutionAllowed"] is False
    assert artifacts["RiskAssessment"]["proposalRiskEvaluated"] is False
    assert artifacts["PaperTradingRun"]["executionEnabled"] is False
    assert artifacts["PaperTradingRun"]["simulatedFillsCreated"] == 0


def test_expert_team_expands_selected_members(workspace):
    teams = workspace.list_expert_teams()
    selected = next(item for item in teams if item["key"] == "long-term-value")
    task = workspace.create_task(_task_payload(
        "expert_review",
        capabilities=_empty_bindings(expertTeamIds=[selected["id"]]),
    ))
    assert workspace._expanded_expert_ids(task["capabilities"]) == selected["memberIds"]


def test_schedule_launches_due_task_and_updates_ledger(workspace):
    task = workspace.create_task(_task_payload())
    schedule = workspace.create_schedule({
        "taskId": task["id"],
        "name": "每日选股",
        "scheduleMode": "daily",
        "runAt": "09:30",
        "timezone": "Asia/Shanghai",
    })
    fake_run = {"id": "run-from-schedule"}
    with workspace.db.session_scope() as session:
        from src.storage import WorkspaceScheduleRecord

        row = session.get(WorkspaceScheduleRecord, schedule["id"])
        row.next_run_at = row.created_at
    with patch.object(workspace, "create_run", return_value=fake_run) as create_run:
        run_ids = workspace.run_due_schedules()

    assert run_ids == ["run-from-schedule"]
    create_run.assert_called_once_with(task["id"], trigger_type="schedule")
    updated = {item["id"]: item for item in workspace.list_schedules()}[schedule["id"]]
    assert updated["lastRunId"] == "run-from-schedule"


def test_market_dashboard_persists_layout_and_publishes_scheduled_research(workspace):
    task = workspace.create_task(_task_payload(
        "research",
        name="贵州茅台每日跟踪",
        subject={"stock": "600519", "stockName": "贵州茅台"},
    ))
    workspace.create_schedule({
        "taskId": task["id"],
        "name": "贵州茅台收盘复盘",
        "scheduleMode": "daily",
        "runAt": "18:30",
        "timezone": "Asia/Shanghai",
        "publishToMarket": True,
        "marketDashboardTitle": "贵州茅台跟踪",
    })

    dashboard = workspace.update_market_dashboard("CN", {
        "widgetIds": ["overview", "subscriptions", "news"],
        "newsSourceIds": [12],
        "newsKeywords": ["白酒", "消费"],
    })

    assert dashboard["widgetIds"] == ["overview", "subscriptions", "news"]
    assert dashboard["newsSourceIds"] == [12]
    assert dashboard["newsKeywords"] == ["白酒", "消费"]
    assert dashboard["subscriptions"][0]["taskId"] == task["id"]
    assert dashboard["subscriptions"][0]["title"] == "贵州茅台跟踪"
    assert dashboard["subscriptions"][0]["schedules"][0]["runAt"] == "18:30"


def test_market_subscription_returns_only_artifact_summary(workspace):
    task = workspace.create_task(_task_payload(
        "research",
        subject={"stock": "AAPL", "stockName": "Apple"},
    ))
    result = SimpleNamespace(
        success=True,
        content='{"ResearchReport":{"conclusion":"盈利质量稳定，继续观察估值。","confidence":0.73,"risks":["估值偏高"]}}',
        backend="litellm",
        model="test-model",
        tool_calls_log=[],
        error_code=None,
        error=None,
    )
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(
        workspace,
        "_call_agent",
        return_value=result,
    ):
        run = workspace.create_run(task["id"])
    workspace.create_market_subscription({"taskId": task["id"], "market": "US"})

    subscription = workspace.get_market_dashboard("US")["subscriptions"][0]

    assert subscription["latestArtifact"]["runId"] == run["id"]
    assert subscription["latestArtifact"]["summary"] == {
        "text": "盈利质量稳定，继续观察估值。",
        "risks": ["估值偏高"],
        "confidence": 0.73,
    }
    assert "content" not in subscription["latestArtifact"]


def test_schedule_rejects_disabled_tasks_and_invalid_updates(workspace):
    task = workspace.create_task(_task_payload())
    workspace.update_task(task["id"], {"enabled": False})
    with pytest.raises(WorkspaceError) as disabled:
        workspace.create_schedule({
            "taskId": task["id"],
            "name": "不可运行",
            "scheduleMode": "daily",
            "runAt": "09:30",
            "timezone": "Asia/Shanghai",
        })
    assert disabled.value.code == "task_disabled"

    workspace.update_task(task["id"], {"enabled": True})
    schedule = workspace.create_schedule({
        "taskId": task["id"],
        "name": "每日运行",
        "scheduleMode": "daily",
        "runAt": "09:30",
        "timezone": "Asia/Shanghai",
    })
    with pytest.raises(WorkspaceError) as invalid_time:
        workspace.update_schedule(schedule["id"], {"runAt": "25:99"})
    assert invalid_time.value.code == "schedule_time_invalid"


def test_http_mcp_probe_discovers_tools_without_persisting_secret_values(workspace, monkeypatch):
    monkeypatch.setenv("TEST_MCP_TOKEN", "super-secret-token")
    server = workspace.create_mcp_server({
        "name": "研究工具",
        "transport": "http",
        "location": "https://mcp.example.test/api",
        "credentialKey": "TEST_MCP_TOKEN",
    })
    init_response = Mock(status_code=200, headers={"Mcp-Session-Id": "session-1"}, content=b"{}")
    init_response.raise_for_status.return_value = None
    initialized_response = Mock(status_code=202, headers={}, content=b"")
    initialized_response.raise_for_status.return_value = None
    list_response = Mock(status_code=200, headers={"content-type": "application/json"})
    list_response.content = b'{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}'
    list_response.json.return_value = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "tools": [{
                "name": "read_filings",
                "description": "读取公告",
                "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}}},
            }],
        },
    }
    with patch(
        "src.services.workspace_service.requests.post",
        side_effect=[init_response, initialized_response, list_response],
    ) as post:
        probed = workspace.probe_mcp_server(server["id"])

    assert probed["healthStatus"] == "healthy"
    assert probed["selectable"] is True
    assert probed["capabilities"][0]["name"] == "read_filings"
    assert probed["credentialKey"] == "TEST_MCP_TOKEN"
    assert "super-secret-token" not in str(probed)
    assert post.call_args_list[0].kwargs["headers"]["Authorization"] == "Bearer super-secret-token"


def test_mcp_must_be_healthy_http_before_task_binding(workspace):
    server = workspace.create_mcp_server({
        "name": "待检查 MCP",
        "transport": "http",
        "location": "https://mcp.example.test/api",
    })
    assert server["selectable"] is False
    with pytest.raises(WorkspaceError) as invalid:
        workspace.validate_bindings(_empty_bindings(mcpIds=[server["id"]]))
    assert invalid.value.code == "capability_binding_invalid"

    stdio = workspace.create_mcp_server({
        "name": "Runtime MCP",
        "transport": "stdio",
        "location": "python -m trusted_server",
    })
    probed = workspace.probe_mcp_server(stdio["id"])
    assert probed["healthStatus"] == "requires_runtime"
    assert probed["selectable"] is False
