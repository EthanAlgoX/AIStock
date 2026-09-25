"""Spot replay contract: complete hours, no future signals, fractional cash ledger."""

import math

import pytest

from src.services import crypto_market_service as crypto
from src.services.crypto_market_service import HOUR_MS, replay, screen


def rows(prices, volume=100):
    return [[i * HOUR_MS, str(price), str(price), str(price), str(price), "1",
             (i + 1) * HOUR_MS - 1, str(volume), 0, 0, 0, 0]
            for i, price in enumerate(prices)]


def test_screen_uses_only_completed_lookback_and_quote_volume():
    data = {
        "BTCUSDT": rows([100, 101, 102, 103, 104, 105], 10),
        "ETHUSDT": rows([10, 12, 8, 11, 9, 1000], 20),
    }
    result = screen(data, list(data), at_index=5, lookback=5, top_n=2)
    assert result["selected"] == "ETHUSDT"
    assert result["ranking"][0]["quoteVolume"] == 100
    assert result["signalTime"] == 4 * HOUR_MS


def test_next_open_execution_and_fractional_spot_accounting():
    data = {"BTCUSDT": rows([100, 100, 100, 110, 120])}
    result = replay(data, ["BTCUSDT"], 3 * HOUR_MS, 5 * HOUR_MS,
                    strategy="btc_half", initial_cash=1000, lookback=3,
                    fee_rate=.001, slippage_rate=.0005)
    assert result["tradeCount"] == 1
    assert result["trades"][0]["time"] == 3 * HOUR_MS
    assert result["trades"][0]["quantity"] < 5
    assert result["endingCash"] > 0
    assert math.isclose(result["finalEquity"], result["endingCash"] + result["endingPositions"]["BTCUSDT"] * 120)
    assert result["fees"] > 0 and result["slippageCost"] > 0


def test_replay_rejects_missing_or_misaligned_hours():
    data = {"BTCUSDT": rows([100] * 7), "ETHUSDT": rows([10] * 7)}
    data["ETHUSDT"][2][0] += HOUR_MS
    with pytest.raises(ValueError, match="hourly candles"):
        replay(data, list(data), 3 * HOUR_MS, 7 * HOUR_MS, lookback=3)


def test_replay_hash_and_results_are_repeatable():
    data = {"BTCUSDT": rows([100, 100, 102, 98, 105, 107, 110]),
            "ETHUSDT": rows([10, 12, 9, 15, 13, 16, 17], 200)}
    args = (data, list(data), 3 * HOUR_MS, 7 * HOUR_MS)
    first = replay(*args, lookback=3, top_n=2, rebalance_hours=2)
    second = replay(*args, lookback=3, top_n=2, rebalance_hours=2)
    assert first == second
    assert first["tradeCount"] > 0
    assert first["sampleHash"]


def test_binance_pagination_requires_every_completed_hour(monkeypatch):
    source = rows([100] * 1001)
    calls = []

    def get(_path, **params):
        calls.append(params["startTime"])
        start = params["startTime"] // HOUR_MS
        return source[start:start + 1000]

    monkeypatch.setattr(crypto, "_get", get)
    assert len(crypto.fetch_hourly("BTCUSDT", 0, 1001 * HOUR_MS)) == 1001
    assert calls == [0, 1000 * HOUR_MS]
    source.pop(500)
    with pytest.raises(ValueError, match="Missing complete hourly"):
        crypto.fetch_hourly("BTCUSDT", 0, 1001 * HOUR_MS)
