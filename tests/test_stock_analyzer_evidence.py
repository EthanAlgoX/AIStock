# -*- coding: utf-8 -*-
"""Technical evidence uses honest warmup and never crosses explicit defects."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest

from src.stock_analyzer import BuySignal, StockTrendAnalyzer


def history(closes, volumes=None, source='fixture'):
    return pd.DataFrame({
        'date': pd.date_range('2026-01-01', periods=len(closes), freq='B'),
        'open': closes,
        'high': [value + 1 for value in closes],
        'low': [value - 1 for value in closes],
        'close': closes,
        'volume': volumes if volumes is not None else [100.0] * len(closes),
        'data_source': source,
    })


def analyze(df):
    with patch('src.stock_analyzer.get_config', return_value=SimpleNamespace(bias_threshold=5.0)):
        return StockTrendAnalyzer().analyze(df, '000001')


@pytest.mark.parametrize(('close', 'direction'), [(102.0, 'up'), (98.0, 'down')])
def test_range_event_uses_twenty_previous_highs_and_lows(close, direction):
    df = history([100.0] * 20 + [close])
    df.loc[20, 'high'] = 150.0
    result = analyze(df)
    event, = result.rule_events

    assert event['rule_id'] == 'range20'
    assert event['direction'] == direction
    assert event['parameters'] == {'period': 20}
    assert event['evidence'] == {'close': close, 'reference_high': 101.0, 'reference_low': 99.0}
    assert event['bar_date'] == df.iloc[-1]['date'].date().isoformat()
    assert event['source'] == 'fixture'
    assert event['reference_start'] == df.iloc[0]['date'].date().isoformat()
    assert event['reference_end'] == df.iloc[-2]['date'].date().isoformat()


@pytest.mark.parametrize('close', [99.0, 101.0])
def test_touching_range_boundary_does_not_trigger_event(close):
    assert analyze(history([100.0] * 20 + [close])).rule_events == []


def test_volume_event_excludes_current_volume_from_baseline():
    result = analyze(history([100.0] * 21, [100.0] * 20 + [200.0]))
    event, = result.rule_events

    assert event['rule_id'] == 'volume20'
    assert event['direction'] == 'above'
    assert event['parameters'] == {'period': 20, 'ratio': 2.0}
    assert event['evidence'] == {'volume': 200.0, 'mean_volume20': 100.0, 'volume_ratio20': 2.0}
    # Independent evidence does not change the existing six-part score.
    df = history([100.0] * 40)
    baseline = analyze(df)
    # Some feeds exclude auctions from high/low; retain that declared source
    # convention rather than rejecting valid closing-auction prices.
    df.loc[:38, 'high'] = 99.0
    df.loc[:38, 'low'] = 98.0
    with_event = analyze(df)
    assert with_event.rule_events[0]['rule_id'] == 'range20'
    assert with_event.signal_score == baseline.signal_score


def test_zero_volume_baseline_never_becomes_positive_shrink_signal():
    result = analyze(history([100.0] * 40, [0.0] * 39 + [200.0]))
    normal = analyze(history([100.0] * 40))

    assert result.volume_ratio_5d is None
    assert result.indicator_availability['volume_ratio_5d'] is False
    assert result.signal_score == normal.signal_score - 10
    assert result.rule_events == []
    assert not any('洗盘' in reason for reason in result.signal_reasons)
    assert result.to_dict()['volume_status'] is None
    assert any('均量为零' in warning for warning in result.analysis_warnings)


def test_short_history_returns_null_unready_indicators_and_no_default_bonus():
    result = analyze(history([100.0] * 20))

    assert result.ma60 is None
    assert result.macd_dif is result.macd_dea is result.macd_bar is None
    assert result.rsi_6 == result.rsi_12 == 50.0
    assert result.rsi_24 is None
    assert result.indicator_availability['macd'] is False
    assert result.indicator_availability['rsi'] is False
    assert result.indicator_availability['rule_events'] is False
    assert result.signal_score == 50  # 12 trend + 18 bias + 10 volume + 10 support
    assert result.rule_events == []
    assert result.to_dict()['macd_status'] is None
    assert result.to_dict()['rsi_status'] is None
    assert '不可用' in StockTrendAnalyzer().format_analysis(result)
    json.dumps(result.to_dict(), allow_nan=False)


def test_exact_indicator_warmup_boundaries():
    rsi_pending = analyze(history([100.0] * 24))
    rsi_ready = analyze(history([100.0] * 25))
    macd_pending = analyze(history([100.0] * 34))
    macd_ready = analyze(history([100.0] * 35))

    assert rsi_pending.rsi_24 is None
    assert rsi_ready.rsi_24 == 50.0
    assert rsi_ready.signal_score == rsi_pending.signal_score + 5
    assert macd_pending.macd_dif is None
    assert macd_ready.macd_dif == macd_ready.macd_dea == macd_ready.macd_bar == 0.0
    assert macd_ready.signal_score == macd_pending.signal_score + 8
    assert analyze(history([100.0] * 59)).ma60 is None
    assert analyze(history([100.0] * 60)).ma60 == 100.0


@pytest.mark.parametrize(('flag', 'value'), [('is_partial_bar', True), ('is_estimated', True), ('closed', False)])
def test_explicit_pending_tail_updates_intraday_estimates_without_new_event(flag, value):
    df = history([100.0] * 20 + [102.0, 150.0])
    df[flag] = not value
    df.loc[len(df) - 1, flag] = value
    result = analyze(df)

    assert result.rule_events == []
    assert result.current_price == 150.0
    assert result.ma5 == pytest.approx((100.0 * 3 + 102.0 + 150.0) / 5)
    assert result.analysis_date == df.iloc[-1]['date'].date().isoformat()
    assert result.valid_bars == 22
    assert result.indicator_availability['rule_events'] is False
    assert any('未闭合' in warning for warning in result.analysis_warnings)


@pytest.mark.parametrize('defect', ['missing_close', 'negative_volume', 'high_below_low', 'gap', 'source', 'partial'])
def test_defect_or_provenance_change_resets_indicator_and_event_warmup(defect):
    df = history([100.0] * 60 + [100.0] * 20 + [102.0])
    if defect == 'missing_close':
        df.loc[60, 'close'] = float('nan')
    elif defect == 'negative_volume':
        df.loc[60, 'volume'] = -1.0
    elif defect == 'high_below_low':
        df.loc[60, 'high'] = 90.0
    elif defect == 'gap':
        df['gap_before'] = False
        df.loc[61, 'gap_before'] = True
    elif defect == 'source':
        df.loc[61:, 'data_source'] = 'other'
    else:
        df['is_partial_bar'] = False
        df.loc[60, 'is_partial_bar'] = True
    result = analyze(df)

    assert result.valid_bars == 20
    assert result.ma60 is None
    assert result.macd_dif is None
    assert result.indicator_availability['rule_events'] is False
    assert result.rule_events == []
    assert result.analysis_warnings


def test_new_segment_can_emit_after_twenty_one_valid_bars_without_reusing_old_ma60():
    df = history([50.0] * 60 + [100.0] * 20 + [102.0])
    df['gap_before'] = False
    df.loc[60, 'gap_before'] = True
    result = analyze(df)

    assert result.valid_bars == 21
    assert result.ma60 is None
    event, = result.rule_events
    assert event['evidence']['reference_high'] == 101.0


@pytest.mark.parametrize('defect', ['nonfinite', 'duplicate', 'quality', 'invalid_date'])
def test_invalid_final_bar_never_leaks_a_trade_signal_or_nonfinite_json(defect):
    df = history([100.0] * 60 + [150.0])
    if defect == 'nonfinite':
        df.loc[60, 'close'] = float('inf')
    elif defect == 'duplicate':
        df.loc[60, 'date'] = df.loc[59, 'date']
    elif defect == 'quality':
        df['quality'] = [[] for _ in range(len(df))]
        df.at[60, 'quality'] = ['missing_ohlcv']
    else:
        df.loc[60, 'date'] = pd.NaT
    result = analyze(df)

    assert result.buy_signal is BuySignal.WAIT
    assert result.signal_score == 0
    assert result.rule_events == []
    assert result.valid_bars == 0
    json.dumps(result.to_dict(), allow_nan=False)


def test_legacy_rows_do_not_invent_provenance_or_closure_guarantees():
    df = history([100.0] * 20 + [102.0]).drop(columns=['data_source'])
    result = analyze(df)

    assert result.analysis_source is None
    assert result.rule_events[0]['source'] is None
    assert 'closed' not in result.rule_events[0]


def test_appended_realtime_estimate_without_source_keeps_intraday_ma_contract():
    from src.core.pipeline import StockAnalysisPipeline

    df = history([100.0] * 60)
    pipeline = object.__new__(StockAnalysisPipeline)
    pipeline.config = SimpleNamespace(enable_realtime_technical_indicators=True)
    quote = SimpleNamespace(price=150.0, open_price=100.0, high=151.0, low=99.0, volume=500.0)
    market_now = df.iloc[-1]['date'] + pd.Timedelta(days=1, hours=10)
    with patch('src.core.pipeline.get_market_now', return_value=market_now), \
            patch('src.core.pipeline.is_market_open', return_value=True), \
            patch('src.core.pipeline.get_market_for_stock', return_value='cn'):
        augmented = pipeline._augment_historical_with_realtime(df, quote, '000001')
    result = analyze(augmented)

    assert result.valid_bars == 61
    assert result.current_price == 150.0
    assert result.ma5 == 110.0
    assert result.ma60 == pytest.approx((100.0 * 59 + 150.0) / 60)
    assert result.rule_events == []
    assert result.analysis_source is None
    assert any('盘中观察' in warning for warning in result.analysis_warnings)


@pytest.mark.parametrize('quote_source', ['tencent', None])
def test_realtime_update_uses_quote_provenance_without_restarting_daily_window(quote_source):
    from src.core.pipeline import StockAnalysisPipeline

    df = history([100.0] * 60, source='AkshareFetcher')
    before = df.copy(deep=True)
    pipeline = object.__new__(StockAnalysisPipeline)
    pipeline.config = SimpleNamespace(enable_realtime_technical_indicators=True)
    quote = SimpleNamespace(
        price=150.0, open_price=100.0, high=151.0, low=99.0, volume=500.0,
        source=SimpleNamespace(value=quote_source) if quote_source else None,
    )
    market_now = df.iloc[-1]['date'] + pd.Timedelta(hours=10)
    with patch('src.core.pipeline.get_market_now', return_value=market_now), \
            patch('src.core.pipeline.is_market_open', return_value=True), \
            patch('src.core.pipeline.get_market_for_stock', return_value='cn'):
        augmented = pipeline._augment_historical_with_realtime(df, quote, '000001')
    result = analyze(augmented)

    pd.testing.assert_frame_equal(df, before)
    assert result.valid_bars == 60
    assert result.current_price == 150.0
    assert result.ma5 == 110.0
    assert result.ma60 == pytest.approx((100.0 * 59 + 150.0) / 60)
    assert result.analysis_source == quote_source
    assert augmented.iloc[-1]['data_source'] == 'AkshareFetcher'
    assert result.rule_events == []


def test_formula_helper_masks_unready_rsi_values():
    result = StockTrendAnalyzer()._calculate_rsi(pd.DataFrame({'close': [100.0] * 25}))
    assert result['RSI_24'].iloc[:24].isna().all()
    assert result['RSI_24'].iloc[24] == 50.0
