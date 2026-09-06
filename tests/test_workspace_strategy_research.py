from threading import Event
from unittest.mock import Mock, patch
from types import SimpleNamespace

import pytest

from src.services.workspace_deliberation import material_expert_conflicts
from src.services.workspace_service import WorkspaceService, WorkspaceError
from src.services.workspace_outcomes import business_outcome


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
