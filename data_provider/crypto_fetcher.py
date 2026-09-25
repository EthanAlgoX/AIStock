"""Completed UTC spot days for the shared research and portfolio data contract."""
from datetime import date, datetime, timedelta, timezone
import math

import pandas as pd

from data_provider.realtime_types import RealtimeSource, UnifiedRealtimeQuote
from src.services.crypto_market_service import _get, validate_symbol

DAY_MS = 86_400_000


def daily_data(symbol, start_date=None, end_date=None, days=90):
    code = validate_symbol(symbol)
    today = datetime.now(timezone.utc).date()
    end = min(date.fromisoformat(str(end_date)[:10]) if end_date else today - timedelta(days=1),
              today - timedelta(days=1))
    start = date.fromisoformat(str(start_date)[:10]) if start_date else end - timedelta(days=days - 1)
    cursor = int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp() * 1000)
    end_ms = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp() * 1000)
    rows = []
    while cursor < end_ms:
        batch = _get('klines', symbol=code, interval='1d', startTime=cursor, endTime=end_ms - 1, limit=1000)
        if not isinstance(batch, list) or not batch:
            raise ValueError(f'{code}: missing completed UTC spot candles')
        for raw in batch:
            if len(raw) < 12 or int(raw[0]) != cursor or int(raw[6]) != cursor + DAY_MS - 1 or cursor >= end_ms:
                raise ValueError(f'{code}: missing, duplicate or incomplete UTC candle')
            values = [float(raw[i]) for i in (1, 2, 3, 4, 5, 7)]
            if any(not math.isfinite(v) or v < 0 for v in values) or min(values[:4]) <= 0 or values[1] < max(values[0], values[3]) or values[2] > min(values[0], values[3]):
                raise ValueError(f'{code}: invalid spot candle')
            rows.append(dict(date=datetime.fromtimestamp(cursor / 1000, timezone.utc).date().isoformat(),
                             open=values[0], high=values[1], low=values[2], close=values[3],
                             volume=values[4], amount=values[5]))
            cursor += DAY_MS
    frame = pd.DataFrame(rows, columns=['date', 'open', 'high', 'low', 'close', 'volume', 'amount'])
    frame['pct_chg'] = frame['close'].pct_change() * 100
    from data_provider.base import BaseFetcher
    return BaseFetcher._calculate_indicators(frame, price_decimals=None)


def realtime_quote(symbol):
    code = validate_symbol(symbol)
    raw = _get('ticker/24hr', symbol=code)
    price = float(raw['lastPrice'])
    if not math.isfinite(price) or price <= 0:
        raise ValueError(f'{code}: invalid spot price')
    return UnifiedRealtimeQuote(code=code, name=code, source=RealtimeSource.BINANCE,
        market='crypto', currency='USDT', price=price, change_pct=float(raw['priceChangePercent']),
        volume=float(raw['volume']), amount=float(raw['quoteVolume']),
        open_price=float(raw['openPrice']), high=float(raw['highPrice']), low=float(raw['lowPrice']),
        fetched_at=datetime.now(timezone.utc).isoformat(),
        provider_timestamp=datetime.fromtimestamp(int(raw['closeTime']) / 1000, timezone.utc).isoformat(),
        data_quality='ok')
