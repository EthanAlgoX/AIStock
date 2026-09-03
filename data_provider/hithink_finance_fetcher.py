# -*- coding: utf-8 -*-
"""HiThink Financial API adapter for A-share market data.

The provider is optional: it is registered only when
``HITHINK_FINANCE_API_KEY`` is configured.  Remote failures are surfaced as
``DataFetchError`` so ``DataFetcherManager`` can continue its normal fallback
chain.  Credentials are sent only in the ``X-api-key`` request header and are
never included in logs or exception messages.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from .base import BaseFetcher, DataFetchError, STANDARD_COLUMNS, normalize_stock_code
from .realtime_types import RealtimeSource, UnifiedRealtimeQuote, safe_float, safe_int


logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://fuyao.aicubes.cn"
_CN_TZ = ZoneInfo("Asia/Shanghai")
_MAIN_INDICES = {
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
    "000688.SH": "科创50",
    "000016.SH": "上证50",
    "000300.SH": "沪深300",
}


class HiThinkFinanceFetcher(BaseFetcher):
    """Optional official HiThink Financial API provider for A shares."""

    name = "HiThinkFinanceFetcher"
    priority = 0

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        priority: Optional[int] = None,
        max_retries: int = 3,
        session: Optional[requests.Session] = None,
        sleeper=time.sleep,
    ) -> None:
        from src.config import get_config

        config = get_config()
        self.api_key = (api_key if api_key is not None else getattr(config, "hithink_finance_api_key", None) or "").strip()
        configured_url = base_url if base_url is not None else getattr(config, "hithink_finance_base_url", DEFAULT_BASE_URL)
        self.base_url = self._validate_base_url(configured_url)
        configured_timeout = timeout if timeout is not None else getattr(config, "hithink_finance_timeout_seconds", 15.0)
        self.timeout = max(0.1, float(configured_timeout))
        configured_priority = priority if priority is not None else getattr(config, "hithink_finance_priority", 0)
        self.priority = max(0, int(configured_priority))
        self.max_retries = min(max(1, int(max_retries)), 3)
        self._session = session or requests.Session()
        self._sleep = sleeper
        self._symbol_cache: Dict[str, str] = {}
        self._name_cache: Dict[str, str] = {}

    @staticmethod
    def _validate_base_url(value: Any) -> str:
        normalized = str(value or DEFAULT_BASE_URL).strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("HITHINK_FINANCE_BASE_URL must be an http(s) URL")
        return normalized

    def is_available(self) -> bool:
        return bool(self.api_key)

    def _request(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if not self.api_key:
            raise DataFetchError("HiThink Financial API key is not configured")

        last_error = "request failed"
        for attempt in range(self.max_retries):
            try:
                response = self._session.get(
                    f"{self.base_url}{path}",
                    params=params,
                    headers={"X-api-key": self.api_key, "Accept": "application/json"},
                    timeout=self.timeout,
                )
                if response.status_code >= 500:
                    raise requests.HTTPError(f"server returned HTTP {response.status_code}")
                if response.status_code >= 400:
                    raise DataFetchError(f"HiThink Financial API returned HTTP {response.status_code}")
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise DataFetchError("HiThink Financial API returned a non-object response")

                code = payload.get("code")
                if code == 0:
                    data = payload.get("data")
                    if not isinstance(data, dict):
                        raise DataFetchError("HiThink Financial API response is missing data")
                    return data

                message = str(payload.get("message") or "request rejected").strip()
                request_id = str(payload.get("request_id") or "").strip()
                last_error = f"provider code={code}: {message}"
                if request_id:
                    last_error = f"{last_error} (request_id={request_id})"
                retryable = code == 4001 or (isinstance(code, int) and 5000 <= code < 6000)
                if not retryable:
                    raise DataFetchError(last_error)
            except DataFetchError:
                raise
            except (requests.RequestException, ValueError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"

            if attempt + 1 < self.max_retries:
                self._sleep(min(2 ** attempt, 4))

        raise DataFetchError(f"HiThink Financial API request failed after {self.max_retries} attempts: {last_error}")

    @staticmethod
    def _explicit_thscode(stock_code: str) -> Optional[str]:
        raw = str(stock_code or "").strip().upper()
        if not raw:
            return None
        if "." in raw:
            base, suffix = raw.rsplit(".", 1)
            if base.isdigit() and len(base) == 6 and suffix in {"SH", "SZ", "BJ"}:
                return f"{base}.{suffix}"
        for prefix in ("SH", "SZ", "BJ"):
            value = raw[len(prefix):].lstrip(".") if raw.startswith(prefix) else ""
            if value.isdigit() and len(value) == 6:
                return f"{value}.{prefix}"
        return None

    def _resolve_thscode(self, stock_code: str) -> str:
        explicit = self._explicit_thscode(stock_code)
        if explicit:
            return explicit

        ticker = normalize_stock_code(stock_code)
        if not ticker.isdigit() or len(ticker) != 6:
            raise DataFetchError(f"HiThink Financial API only supports A-share codes: {stock_code}")
        if ticker in self._symbol_cache:
            return self._symbol_cache[ticker]

        data = self._request(
            "/api/meta/tickers/search",
            {"q": ticker, "asset_type": "a-share", "limit": 10},
        )
        matches = [
            item for item in data.get("item", [])
            if isinstance(item, dict)
            and str(item.get("ticker") or "") == ticker
            and str(item.get("asset_type") or "").lower() == "a-share"
        ]
        unique = {str(item.get("thscode") or "").upper(): item for item in matches if item.get("thscode")}
        if len(unique) != 1:
            raise DataFetchError(f"HiThink Financial API could not uniquely resolve A-share code {ticker}")
        thscode, item = next(iter(unique.items()))
        self._symbol_cache[ticker] = thscode
        name = str(item.get("name") or "").strip()
        if name:
            self._name_cache[ticker] = name
        return thscode

    @staticmethod
    def _date_to_ms(value: str, *, end_of_day: bool = False) -> int:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=_CN_TZ)
        if end_of_day:
            parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999000)
        return int(parsed.timestamp() * 1000)

    def _fetch_raw_data(self, stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        thscode = self._resolve_thscode(stock_code)
        data = self._request(
            "/api/a-share/prices/historical",
            {
                "thscode": thscode,
                "interval": "1d",
                "start": self._date_to_ms(start_date),
                "end": self._date_to_ms(end_date, end_of_day=True),
                "adjust": "forward",
                "offset": 0,
            },
        )
        items = data.get("item") or []
        return pd.DataFrame(items if isinstance(items, list) else [])

    def _normalize_data(self, df: pd.DataFrame, stock_code: str) -> pd.DataFrame:
        if df is None or df.empty:
            return pd.DataFrame(columns=["code", *STANDARD_COLUMNS])
        raw = df.copy()
        normalized = pd.DataFrame()
        normalized["code"] = [normalize_stock_code(stock_code)] * len(raw)
        normalized["date"] = (
            pd.to_datetime(raw.get("date_ms"), unit="ms", errors="coerce", utc=True)
            .dt.tz_convert(_CN_TZ)
            .dt.tz_localize(None)
            .dt.normalize()
        )
        for source, target in (
            ("open_price", "open"),
            ("high_price", "high"),
            ("low_price", "low"),
            ("close_price", "close"),
            ("volume", "volume"),
            ("turnover", "amount"),
        ):
            normalized[target] = pd.to_numeric(raw.get(source), errors="coerce")
        normalized["pct_chg"] = normalized["close"].pct_change().fillna(0.0) * 100.0
        normalized = normalized.dropna(subset=["date", "close", "volume"])
        return normalized[["code", *STANDARD_COLUMNS]].reset_index(drop=True)

    def get_realtime_quote(self, stock_code: str) -> Optional[UnifiedRealtimeQuote]:
        try:
            thscode = self._resolve_thscode(stock_code)
            data = self._request("/api/a-share/prices/snapshot", {"thscodes": thscode})
            items = data.get("item") or []
            if not items or not isinstance(items[0], dict):
                return None
            item = items[0]
            ticker = str(item.get("ticker") or normalize_stock_code(stock_code))
            high = safe_float(item.get("high_price"))
            low = safe_float(item.get("low_price"))
            previous = safe_float(item.get("prev_price"))
            amplitude = None
            if high is not None and low is not None and previous and previous > 0:
                amplitude = round((high - low) / previous * 100.0, 2)
            return UnifiedRealtimeQuote(
                code=ticker,
                name=self._name_cache.get(ticker, ""),
                source=RealtimeSource.HITHINK_FINANCE,
                market="cn",
                currency="CNY",
                price=safe_float(item.get("last_price")),
                change_pct=safe_float(item.get("price_change_ratio_pct")),
                change_amount=safe_float(item.get("price_change")),
                volume=safe_int(item.get("volume")),
                amount=safe_float(item.get("turnover")),
                amplitude=amplitude,
                open_price=safe_float(item.get("open_price")),
                high=high,
                low=low,
                pre_close=previous,
            )
        except Exception as exc:
            logger.warning("[HiThinkFinance] realtime quote failed for %s: %s", normalize_stock_code(stock_code), exc)
            return None

    def get_stock_name(self, stock_code: str) -> Optional[str]:
        ticker = normalize_stock_code(stock_code)
        try:
            self._resolve_thscode(stock_code)
        except Exception as exc:
            logger.debug("[HiThinkFinance] symbol lookup failed for %s: %s", ticker, exc)
            return None
        return self._name_cache.get(ticker)

    def get_main_indices(self, region: str = "cn") -> Optional[List[Dict[str, Any]]]:
        if region != "cn" or not self.api_key:
            return None
        try:
            data = self._request(
                "/api/a-share-index/prices/snapshot",
                {"thscodes": ",".join(_MAIN_INDICES)},
            )
        except Exception as exc:
            logger.warning("[HiThinkFinance] main indices failed: %s", exc)
            return None
        results: List[Dict[str, Any]] = []
        for item in data.get("item") or []:
            if not isinstance(item, dict):
                continue
            code = str(item.get("thscode") or "")
            current = safe_float(item.get("last_price"))
            if not code or current is None or not math.isfinite(current):
                continue
            results.append({
                "code": code,
                "name": _MAIN_INDICES.get(code, code),
                "current": current,
                "change": safe_float(item.get("price_change")),
                "change_pct": safe_float(item.get("price_change_ratio_pct")),
                "volume": safe_int(item.get("volume")),
                "amount": safe_float(item.get("turnover")),
            })
        return results or None
