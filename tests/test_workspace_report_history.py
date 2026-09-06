from copy import deepcopy

from src.services.workspace_report_history import annotate_report_history
from src.services.workspace_outcomes import business_outcome, normalize_trade_proposal, report_artifacts, valid_artifact


def records():
    target_id = "b" * 32
    original = {"id": "a" * 32, "kind": "research", "status": "completed", "triggerType": "manual",
                "createdAt": "2026-09-06T16:10:00Z", "completedAt": "2026-09-06T16:16:00Z",
                "taskSnapshot": {"name": "比亚迪 个股分析", "market": "CN", "subject": {"stock": "002594.SZ"}},
                "artifacts": [{"text": f"正式报告 /runs/{target_id}", "content": {}}]}
    target = {"id": target_id, "kind": "research", "status": "completed", "triggerType": "agent_tool",
              "createdAt": "2026-09-06T16:14:00Z", "outcome": {"status": "produced"},
              "taskSnapshot": {"market": "CN", "subject": {"stock": "002594"}}, "artifacts": []}
    return [original, target]


def test_exact_link_matching_stock_market_and_time_groups_legacy_report():
    items = records()
    original_artifacts = deepcopy(items[0]["artifacts"])
    annotate_report_history(items)
    assert items[0]["primaryReportRunId"] == items[1]["id"]
    assert items[1]["relatedRunIds"] == [items[0]["id"]]
    assert items[1]["reportTitle"] == "比亚迪 个股分析"
    assert items[0]["artifacts"] == original_artifacts


def test_unrelated_old_reference_and_different_stock_are_never_merged():
    for field, value in [("createdAt", "2026-09-05T00:00:00Z"), ("triggerType", "manual")]:
        items = records()
        items[1][field] = value
        annotate_report_history(items)
        assert "primaryReportRunId" not in items[0]
    items = records()
    items[1]["taskSnapshot"]["subject"]["stock"] = "600519"
    annotate_report_history(items)
    assert "primaryReportRunId" not in items[0]


def test_trade_report_aliases_are_recovered_without_trusting_execution_claims():
    saved = [{"id": "old", "type": "AgentResponse", "text": "original", "content": {
        "TradeProposal": {"proposals": [{"ticker": "000333", "side": "BUY", "shares": 0}]},
        "RiskAssessment": {"approved": True}, "PaperTradingRun": {"simulatedFillsCreated": 99},
    }}]
    before = deepcopy(saved)
    rendered = report_artifacts("trading", saved)
    assert saved == before
    assert rendered[0]["type"] == "TradeProposal"
    assert rendered[0]["content"]["actions"][0]["symbol"] == "000333"
    assert not any(a["type"] == "PaperTradingRun" for a in rendered)
    assert business_outcome("completed", "trading", rendered)["status"] == "proposal"
    assert valid_artifact("TradeProposal", normalize_trade_proposal(saved[0]["content"]["TradeProposal"]))


def test_failed_no_candidates_is_not_a_completed_scan():
    content = {"status": "FAILED_NO_CANDIDATES", "candidates": [], "failure_reason": "无美股策略"}
    assert not valid_artifact("CandidateList", content)
    assert business_outcome("completed", "screening", [{"content": content}])["status"] == "blocked"
