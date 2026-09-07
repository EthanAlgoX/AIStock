from types import SimpleNamespace
from unittest.mock import patch

import pytest
from data_provider.base import normalize_stock_code

from src.services.workspace_defaults import default_task_plan
from src.services.workspace_service import WorkspaceError, WorkspaceService
from src.services.strategy_definition_service import StrategyDefinitionService
from src.storage import DatabaseManager


@pytest.fixture
def workspace(tmp_path):
    DatabaseManager.reset_instance()
    service = WorkspaceService(DatabaseManager(f"sqlite:///{tmp_path / 'defaults.db'}"))
    with patch("src.services.workspace_defaults.get_config", return_value=SimpleNamespace(stock_list=[])):
        yield service
    DatabaseManager.reset_instance()


@pytest.mark.parametrize("kind", ["research", "screening", "trading"])
def test_empty_install_defaults_are_deterministic_valid_and_do_not_run(workspace, kind):
    with patch.object(workspace, "create_task") as create, patch.object(workspace, "create_run") as run:
        first = default_task_plan(workspace, kind)
        second = default_task_plan(workspace, kind)
    assert first == second
    create.assert_not_called()
    run.assert_not_called()
    task = workspace.create_task(first["task"])
    assert task["config"]["defaultPolicyVersion"] == "starter-v1"
    assert task["capabilities"]["mcpIds"] == []
    assert first["expertCount"] <= 4
    assert first["reasons"] and first["notice"]
    if kind == "trading":
        assert task["subject"]["stock"]
        assert task["config"]["executionMode"] == "paper"
        assert task["config"]["riskPolicy"]["requireApproval"] is True
        assert task["config"]["riskPolicy"]["maxPositionPercent"] == 10
    elif kind == "screening":
        version = StrategyDefinitionService(workspace.db).get_version(task["config"]["strategyVersionId"])
        assert version["screeningPolicy"]["strategy"] == "balanced_alpha"
        assert task["config"]["deepResearchCount"] == 0


def test_growth_stock_uses_frozen_skill_and_complementary_expert_team(workspace):
    plan = default_task_plan(workspace, "research", stock="688981.SH")
    task = plan["task"]
    version = StrategyDefinitionService(workspace.db).get_version(task["config"]["strategyVersionId"])
    assert version["decisionPolicy"]["packageParameters"]["skills"] == ["growth_quality"]
    assert task["capabilities"]["skillIds"] == []  # Frozen version owns this method.
    assert task["capabilities"]["expertTeamIds"] == [-2002]
    assert normalize_stock_code(task["subject"]["stock"]) == "688981"


def test_watchlist_precedes_demo_and_explicit_stock_precedes_watchlist(workspace):
    with patch("src.services.workspace_defaults.get_config", return_value=SimpleNamespace(stock_list=["AAPL", "688981.SH", "600519"])):
        assert normalize_stock_code(default_task_plan(workspace, "research")["task"]["subject"]["stock"]) == "688981"
        assert normalize_stock_code(default_task_plan(workspace, "research", stock="600519")["task"]["subject"]["stock"]) == "600519"


def test_market_mismatch_and_missing_formal_market_are_explicit(workspace):
    with pytest.raises(WorkspaceError, match="市场不一致"):
        default_task_plan(workspace, "research", stock="00981.HK")
    with pytest.raises(WorkspaceError, match="默认正式策略"):
        default_task_plan(workspace, "research", market="HK")


def test_disabled_team_member_is_not_reenabled(workspace):
    experts = workspace.list_experts()
    with patch.object(workspace, "list_experts", return_value=[{**item, "enabled": False} if item["id"] == -1001 else item for item in experts]):
        plan = default_task_plan(workspace, "research")
    assert plan["task"]["capabilities"]["expertTeamIds"] == []
    assert plan["warnings"]


def test_disabled_required_tool_blocks_default_plan(workspace):
    tools = workspace.list_tools()
    with patch.object(workspace, "list_tools", return_value=[{**item, "enabled": False} if item["id"] == "run_stock_research" else item for item in tools]):
        with pytest.raises(WorkspaceError, match="白名单"):
            default_task_plan(workspace, "research")


def test_disabled_growth_method_falls_back_visibly(workspace):
    skills = workspace.list_skills()
    with patch.object(workspace, "list_skills", return_value=[{**item, "enabled": False} if item["id"] == "growth_quality" else item for item in skills]):
        plan = default_task_plan(workspace, "research", stock="688981.SH")
    assert any("回退" in message for message in plan["warnings"])
    assert plan["skillNames"] == []


def test_disabled_trading_history_tool_blocks_instead_of_proposing_without_data(workspace):
    tools = workspace.list_tools()
    with patch.object(workspace, "list_tools", return_value=[{**item, "enabled": False} if item["id"] == "get_daily_history" else item for item in tools]):
        with pytest.raises(WorkspaceError, match="日线历史"):
            default_task_plan(workspace, "trading")
