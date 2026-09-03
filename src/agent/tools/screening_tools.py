# -*- coding: utf-8 -*-
"""Deterministic stock-universe screening tool for the financial Agent."""

from __future__ import annotations

from src.agent.tools.execution import check_tool_execution
from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolPolicy


_SCREENING_POLICY = ToolPolicy.declared(
    read_only=True,
    side_effects=["network_read", "compute"],
    permissions=["market_data:read", "screening:compute"],
)


def _handle_screen_stock_universe(
    market: str = "cn",
    strategy: str = "balanced_alpha",
    max_results: int = 20,
) -> dict:
    """Run the existing screening pipeline instead of inventing candidates."""
    from src.config import get_config
    from src.services.screening_service import ScreeningService

    normalized_market = str(market or "cn").strip().lower()
    if normalized_market not in {"cn", "hk", "us"}:
        raise ValueError("market must be one of: cn, hk, us")
    normalized_count = max(1, min(int(max_results), 50))
    check_tool_execution()
    result = ScreeningService(config=get_config()).screen(
        strategy=str(strategy or "balanced_alpha").strip(),
        market=normalized_market,
        max_results=normalized_count,
    )
    check_tool_execution()
    return result


screen_stock_universe_tool = ToolDefinition(
    name="screen_stock_universe",
    description=(
        "Run the platform's real stock-universe screening pipeline and return ranked candidates. "
        "Choose one strategy matching the objective: dual_low, quality_value, blue_chip_income, "
        "momentum_quality, balanced_alpha, volume_breakout, shrink_pullback, "
        "low_volatility_quality, oversold_reversal, or capital_heat. "
        "Use this before producing a CandidateList; never invent unscanned candidates."
    ),
    parameters=[
        ToolParameter(
            name="market",
            type="string",
            description="Market universe: cn, hk, or us.",
            required=False,
            default="cn",
            enum=["cn", "hk", "us"],
        ),
        ToolParameter(
            name="strategy",
            type="string",
            description="Registered deterministic screening strategy identifier.",
            required=False,
            default="balanced_alpha",
            enum=[
                "dual_low",
                "quality_value",
                "blue_chip_income",
                "momentum_quality",
                "balanced_alpha",
                "volume_breakout",
                "shrink_pullback",
                "low_volatility_quality",
                "oversold_reversal",
                "capital_heat",
            ],
        ),
        ToolParameter(
            name="max_results",
            type="integer",
            description="Maximum number of ranked candidates, from 1 to 50.",
            required=False,
            default=20,
        ),
    ],
    handler=_handle_screen_stock_universe,
    category="screening",
    policy=_SCREENING_POLICY,
)


ALL_SCREENING_TOOLS = [screen_stock_universe_tool]
