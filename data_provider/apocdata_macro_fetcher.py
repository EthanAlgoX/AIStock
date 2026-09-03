# -*- coding: utf-8 -*-
"""No-credential China macro adapter for the public ApocData API.

ApocData-skill is Apache-2.0 licensed: https://github.com/ApocData/ApocData-skill
Only its documented public API contract is reused; Agent instructions and
network execution stay inside this project's capability boundary.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from .base import BaseFetcher, DataSourceUnavailableError


logger = logging.getLogger(__name__)


class ApocDataMacroFetcher(BaseFetcher):
    """Fetch GDP/CPI/PPI/PMI releases from ApocData's public endpoint."""

    name = "ApocDataMacroFetcher"
    priority = -8
    macro_regions = {"global", "cn", "hk"}
    _API_URL = "https://www.apocdata.com/api/blade-dataplatform/open/data/macro"
    _INDICATORS = {
        "PMI": ("china_pmi", "中国制造业 PMI", "指数"),
        "CPI": ("china_cpi_yoy", "中国 CPI 同比", "%"),
        "PPI": ("china_ppi_yoy", "中国 PPI 同比", "%"),
        "GDP": ("china_gdp_yoy", "中国 GDP 同比", "%"),
    }

    def __init__(self, timeout: float = 6.0):
        self.timeout = max(0.5, float(timeout))

    def is_available_for_request(self, capability: str = "") -> bool:
        return capability == "macro_indicators"

    def _fetch_raw_data(self, stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        raise DataSourceUnavailableError("ApocData 宏观接口不提供个股 K 线")

    def _normalize_data(self, df: pd.DataFrame, stock_code: str) -> pd.DataFrame:
        return df

    def _fetch_indicator(self, indicator_type: str) -> Optional[Dict[str, Any]]:
        response = requests.get(
            self._API_URL,
            params={"type": indicator_type, "limit": 2},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        records = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(records, dict):
            records = records.get("list") or records.get("records") or records.get("data")
        if not isinstance(records, list) or not records:
            return None

        key, name, unit = self._INDICATORS[indicator_type]
        value_field = "value" if indicator_type == "PMI" else "yoy_growth"

        def numeric(record: dict[str, Any]) -> Optional[float]:
            raw = record.get(value_field)
            if raw in (None, "") and indicator_type != "PMI":
                raw = record.get("value")
            try:
                return float(raw)
            except (TypeError, ValueError):
                return None

        current_record = records[0]
        current = numeric(current_record)
        if current is None:
            return None
        previous = numeric(records[1]) if len(records) > 1 else current
        previous = current if previous is None else previous
        change_pct = ((current - previous) / abs(previous) * 100) if previous else 0.0
        return {
            "key": key,
            "name": name,
            "current": current,
            "previous": previous,
            "change_pct": change_pct,
            "change_label": "较前值",
            "unit": unit,
            "frequency": "quarterly" if indicator_type == "GDP" else "monthly",
            "as_of": str(current_record.get("period") or current_record.get("updated_at") or ""),
            "source": "ApocData 公共宏观接口",
        }

    def get_macro_indicators(self) -> Optional[List[Dict[str, Any]]]:
        rows: Dict[str, Dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="apoc_macro") as executor:
            futures = {
                executor.submit(self._fetch_indicator, indicator_type): indicator_type
                for indicator_type in self._INDICATORS
            }
            for future in as_completed(futures):
                indicator_type = futures[future]
                try:
                    item = future.result()
                except Exception as exc:
                    logger.warning("[ApocData] 获取 %s 失败: %s", indicator_type, exc)
                    continue
                if item:
                    rows[item["key"]] = item
        return [rows[item[1][0]] for item in self._INDICATORS.items() if item[1][0] in rows] or None
