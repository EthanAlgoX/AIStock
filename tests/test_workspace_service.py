from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.services.workspace_service import WorkspaceError, WorkspaceService
from src.storage import DatabaseManager


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
    ]

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
    assert run["dataSnapshot"]["quality"]["status"] == "ready"
    assert run["taskSnapshot"]["runContext"]["dataSnapshotId"] == run["dataSnapshotId"]
    assert run["taskSnapshot"]["capabilitySnapshot"]["dataSources"][0]["id"] == "system_market_data"
    assert run["artifacts"][0]["type"] == "ResearchReport"
    assert run["artifacts"][0]["content"]["conclusion"] == "继续研究"


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
