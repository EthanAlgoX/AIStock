"""Exercise the real discussion coordinator and durable ledger without model/network calls."""
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tests.test_workspace_service import workspace, _empty_bindings, _task_payload, _ImmediateExecutor  # noqa: F401
from src.services.workspace_service import WorkspaceError


def result(content, success=True):
    return SimpleNamespace(success=success, content=content, error=None if success else "provider unavailable",
                           error_code=None, backend="test", model="test")


@pytest.mark.parametrize("mode", ["pipeline", "voting"])
def test_collaboration_isolates_workers_and_supervisor(workspace, mode):
    sessions = []

    def collaborate(suffix, prompt, task, *args):
        sessions.append(suffix)
        if suffix.endswith("-plan"):
            assert not any(task["capabilities"].values())
            return result(json.dumps({"assignments": [{"expertId": -1001, "task": "分析现金流"},
                                                       {"expertId": -1002, "task": "核查估值假设"}]}))
        if "-expert-" in suffix:
            if suffix.endswith("-1002"):
                assert ("FIRST_REPORT" in prompt) == (mode == "pipeline")
            return result("## FIRST_REPORT\n现金流风险" if suffix.endswith("-1001") else "## SECOND_REPORT\n估值假设")
        assert not any(task["capabilities"].values())
        if "-judge-" in suffix:
            assert "FIRST_REPORT" in prompt and "SECOND_REPORT" in prompt
            assert "prior_judge_secret" not in prompt
            return result('{"expertId":-1002,"reason":"prior_judge_secret"}')
        return result("## 总结\n保留风险")

    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=collaborate):
        run = workspace.create_run(workspace.create_task(payload(collaborationMode=mode))["id"])
    assert run["status"] == "completed"
    assert len(sessions) == len(set(sessions))
    report = next(a["content"] for a in run["artifacts"] if a["type"] == "ExpertReview")
    assert report["collaborationMode"] == mode
    assert not report["failures"]
    assert not any("questions-" in s or "evidence" in s for s in sessions)
    if mode == "voting":
        assert report["voting"]["winnerExpertId"] == -1002
        assert len(report["voting"]["ballots"]) == 3
        assert "SECOND_REPORT" in report["conclusion"]


@pytest.mark.parametrize("votes", [[-1001, -1002, None], [999, True, -1001]])
def test_votes_cannot_create_a_winner_without_two_valid_votes(workspace, votes):
    def collaborate(suffix, *args):
        if "-judge-" in suffix:
            return result(json.dumps({"expertId": votes[int(suffix[-1]) - 1], "reason": "质量判断"}))
        return result("## 独立报告")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=collaborate):
        run = workspace.create_run(workspace.create_task(payload(collaborationMode="voting"))["id"])
    report = next(a["content"] for a in run["artifacts"] if a["type"] == "ExpertReview")
    assert report["voting"]["winnerExpertId"] is None
    assert report["conclusion"].startswith("## 评审结果：未选出报告")
    assert run["outcome"]["status"] == "partial"


def test_pipeline_rejects_duplicate_assignment_before_experts_run(workspace):
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result(
            '{"assignments":[{"expertId":-1001,"task":"A"},{"expertId":-1001,"task":"B"}]}')) as calls:
        run = workspace.create_run(workspace.create_task(payload(collaborationMode="pipeline"))["id"])
    assert run["status"] == "failed"
    assert calls.call_count == 1
    assert not any(a["type"] == "ExpertOpinion" for a in run["artifacts"])


def test_invalid_collaboration_mode_is_rejected(workspace):
    with pytest.raises(WorkspaceError):
        workspace.create_task(payload(collaborationMode="random"))


def test_followup_inherits_collaboration_mode(workspace):
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result("## 报告")):
        first = workspace.create_run(workspace.create_task(payload(collaborationMode="voting"))["id"])
    task = workspace.create_task(payload(parentDiscussionRunId=first["id"], collaborationMode="pipeline"))
    assert task["config"]["collaborationMode"] == "voting"


def test_explicit_group_reconfiguration_freezes_new_round_without_changing_parent(workspace):
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result("## 报告")):
        first = workspace.create_run(workspace.create_task(payload(collaborationMode="voting"))["id"])
        task = workspace.create_task(payload(parentDiscussionRunId=first["id"], collaborationMode="debate",
                                             reconfigureDiscussion=True))
        second = workspace.create_run(task["id"])
    assert second["taskSnapshot"]["config"]["collaborationMode"] == "debate"
    assert second["taskSnapshot"]["config"]["parentDiscussionRunId"] == first["id"]
    assert workspace.get_run(first["id"])["taskSnapshot"]["config"]["collaborationMode"] == "voting"
    assert second["taskSnapshot"]["discussionSnapshot"]["references"][0]["runId"] == first["id"]


def test_group_reconfiguration_still_validates_members_and_flag(workspace):
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", return_value=result("## 报告")):
        first = workspace.create_run(workspace.create_task(payload(collaborationMode="voting"))["id"])
    invalid = payload(parentDiscussionRunId=first["id"], reconfigureDiscussion=True)
    invalid["capabilities"]["expertIds"] = [-1001]
    with pytest.raises(WorkspaceError):
        workspace.create_task(invalid)
    with pytest.raises(WorkspaceError):
        workspace.create_task(payload(parentDiscussionRunId=first["id"], reconfigureDiscussion="true"))


def test_voting_cancel_does_not_start_judges_or_synthesis(workspace):
    def cancel_worker(suffix, prompt, task, cancel, *args):
        cancel.set()
        return result("## 已保存意见")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=cancel_worker) as calls:
        run = workspace.create_run(workspace.create_task(payload(collaborationMode="voting"))["id"])
    assert run["status"] == "cancelled"
    assert calls.call_count == 1
    assert any(a["type"] == "ExpertOpinion" for a in run["artifacts"])


def test_chat_binding_saves_same_conversation_and_context_once(workspace):
    workspace.db.save_conversation_message("chat-user-1", "user", "继续讨论这家公司现金流")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=agent):
        run = workspace.create_run(workspace.create_task(payload(chatSessionId="chat-user-1"))["id"])
    assert run["status"] == "completed"
    history = workspace.db.get_visible_conversation_messages("chat-user-1")
    assert [m["role"] for m in history] == ["user", "user", "assistant"]
    assert "综合结论" in history[-1]["content"]
    assert run["id"] in history[-1]["content"]
    assert "现金流" in run["taskSnapshot"]["discussionSnapshot"]["chatHistory"][0]["content"]
    workspace._finish_run(run["id"], "completed")
    assert len(workspace.db.get_visible_conversation_messages("chat-user-1")) == 3
    assert workspace.db.get_visible_conversation_messages("chat-user-2") == []


@pytest.mark.parametrize("chat_id", ["workspace-private", "", 123, "../bad", "x" * 101])
def test_chat_binding_rejects_invalid_or_internal_session_ids(workspace, chat_id):
    with pytest.raises(WorkspaceError):
        workspace.create_task(payload(chatSessionId=chat_id))


def test_chat_deleted_during_research_is_not_resurrected(workspace):
    def delete_chat(suffix, *args):
        workspace.db.delete_conversation_session("chat-delete")
        return result('{"questions": []}' if "questions-" in suffix else "## 已完成")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=delete_chat):
        run = workspace.create_run(workspace.create_task(payload(chatSessionId="chat-delete"))["id"])
    assert run["status"] == "completed"
    assert workspace.db.get_visible_conversation_messages("chat-delete") == []
    assert any(a["type"] == "ExpertReview" for a in run["artifacts"])


def test_restart_publishes_interrupted_chat_reply_once(workspace):
    with patch("src.services.workspace_service._WORKERS"):
        run = workspace.create_run(workspace.create_task(payload(chatSessionId="chat-restart"))["id"])
    assert workspace.reconcile_interrupted_runs() == 1
    assert workspace.reconcile_interrupted_runs() == 0
    history = workspace.db.get_visible_conversation_messages("chat-restart")
    assert len(history) == 2
    assert "未完成" in history[-1]["content"]
    assert workspace.get_run(run["id"])["status"] == "failed"


def payload(**config):
    return _task_payload(kind="expert_review", capabilities=_empty_bindings(expertIds=[-1001, -1002]),
                         config={"discussionProtocol": "cross_response_v1", **config})


def test_new_personas_reach_independent_agents_and_frozen_snapshot(workspace):
    data = payload()
    data["capabilities"] = _empty_bindings(expertIds=[-1012, -1013])
    expected = {expert_id: workspace.get_expert(expert_id)["prompt"] for expert_id in [-1012, -1013]}
    sessions = []

    def respond(suffix, prompt, task, *args):
        if "-expert-" in suffix:
            expert_id = next(expert_id for expert_id in expected if suffix.endswith(str(expert_id)))
            assert expected[expert_id] in prompt
            sessions.append(suffix)
        return result('{"questions": []}' if "questions-" in suffix else "## 结论\n本角色的证据与风险。")

    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=respond):
        run = workspace.create_run(workspace.create_task(data)["id"])
    assert run["status"] == "completed"
    assert len(set(sessions)) == 2
    frozen = run["taskSnapshot"]["discussionSnapshot"]["members"]
    assert {m["expert"]["id"]: m["expert"]["prompt"] for m in frozen} == expected
    workspace.update_expert(-1012, {"prompt": "后续自定义"})
    assert workspace.get_run(run["id"])["taskSnapshot"]["discussionSnapshot"]["members"] == frozen


def agent(suffix, prompt, task, cancel, skills, instructions):
    if "questions-" in suffix:
        return result(json.dumps({"questions": [{"expertId": -1001, "question": "请回应另一位专家的现金流反例。"}]}))
    if "-synthesis" in suffix:
        assert "请回应另一位专家的现金流反例" in prompt
        assert "保留风险" in prompt
        return result("## 综合结论\n\n证据不足以消除风险。\n\n## 分歧\n\n现金流假设尚未解决。")
    if "-response-" in suffix:
        assert "其他观点与此前回应" in prompt
        assert "现金流" in prompt
        return result("## 回应\n\n修正判断，保留风险。")
    return result('{"thesis":"现金流存在不确定性","evidence":["测试证据"],"confidence":0.5}')


def test_real_cross_response_and_frozen_profiles(workspace):
    task = workspace.create_task(payload(expertCapabilities={"-1001": {"skillIds": [], "toolIds": [], "mcpIds": [], "dataSourceIds": []}}))
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=agent) as calls:
        run = workspace.create_run(task["id"])
    assert run["status"] == "completed"
    types = [a["type"] for a in run["artifacts"]]
    assert types.count("ExpertReview") == 1
    assert types.count("ExpertOpinion") == 2
    assert types.count("ExpertResponse") == 1
    assert "DiscussionEvidence" in types
    assert run["taskSnapshot"]["discussionSnapshot"]["members"][0]["expert"]["prompt"]
    host_calls = [c for c in calls.call_args_list if "questions-" in c.args[0] or "synthesis" in c.args[0]]
    assert all(not any(c.args[2]["capabilities"].values()) for c in host_calls)
    assert "### 核心判断" in next(a["text"] for a in run["artifacts"] if a["type"] == "ExpertOpinion")


@pytest.mark.parametrize("config", [
    {"crossExaminationRounds": 0}, {"crossExaminationRounds": True}, {"crossExaminationRounds": 3},
    {"expertCapabilities": {"-1001": {"toolIds": ["get_daily_history"]}}},
    {"expertCapabilities": {"999": {}}}, {"expertCapabilities": {"-1001": {"expertIds": [-1002]}}},
    {"expertCapabilities": {"-1001": {"skillIds": "oops"}}},
])
def test_reject_invalid_protocol_and_permission_escalation(workspace, config):
    with pytest.raises(WorkspaceError):
        workspace.create_task(payload(**config))


def test_requires_two_distinct_members(workspace):
    data = payload()
    data["capabilities"]["expertIds"] = [-1001, -1001]
    with pytest.raises(WorkspaceError):
        workspace.create_task(data)


def test_followup_freezes_server_report_and_preserves_previous_run(workspace):
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=agent):
        first = workspace.create_run(workspace.create_task(payload())["id"])
        task = workspace.create_task(payload(parentDiscussionRunId=first["id"]))
        second = workspace.create_run(task["id"])
    reference = second["taskSnapshot"]["discussionSnapshot"]["references"][0]
    assert reference["runId"] == first["id"]
    assert "证据不足" in reference["artifacts"][0]["excerpt"]
    assert workspace.get_run(first["id"])["artifacts"] == first["artifacts"]


def test_no_conflict_exits_early_without_manufactured_responses(workspace):
    def no_conflict(suffix, *args):
        return result('{"questions": []}' if "questions-" in suffix else "## 结论\n暂无方向性冲突。")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=no_conflict):
        run = workspace.create_run(workspace.create_task(payload(crossExaminationRounds=2))["id"])
    assert run["status"] == "completed"
    assert not any(a["type"] == "ExpertResponse" for a in run["artifacts"])
    assert sum(a["type"] == "DiscussionQuestions" for a in run["artifacts"]) == 1


@pytest.mark.parametrize("response", ['not json', '{"questions":[{"expertId":999,"question":"invalid"}]}'])
def test_bad_moderation_is_failure_not_consensus(workspace, response):
    def malformed(suffix, *args):
        return result(response if "questions-" in suffix else "## 测试意见")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=malformed):
        run = workspace.create_run(workspace.create_task(payload())["id"])
    report = next(a["content"] for a in run["artifacts"] if a["type"] == "ExpertReview")
    assert report["failures"]
    assert not report["responses"]


def test_partial_expert_failure_keeps_surviving_opinion(workspace):
    def partial(suffix, *args):
        if "expert--1001" in suffix:
            raise RuntimeError("provider failed")
        return result("## 可用意见")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=partial):
        run = workspace.create_run(workspace.create_task(payload())["id"])
    assert run["status"] == "completed"
    assert run["resultSummary"]["expertCount"] == 1
    assert run["outcome"]["status"] == "partial"
    assert run["resultSummary"]["failedStageCount"] > 0
    assert len([a for a in run["artifacts"] if a["type"] == "ExpertOpinion"]) == 2


def test_cancel_retains_finished_evidence(workspace):
    def cancel_after_evidence(suffix, prompt, task, cancel, *args):
        cancel.set()
        return result("## 已完成的公共证据")
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=cancel_after_evidence):
        run = workspace.create_run(workspace.create_task(payload())["id"])
    assert run["status"] == "cancelled"
    assert any(a["type"] == "DiscussionEvidence" for a in run["artifacts"])


def test_update_and_run_revalidate_expert_permissions(workspace):
    task = workspace.create_task(payload())
    with pytest.raises(WorkspaceError):
        workspace.update_task(task["id"], {"config": {"discussionProtocol": "cross_response_v1", "crossExaminationRounds": 9}})
    workspace.update_expert(-1002, {"enabled": False})
    with pytest.raises(WorkspaceError):
        workspace.create_run(task["id"])


def test_total_deadline_stops_new_calls_and_preserves_evidence(workspace):
    clock = [0]

    def expire(*args):
        clock[0] = 601
        return result("## 超时前取得的证据")

    with patch("src.services.workspace_discussion.time", SimpleNamespace(monotonic=lambda: clock[0])), \
            patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), \
            patch.object(workspace, "_call_agent", side_effect=expire) as calls:
        run = workspace.create_run(workspace.create_task(payload())["id"])
    assert run["status"] == "failed"
    assert run["errorCode"] == "discussion_timeout"
    assert calls.call_count == 1
    assert any(a["type"] == "DiscussionEvidence" for a in run["artifacts"])


def test_executor_receives_real_member_tool_subset_and_remaining_budget(workspace):
    import threading
    import time
    executor = SimpleNamespace(timeout_seconds=800, max_steps=20, chat=lambda *args, **kwargs: result("ok"))
    task = {**payload(), "discussionDeadline": time.monotonic() + 30}
    task["capabilities"] = _empty_bindings(toolIds=["get_daily_history", "run_stock_research"])
    with patch("src.agent.factory.build_agent_chat_executor", return_value=executor) as build:
        workspace._call_agent("test", "question", task, threading.Event(), [], "")
    assert build.call_args.kwargs["tool_ids"] == ["get_daily_history"]
    assert 0 < executor.timeout_seconds <= 30
    assert executor.max_steps == 6


def test_followup_does_not_silently_adopt_edited_team_or_persona(workspace):
    team = workspace.list_expert_teams()[0]
    data = payload()
    data["capabilities"] = _empty_bindings(expertTeamIds=[team["id"]])
    with patch("src.services.workspace_service._WORKERS", _ImmediateExecutor()), patch.object(workspace, "_call_agent", side_effect=agent):
        first = workspace.create_run(workspace.create_task(data)["id"])
        frozen = first["taskSnapshot"]["discussionSnapshot"]["members"]
        workspace.update_expert_team(team["id"], {"memberIds": [-1001, -1002]})
        workspace.update_expert(-1001, {"prompt": "变更后的角色，不应出现在追问中"})
        next_task = workspace.create_task(payload(parentDiscussionRunId=first["id"]))
        second = workspace.create_run(next_task["id"])
    assert next_task["capabilities"]["expertTeamIds"] == []
    assert next_task["capabilities"]["expertIds"] == [m["expert"]["id"] for m in frozen]
    assert second["taskSnapshot"]["discussionSnapshot"]["members"] == frozen
    assert second["taskSnapshot"]["capabilitySnapshot"]["experts"] == [
        {"id": m["expert"]["id"], "version": m["expert"]["version"]} for m in frozen
    ]
