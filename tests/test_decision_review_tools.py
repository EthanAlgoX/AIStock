from types import SimpleNamespace
from unittest.mock import patch

from src.agent.factory import get_tool_registry
from src.agent.tool_surface import ToolSurface
from src.agent.tools.execution import ToolAccessContext
from src.agent.tools.decision_review_tools import get_stock_decision_review


def test_review_tool_respects_stock_scope_before_reading_history():
    scope = SimpleNamespace(expected_stock_code="600519", allowed_stock_codes={"600519"})
    with patch("src.services.decision_signal_service.DecisionSignalService") as service:
        result = ToolSurface(get_tool_registry()).execute_tool("get_stock_decision_review", {"stock_code": "AAPL"}, ToolAccessContext(stock_scope=scope))
    assert not result["ok"]
    service.assert_not_called()


def test_review_reads_existing_outcomes_and_never_runs_evaluation_or_orders():
    with patch("src.services.decision_signal_service.DecisionSignalService") as signals, patch("src.services.decision_signal_outcome_service.DecisionSignalOutcomeService") as outcomes:
        signals.return_value.list_signals.return_value = {"items": [{"id": 7, "stock_code": "600519", "status": "expired"}]}
        outcomes.return_value.list_signal_outcomes.return_value = {"items": [{"eval_status": "unable", "unable_reason": "insufficient_forward_bars"}]}
        result = get_stock_decision_review("600519")
        signals.return_value.list_signals.assert_called_once_with(stock_code="600519", page_size=5)
        outcomes.return_value.list_signal_outcomes.assert_called_once_with(7)
        outcomes.return_value.run_outcomes.assert_not_called()
        signals.return_value.create_signal.assert_not_called()
    assert result["executionEnabled"] is False
    assert result["items"][0]["outcomes"][0]["eval_status"] == "unable"
