"""The Agent tool uses the real analyzer and preserves unavailable evidence."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest

from src.agent.tools.analysis_tools import _handle_analyze_trend


@pytest.mark.parametrize("partial", [False, True])
def test_agent_analysis_tool_preserves_nulls_and_pending_event_boundary(partial):
    closes = [100.0] * 20 + [102.0]
    df = pd.DataFrame({
        "date": pd.date_range("2026-09-01", periods=21, freq="B"),
        "open": closes, "close": closes,
        "high": [price + 1 for price in closes],
        "low": [price - 1 for price in closes],
        "volume": [100.0] * 21,
        "is_partial_bar": [False] * 20 + [partial],
    })
    with patch("src.agent.tools.analysis_tools._fetch_trend_data", return_value=df), patch(
        "src.stock_analyzer.get_config", return_value=SimpleNamespace(bias_threshold=5.0),
    ):
        output = _handle_analyze_trend("600519")
    assert "error" not in output
    assert output["ma60"] is None
    assert output["macd_dif"] is output["macd_status"] is None
    assert output["rsi_24"] is output["rsi_status"] is None
    assert output["indicator_availability"]["macd"] is False
    assert output["current_price"] == 102.0
    if partial:
        assert output["rule_events"] == []
    else:
        assert output["rule_events"][0]["rule_id"] == "range20"
    json.dumps(output, allow_nan=False)
