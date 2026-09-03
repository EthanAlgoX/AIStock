# -*- coding: utf-8 -*-
"""Capability grant integrity and runtime-name contract tests."""

from __future__ import annotations

import pytest

from src.agent.capability_grants import (
    CapabilityGrantError,
    build_runtime_capability_policy,
    runtime_mcp_tool_name,
    verify_capability_grant,
)


def test_runtime_policy_and_signed_gateway_claims_are_exact() -> None:
    manifest = {
        "skillIds": ["bull_trend"],
        "dataSources": [{"id": "system_market_data"}],
        "runtimePolicy": {
            "gatewayToolIds": ["get_realtime_quote"],
            "runtimeToolIds": ["mcp_finance_get_realtime_quote"],
        },
    }

    policy = build_runtime_capability_policy(
        manifest,
        session_id="session-1",
        stock_codes=["600519.SH"],
        configured_secret="test-secret",
    )
    claims = verify_capability_grant(
        policy["gateway_grant"],
        configured_secret="test-secret",
    )

    assert policy["allowed_tools"] == ["mcp_finance_get_realtime_quote"]
    assert policy["allowed_skills"] == ["bull_trend"]
    assert claims.gateway_tool_ids == {"get_realtime_quote"}
    assert claims.data_source_ids == {"system_market_data"}
    assert claims.stock_codes == {"600519.SH"}


def test_tampered_gateway_grant_is_rejected() -> None:
    policy = build_runtime_capability_policy(
        {"runtimePolicy": {"gatewayToolIds": [], "runtimeToolIds": []}},
        session_id="session-1",
        configured_secret="test-secret",
    )
    token = policy["gateway_grant"]

    with pytest.raises(CapabilityGrantError):
        verify_capability_grant(token + "x", configured_secret="test-secret")


def test_external_runtime_mcp_name_matches_runtime_limit_contract() -> None:
    short = runtime_mcp_tool_name("finance", "get_realtime_quote")
    long = runtime_mcp_tool_name("finance", "x" * 100)

    assert short == "mcp_finance_get_realtime_quote"
    assert len(long) == 64
