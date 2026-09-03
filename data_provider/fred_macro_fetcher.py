# -*- coding: utf-8 -*-
"""Official FRED macro-series adapter used by the financial Agent surface.

The series selection and observation contract are adapted from the MIT-licensed
``fred-macro`` Agent Skill in https://github.com/gauss314/skills.  Network
access is implemented locally so third-party Skill scripts never bypass the
workspace capability gateway.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from .base import BaseFetcher, DataSourceUnavailableError


logger = logging.getLogger(__name__)


class FredMacroFetcher(BaseFetcher):
    """Read a bounded set of official US/global macro observations from FRED."""

    name = "FredMacroFetcher"
    priority = -10
    macro_regions = {"global", "cn", "hk", "us"}
    _API_URL = "https://api.stlouisfed.org/fred/series/observations"
    _SERIES = {
        "us_2y": ("DGS2", "美国 2 年期国债收益率", "%", "daily"),
        "us_10y": ("DGS10", "美国 10 年期国债收益率", "%", "daily"),
        "us_10y_real": ("DFII10", "美国 10 年期实际利率", "%", "daily"),
        "us_high_yield_spread": ("BAMLH0A0HYM2", "美国高收益债利差", "%", "daily"),
        "vix": ("VIXCLS", "VIX", "点", "daily"),
        "brent": ("DCOILBRENTEU", "Brent 原油", "美元/桶", "daily"),
        "us_cpi": ("CPIAUCSL", "美国 CPI", "指数", "monthly"),
        "us_unemployment": ("UNRATE", "美国失业率", "%", "monthly"),
    }

    def __init__(self, api_key: str, timeout: float = 6.0):
        self.api_key = (api_key or "").strip()
        self.timeout = max(0.5, float(timeout))

    def is_available_for_request(self, capability: str = "") -> bool:
        return bool(self.api_key) and capability == "macro_indicators"

    def _fetch_raw_data(self, stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        raise DataSourceUnavailableError("FRED 仅提供宏观指标，不提供个股 K 线")

    def _normalize_data(self, df: pd.DataFrame, stock_code: str) -> pd.DataFrame:
        return df

    def _fetch_series(self, key: str, definition: tuple[str, str, str, str]) -> Optional[Dict[str, Any]]:
        series_id, name, unit, frequency = definition
        response = requests.get(
            self._API_URL,
            params={
                "series_id": series_id,
                "api_key": self.api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 8,
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        observations = response.json().get("observations") or []
        usable: list[tuple[str, float]] = []
        for item in observations:
            try:
                value = float(item.get("value"))
            except (TypeError, ValueError):
                continue
            usable.append((str(item.get("date") or ""), value))
            if len(usable) == 2:
                break
        if not usable:
            return None
        as_of, current = usable[0]
        previous = usable[1][1] if len(usable) > 1 else current
        change_pct = ((current - previous) / abs(previous) * 100) if previous else 0.0
        return {
            "key": key,
            "name": name,
            "current": current,
            "previous": previous,
            "change_pct": change_pct,
            "change_label": "较前值",
            "unit": unit,
            "frequency": frequency,
            "as_of": as_of,
            "source": f"FRED ({series_id})",
        }

    def get_macro_indicators(self) -> Optional[List[Dict[str, Any]]]:
        if not self.api_key:
            return None
        rows: Dict[str, Dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="fred_macro") as executor:
            futures = {
                executor.submit(self._fetch_series, key, definition): key
                for key, definition in self._SERIES.items()
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    item = future.result()
                except Exception as exc:
                    logger.warning("[FRED] 获取 %s 失败: %s", key, exc)
                    continue
                if item:
                    rows[key] = item
        return [rows[key] for key in self._SERIES if key in rows] or None
