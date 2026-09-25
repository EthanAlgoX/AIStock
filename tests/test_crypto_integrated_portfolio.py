"""Crypto uses the persisted portfolio and workspace contracts, including weekends."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import select

from api.v1.endpoints.simulation_portfolios import StrategyConfig
from data_provider.crypto_fetcher import daily_data, DAY_MS
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.trading_agent_service import TradingAgentService
from src.storage import SimulationFillRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_simulation_portfolios import run_sync


def spot_fetcher():
    def get_daily_data(code, start_date, end_date, **kwargs):
        dates = pd.date_range(start_date, end_date)
        return pd.DataFrame([dict(date=d.date(), open=50000+i, close=50001+i,
            high=50002+i, low=49999+i, volume=100, amount=5000000)
            for i, d in enumerate(dates)]), 'Binance Spot fixture'
    return SimpleNamespace(get_daily_data=get_daily_data)


@pytest.mark.parametrize('skill', ['crypto_rotation', 'crypto_equal_weight', 'crypto_btc_hold'])
def test_saved_crypto_strategy_runs_weekends_and_persists_fractional_fills(workspace, skill):
    agent = TradingAgentService(workspace.db)
    with patch('data_provider.crypto_fetcher.realtime_quote'), patch.object(agent, 'call', side_effect=AssertionError('No LLM')):
        preview = agent.preview('CRYPTO', dict(mode='fixed', symbols=['BTCUSDT'], query='', maxCandidates=12))
        payload = StrategyConfig(name=skill, market='CRYPTO', decisionBackend='rules',
            skillId=skill, universePreviewId=preview['id'], lotSize=1e-8, maxWeight=.5).model_dump()
        service = SimulationPortfolioService(workspace.db, spot_fetcher(), agent)
        saved = service.save_definition(payload)
        run = service.create_validation(saved['id'], dict(mode='backtest', initialCash=10000,
            startDate='2025-02-07', endDate='2025-02-10', historyMode='rules', universeHistory='frozen'))
        with patch.object(service, '_last_closed', return_value=date(2025, 2, 10)):
            run_sync(service, run['id'])
        result = service.detail(run['id'])
        assert result['status'] == 'completed', result.get('error')
        assert result['currency'] == 'USDT'
        assert len(result['days']) == 4
        assert result['days'][1]['date'] == '2025-02-08'
        with workspace.db.get_session() as session:
            fills = session.scalars(select(SimulationFillRecord)).all()
            assert fills and 0 < fills[0].quantity < 1
        assert all(day['usage']['tokens'] == 0 for day in result['days'])
        assert result['evaluation']['capitalMode'] == 'shared_cash_long_only_fractional'
        assert not result['days'][0]['trades']
        assert result['days'][1]['trades'][0]['signalDate'] == '2025-02-07'


def test_crypto_daily_rejects_gaps_and_open_candles():
    start = int(pd.Timestamp('2025-02-08', tz='UTC').timestamp()*1000)
    def candle(at):
        return [at, '100', '102', '99', '101', '10', at+DAY_MS-1, '1000', 0, 0, 0, 0]
    with patch('data_provider.crypto_fetcher._get', return_value=[candle(start), candle(start+DAY_MS)]):
        result = daily_data('BTCUSDT', '2025-02-08', '2025-02-09')
        assert list(result.date) == ['2025-02-08', '2025-02-09']
    with patch('data_provider.crypto_fetcher._get', return_value=[candle(start+DAY_MS)]):
        with pytest.raises(ValueError, match='missing'):
            daily_data('BTCUSDT', '2025-02-08', '2025-02-09')


@pytest.mark.parametrize('kind', ['research', 'screening'])
def test_crypto_uses_published_native_workspace_configuration(workspace, kind):
    from src.services.workspace_defaults import default_task_plan
    from src.services.strategy_definition_service import StrategyDefinitionError
    try:
        task = default_task_plan(workspace, kind, 'CRYPTO', 'BTCUSDT')['task']
    except StrategyDefinitionError as exc:
        pytest.fail(str(exc.details))
    assert task['market'] == 'CRYPTO'
    assert task['config']['strategyVersionId']
    assert workspace.create_task(task)['market'] == 'CRYPTO'


def test_crypto_screening_uses_existing_candidate_pipeline_without_equity_fundamentals():
    from src.services.screening.pipeline import screen
    assets = [dict(symbol='BTCUSDT', lastPrice=50000, changePercent24h=2,
                   quoteVolume24h=1e9, high24h=51000, low24h=48000),
              dict(symbol='ETHUSDT', lastPrice=3000, changePercent24h=1,
                   quoteVolume24h=5e8, high24h=3050, low24h=2900)]
    with patch('src.services.crypto_market_service.market_overview', return_value={
        'assets': assets, 'source': 'Binance Spot', 'asOf': '2025-02-10T00:00:00Z'}):
        result = screen('crypto_liquidity', market='crypto', max_output=2, use_llm=False,
                        collect_llm_candidate_context=False, daily_enrich=False,
                        industry_provider='none', post_analyzers=[])
    assert {p.code for p in result.picks} == {'BTCUSDT', 'ETHUSDT'}
    assert result.market == 'crypto'
    assert result.snapshot_source == 'Binance Spot'


def test_crypto_calendar_and_market_identity_never_fall_back_to_equities():
    from datetime import datetime, timezone
    from src.core.trading_calendar import get_market_for_stock, get_effective_trading_date, build_market_phase_context
    from src.market_context import get_market_guidelines
    from data_provider.base import _market_tag
    now = datetime(2025, 2, 9, 12, tzinfo=timezone.utc)
    assert get_market_for_stock('BTCUSDT') == _market_tag('BTCUSDT') == 'crypto'
    assert get_effective_trading_date('crypto', now) == date(2025, 2, 8)
    phase = build_market_phase_context(market='crypto', current_time=now)
    assert phase.is_market_open_now and not phase.warnings
    assert 'Spot' in get_market_guidelines('BTCUSDT', 'en')


@pytest.mark.parametrize('language', ['zh', 'en', 'ko', 'ja', 'zh-TW'])
def test_native_radar_crypto_identity_survives_model_unavailability(language):
    from src.market_analyzer import MarketAnalyzer, MarketOverview, MarketIndex
    from src.core.market_review_locale import MARKET_NAMES, CRYPTO_REVIEW_COPY
    analyzer = MarketAnalyzer(region='crypto', config=SimpleNamespace(report_language=language))
    overview = MarketOverview(date='2025-02-09', indices=[MarketIndex(code='BTCUSDT', name='BTCUSDT', current=50000)])
    report = analyzer._generate_template_review(overview, [])
    assert MARKET_NAMES[language]['crypto'] in report
    assert CRYPTO_REVIEW_COPY[language][0] in report
    assert analyzer._get_turnover_unit_label() == 'USDT bn'
    assert analyzer._get_market_scope_name(language) == MARKET_NAMES[language]['crypto']
    assert 'USDT' in analyzer._get_index_hint()


def test_crypto_daily_preserves_sub_cent_indicator_precision():
    start = int(pd.Timestamp('2025-02-08', tz='UTC').timestamp()*1000)
    row = [start, '.000011', '.000013', '.000010', '.000012', '10', start+DAY_MS-1, '.00012', 0, 0, 0, 0]
    with patch('data_provider.crypto_fetcher._get', return_value=[row]):
        frame = daily_data('SHIBUSDT', '2025-02-08', '2025-02-08')
    assert frame.iloc[0].ma5 == pytest.approx(.000012)
    assert frame.iloc[0].volume_ratio == 1
