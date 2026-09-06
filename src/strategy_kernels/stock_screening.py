"""Trusted adapter for the mature deterministic/LLM screening pipeline."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def run(context: dict[str, Any]) -> dict[str, Any]:
    from src.config import get_config
    from src.services.screening_service import ScreeningService
    from src.storage import DatabaseManager

    inputs = context.get("inputs") if isinstance(context.get("inputs"), dict) else {}
    parameters = context.get("parameters") if isinstance(context.get("parameters"), dict) else {}
    configuration = context.get("configuration") if isinstance(context.get("configuration"), dict) else {}
    screening_policy = configuration.get("screeningPolicy") if isinstance(configuration.get("screeningPolicy"), dict) else {}
    result = ScreeningService(get_config(), DatabaseManager.get_instance()).screen(
        strategy=str(parameters.get("screeningStrategy") or screening_policy.get("strategy") or inputs.get("strategy") or "dual_low"),
        market=str(configuration.get("market") or inputs.get("market") or "cn"),
        max_results=max(1, min(int(parameters.get("maxResults") or screening_policy.get("maxCandidates") or inputs.get("maxResults") or 3), 100)),
        selection_seed=str(inputs.get("selectionSeed") or ""),
        data_source_config=configuration.get("dataSources") if isinstance(configuration.get("dataSources"), dict) else None,
    )
    return {
        "status": "success",
        "contract": "CandidateList",
        "strategyId": context.get("strategyId"),
        "strategyVersion": context.get("strategyVersion"),
        "asOf": context.get("asOf") or datetime.now(timezone.utc).isoformat(),
        "result": result,
        "dataCoverage": {
            key: {**value, "configured": value.get("available"), "available": None, "verification": "see_screening_result"}
            for key, value in (context.get("dataCoverage") or {}).items()
        },
        "warnings": list(context.get("warnings") or []) + list(result.get("warnings") or []),
        "evidenceRefs": ([{"type": "screening_history", "runId": result["run_id"]}]
                         if result.get("run_id") else []),
    }
