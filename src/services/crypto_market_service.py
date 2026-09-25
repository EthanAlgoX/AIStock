"""Binance Spot USDT research data and deterministic hourly strategy replay."""

from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "https://data-api.binance.vision/api/v3"
CORE_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT")
HOUR_MS = 3_600_000
SOURCE = "Binance Spot"


def validate_symbol(symbol: str) -> str:
    code = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,16}USDT", code):
        raise ValueError("Choose a Binance Spot USDT pair, such as BTCUSDT")
    return code


def _get(path: str, **params):
    url = f"{BASE_URL}/{path}?{urlencode(params)}"
    with urlopen(Request(url, headers={"User-Agent": "AI-Stock/crypto-research"}), timeout=12) as response:
        return json.load(response)


def fetch_hourly(symbol: str, start_ms: int, end_ms: int) -> list[list]:
    """Fetch complete hourly spot candles, including USDT quote volume at index 7."""
    code = validate_symbol(symbol)
    end_ms = min(end_ms, int(datetime.now(timezone.utc).timestamp() * 1000) // HOUR_MS * HOUR_MS)
    rows: list[list] = []
    cursor = start_ms
    while cursor < end_ms:
        batch = _get("klines", symbol=code, interval="1h", startTime=cursor,
                     endTime=end_ms - 1, limit=1000)
        if not isinstance(batch, list) or not batch:
            break
        for row in batch:
            if len(row) < 12 or row[0] < cursor or row[0] >= end_ms or row[6] >= end_ms:
                continue
            rows.append(row)
        next_cursor = int(batch[-1][0]) + HOUR_MS
        if next_cursor <= cursor:
            raise ValueError("Spot data did not advance")
        cursor = next_cursor
    if len(rows) != len({row[0] for row in rows}):
        raise ValueError("Duplicate spot candles")
    if len(rows) != (end_ms - start_ms) // HOUR_MS or any(
        int(row[0]) != start_ms + i * HOUR_MS for i, row in enumerate(rows)
    ):
        raise ValueError(f"Missing complete hourly spot candles for {code}")
    return rows


def market_overview() -> dict:
    tickers = _get("ticker/24hr")
    if not isinstance(tickers, list):
        raise ValueError("Spot ticker response is unavailable")
    by_code = {row.get("symbol"): row for row in tickers if isinstance(row, dict)
               and isinstance(row.get("symbol"), str)
               and re.fullmatch(r"[A-Z0-9]{2,16}USDT", row["symbol"])
               and not row["symbol"].endswith(("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT"))}
    ranked = sorted(by_code, key=lambda code: -float(by_code[code]["quoteVolume"]))
    codes = list(dict.fromkeys([*ranked[:20], *CORE_SYMBOLS]))
    assets = []
    for code in codes:
        row = by_code.get(code)
        if row is None:
            continue
        assets.append({
            "symbol": code, "lastPrice": float(row["lastPrice"]),
            "changePercent24h": float(row["priceChangePercent"]),
            "quoteVolume24h": float(row["quoteVolume"]),
            "high24h": float(row["highPrice"]), "low24h": float(row["lowPrice"]),
        })
    if not assets:
        raise ValueError("No Binance Spot USDT tickers returned")
    return {"market": "CRYPTO", "source": SOURCE, "quoteAsset": "USDT",
            "asOf": datetime.now(timezone.utc).isoformat(), "assets": assets}


def asset_detail(symbol: str, hours: int = 168) -> dict:
    code = validate_symbol(symbol)
    end = int(datetime.now(timezone.utc).timestamp() * 1000) // HOUR_MS * HOUR_MS
    rows = fetch_hourly(code, end - hours * HOUR_MS, end)
    closes = [float(r[4]) for r in rows]
    hourly_returns = [b / a - 1 for a, b in zip(closes, closes[1:])]
    metrics = {"periodReturn": closes[-1] / float(rows[0][1]) - 1,
               "hourlyVolatility": statistics.stdev(hourly_returns) if len(hourly_returns) > 1 else None,
               "quoteTurnover": math.fsum(float(r[7]) for r in rows),
               "periodHigh": max(float(r[2]) for r in rows),
               "periodLow": min(float(r[3]) for r in rows)}
    return {"symbol": code, "source": SOURCE, "quoteAsset": "USDT", "interval": "1h",
            "metrics": metrics,
            "candles": [{"time": r[0], "open": float(r[1]), "high": float(r[2]),
                         "low": float(r[3]), "close": float(r[4]),
                         "baseVolume": float(r[5]), "quoteVolume": float(r[7])} for r in rows]}


def _check_history(data: dict[str, list[list]], symbols: list[str], start_ms: int,
                   end_ms: int, lookback: int) -> tuple[int, int]:
    if not symbols or len(symbols) != len(set(symbols)):
        raise ValueError("Choose unique spot pairs")
    if end_ms <= start_ms or start_ms % HOUR_MS or end_ms % HOUR_MS:
        raise ValueError("Backtest dates must align to UTC hours")
    first = None
    reference_times = None
    for symbol in symbols:
        rows = data.get(symbol, [])
        if not rows:
            raise ValueError(f"No candles for {symbol}")
        times = [int(row[0]) for row in rows]
        if any(b - a != HOUR_MS for a, b in zip(times, times[1:])):
            raise ValueError(f"Missing or duplicated hourly candles for {symbol}")
        if any(not all(math.isfinite(float(row[i])) and float(row[i]) > 0
                       for i in (1, 4)) or not math.isfinite(float(row[7])) or float(row[7]) < 0 for row in rows):
            raise ValueError(f"Invalid price or quote volume for {symbol}")
        if first is None:
            first = times[0]
            reference_times = times
        elif times != reference_times:
            raise ValueError("Spot candle timestamps must align across pairs")
    assert first is not None
    start_index = (start_ms - first) // HOUR_MS
    end_index = (end_ms - first) // HOUR_MS
    if start_index < lookback or end_index > len(data[symbols[0]]) or end_index <= start_index:
        raise ValueError("Insufficient complete candles for lookback or evaluation")
    return start_index, end_index


def screen(data: dict[str, list[list]], symbols: list[str], at_index: int,
           lookback: int = 720, top_n: int = 3) -> dict:
    """Rank fixed universe by historical USDT turnover, then hourly volatility."""
    if not 1 <= top_n <= len(symbols) or lookback < 3:
        raise ValueError("Invalid screening parameters")
    ranking = []
    for symbol in symbols:
        history = data[symbol][at_index - lookback:at_index]
        if len(history) != lookback:
            raise ValueError("Insufficient completed candles for screening")
        closes = [float(row[4]) for row in history]
        turnover = [float(row[7]) for row in history]
        if any(not math.isfinite(value) or value <= 0 for value in closes) or any(
            not math.isfinite(value) or value < 0 for value in turnover
        ):
            raise ValueError(f"Invalid spot candles for {symbol}")
        ranking.append({"symbol": symbol,
                        "quoteVolume": math.fsum(turnover),
                        "volatility": statistics.stdev(b / a - 1 for a, b in zip(closes, closes[1:]))})
    rank_index = {symbol: i for i, symbol in enumerate(symbols)}
    ranking.sort(key=lambda item: (-item["quoteVolume"], rank_index[item["symbol"]]))
    candidates = ranking[:top_n]
    selected = min(candidates, key=lambda item: (-item["volatility"], rank_index[item["symbol"]]))
    return {"selected": selected["symbol"], "candidates": candidates, "ranking": ranking,
            "lookbackHours": lookback, "signalTime": data[symbols[0]][at_index - 1][0]}


def replay(data: dict[str, list[list]], symbols: list[str], start_ms: int, end_ms: int,
           strategy: str = "selection_hold", initial_cash: float = 10000,
           fee_rate: float = .001, slippage_rate: float = .0005,
           lookback: int = 720, rebalance_hours: int = 168,
           allocation: float = .5, top_n: int = 3) -> dict:
    """Long-only spot replay. Signal uses closed bars; all orders fill at next open."""
    if strategy not in {"selection_hold", "equal_weight", "btc_half"}:
        raise ValueError("Unknown spot strategy")
    if not initial_cash > 0 or not 0 < allocation <= 1 or not 0 <= fee_rate <= .05 \
            or not 0 <= slippage_rate <= .05 or rebalance_hours < 1:
        raise ValueError("Invalid capital or execution costs")
    start_index, end_index = _check_history(data, symbols, start_ms, end_ms, lookback)
    if strategy == "btc_half" and "BTCUSDT" not in symbols:
        raise ValueError("BTC half strategy requires BTCUSDT")
    cash = float(initial_cash)
    positions = {symbol: 0.0 for symbol in symbols}
    trades: list[dict] = []
    decisions: list[dict] = []
    curve: list[dict] = []
    total_fees = total_slippage = 0.0
    held = None

    def nav(prices: dict[str, float]) -> float:
        return cash + math.fsum(positions[s] * prices[s] for s in symbols)

    def trade(symbol: str, side: str, quantity: float, open_price: float, time_ms: int):
        nonlocal cash, total_fees, total_slippage
        if quantity <= 1e-12:
            return
        fill = open_price * (1 + slippage_rate if side == "buy" else 1 - slippage_rate)
        fee = quantity * fill * fee_rate
        if side == "buy":
            if quantity * fill + fee > cash + 1e-7:
                raise ValueError("Spot purchase exceeds cash")
            cash -= quantity * fill + fee
            positions[symbol] += quantity
        else:
            if quantity > positions[symbol] + 1e-10:
                raise ValueError("Spot sale exceeds position")
            cash += quantity * fill - fee
            positions[symbol] -= quantity
        total_fees += fee
        total_slippage += quantity * open_price * slippage_rate
        trades.append({"time": time_ms, "symbol": symbol, "side": side,
                       "quantity": quantity, "price": fill, "fee": fee})

    for idx in range(start_index, end_index):
        open_prices = {s: float(data[s][idx][1]) for s in symbols}
        t = int(data[symbols[0]][idx][0])
        if (idx - start_index) % rebalance_hours == 0:
            if strategy == "selection_hold":
                decision = screen(data, symbols, idx, lookback, top_n)
                selected = decision["selected"]
                if selected != held:
                    if held is not None:
                        trade(held, "sell", positions[held], open_prices[held], t)
                    budget = allocation * nav(open_prices)
                    quantity = budget / (open_prices[selected] * (1 + slippage_rate) * (1 + fee_rate))
                    trade(selected, "buy", quantity, open_prices[selected], t)
                    held = selected
                decisions.append({"time": t, **decision})
            elif strategy == "btc_half":
                if not trades:
                    symbol = "BTCUSDT"
                    quantity = allocation * cash / (open_prices[symbol] * (1 + slippage_rate) * (1 + fee_rate))
                    trade(symbol, "buy", quantity, open_prices[symbol], t)
                    decisions.append({"time": t, "selected": symbol})
            else:
                target = nav(open_prices) * allocation / len(symbols)
                deltas = {s: target - positions[s] * open_prices[s] for s in symbols}
                for s in symbols:
                    if deltas[s] < -1e-8:
                        trade(s, "sell", min(-deltas[s] / open_prices[s], positions[s]), open_prices[s], t)
                for s in symbols:
                    if deltas[s] > 1e-8:
                        quantity = min(deltas[s] / (open_prices[s] * (1 + slippage_rate) * (1 + fee_rate)),
                                       cash / (open_prices[s] * (1 + slippage_rate) * (1 + fee_rate)))
                        trade(s, "buy", quantity, open_prices[s], t)
                decisions.append({"time": t, "selected": list(symbols)})
        close_prices = {s: float(data[s][idx][4]) for s in symbols}
        curve.append({"time": t, "equity": nav(close_prices)})

    values = [initial_cash] + [point["equity"] for point in curve]
    peak = values[0]
    drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        drawdown = min(drawdown, value / peak - 1)
    btc = data.get("BTCUSDT")
    benchmark = (float(btc[end_index - 1][4]) / float(btc[start_index][1]) - 1) if btc else None
    sample = {s: [[r[0], r[1], r[4], r[7]] for r in data[s][start_index - lookback:end_index]] for s in symbols}
    digest = hashlib.sha256(json.dumps(sample, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return {"strategy": strategy, "market": "CRYPTO", "source": SOURCE,
            "quoteAsset": "USDT", "interval": "1h", "execution": "previous_closed_signal_next_open",
            "symbols": symbols, "start": start_ms, "endExclusive": end_ms,
            "sampleHash": digest, "initialCash": initial_cash, "finalEquity": curve[-1]["equity"],
            "return": curve[-1]["equity"] / initial_cash - 1, "maxDrawdown": drawdown,
            "btcReturn": benchmark, "excessReturnVsBtc": curve[-1]["equity"] / initial_cash - 1 - benchmark if benchmark is not None else None,
            "fees": total_fees, "slippageCost": total_slippage, "feeRate": fee_rate,
            "slippageRate": slippage_rate, "tradeCount": len(trades), "trades": trades,
            "decisions": decisions, "equityCurve": curve[::24] + ([] if len(curve) % 24 == 1 else curve[-1:]),
            "endingCash": cash, "endingPositions": positions}


def live_replay(symbols: list[str], start: datetime, end: datetime, **kwargs) -> dict:
    symbols = [validate_symbol(symbol) for symbol in symbols]
    if not 1 <= len(symbols) <= len(CORE_SYMBOLS) or len(set(symbols)) != len(symbols):
        raise ValueError("Choose 1–5 unique spot pairs")
    start = start.astimezone(timezone.utc)
    end = end.astimezone(timezone.utc)
    now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    if start.minute or start.second or start.microsecond or end.minute or end.second or end.microsecond:
        raise ValueError("Dates must align to UTC hours")
    if end > now_hour or end <= start or end - start > timedelta(days=90):
        raise ValueError("Choose 1–90 completed UTC days")
    lookback = kwargs.get("lookback", 720)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    history_start = start_ms - lookback * HOUR_MS
    data = {s: fetch_hourly(s, history_start, end_ms) for s in symbols}
    return replay(data, symbols, start_ms, end_ms, **kwargs)
