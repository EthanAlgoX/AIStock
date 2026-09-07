from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.agent.factory import get_tool_registry
from src.agent.tool_surface import ToolSurface
from src.agent.tools.execution import ToolAccessContext
from src.agent.tools.workflow_tools import execute_research_workflow, list_research_workflows
from src.services.strategy_definition_service import StrategyDefinitionService
from src.services.workspace_service import WorkspaceService
from src.storage import DatabaseManager


@pytest.fixture
def definitions(tmp_path):
    DatabaseManager.reset_instance()
    db = DatabaseManager(f"sqlite:///{tmp_path / 'workflow.db'}")
    service = StrategyDefinitionService(db)
    service.ensure_daily_product_strategies()
    with patch("src.agent.tools.workflow_tools.StrategyDefinitionService", return_value=service):
        yield service
    DatabaseManager.reset_instance()


def test_discovery_only_exposes_published_configurations(definitions):
    items = list_research_workflows()["items"]
    assert {item["contract"] for item in items} == {"ResearchReport", "CandidateList"}
    for item in items:
        version = definitions.get_version(item["versionId"])
        assert version["status"] == "PUBLISHED"
        assert version["productRole"] != "kernel"


def test_research_template_skills_reach_actual_analysis_entry(definitions):
    items = [item for item in list_research_workflows()["items"] if item["contract"] == "ResearchReport"]
    assert len(items) == 5
    growth = next(item for item in items if "成长质量" in item["name"])
    with patch("src.services.analysis_service.AnalysisService.analyze_stock", return_value={"report": {"summary": {"analysis_summary": "成长研究"}}}) as analyze:
        result = execute_research_workflow(growth["versionId"], "research_report", {"symbol": "600519"}, market="CN")
    assert analyze.call_args.kwargs["skills"] == ["growth_quality"]
    assert result["researchSkills"] == ["growth_quality"]


@pytest.mark.parametrize("symbol", ["688981.SH", "300750.SZ", "920748.BJ", "688981.SS", "SH688981"])
def test_frontend_stock_codes_reach_actual_analysis_entry(definitions, symbol):
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "ResearchReport")
    with patch("src.services.analysis_service.AnalysisService.analyze_stock", return_value={"report": {"summary": {"analysis_summary": "研究报告"}}}) as analyze:
        result = execute_research_workflow(version_id, "research_report", {"symbol": symbol}, market="CN")
    assert result["status"] == "success"
    assert analyze.call_args.kwargs["stock_code"] == symbol


@pytest.mark.parametrize("symbol", ["00981.HK", "HK00981", "AAPL", "688981.INVALID", "68898.SH", ""])
def test_stock_alias_support_does_not_bypass_market_validation(definitions, symbol):
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "ResearchReport")
    with patch("src.services.analysis_service.AnalysisService.analyze_stock") as analyze:
        with pytest.raises(ValueError, match="股票市场"):
            execute_research_workflow(version_id, "research_report", {"symbol": symbol}, market="CN")
    analyze.assert_not_called()


def test_formal_research_method_also_controls_host_interpretation(definitions):
    growth = next(item for item in list_research_workflows()["items"] if "成长质量" in item["name"])
    service = WorkspaceService(definitions.db)
    service._set_run_stage = Mock()
    service._store_artifact = Mock()
    service.resolve_skill_selection = Mock(return_value=([], ""))
    service._expanded_expert_ids = Mock(return_value=[])
    service._call_agent = Mock(return_value=SimpleNamespace(success=True, content='{"conclusion":"成长研究"}', backend="test", model="test", tool_calls_log=[]))
    task = {"kind": "research", "name": "成长", "objective": "成长质量", "market": "CN", "subject": {"stock": "600519"},
            "config": {"strategyVersionId": growth["versionId"]}, "capabilities": {"toolIds": ["run_stock_research"]}}
    with patch("src.services.analysis_service.AnalysisService.analyze_stock", return_value={"report": {"summary": {"analysis_summary": "成长研究"}}}):
        service._execute_agent_task("run", task, Event())
    assert service._call_agent.call_args.args[4] == ["growth_quality"]


def test_all_screening_presets_reach_kernel_with_their_frozen_rule(definitions):
    workflows = [item for item in list_research_workflows()["items"] if item["contract"] == "CandidateList"]
    assert len(workflows) == 10
    with patch("src.services.screening_service.ScreeningService.screen", return_value={"candidates": [], "warnings": []}) as screen:
        for workflow in workflows:
            policy = workflow["screeningPolicy"]
            result = execute_research_workflow(workflow["versionId"], "candidate_screening", {}, market="CN")
            assert result["status"] == "success"
            assert screen.call_args.kwargs["strategy"] == policy["strategy"]
            assert screen.call_args.kwargs["max_results"] == policy["maxCandidates"]
            assert screen.call_args.kwargs["market"] == "cn"
        assert screen.call_count == 10


def test_real_kernel_boundary_preserves_report_and_rejects_wrong_purpose(definitions):
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "ResearchReport")
    payload = {"query_id": "report-trace", "report": {"summary": {"analysis_summary": "原始结论"}}}
    with patch("src.services.analysis_service.AnalysisService.analyze_stock", return_value=payload) as analyze:
        result = execute_research_workflow(version_id, "research_report", {"symbol": "600519"}, market="CN")
        assert result["result"] == payload
        assert result["workflowVersionId"] == version_id
        assert result["evidenceRefs"][0]["queryId"] == "report-trace"
        assert all(item["available"] is None for item in result["dataCoverage"].values())
        assert analyze.call_args.kwargs["send_notification"] is False
        assert analyze.call_args.kwargs["agent_mode"] is False
        with pytest.raises(ValueError, match="市场"):
            execute_research_workflow(version_id, "research_report", {"symbol": "AAPL"}, market="US")
        with pytest.raises(ValueError, match="股票市场"):
            execute_research_workflow(version_id, "research_report", {"symbol": "AAPL"})
        with pytest.raises(ValueError, match="类型"):
            execute_research_workflow(version_id, "candidate_screening", {})
        assert analyze.call_count == 1


def test_research_tool_enforces_stock_scope_before_running():
    scope = SimpleNamespace(expected_stock_code="600519", allowed_stock_codes={"600519"})
    result = ToolSurface(get_tool_registry()).execute_tool(
        "run_stock_research", {"strategy_version_id": 1, "stock_code": "AAPL"},
        ToolAccessContext(stock_scope=scope),
    )
    assert not result["ok"]


def test_workspace_stores_kernel_output_before_agent_interpretation(definitions):
    service = WorkspaceService(definitions.db)
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "CandidateList")
    task = {"kind": "screening", "name": "筛选", "market": "CN", "objective": "低估值",
            "config": {"strategyVersionId": version_id}, "capabilities": {"toolIds": ["run_stock_screening"]}}
    saved = []
    service._store_artifact = lambda run, kind, title, content, text=None: saved.append((kind, content))
    service.resolve_skill_selection = Mock(return_value=([], ""))
    service._expanded_expert_ids = Mock(return_value=[])
    service._call_agent = Mock(return_value=SimpleNamespace(success=True, content='{"conclusion":"解读"}', backend="test", model="test", tool_calls_log=[]))
    candidates = {"candidates": [{"code": "600519", "score": 80}], "warnings": []}
    with patch("src.services.screening_service.ScreeningService.screen", return_value=candidates):
        result = service._execute_agent_task("run", task, Event())
    assert result["success"]
    assert [kind for kind, _ in saved] == ["CandidateList", "ScreenSpec", "ResearchInterpretation"]
    assert saved[0][1]["result"] == candidates
    assert "600519" in service._call_agent.call_args.args[1]


def test_workflow_is_not_run_without_granted_tool():
    service = WorkspaceService.__new__(WorkspaceService)
    result = service._execute_agent_task("run", {
        "kind": "research", "config": {"strategyVersionId": 1}, "capabilities": {},
    }, Event())
    assert result["errorCode"] == "workflow_tool_required"


def test_standard_research_does_not_change_global_agent_mode():
    from src.services.analysis_service import AnalysisService

    configuration = SimpleNamespace(agent_mode=True)
    with patch("src.config.get_config", return_value=configuration), patch("src.core.pipeline.StockAnalysisPipeline") as pipeline:
        pipeline.return_value.process_single_stock.return_value = None
        AnalysisService().analyze_stock("600519", agent_mode=False, send_notification=False)
        assert pipeline.call_args.kwargs["config"].agent_mode is False
        assert configuration.agent_mode is True


def test_chat_workflow_returns_a_persisted_report_link(definitions):
    from src.agent.tools.workflow_tools import run_stock_screening

    workspace = WorkspaceService(definitions.db)
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "CandidateList")
    with patch("src.services.screening_service.ScreeningService.screen", return_value={"candidates": [], "run_id": "scan-1"}), patch("src.services.workspace_service.WorkspaceService", return_value=workspace):
        result = run_stock_screening(version_id)
    run = workspace.get_run(result["workspaceRunId"])
    assert result["reportUrl"] == f"/runs/{run['id']}"
    assert run["status"] == "completed"
    assert run["artifacts"][0]["content"]["evidenceRefs"] == [{"type": "screening_history", "runId": "scan-1"}]
    assert workspace.get_task(run["taskId"])["enabled"] is False


def test_workflow_inside_workspace_keeps_one_run_and_separate_interpretation(definitions):
    from src.agent.tools.workflow_tools import run_stock_screening
    class ImmediateExecutor:
        def submit(self, function, *args):
            function(*args)

    workspace = WorkspaceService(definitions.db)
    version_id = next(item["versionId"] for item in list_research_workflows()["items"] if item["contract"] == "CandidateList")
    task = workspace.create_task({"kind": "screening", "name": "一次研究", "market": "CN", "objective": "筛选",
                                  "capabilities": workspace.default_bindings("screening")})

    def agent(*args):
        result = run_stock_screening(version_id)
        assert result["workspaceRunId"] == args[0]
        return SimpleNamespace(success=True, content='{"conclusion":"解读已生成的候选"}', backend="test", model="test", tool_calls_log=[])

    with patch("src.services.workspace_service._WORKERS", ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=agent), patch("src.services.screening_service.ScreeningService.screen", return_value={"candidates": []}), patch("src.services.workspace_service.WorkspaceService", return_value=workspace):
        run = workspace.create_run(task["id"])
    assert run["status"] == "completed"
    assert run["outcome"]["status"] == "empty"
    assert [a["type"] for a in run["artifacts"]] == ["CandidateList", "ResearchInterpretation"]
    assert len(workspace.list_runs()) == 1
    assert len(workspace.list_tasks()) == 1
