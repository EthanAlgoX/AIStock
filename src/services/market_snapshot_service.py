# -*- coding: utf-8 -*-
"""Read-only live market snapshots for the Web market workspace."""

from __future__ import annotations

import copy
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

from src.market_analyzer import MarketAnalyzer, MarketOverview


_SUPPORTED_REGIONS = frozenset({"cn", "hk", "us"})
_REGION_LABELS = {"cn": "A 股", "hk": "港股", "us": "美股"}
_CACHE_TTL_SECONDS = 120.0
_cache_lock = threading.Lock()
_snapshot_cache: dict[str, tuple[float, Dict[str, Any]]] = {}


def _serialize_snapshot(analyzer: MarketAnalyzer, overview: MarketOverview) -> Dict[str, Any]:
    indices = [item.to_dict() for item in overview.indices]
    macro_indicators = [dict(item) for item in overview.macro_indicators if isinstance(item, dict)]
    has_breadth = overview.up_count + overview.down_count + overview.flat_count > 0
    has_limits = overview.limit_up_count + overview.limit_down_count > 0
    has_any_data = bool(indices or macro_indicators or has_breadth or overview.top_sectors or overview.bottom_sectors)
    warnings = []
    if not indices:
        warnings.append("main_indices_unavailable")
    if not macro_indicators:
        warnings.append("macro_indicators_unavailable")

    payload: Dict[str, Any] = {
        "version": 1,
        "kind": "market_snapshot",
        "region": analyzer.region,
        "market_scope": _REGION_LABELS[analyzer.region],
        "generated_at": datetime.now().astimezone().isoformat(),
        "date": overview.date,
        "indices": indices,
        "macro_indicators": macro_indicators,
        "analysis_skills": analyzer._get_macro_skill_ids(),
        "sectors": {
            "top": list(overview.top_sectors or []),
            "bottom": list(overview.bottom_sectors or []),
        },
        "data_quality": (
            "ok" if indices and macro_indicators else "partial" if has_any_data else "unavailable"
        ),
        "warnings": warnings,
    }
    if has_breadth or has_limits:
        payload["breadth"] = {
            "up_count": overview.up_count,
            "down_count": overview.down_count,
            "flat_count": overview.flat_count,
            "limit_up_count": overview.limit_up_count,
            "limit_down_count": overview.limit_down_count,
            "total_amount": overview.total_amount,
            "turnover_unit": analyzer._get_turnover_unit_label(),
        }
    return payload


def get_current_market_snapshot(
    region: str,
    *,
    config: Optional[Any] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Fetch a live structured snapshot without running an LLM review.

    A short process-local cache keeps tab switching responsive and prevents the
    public providers from receiving duplicate requests from the same page.
    """

    normalized_region = str(region or "").strip().lower()
    if normalized_region not in _SUPPORTED_REGIONS:
        raise ValueError(f"market region must be one of cn, hk, us: {region}")

    now = time.monotonic()
    if not force_refresh:
        with _cache_lock:
            cached = _snapshot_cache.get(normalized_region)
            if cached and now - cached[0] <= _CACHE_TTL_SECONDS:
                return copy.deepcopy(cached[1])

    analyzer = MarketAnalyzer(region=normalized_region, config=config)
    snapshot = _serialize_snapshot(analyzer, analyzer.get_market_overview())
    with _cache_lock:
        _snapshot_cache[normalized_region] = (time.monotonic(), copy.deepcopy(snapshot))
    return snapshot
