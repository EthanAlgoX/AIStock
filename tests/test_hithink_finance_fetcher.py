# -*- coding: utf-8 -*-
"""Offline contract tests for the HiThink Financial API provider."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data_provider.base import DataFetchError
from data_provider.hithink_finance_fetcher import HiThinkFinanceFetcher
from data_provider.realtime_types import RealtimeSource
from src.config import Config


def _response(payload: dict, status_code: int = 200) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


def _fetcher(*responses: MagicMock, max_retries: int = 3) -> tuple[HiThinkFinanceFetcher, MagicMock]:
    session = MagicMock()
    session.get.side_effect = list(responses)
    fetcher = HiThinkFinanceFetcher(
        api_key="secret-for-test",
        base_url="https://finance.example.test",
        timeout=4,
        max_retries=max_retries,
        session=session,
        sleeper=lambda _seconds: None,
    )
    return fetcher, session


def test_daily_history_resolves_symbol_and_normalizes_official_contract() -> None:
    fetcher, session = _fetcher(
        _response({"code": 0, "message": "ok", "data": {"item": [{
            "thscode": "600519.SH", "ticker": "600519", "name": "贵州茅台",
            "asset_type": "a-share",
        }]}}),
        _response({"code": 0, "message": "ok", "data": {"item": [{
            "date_ms": 1725148800000, "open_price": 1400, "high_price": 1420,
            "low_price": 1390, "close_price": 1410, "volume": 12345,
            "turnover": 17300000,
        }]}}),
    )

    result = fetcher.get_daily_data("600519", start_date="2024-09-01", end_date="2024-09-02")

    assert list(result["code"]) == ["600519"]
    assert result.iloc[0]["close"] == 1410
    assert result.iloc[0]["amount"] == 17300000
    assert result.iloc[0]["date"] == pd.Timestamp("2024-09-01")
    assert session.get.call_count == 2
    search_call, history_call = session.get.call_args_list
    assert search_call.kwargs["params"]["asset_type"] == "a-share"
    assert history_call.kwargs["params"]["thscode"] == "600519.SH"
    assert history_call.kwargs["params"]["adjust"] == "forward"
    assert history_call.kwargs["headers"] == {"X-api-key": "secret-for-test", "Accept": "application/json"}


def test_explicit_exchange_code_does_not_need_meta_lookup() -> None:
    fetcher, session = _fetcher(
        _response({"code": 0, "message": "ok", "data": {"item": []}}),
    )

    raw = fetcher._fetch_raw_data("000001.SZ", "2024-09-01", "2024-09-02")

    assert raw.empty
    assert session.get.call_count == 1
    assert session.get.call_args.kwargs["params"]["thscode"] == "000001.SZ"


def test_realtime_quote_maps_snapshot_fields() -> None:
    fetcher, _session = _fetcher(
        _response({"code": 0, "message": "ok", "data": {"item": [{
            "thscode": "000001.SZ", "ticker": "000001", "last_price": 12.5,
            "price_change": 0.3, "price_change_ratio_pct": 2.46,
            "open_price": 12.2, "high_price": 12.8, "low_price": 12.1,
            "prev_price": 12.2, "volume": 1000, "turnover": 12300,
        }]}}),
    )

    quote = fetcher.get_realtime_quote("000001.SZ")

    assert quote is not None
    assert quote.source is RealtimeSource.HITHINK_FINANCE
    assert quote.price == 12.5
    assert quote.change_pct == 2.46
    assert quote.volume == 1000
    assert quote.currency == "CNY"


def test_retryable_provider_code_is_bounded() -> None:
    fetcher, session = _fetcher(
        _response({"code": 4001, "message": "busy", "data": {}}),
        _response({"code": 0, "message": "ok", "data": {"item": []}}),
    )

    data = fetcher._request("/api/a-share/prices/snapshot", {"thscodes": "600519.SH"})

    assert data == {"item": []}
    assert session.get.call_count == 2


def test_auth_error_does_not_retry_or_expose_key() -> None:
    fetcher, session = _fetcher(
        _response({"code": 2003, "message": "invalid key", "data": {}}),
    )

    with pytest.raises(DataFetchError) as raised:
        fetcher._request("/api/a-share/prices/snapshot", {"thscodes": "600519.SH"})

    assert session.get.call_count == 1
    assert "secret-for-test" not in str(raised.value)


def test_http_client_error_does_not_retry() -> None:
    fetcher, session = _fetcher(_response({}, status_code=401))

    with pytest.raises(DataFetchError, match="HTTP 401"):
        fetcher._request("/api/a-share/prices/snapshot", {"thscodes": "600519.SH"})

    assert session.get.call_count == 1


def test_provider_error_preserves_request_id_without_key() -> None:
    fetcher, _session = _fetcher(
        _response({
            "code": 3001,
            "message": "ticker not found",
            "request_id": "req-123",
            "data": None,
        }),
    )

    with pytest.raises(DataFetchError) as raised:
        fetcher._request("/api/a-share/prices/snapshot", {"thscodes": "600519.SH"})

    assert "request_id=req-123" in str(raised.value)
    assert "secret-for-test" not in str(raised.value)


@patch("src.config.get_config")
def test_manager_registers_provider_only_with_configured_key(mock_config: MagicMock) -> None:
    mock_config.return_value = MagicMock(
        hithink_finance_api_key="configured-key",
        hithink_finance_base_url="https://finance.example.test",
        hithink_finance_timeout_seconds=3,
        hithink_finance_priority=0,
        max_retries=1,
        tushare_token=None,
        tickflow_api_key=None,
        finnhub_api_key=None,
        alphavantage_api_key=None,
        longbridge_app_key=None,
        longbridge_app_secret=None,
        longbridge_access_token=None,
        longbridge_oauth_client_id=None,
    )
    from data_provider.base import DataFetcherManager

    manager = DataFetcherManager()

    assert "HiThinkFinanceFetcher" in manager.available_fetchers


@patch("src.config.get_config")
def test_manager_skips_provider_without_key(mock_config: MagicMock) -> None:
    mock_config.return_value = MagicMock(
        hithink_finance_api_key=None,
        tushare_token=None,
        tickflow_api_key=None,
        finnhub_api_key=None,
        alphavantage_api_key=None,
        longbridge_app_key=None,
        longbridge_app_secret=None,
        longbridge_access_token=None,
        longbridge_oauth_client_id=None,
    )
    from data_provider.base import DataFetcherManager

    manager = DataFetcherManager()

    assert "HiThinkFinanceFetcher" not in manager.available_fetchers


def test_normalize_empty_history_keeps_standard_schema() -> None:
    fetcher, _session = _fetcher()
    result = fetcher._normalize_data(pd.DataFrame(), "600519")
    assert list(result.columns) == ["code", "date", "open", "high", "low", "close", "volume", "amount", "pct_chg"]


def test_provider_is_filtered_from_non_cn_daily_routes() -> None:
    from data_provider.base import DataFetcherManager

    fetcher, _session = _fetcher()

    assert DataFetcherManager._filter_daily_fetchers_for_market([fetcher], "hk") == []
    assert DataFetcherManager._filter_daily_fetchers_for_market([fetcher], "us") == []
    assert DataFetcherManager._filter_daily_fetchers_for_market([fetcher], "cn") == [fetcher]


def test_configured_key_is_auto_injected_into_default_realtime_chain() -> None:
    with patch.dict("os.environ", {"HITHINK_FINANCE_API_KEY": "configured"}, clear=True):
        assert Config._resolve_realtime_source_priority() == (
            "hithink_finance,tencent,akshare_sina,efinance,akshare_em"
        )


def test_explicit_realtime_chain_is_preserved() -> None:
    with patch.dict(
        "os.environ",
        {
            "HITHINK_FINANCE_API_KEY": "configured",
            "REALTIME_SOURCE_PRIORITY": "tencent,hithink_finance",
        },
        clear=True,
    ):
        assert Config._resolve_realtime_source_priority() == "tencent,hithink_finance"
