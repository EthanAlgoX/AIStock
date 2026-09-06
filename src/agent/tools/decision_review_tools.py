"""Read-only decision history for Agent planning; no orders or signal mutation."""

from src.agent.tools.execution import check_tool_execution
from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolPolicy


def get_stock_decision_review(stock_code: str) -> dict:
    from src.services.decision_signal_service import DecisionSignalService
    from src.services.decision_signal_outcome_service import DecisionSignalOutcomeService
    check_tool_execution()
    if not stock_code.strip():
        raise ValueError("必须指定股票代码。")
    signals = DecisionSignalService().list_signals(stock_code=stock_code.strip(), page_size=5)
    outcomes = DecisionSignalOutcomeService()
    items = []
    for signal in signals["items"]:
        check_tool_execution()
        items.append({"signal": signal, "outcomes": outcomes.list_signal_outcomes(signal["id"])["items"]})
    return {"items": items, "executionEnabled": False,
            "note": "历史信号与后验评估，不是当前买卖许可；未评估不等于有效，历史表现不代表未来。"}


ALL_DECISION_REVIEW_TOOLS = [ToolDefinition(
    name="get_stock_decision_review",
    description="Read the latest five persisted signals and recorded forward outcomes for one stock. Preserve source report IDs, expiration, missing evidence and evaluation status; never interpret these as executed orders or current account risk approval.",
    parameters=[ToolParameter("stock_code", "string", "Exact stock code to review.")],
    handler=get_stock_decision_review, category="analysis",
    policy=ToolPolicy.declared(read_only=True, side_effects=["db_read"], permissions=["research:read"], scope_dimensions=["stock"]),
)]
