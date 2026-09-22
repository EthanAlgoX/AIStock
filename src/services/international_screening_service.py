"""Bounded offshore screening using verified directories or operator-selected symbols."""
import json
import os
import time

from data_provider.base import DataFetchError
from src.services.market_symbol_utils import get_suffix_market


MARKETS = ('hk', 'us', 'tw', 'jp', 'kr', 'gb', 'ca', 'au', 'in', 'de', 'fr')


def universe(market):
    from src.core.trading_calendar import get_market_for_stock
    from data_provider.base import normalize_stock_code
    from src.data.stock_index_loader import find_existing_stock_index_path
    configured = json.loads(os.getenv('SCREENING_INTERNATIONAL_TICKERS', '{}'))
    if not isinstance(configured, dict):
        raise ValueError('SCREENING_INTERNATIONAL_TICKERS must be a JSON object')
    symbols = configured.get(market.upper()) or configured.get(market)
    if symbols is not None:
        if not isinstance(symbols, list) or not symbols or len(symbols) > 50:
            raise ValueError('International screening requires 1–50 configured symbols per market')
        symbols = list(dict.fromkeys(normalize_stock_code(str(s)) for s in symbols))
        if any(get_market_for_stock(s) != market for s in symbols):
            raise ValueError('Configured screening symbols must all belong to the selected market')
        return symbols
    if market == 'tw':
        from data_provider.international_fetcher import taiwan_listings
        return [r['canonicalCode'] for r in taiwan_listings(int(time.time() // 3600))][:50]
    path = find_existing_stock_index_path()
    if path:
        records = json.loads(path.read_text())
        symbols = [r[0] if isinstance(r, list) else r['canonicalCode'] for r in records]
        symbols = [s for s in symbols if get_suffix_market(s) == market]
        if symbols:
            return symbols[:50]
    raise DataFetchError('Configure SCREENING_INTERNATIONAL_TICKERS for this market before screening')


def snapshot(market):
    from src.services.screening.snapshot_us import fetch_us_snapshot
    symbols = universe(market)
    symbols = [str(int(s[2:])).zfill(4) + '.HK' if s.startswith('HK') else s for s in symbols]
    frame = fetch_us_snapshot(tickers=symbols)
    if frame.empty:
        raise DataFetchError('No observations for the configured international universe')
    frame.attrs.update(snapshot_source='yfinance:bounded_international_universe',
                       universe_size=len(symbols), market=market,
                       source_errors=['Bounded candidate sample, not exhaustive market coverage.'])
    return frame
