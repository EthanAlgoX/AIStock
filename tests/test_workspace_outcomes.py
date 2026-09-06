import pytest

from src.services.workspace_outcomes import business_outcome, valid_artifact


def formal(rows):
    return [{"type": "CandidateList", "content": {"status": "success", "result": {"candidates": rows}}}]


def test_completion_is_not_business_success():
    for content in ({}, {"status": "success", "candidates": [{"code": "invented"}]}):
        assert business_outcome("completed", "screening", [{"type": "CandidateList", "content": content}])["status"] == "unverified"


def test_blocked_legacy_markdown_is_not_empty_success():
    artifacts = [{"text": '工具受限\n```json\n{"CandidateList":{"status":"not_executed","candidates":[]}}\n```'}]
    assert business_outcome("completed", "screening", artifacts)["status"] == "blocked"
    assert business_outcome("completed", "screening", formal([]), formal=True)["status"] == "empty"
    assert business_outcome("completed", "screening", formal([{"code": "600519"}]), formal=True)["status"] == "produced"


@pytest.mark.parametrize("state", ["failed", "cancelled"])
def test_partial_formal_results_survive_terminal_failure(state):
    assert business_outcome(state, "screening", formal([]), formal=True)["status"] == "partial"


def test_bad_formal_shape_and_invalid_trade_never_claim_production():
    assert business_outcome("completed", "screening", formal([{}]), formal=True)["status"] == "unverified"
    assert not valid_artifact("TradeProposal", {"actions": [{"symbol": "600519"}]})
    assert not valid_artifact("CandidateList", {"candidates": "none"})
    assert not valid_artifact("ScreenSpec", {"conclusion": "未执行"})
    assert business_outcome("completed", "trading", [{"type": "TradeProposal", "content": {"actions": []}}])["status"] == "proposal"


def test_free_text_never_drives_business_status():
    assert business_outcome("completed", "research", [{"text": "报告说 failed 这个词不代表失败"}])["status"] == "unverified"


def test_multiple_scans_do_not_hide_nonempty_results():
    artifacts = formal([]) + formal([{"code": "600519"}])
    assert business_outcome("completed", "screening", artifacts, formal=True)["status"] == "produced"


@pytest.mark.parametrize("key", ["executionStatus", "execution_status"])
def test_legacy_execution_status_blocks_empty_candidate_claim(key):
    content = {key: "not_executed", "candidates": []}
    assert not valid_artifact("CandidateList", content)
    assert business_outcome("completed", "screening", [{"type": "CandidateList", "content": content}])["status"] == "blocked"
