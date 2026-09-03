from unittest.mock import patch

from src.agent.factory import get_tool_registry
from src.agent.tools.screening_tools import _handle_screen_stock_universe


def test_screening_tool_is_registered_as_financial_compute_capability():
    tool = get_tool_registry().get("screen_stock_universe")

    assert tool is not None
    assert tool.category == "screening"
    assert tool.policy.read_only is True
    assert "screening:compute" in tool.policy.permissions


def test_screening_tool_delegates_to_existing_pipeline_and_caps_result_count():
    expected = {"candidate_count": 1, "candidates": [{"symbol": "600519"}]}
    with patch(
        "src.services.screening_service.ScreeningService.screen",
        return_value=expected,
    ) as screen:
        result = _handle_screen_stock_universe(
            market="CN",
            strategy="quality_value",
            max_results=500,
        )

    assert result == expected
    screen.assert_called_once_with(
        strategy="quality_value",
        market="cn",
        max_results=50,
    )
