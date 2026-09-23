"""Paginated provider-classified equity directories, never a curated ticker list."""
from functools import lru_cache
import time

from src.services.screening.source_guard import call_with_timeout

SECTORS = {
    '金融': 'Financial Services', '医药生物': 'Healthcare', '信息技术': 'Technology',
    '能源': 'Energy', '原材料': 'Basic Materials', '工业制造': 'Industrials',
    '可选消费': 'Consumer Cyclical', '必选消费': 'Consumer Defensive',
    '公用事业': 'Utilities', '房地产': 'Real Estate',
}
INDUSTRIES = {
    '半导体': ('Semiconductors', 'Semiconductor Equipment & Materials'),
    '通信': ('Telecom Services', 'Communication Equipment'),
    '传媒教育': ('Entertainment', 'Broadcasting', 'Publishing', 'Advertising Agencies',
               'Electronic Gaming & Multimedia', 'Internet Content & Information', 'Education & Training Services'),
}


def equity_directory(market, industries=()):
    """Cache complete successful responses only; refresh current classifications every 15 min."""
    rows = _directory(market, tuple(sorted(set(industries))), int(time.time() // 900))
    return [dict(row) for row in rows]


@lru_cache(maxsize=64)
def _directory(market, industries, cache_period):
    del cache_period
    import yfinance as yf
    if market not in {'US', 'HK'}:
        raise ValueError('Unsupported equity directory market')
    if not hasattr(yf, 'screen') or not hasattr(yf, 'EquityQuery'):
        raise RuntimeError('Installed yfinance lacks equity screening support; upgrade yfinance')
    query = yf.EquityQuery
    # Region denotes domicile; exchange selects where the security actually trades.
    exchanges = ['HKG'] if market == 'HK' else ['NYQ', 'NMS', 'NGM', 'NCM', 'ASE', 'BTS', 'PCX']
    filters = [query('is-in', ['exchange', *exchanges])]
    groups = []
    for name in industries:
        if name in SECTORS:
            groups.append(query('eq', ['sector', SECTORS[name]]))
        elif name in INDUSTRIES:
            groups.append(query('is-in', ['industry', *INDUSTRIES[name]]))
        else:
            raise ValueError('Unsupported industry selection: ' + name)
    if groups:
        filters.append(groups[0] if len(groups) == 1 else query('or', groups))
    request = filters[0] if len(filters) == 1 else query('and', filters)
    rows, seen, total, offset = [], set(), None, 0
    # A guard is a failure, never silent truncation presented as a complete directory.
    for _ in range(100):
        try:
            result = call_with_timeout(
                lambda: yf.screen(request, size=250, offset=offset, sortField='ticker', sortAsc=True),
                timeout_sec=20, label='equity industry directory')
        except Exception as exc:
            raise RuntimeError('Equity directory request failed; no partial directory returned') from exc
        if not isinstance(result, dict) or type(result.get('total')) is not int or not isinstance(result.get('quotes'), list):
            raise RuntimeError('Equity directory response schema changed')
        if total is None:
            total = result['total']
        if total < 0 or result['total'] != total or result.get('start') != offset:
            raise RuntimeError('Equity directory changed during pagination; retry')
        page = result['quotes']
        if not page and offset < total:
            raise RuntimeError('Equity directory returned an incomplete page')
        for row in page:
            symbol = row.get('symbol')
            if not isinstance(symbol, str) or not symbol or symbol in seen:
                raise RuntimeError('Equity directory returned duplicate or invalid symbols')
            if row.get('quoteType') != 'EQUITY' or row.get('exchange') not in exchanges:
                raise RuntimeError('Equity directory returned a security outside the requested market/type')
            seen.add(symbol)
            rows.append(dict(code=symbol, name=row.get('shortName') or row.get('longName') or symbol,
                             industry=row.get('industry') or '', total_mv=row.get('marketCap'),
                             amount=(row.get('regularMarketVolume') or 0) * (row.get('regularMarketPrice') or 0)))
        offset += len(page)
        if offset == total:
            return tuple(rows)
        if offset > total:
            raise RuntimeError('Equity directory count mismatch')
    raise RuntimeError('Equity directory pagination limit exceeded')
