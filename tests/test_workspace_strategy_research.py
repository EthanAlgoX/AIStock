from threading import Event
from unittest.mock import Mock, patch
from types import SimpleNamespace

import pytest

from src.services.workspace_deliberation import material_expert_conflicts
from src.services.workspace_service import WorkspaceService, WorkspaceError
from src.services.workspace_outcomes import business_outcome


def test_formal_research_passes_frozen_method_into_report_generation():
    from src.strategy_kernels.single_stock_research import run

    with patch("src.services.analysis_service.AnalysisService") as service_type:
        service_type.return_value.analyze_stock.return_value = {"query_id": "report-1", "report": {"summary": {}}}
        result = run({"inputs": {"symbol": "600519", "methodInstructions": "核对财报时点"},
                      "parameters": {"analysisMode": "standard"}, "runId": "run-1"})
    assert result["status"] == "success"
    assert service_type.return_value.analyze_stock.call_args.kwargs["analysis_instructions"] == "核对财报时点"
    assert service_type.return_value.analyze_stock.call_args.kwargs["agent_mode"] is False


@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("kind", ["research", "screening", "trading"])
def test_task_prompts_keep_scenario_contracts_separate(kind, completed):
    task = dict(kind=kind, name="测试", market="CN", objective="应用同一个 Skill",
                config={}, subject={})
    if completed:
        task["workflowResult"] = {"result": {"summary": "本次证据"}}
    prompt = WorkspaceService._task_prompt(task)
    roles = {"research": "你是个股研究 Agent", "screening": "你是策略选股 Agent",
             "trading": "你是交易计划 Agent"}
    assert roles[kind] in prompt
    assert all(role not in prompt for other, role in roles.items() if other != kind)
    if kind == "research":
        assert "历史评分" in prompt
        assert "候选补充研究" not in prompt
    if kind == "screening":
        assert "匹配评分" in prompt
        assert "实际持仓背景" not in prompt
    if not completed and kind == "trading":
        assert '"TradeProposal"' in prompt


def test_research_interpretation_uses_holdings_but_watch_does_not():
    task = dict(kind="research", name="测试", market="CN", objective="研究", subject={},
                config={}, portfolioContext={"account_name": "持仓账户甲", "quantity": 123},
                workflowResult={"result": {"score": 72}})
    prompt = WorkspaceService._task_prompt(task)
    assert "这是持仓研究" in prompt and "持仓账户甲" in prompt and "123" in prompt
    task["config"] = {"portfolioWatch": {"symbol": "600519"}}
    prompt = WorkspaceService._task_prompt(task)
    assert "这是只关注股票研究" in prompt
    assert "持仓账户甲" not in prompt
    assert "实际持仓背景" not in prompt


@pytest.mark.parametrize("watch", [False, True])
def test_formal_research_receives_frozen_context_and_watch_overrides_it(watch):
    service = WorkspaceService.__new__(WorkspaceService)
    service.resolve_skill_selection = Mock(return_value=([], ""))
    service._set_run_stage = Mock()
    task = dict(kind="research", config={"strategyVersionId": 1}, subject={"stock": "600519"},
                market="CN", capabilities={"toolIds": ["run_stock_research"]},
                portfolioContext={"quantity": 100, "avg_cost": 10})
    if watch:
        task["config"]["portfolioWatch"] = {"symbol": "600519"}
    # Stop after the real task dispatch boundary; no model or ledger mutations needed.
    with patch("src.agent.tools.workflow_tools.execute_research_workflow",
               return_value={"status": "failed", "message": "stop after capture"}) as execute:
        service._execute_agent_task("test", task, Event())
    inputs = execute.call_args.args[2]
    assert inputs["portfolioContext"] == ({} if watch else task["portfolioContext"])
    assert inputs["watchResearch" if watch else "holdingResearch"] is True


def test_frozen_screening_method_does_not_enter_candidate_research():
    service = WorkspaceService.__new__(WorkspaceService)
    service._set_run_stage = Mock()
    service._store_artifact = Mock()
    service._research_screening_candidates = Mock(side_effect=RuntimeError("captured"))
    task = {"kind": "screening", "name": "筛选", "market": "CN", "objective": "寻找高量高波动",
            "subject": {}, "capabilities": {"toolIds": ["run_stock_screening"], "skillIds": ["screen-method"]},
            "config": {"strategyVersionId": 2, "deepResearchCount": 1, "deepResearchVersionId": 3,
                       "methodSnapshot": {"skills": [{"id": "screen-method", "name": "选股方法",
                                                     "instructions": "只解读候选", "builtIn": False}]}}}
    with patch("src.agent.tools.workflow_tools.execute_research_workflow",
               return_value={"status": "success", "contract": "CandidateList", "result": {"candidates": []}}):
        with pytest.raises(RuntimeError, match="captured"):
            service._execute_agent_task("run", task, Event())
    assert service._research_screening_candidates.call_args.args[3] == []


def test_only_valid_high_confidence_directional_conflicts_trigger_review():
    def opinion(identifier, stance, confidence):
        return {"expertId": identifier, "structured": {"stance": stance, "confidence": confidence}}
    assert material_expert_conflicts([opinion(1, "buy", .8), opinion(2, "sell", .8)])
    assert not material_expert_conflicts([opinion(1, "buy", .8), opinion(2, "buy", .9)])
    assert not material_expert_conflicts([opinion(1, "buy", .8), opinion(2, "sell", .3)])
    assert not material_expert_conflicts([opinion(1, "buy", float("nan")), opinion(2, "sell", .8)])
    assert not material_expert_conflicts([opinion(1, "可能上涨", .8), opinion(2, "sell", .8)])


@pytest.mark.parametrize("count", [-1, 4, "3", True])
def test_candidate_budget_is_server_validated(count):
    with pytest.raises(WorkspaceError, match="数量"):
        WorkspaceService._validate_task_contract("screening", {}, {"deepResearchCount": count}, {"toolIds": []})


def test_candidate_depth_requires_explicit_tool_and_workflows():
    with pytest.raises(WorkspaceError, match="工具权限"):
        WorkspaceService._validate_task_contract("screening", {}, {
            "strategyVersionId": 2, "deepResearchVersionId": 3, "deepResearchCount": 1,
        }, {"toolIds": ["run_stock_screening"]})


def test_deep_research_preserves_rank_deduplicates_caps_calls_and_keeps_failures():
    service = WorkspaceService.__new__(WorkspaceService)
    service._set_run_stage = Mock()
    service._store_artifact = Mock()
    rows = [{"code": "000001", "rank": 1}, {"code": "000001", "rank": 1}, {"code": "600519", "rank": 2}, {"code": "600036", "rank": 3}]
    task = {"market": "CN", "config": {"deepResearchCount": 2, "deepResearchVersionId": 12}, "workflowResult": {"result": {"candidates": rows}}}
    with patch("src.agent.tools.workflow_tools.execute_research_workflow", side_effect=[{"status": "success", "result": {"report": {}}}, ValueError("新闻不可用")]) as execute:
        result = service._research_screening_candidates("run", task, Event(), ["growth_quality"])
    assert execute.call_count == 2
    assert execute.call_args.args[2] == {"symbol": "600519", "skills": ["growth_quality"]}
    assert result["workflowResult"]["result"]["candidates"] == rows
    assert [entry["screeningRank"] for entry in result["candidateResearch"]] == [1, 2]
    assert result["candidateResearch"][1]["report"]["status"] == "failed"
    assert service._store_artifact.call_count == 2
    artifacts = [{"type": "CandidateList", "content": {"status": "success", "result": {"candidates": rows}}},
                 {"type": "CandidateResearch", "content": result["candidateResearch"][1]}]
    assert business_outcome("completed", "screening", artifacts, formal=True)["status"] == "partial"


def test_cancelled_candidate_research_does_not_start_another_report():
    service = WorkspaceService.__new__(WorkspaceService)
    service._set_run_stage = Mock()
    service._store_artifact = Mock()
    cancelled = Event()
    task = {"market": "CN", "config": {"deepResearchCount": 2, "deepResearchVersionId": 12}, "workflowResult": {"result": {"candidates": [{"code": "000001"}, {"code": "600519"}]}}}
    def finish_first(*args, **kwargs):
        cancelled.set()
        return {"status": "success"}
    with patch("src.agent.tools.workflow_tools.execute_research_workflow", side_effect=finish_first) as execute:
        result = service._research_screening_candidates("run", task, cancelled, [])
    assert execute.call_count == 1
    assert len(result["candidateResearch"]) == 1


def test_expert_opposition_triggers_one_review_and_preserves_original_opinions():
    service = WorkspaceService.__new__(WorkspaceService)
    service.get_expert = lambda identifier: {"name": str(identifier), "prompt": "独立研究"}
    service._set_run_stage = Mock()
    service._store_artifact = Mock()
    def result(content):
        return SimpleNamespace(success=True, content=content, backend="test", model="test", error=None, error_code=None)
    service._call_agent = Mock(side_effect=[
        result('{"stance":"buy","confidence":0.8}'),
        result('{"stance":"sell","confidence":0.9}'),
        result("## 尚未解决\n不同数据时点导致分歧"),
        result("保留分歧，等待验证"),
    ])
    task = {"kind": "expert_review", "name": "测试", "market": "CN", "objective": "比较证据", "config": {}, "subject": {}}
    outcome = service._execute_expert_task("run", task, Event(), [1, 2], [], "")
    assert outcome["success"]
    assert service._call_agent.call_count == 4
    records = {call.args[1]: call.args[3] for call in service._store_artifact.call_args_list}
    assert records["ExpertReview"]["opinions"][0]["structured"]["stance"] == "buy"
    assert records["ExpertReview"]["opinions"][1]["structured"]["stance"] == "sell"
    assert records["ExpertDisagreement"]["content"].startswith("## 尚未解决")
