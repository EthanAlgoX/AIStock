"""Reject malformed provider batches before indicators, caches or persistence."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data_provider.base import DataFetchError, DataFetcherManager
from data_provider.efinance_fetcher import EfinanceFetcher
from data_provider.hithink_finance_fetcher import HiThinkFinanceFetcher
from data_provider.international_fetcher import TaiwanOfficialFetcher
from data_provider.realtime_types import RealtimeSource
from data_provider.tickflow_fetcher import TickFlowFetcher
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.agent.tools.data_tools import _handle_get_daily_history
from src.services.history_loader import reset_frozen_target_date, set_frozen_target_date
from src.stock_analyzer import StockTrendAnalyzer


@pytest.mark.parametrize('price', [float('inf'), float('-inf'), float('nan'), 'inf'])
@pytest.mark.parametrize('prefetch', [False, True])
def test_nonfinite_tickflow_quote_uses_real_manager_fallback_without_poisoning_cache(price, prefetch):
    tickflow = TickFlowFetcher(api_key='test', priority=0)
    quotes = MagicMock()
    quotes.get.return_value = [{'symbol': '600519.SH', 'last_price': price}]
    tickflow._client = SimpleNamespace(quotes=quotes, close=lambda: None)
    hithink = HiThinkFinanceFetcher(api_key='test', priority=1)
    hithink._symbol_cache['600519'] = '600519.SH'
    manager = DataFetcherManager(fetchers=[tickflow, hithink])
    config = SimpleNamespace(enable_realtime_quote=True,
                             realtime_source_priority='tickflow,hithink_finance',
                             realtime_cache_ttl=600)
    with patch('src.config.get_config', return_value=config), patch.object(
        hithink, '_request', return_value={'item': [{'ticker': '600519', 'last_price': 12.0}]}
    ) as request:
        if prefetch:
            assert tickflow.prefetch_realtime_quotes(['600519']) == 0
        quote = manager.get_realtime_quote('600519')
    assert quote.price == 12.0
    assert quote.source == RealtimeSource.HITHINK_FINANCE
    assert quote.fallback_from == 'tickflow'
    request.assert_called_once_with('/api/a-share/prices/snapshot', {'thscodes': '600519.SH'})
    assert tickflow._quote_cache == {}


def test_nonfinite_quote_from_both_real_sources_reports_unavailable():
    tickflow = TickFlowFetcher(api_key='test', priority=0)
    quotes = MagicMock()
    quotes.get.return_value = [{'symbol': '600519.SH', 'last_price': float('inf')}]
    tickflow._client = SimpleNamespace(quotes=quotes, close=lambda: None)
    hithink = HiThinkFinanceFetcher(api_key='test', priority=1)
    hithink._symbol_cache['600519'] = '600519.SH'
    manager = DataFetcherManager(fetchers=[tickflow, hithink])
    config = SimpleNamespace(enable_realtime_quote=True,
                             realtime_source_priority='tickflow,hithink_finance',
                             realtime_cache_ttl=600)
    with patch('src.config.get_config', return_value=config), patch.object(
        hithink, '_request', return_value={'item': [{'ticker': '600519', 'last_price': float('inf')}]}
    ):
        assert manager.get_realtime_quote('600519') is None
    assert tickflow._quote_cache == {}


def test_tickflow_optional_nonfinite_quote_numbers_do_not_drop_valid_price():
    fetcher = TickFlowFetcher(api_key='test')
    quotes = MagicMock()
    quotes.get.return_value = [{
        'symbol': '600519.SH', 'last_price': 12.0,
        'prev_close': float('inf'), 'high': float('inf'), 'low': float('-inf'),
        'open': float('nan'), 'volume': float('inf'), 'amount': float('inf'),
        'ext': {'change_amount': float('inf'), 'change_pct': float('inf'),
                'turnover_rate': float('inf'), 'amplitude': float('inf')},
    }]
    fetcher._client = SimpleNamespace(quotes=quotes, close=lambda: None)
    quote = fetcher.get_realtime_quote('600519')
    assert quote.price == 12.0
    assert quote.has_basic_data()
    assert quote.high is None and quote.low is None and quote.pre_close is None
    assert quote.change_amount is None and quote.change_pct is None
    assert quote.turnover_rate is None and quote.amplitude is None


def _bars():
    return pd.DataFrame({
        'date': pd.bdate_range('2026-01-01', periods=31),
        'open': [10.0] * 31, 'high': [11.0] * 30 + [13.0], 'low': [9.0] * 31,
        'close': [10.0] * 30 + [12.0], 'volume': [100.0] * 30 + [300.0],
    })


def _provider_and_raw(provider, bars):
    if provider == 'yfinance':
        fetcher = YfinanceFetcher()
        raw = bars.rename(columns={name: name.title() for name in bars.columns}).set_index('Date')
    elif provider == 'hithink':
        fetcher = HiThinkFinanceFetcher(api_key='test')
        raw = bars.rename(columns={name: f'{name}_price' for name in ('open', 'high', 'low', 'close')})
        raw['date_ms'] = bars['date'].map(
            lambda day: int(pd.Timestamp(day).tz_localize('Asia/Shanghai').timestamp() * 1000)
            if pd.notna(day) else None
        )
    elif provider == 'tickflow':
        fetcher = TickFlowFetcher(api_key='test')
        raw = bars.rename(columns={'date': 'trade_date'})
    elif provider == 'efinance':
        with patch('data_provider.efinance_fetcher.get_config',
                   return_value=SimpleNamespace(enable_eastmoney_patch=False)):
            fetcher = EfinanceFetcher(sleep_min=0, sleep_max=0)
        raw = bars.rename(columns={'date': '日期', 'open': '开盘', 'high': '最高',
                                   'low': '最低', 'close': '收盘', 'volume': '成交量'})
    else:
        fetcher = TaiwanOfficialFetcher()
        raw = bars.copy()
    return fetcher, raw


@pytest.mark.parametrize('provider', ['yfinance', 'hithink', 'tickflow', 'official', 'efinance'])
@pytest.mark.parametrize('defect', ['missing_close', 'nonfinite_high', 'negative_volume', 'high_below_low', 'invalid_date'])
def test_real_daily_fetch_path_rejects_interior_bad_bar_without_stitching_history(provider, defect):
    bars = _bars()
    field, value = {
        'missing_close': ('close', float('nan')),
        'nonfinite_high': ('high', float('inf')),
        'negative_volume': ('volume', -1.0),
        'high_below_low': ('high', 8.0),
        'invalid_date': ('date', pd.NaT),
    }[defect]
    bars.loc[24, field] = value
    fetcher, raw = _provider_and_raw(provider, bars)
    original = raw.copy(deep=True)
    with patch.object(fetcher, '_fetch_raw_data', return_value=raw):
        with pytest.raises(DataFetchError):
            fetcher.get_daily_data('600519', start_date='2026-01-01', end_date='2026-02-12')
    pd.testing.assert_frame_equal(raw, original)


def test_daily_validation_preserves_zero_volume_auction_prices_and_optional_missing_values():
    bars = _bars()
    bars['volume'] = 0.0
    bars.loc[30, 'close'] = 14.0  # auction close may exceed the intraday high
    bars['amount'] = float('nan')
    bars['pct_chg'] = float('nan')
    fetcher, raw = _provider_and_raw('yfinance', bars)
    with patch.object(fetcher, '_fetch_raw_data', return_value=raw):
        daily = fetcher.get_daily_data('600519', start_date='2026-01-01', end_date='2026-02-12')
    assert len(daily) == 31
    assert daily.iloc[-1]['close'] == 14.0
    assert daily['volume'].eq(0.0).all()
    result = StockTrendAnalyzer().analyze(daily, '600519')
    assert result.volume_ratio_5d is None
    assert [event['rule_id'] for event in result.rule_events] == ['range20']


def test_nullable_missing_price_is_rejected_as_missing_data():
    fetcher = YfinanceFetcher()
    bars = _bars()
    bars['close'] = bars['close'].astype('Float64')
    bars.loc[24, 'close'] = pd.NA
    with pytest.raises(DataFetchError):
        fetcher._clean_data(bars)


@pytest.mark.parametrize('missing_field', ['open', 'high', 'low', 'close', 'volume'])
def test_efinance_missing_ohlcv_is_not_fabricated_from_close_or_zero(missing_field):
    fetcher, raw = _provider_and_raw('efinance', _bars().drop(columns=missing_field))
    with patch.object(fetcher, '_fetch_raw_data', return_value=raw):
        with pytest.raises(DataFetchError, match='必要字段'):
            fetcher.get_daily_data('600519', start_date='2026-01-01', end_date='2026-02-12')


@pytest.mark.parametrize('primary_provider', ['hithink', 'efinance'])
@pytest.mark.parametrize('backup_valid', [True, False])
def test_real_manager_fallback_reaches_history_tool_and_only_valid_batch_is_saved(backup_valid, primary_provider):
    bad_bars = _bars()
    if primary_provider == 'efinance':
        bad_bars = bad_bars.drop(columns='open')
    else:
        bad_bars.loc[24, 'close'] = float('nan')
    primary, primary_raw = _provider_and_raw(primary_provider, bad_bars)
    backup, backup_raw = _provider_and_raw('yfinance', _bars() if backup_valid else bad_bars)
    db = MagicMock()
    db.get_data_range.return_value = []
    db.save_daily_data.return_value = 31
    DataFetcherManager.reset_daily_source_health()
    target_token = set_frozen_target_date(date(2026, 2, 12))
    try:
        manager = DataFetcherManager(fetchers=[primary, backup])
        with patch.object(primary, '_fetch_raw_data', return_value=primary_raw), \
                patch.object(backup, '_fetch_raw_data', return_value=backup_raw), \
                patch('src.storage.get_db', return_value=db), \
                patch('src.agent.tools.data_tools._get_db', return_value=db), \
                patch('src.services.history_loader._get_fetcher_manager', return_value=manager):
            result = _handle_get_daily_history('600519', days=60)
        if backup_valid:
            assert result['source'] == 'YfinanceFetcher'
            saved_df, code, source = db.save_daily_data.call_args.args
            assert code == '600519' and source == 'YfinanceFetcher'
            assert len(saved_df) == 31 and saved_df['close'].notna().all()
            db.save_daily_data.assert_called_once()
        else:
            assert result['error'] == 'No historical data available for 600519'
            db.save_daily_data.assert_not_called()
    finally:
        reset_frozen_target_date(target_token)
        DataFetcherManager.reset_daily_source_health()


@pytest.mark.parametrize('defect', ['invalid_date', 'missing_close'])
def test_tickflow_invalid_single_and_batch_payloads_do_not_enter_raw_cache(defect):
    bars = _bars().rename(columns={'date': 'trade_date'})
    bars.loc[24, 'trade_date' if defect == 'invalid_date' else 'close'] = None
    client = SimpleNamespace(klines=SimpleNamespace(get=MagicMock(return_value=bars),
                                                  batch=MagicMock(return_value={'600519.SH': bars})))
    fetcher = TickFlowFetcher(api_key='test', batch_daily_enabled=True)
    with patch.object(fetcher, '_get_client', return_value=client):
        with pytest.raises(DataFetchError):
            fetcher.get_daily_data('600519', start_date='2026-01-01', end_date='2026-02-12')
        assert fetcher._daily_cache == {}
        assert fetcher.prefetch_daily_klines(['600519'], start_date='2026-01-01', end_date='2026-02-12') == 0
        assert fetcher._daily_cache == {}
