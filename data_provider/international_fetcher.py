"""Official offshore daily bars. Dates and share units are never inferred from prices."""
from datetime import date
from functools import lru_cache
import json
import math
import time

import pandas as pd
import requests

from data_provider.base import BaseFetcher, DataFetchError
from src.services.market_symbol_utils import get_suffix_market


def public_json(url, params=None, headers=None, timeout=15):
    from src.services.screening.source_guard import call_with_timeout
    try:
        return call_with_timeout(_request_json, url, params, headers, timeout,
                                 timeout_sec=timeout, label="official market data")
    except TimeoutError:
        raise DataFetchError('Official market data request timed out') from None


def _request_json(url, params=None, headers=None, timeout=15):
    """Bound both socket reads and slow streaming; never include credentials in errors."""
    started = time.monotonic()
    try:
        with requests.get(url, params=params, headers=headers, timeout=(5, 5), stream=True) as response:
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_content(1024):
                size += len(chunk)
                if time.monotonic() - started > timeout or size > 12_000_000:
                    raise DataFetchError('Market data response exceeded its time or size limit')
                chunks.append(chunk)
            return json.loads(b''.join(chunks))
    except (requests.RequestException, ValueError) as exc:
        raise DataFetchError(f'Market data request failed ({type(exc).__name__})') from None


def number(value):
    try:
        result = float(str(value).replace(',', '').strip())
    except (ValueError, TypeError):
        return None
    return result if math.isfinite(result) else None


def tw_date(value):
    text = str(value).replace('/', '').replace('-', '')
    if len(text) == 7 and text.isdigit():
        text = str(int(text[:3]) + 1911) + text[3:]
    return date.fromisoformat(f'{text[:4]}-{text[4:6]}-{text[6:8]}').isoformat()


class OfficialBarsFetcher(BaseFetcher):
    def _normalize_data(self, df, stock_code):
        required = ['date', 'open', 'high', 'low', 'close', 'volume']
        if df.empty or any(key not in df for key in required):
            raise DataFetchError('No complete daily bars from the official source')
        frame = df.copy()
        for key in required[1:] + ['amount']:
            if key in frame:
                frame[key] = frame[key].map(number)
        frame = frame.dropna(subset=required)
        frame = frame[(frame['close'] > 0) & (frame['open'] > 0) & (frame['volume'] >= 0)]
        if frame.empty or ((frame['high'] < frame[['open', 'close', 'low']].max(axis=1)) | (frame['low'] > frame[['open', 'close']].min(axis=1)) | (frame['low'] <= 0)).any() or frame['date'].duplicated().any():
            raise DataFetchError('Invalid or duplicate official daily bars')
        frame = frame.sort_values('date').reset_index(drop=True)
        frame['pct_chg'] = frame['close'].pct_change(fill_method=None) * 100
        frame['code'] = stock_code
        return frame


@lru_cache(maxsize=512)
def _taiwan_month(code, suffix, month, cache_hour):
    del cache_hour
    if suffix == 'TW':
        return public_json('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY',
                           {'stockNo': code, 'date': month.replace('-', ''), 'response': 'json'})
    return public_json('https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock',
                       {'code': code, 'date': month.replace('-', '/'), 'response': 'json'})


class TaiwanOfficialFetcher(OfficialBarsFetcher):
    name = 'TaiwanOfficialFetcher'
    priority = 3

    def _fetch_raw_data(self, stock_code, start_date, end_date):
        if get_suffix_market(stock_code) != 'tw':
            raise DataFetchError('Taiwan source requires an explicit .TW or .TWO symbol')
        code, suffix = stock_code.rsplit('.', 1)
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
        months = (end.year - start.year) * 12 + end.month - start.month + 1
        if not 1 <= months <= 30:
            raise DataFetchError('Official Taiwan history requests support up to 30 months')
        records = []
        for offset in range(months):
            month_id = start.year * 12 + start.month - 1 + offset
            month = date(month_id // 12, month_id % 12 + 1, 1)
            if suffix == 'TW':
                payload = _taiwan_month(code, suffix, month.isoformat(), int(time.time() // 3600))
                fields, rows = payload.get('fields', []), payload.get('data', [])
                columns = {'日期':'date', '成交股數':'volume', '成交金額':'amount', '開盤價':'open',
                           '最高價':'high', '最低價':'low', '收盤價':'close'}
            else:
                payload = _taiwan_month(code, suffix, month.isoformat(), int(time.time() // 3600))
                tables = payload.get('tables', [])
                table = next((table for table in tables if '日 期' in table.get('fields', [])), {})
                fields, rows = table.get('fields', []), table.get('data', [])
                columns = {'日 期':'date', '成交張數':'volume', '成交仟元':'amount', '開盤':'open',
                           '最高':'high', '最低':'low', '收盤':'close'}
            if not rows:
                continue
            if not set(columns).issubset(fields):
                raise DataFetchError('Taiwan daily-bar schema changed')
            for values in rows:
                if len(values) != len(fields):
                    raise DataFetchError('Taiwan daily-bar row does not match schema')
                raw = dict(zip(fields, values))
                row = {target: raw[source] for source, target in columns.items()}
                row['date'] = tw_date(row['date'])
                if suffix == 'TWO':
                    for key in ('volume', 'amount'):
                        value = number(row[key])
                        row[key] = value * 1000 if value is not None else None
                if start_date <= row['date'] <= end_date:
                    records.append(row)
        return pd.DataFrame(records)


class JQuantsFetcher(OfficialBarsFetcher):
    name = 'JQuantsFetcher'
    priority = 3

    def __init__(self, api_key):
        self.api_key = api_key

    def _fetch_raw_data(self, stock_code, start_date, end_date):
        if get_suffix_market(stock_code) != 'jp':
            raise DataFetchError('J-Quants requires a .T symbol')
        code = stock_code.split('.')[0]
        params = {'code': code, 'from': start_date, 'to': end_date}
        rows = []
        for _ in range(30):
            result = public_json('https://api.jquants.com/v2/equities/bars/daily', params,
                                 {'x-api-key': self.api_key})
            if not isinstance(result.get('data'), list):
                raise DataFetchError('J-Quants daily-bar schema changed')
            for row in result['data']:
                if not start_date <= str(row.get('Date', '')) <= end_date:
                    raise DataFetchError('J-Quants returned a date outside the requested interval')
                if str(row.get('Code')) not in {code, code + '0' if len(code) == 4 else code}:
                    raise DataFetchError('J-Quants returned another security')
                # Raw OHLCV: paper fills must use actual prices, not adjusted prices.
                rows.append({key:row.get(source) for key,source in
                             {'date':'Date','open':'O','high':'H','low':'L','close':'C','volume':'Vo','amount':'Va'}.items()})
            token = result.get('pagination_key')
            if not token:
                return pd.DataFrame(rows)
            params['pagination_key'] = token
        raise DataFetchError('J-Quants pagination limit reached; shorten the date range')


@lru_cache(maxsize=8)
def taiwan_listings(cache_hour):
    """Actual exchange listing directories, cached for one hour; no invented companies."""
    del cache_hour
    result = []
    for url, suffix in [('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', 'TW'),
                        ('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', 'TWO')]:
        rows = public_json(url)
        if not isinstance(rows, list):
            raise DataFetchError('Taiwan listing directory schema changed')
        for row in rows:
            code = str(row.get('公司代號') or row.get('SecuritiesCompanyCode') or '').strip()
            if get_suffix_market(f'{code}.{suffix}') != 'tw':
                continue
            result.append(dict(canonicalCode=f'{code}.{suffix}', displayCode=f'{code}.{suffix}',
                nameZh=row.get('公司簡稱') or row.get('CompanyAbbreviation') or row.get('公司名稱') or code,
                nameEn=row.get('英文簡稱') or row.get('英文全名') or row.get('Symbol') or f'{code}.{suffix}',
                aliases=[row.get('公司名稱') or row.get('CompanyName') or '', row.get('英文簡稱') or row.get('Symbol') or ''], market='TW', assetType='stock', active=True))
    if not result:
        raise DataFetchError('Taiwan listing directory is empty')
    return result

@lru_cache(maxsize=32)
def _krx_day(api_key, board, day, cache_day):
    del cache_day
    result = public_json(f'https://data-dbg.krx.co.kr/svc/apis/{board}',
                         {'basDd': day}, {'AUTH_KEY': api_key})
    rows = result.get('OutBlock_1')
    if not isinstance(rows, list):
        raise DataFetchError('KRX daily-bar response unavailable; check API permissions')
    fields = ("ISU_SRT_CD", "TDD_OPNPRC", "TDD_HGPRC", "TDD_LWPRC", "TDD_CLSPRC", "ACC_TRDVOL", "ACC_TRDVAL")
    return [{key: row.get(key) for key in fields} for row in rows]


class KrxOfficialFetcher(OfficialBarsFetcher):
    name = 'KrxOfficialFetcher'
    priority = 3

    def __init__(self, api_key):
        self.api_key = api_key

    def _fetch_raw_data(self, stock_code, start_date, end_date):
        if get_suffix_market(stock_code) != 'kr':
            raise DataFetchError('KRX requires a .KS or .KQ symbol')
        import exchange_calendars as xcals
        sessions = xcals.get_calendar('XKRX').sessions_in_range(start_date, end_date)
        if len(sessions) > 520:
            raise DataFetchError('KRX history request exceeds two trading years')
        code, suffix = stock_code.split('.')
        board = 'sto/ksq_bydd_trd' if suffix == 'KQ' else 'sto/stk_bydd_trd'
        rows, started = [], time.monotonic()
        for session in sessions:
            if time.monotonic() - started > 60:
                raise DataFetchError('KRX history request timed out; cached dates are retained for retry')
            day = session.strftime('%Y%m%d')
            candidates = _krx_day(self.api_key, board, day, date.today().isoformat())
            match = next((r for r in candidates if r.get('ISU_SRT_CD') == code), None)
            if match is None and suffix == 'KS':
                candidates = _krx_day(self.api_key, 'etp/etf_bydd_trd', day, date.today().isoformat())
                match = next((r for r in candidates if r.get('ISU_SRT_CD') == code), None)
            if match:
                rows.append(dict(date=session.date().isoformat(), **{key:match.get(source) for key,source in
                    {'open':'TDD_OPNPRC','high':'TDD_HGPRC','low':'TDD_LWPRC','close':'TDD_CLSPRC',
                     'volume':'ACC_TRDVOL','amount':'ACC_TRDVAL'}.items()}))
        return pd.DataFrame(rows)
