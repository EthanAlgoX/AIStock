"""Exercise daily screening evidence through its real bridge and cache paths."""

from unittest.mock import patch
import json
from types import SimpleNamespace
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.services.screening import daily
from src.services.screening_service import (
    _build_screening_dsa_daily_history_fetcher,
    _normalize_dsa_daily_history,
)


def _history(points=61):
    return pd.DataFrame({
        "date": pd.date_range("2025-01-01", periods=points),
        "open": [100.0] * points,
        "high": [101.0] * points,
        "low": [99.0] * points,
        "close": [100.0] * (points - 1) + [110.0],
        "volume": [1000.0] * points,
    })


@pytest.mark.parametrize("nullable", [False, True])
def test_close_only_dsa_history_does_not_invent_ohlcv_evidence(nullable):
    raw = _history()
    for field in ("open", "high", "low", "volume"):
        if nullable:
            raw[field] = None
        else:
            raw = raw.drop(columns=field)
    original = raw.copy(deep=True)
    features = daily.compute_daily_features(_normalize_dsa_daily_history(raw))

    assert features["ma60"] == pytest.approx(100 + 10 / 60, abs=0.0001)
    assert features["ma20"] == 100.5
    for field in ("prev_high_20d", "range_20d_pct", "breakout_20d_pct",
                  "volume_ratio_20d", "body_pct", "atr_20_pct", "consolidation_days_20d"):
        assert features[field] is None, field
    assert features["daily_quality_score"] < 100
    assert "high" in features["daily_quality_flags"]
    pd.testing.assert_frame_equal(raw, original)


@pytest.mark.parametrize("field,value", [
    ("close", None), ("close", np.inf), ("close", 0), ("close", True),
    ("closed", False), ("is_partial_bar", True), ("is_estimated", True),
    ("quality", ["invalid"]),
])
def test_dsa_bridge_and_actual_daily_cache_do_not_join_across_invalid_bars(tmp_path, field, value):
    raw = _history()
    if field not in raw:
        raw[field] = pd.Series([None] * len(raw), dtype=object)
    if field == "close" and isinstance(value, bool):
        raw[field] = raw[field].astype(object)
    raw.at[40, field] = value
    fetcher = _build_screening_dsa_daily_history_fetcher()
    assert fetcher is not None
    with patch("src.services.screening_service.get_dsa_daily_history", return_value=(raw, "database")):
        bridged = fetcher("600519", cache_dir=tmp_path)
    cache_path = daily._daily_history_cache_path(tmp_path, code="600519", source="akshare", lookback_days=120)
    cached = daily._read_daily_history_cache(cache_path, ttl_seconds=60)
    assert cached is not None
    for frame in (bridged, cached):
        features = daily.compute_daily_features(frame)
        assert features["daily_data_points"] == 20
        assert features["ma60"] is None
        assert features["prev_high_20d"] is None
        assert features["breakout_20d_pct"] is None
        assert features["volume_ratio_20d"] is None
        assert features["change_60d"] is None
        assert features["daily_quality_score"] < 100


@pytest.mark.parametrize("marker", ["closed", "is_partial_bar", "is_estimated"])
def test_unclosed_tail_is_excluded_from_daily_screening(marker):
    raw = _history()
    raw[marker] = pd.Series([None] * len(raw), dtype=object)
    raw.at[60, marker] = marker != "closed"
    features = daily.compute_daily_features(_normalize_dsa_daily_history(raw))
    assert features["daily_data_points"] == 60
    assert features["ma20"] == 100.0
    assert features["breakout_20d_pct"] == pytest.approx((100 / 101 - 1) * 100, abs=0.0001)
    assert "partial_bar_excluded" in features["daily_quality_flags"]
    assert features["daily_quality_score"] < 100


@pytest.mark.parametrize("field,value", [("gap_before", True), ("data_source", "other"),
                                        ("adjustment", "hfq"), ("volume_unit", "shares")])
def test_explicit_gap_and_provenance_change_restart_daily_windows(field, value):
    raw = _history()
    raw[field] = pd.Series([None] * len(raw), dtype=object)
    raw.loc[41:, field] = value
    features = daily.compute_daily_features(_normalize_dsa_daily_history(raw))
    # A marker starts the new segment at the marked bar; no calendar gaps are guessed.
    assert features["daily_data_points"] == (1 if field == "gap_before" else 20)
    assert features["ma60"] is None
    assert features["breakout_20d_pct"] is None
    assert "history_boundary" in features["daily_quality_flags"]


@pytest.mark.parametrize("field,value", [("high", np.inf), ("low", -1),
                                        ("volume", np.inf), ("volume", -1)])
def test_non_finite_or_invalid_optional_prices_never_create_shape_evidence(field, value):
    raw = _history()
    raw.at[50, field] = value
    features = daily.compute_daily_features(raw)
    assert features["ma60"] is not None
    if field == "volume":
        assert features["volume_ratio_20d"] is None
    else:
        for name in ("prev_high_20d", "range_20d_pct", "breakout_20d_pct", "atr_20_pct"):
            assert features[name] is None, name
    assert features["daily_quality_score"] < 100


def test_shape_periods_require_full_real_samples_and_zero_volume_is_legitimate():
    short = daily.compute_daily_features(_history(10))
    for field in ("prev_high_20d", "range_20d_pct", "breakout_20d_pct",
                  "volume_ratio_20d", "volatility_20d_pct", "max_drawdown_20d_pct", "atr_20_pct", "change_60d"):
        assert short[field] is None, field
    raw = _history()
    raw.at[len(raw) - 1, "volume"] = 0
    features = daily.compute_daily_features(raw)
    assert features["volume_ratio_20d"] == 0
    assert features["daily_quality_score"] == 70  # Auction close outside session high is a quality flag.


def test_contiguous_complete_history_keeps_numerical_shape_evidence():
    raw = _history()
    raw.at[60, "high"] = 111
    features = daily.compute_daily_features(raw)
    assert features["daily_data_points"] == 61
    assert features["prev_high_20d"] == 101
    assert features["breakout_20d_pct"] == pytest.approx((110 / 101 - 1) * 100, abs=0.0001)
    assert features["change_60d"] == 10
    assert features["volume_ratio_20d"] == 1
    assert features["atr_20_pct"] is not None
    assert features["daily_quality_score"] == 100


@pytest.mark.parametrize("case", ["missing_ohlcv", "invalid_close", "source_change"])
def test_actual_sqlite_history_loader_and_cache_keep_evidence_boundaries(tmp_path, case):
    from src.services.history_loader import reset_frozen_target_date, set_frozen_target_date
    from src.storage import DatabaseManager

    DatabaseManager.reset_instance()
    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / 'history.db'}")
    raw = _history()
    if case == "missing_ohlcv":
        raw = raw.drop(columns=["open", "high", "low", "volume"])
    elif case == "invalid_close":
        raw.at[40, "close"] = None
    token = set_frozen_target_date(raw.iloc[-1]["date"].date())
    try:
        db.save_daily_data(raw, "600519", "primary")
        if case == "source_change":
            db.save_daily_data(raw.iloc[41:], "600519", "secondary")
        fetcher = _build_screening_dsa_daily_history_fetcher()
        with patch("src.storage.get_db", return_value=db), patch(
            "src.services.history_loader._get_fetcher_manager",
            side_effect=AssertionError("A real SQLite cache hit must not fetch network data"),
        ):
            bridged = fetcher("600519", cache_dir=tmp_path / "daily")
        cache_path = daily._daily_history_cache_path(tmp_path / "daily", code="600519", source="akshare", lookback_days=120)
        cached = daily._read_daily_history_cache(cache_path, ttl_seconds=60)
        assert cached is not None
        for frame in (bridged, cached):
            features = daily.compute_daily_features(frame)
            assert features["daily_quality_score"] < 100
            if case == "missing_ohlcv":
                assert features["ma60"] is not None
                assert features["breakout_20d_pct"] is None
                assert features["atr_20_pct"] is None
                assert features["volume_ratio_20d"] is None
            else:
                assert features["daily_data_points"] == 20
                assert features["ma60"] is None
                assert features["breakout_20d_pct"] is None
    finally:
        reset_frozen_target_date(token)
        DatabaseManager.reset_instance()


@pytest.mark.parametrize("source_succeeds", [True, False])
def test_actual_fetch_rejects_v1_fabricated_cache_even_as_stale_fallback(tmp_path, source_succeeds):
    cache_path = daily._daily_history_cache_path(tmp_path, code="600519", source="tencent", lookback_days=120)
    forged = _history()
    forged["open"] = forged["high"] = forged["low"] = forged["close"]
    forged["volume"] = 0
    cache_path.write_text(json.dumps({
        "version": 1,
        "frame": json.loads(forged.to_json(orient="split", date_format="iso")),
        "metadata": {"daily_source": "dsa:db_cache"},
    }))
    assert daily._read_daily_history_cache(cache_path, ttl_seconds=60) is None
    assert daily._read_daily_history_cache(cache_path, ttl_seconds=0, allow_stale=True) is None
    real = _history()
    real.at[60, "high"] = 111
    with patch.object(daily, "_fetch_daily_tencent", return_value=real,
                      side_effect=None if source_succeeds else RuntimeError("source unavailable")) as fetch:
        if source_succeeds:
            result = daily.fetch_daily_history("600519", source="tencent", retries=0, cache_dir=tmp_path)
            features = daily.compute_daily_features(result)
            assert features["prev_high_20d"] == 101
            assert features["volume_ratio_20d"] == 1
            assert json.loads(cache_path.read_text())["version"] == 2
        else:
            with pytest.raises(RuntimeError, match="daily history fetch failed"):
                daily.fetch_daily_history("600519", source="tencent", retries=0, cache_dir=tmp_path)
        fetch.assert_called_once()


@pytest.mark.parametrize("source", ["tencent", "sina"])
@pytest.mark.parametrize("bad_row", ["structure", "boolean_close"])
def test_native_http_normalizers_do_not_drop_or_reinterpret_bad_bars(tmp_path, source, bad_row):
    raw = _history()
    if source == "tencent":
        rows = [[row.date.date().isoformat(), row.open, row.close, row.high, row.low, row.volume]
                for row in raw.itertuples()]
        rows[40] = [] if bad_row == "structure" else ["2025-02-10", 100, True, 101, 99, 1000]
        payload = {"code": 0, "data": {"sh600519": {"qfqday": rows}}}
    else:
        rows = [{**row._asdict(), "day": row.date.date().isoformat()} for row in raw.itertuples(index=False)]
        rows[40] = "malformed" if bad_row == "structure" else {**rows[40], "close": True}
        payload = {"result": {"data": rows}}
    response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)
    with patch.object(daily.requests, "get", return_value=response):
        if bad_row == "structure":
            with pytest.raises(RuntimeError, match="daily history fetch failed.*malformed"):
                daily.fetch_daily_history("600519", source=source, retries=0, cache_dir=tmp_path)
            assert not list(tmp_path.glob("*.json"))
        else:
            result = daily.fetch_daily_history("600519", source=source, retries=0, cache_dir=tmp_path)
            cache_path = daily._daily_history_cache_path(tmp_path, code="600519", source=source, lookback_days=120)
            cached = daily._read_daily_history_cache(cache_path, ttl_seconds=60)
            for frame in (result, cached):
                features = daily.compute_daily_features(frame)
                assert features["daily_data_points"] == 20
                assert features["ma60"] is None
                assert features["breakout_20d_pct"] is None


def test_actual_volume_breakout_strategy_rejects_unwarmed_macd_on_21_real_bars():
    from src.services.screening.filter import apply_hard_filters
    from src.services.screening.strategy import load_strategy

    raw = _history(21)
    raw["close"] = [100., 105.] * 10 + [107.]
    raw["high"] = 106.
    raw.loc[20, ["open", "high", "volume"]] = [105., 108., 1500.]
    features = daily.compute_daily_features(raw)
    candidate = pd.DataFrame([{
        "code": "600519", "name": "Evidence fixture", "amount": 200_000_000.,
        "turnover_rate": 5., "volume_ratio": 3., "change_pct": 3., **features,
    }])
    strategy_path = Path(daily.__file__).parent / "strategies" / "volume_breakout.yaml"
    filters = load_strategy(strategy_path).screening.hard_filters
    # All other real strategy conditions pass. Only missing MACD evidence
    # must reject the candidate, rather than treating it as a neutral signal.
    assert len(apply_hard_filters(candidate, replace(filters, macd_status_whitelist=None))) == 1
    assert apply_hard_filters(candidate, filters).empty
    assert features["macd_status"] == ""


@pytest.mark.parametrize("kind,expected,status", [("up", 100., "overbought"),
                                                ("down", 0., "oversold"),
                                                ("flat", 50., "neutral")])
def test_rsi_requires_14_real_changes_then_handles_single_sided_and_flat_prices(kind, expected, status):
    raw = _history(15)
    raw["close"] = [100. + i * (1 if kind == "up" else -1 if kind == "down" else 0) for i in range(15)]
    short = daily.compute_daily_features(raw.iloc[:14])
    assert short["rsi14"] is None
    assert short["rsi_status"] == ""
    assert short["macd_status"] == ""
    ready = daily.compute_daily_features(raw)
    assert ready["rsi14"] == expected
    assert ready["rsi_status"] == status
