"""Provider pagination and discovery contracts, without paid model calls."""
from unittest.mock import patch

import pandas as pd
import pytest

from src.services.industry_universe_service import _directory, equity_directory
from src.services.trading_agent_service import TradingAgentService, _cn_industry_candidates


@pytest.fixture(autouse=True)
def clear_directory_cache():
    _directory.cache_clear()
    yield
    _directory.cache_clear()


def quote(symbol, exchange='HKG'):
    return dict(symbol=symbol, exchange=exchange, quoteType='EQUITY', shortName=symbol, marketCap=100)


def test_directory_reads_all_pages_including_stocks_beyond_old_limit():
    pages = [dict(total=251, start=0, quotes=[quote(f'{i:04}.HK') for i in range(1, 251)]),
             dict(total=251, start=250, quotes=[quote('2513.HK')])]
    with patch('yfinance.screen', side_effect=pages) as screen:
        rows = equity_directory('HK', ['信息技术'])
    assert len(rows) == 251 and rows[-1]['code'] == '2513.HK'
    assert screen.call_args.kwargs['offset'] == 250
    serialized = str(screen.call_args.args[0].to_dict())
    assert 'HKG' in serialized and 'Technology' in serialized


@pytest.mark.parametrize('page', [
    dict(total=2, start=1, quotes=[]),
    dict(total=2, start=1, quotes=[quote('0001.HK')]),
    dict(total=3, start=1, quotes=[quote('0002.HK')]),
    dict(total=2, start=0, quotes=[quote('0002.HK')]),
])
def test_partial_duplicate_or_shifting_directory_fails(page):
    with patch('yfinance.screen', side_effect=[dict(total=2, start=0, quotes=[quote('0001.HK')]), page]):
        with pytest.raises(RuntimeError):
            equity_directory('HK')


def test_us_uses_exchange_directory_and_semiconductor_union_not_default_tickers():
    with patch('yfinance.screen', return_value=dict(total=1, start=0, quotes=[quote('NEWCO', 'NMS')])) as screen:
        rows = equity_directory('US', ['半导体', '信息技术'])
    serialized = str(screen.call_args.args[0].to_dict())
    assert 'Semiconductors' in serialized and 'Technology' in serialized and 'NYQ' in serialized
    assert rows[0]['code'] == 'NEWCO'


@pytest.mark.parametrize('bad', [quote('2513.HK', 'NMS'), dict(quote('7709.HK'), quoteType='ETF')])
def test_directory_rejects_wrong_market_or_asset(bad):
    with patch('yfinance.screen', return_value=dict(total=1, start=0, quotes=[bad])):
        with pytest.raises(RuntimeError):
            equity_directory('HK')


def test_cn_all_industries_reads_all_boards_and_checks_constituent_counts():
    catalog = pd.DataFrame([dict(label='a', 板块='软件', 公司家数=100), dict(label='b', 板块='银行', 公司家数=100)])
    with patch('src.services.trading_agent_service._cn_constituent_count', return_value=1), patch('akshare.stock_sector_spot', return_value=catalog), patch('akshare.stock_sector_detail', side_effect=[
        pd.DataFrame([dict(code='600001', mktcap=1, nmc=1)]),
        pd.DataFrame([dict(code='600002', mktcap=1, nmc=1)])]):
        assert len(_cn_industry_candidates([])['candidates']) == 2
    with patch('src.services.trading_agent_service._cn_constituent_count', return_value=2), patch('akshare.stock_sector_spot', return_value=catalog.iloc[:1]), patch(
        'akshare.stock_sector_detail', return_value=pd.DataFrame([dict(code='600001')])):
        with pytest.raises(RuntimeError, match='数量'):
            _cn_industry_candidates(['软件'])


def test_hk_resolve_discovers_without_symbols_and_preserves_missing_evidence():
    agent = object.__new__(TradingAgentService)
    agent.screener = None
    scope = dict(mode='custom', industries=['信息技术'], symbols=[], maxCandidates=12,
                 rule=dict(industryTerms=['software'], minVolatility=None, description='科技'), reportLanguage='ko')
    rows = [dict(code='2513.HK', name='ZHIPU', industry='', total_mv=10),
            dict(code='0020.HK', name='SENSETIME', industry='', total_mv=20)]
    evidence = pd.DataFrame([dict(code='2513.HK', industry='Software', average_volume_20d=100,
                                  volatility_20d_pct=60, history_sessions=20)])
    with patch('src.services.industry_universe_service.equity_directory', return_value=rows), patch(
        'src.services.screening.snapshot_us.fetch_us_snapshot', return_value=evidence):
        result = agent.resolve('HK', scope)
    assert {r['code'] for r in result['candidates']} == {'HK02513', 'HK00020'}
    assert result['coverageStats'] == dict(directoryCount=2, eligibleCount=2, modelCount=2, sampled=False, monthlyEvidenceCount=1)
    assert '자료 완비 1' in result['coverage']
    assert next(r for r in result['candidates'] if r['code'] == 'HK00020')['volatility'] is None


@pytest.mark.parametrize('language,expected', [('en', 'Source directory'), ('zh', '来源目录'), ('zh-TW', '來源目錄'), ('ja', 'データ元'), ('ko', '데이터 제공처')])
def test_coverage_localized(language, expected):
    assert expected in TradingAgentService._coverage(dict(mode='custom', reportLanguage=language), dict(
        directoryCount=100, eligibleCount=100, modelCount=40, sampled=True, monthlyEvidenceCount=35))


def test_cn_b_shares_are_not_a_share_candidates():
    agent = object.__new__(TradingAgentService)
    agent.screener = lambda market: dict(candidates=[dict(code=code, industry='软件') for code in ['600001', '200001', '900001', '920001']])
    result = agent.resolve('CN', dict(mode='custom', rule=dict(industryTerms=['软件'], minVolatility=None, description='软件')))
    assert {row['code'] for row in result['candidates']} == {'600001', '920001'}


def test_full_pool_ranking_finds_small_cap_outside_stratified_sample():
    from datetime import date
    rows = [dict(code=f'{600000+i}', industry='软件', total_mv=100-i,
                 volatility_20d_pct=i+1, average_volume_20d=i+1,
                 history_sessions=20, quote_date='2026-09-22') for i in range(100)]
    rows[1].update(average_volume_20d=10000, volatility_20d_pct=200)
    agent = object.__new__(TradingAgentService)
    agent.screener = lambda market: dict(candidates=rows)
    scope = dict(mode='custom', candidateRanking='volume_volatility',
                 rule=dict(industryTerms=['软件'], minVolatility=None, description='量价'))
    with patch('src.services.simulation_portfolio_service.SimulationPortfolioService._last_closed', return_value=date(2026, 9, 22)):
        result = agent.resolve('CN', scope)
    assert result['candidates'][0]['code'] == '600001'
    assert result['candidates'][0]['raw']['screeningScore'] == 1
    assert result['coverageStats']['evaluatedCount'] == 100
    assert result['coverageStats']['validCount'] == 100
    assert len(result['candidates']) == 40


def test_volume_ranking_excludes_stale_missing_and_nonfinite_evidence():
    def row(code, **changes):
        raw = dict(average_volume_20d=100, history_sessions=20, quote_date='2026-09-22')
        raw.update(changes)
        return dict(code=code, volatility=10, raw=raw)
    rows = [row('A'), row('B', quote_date='2026-09-21'), row('C', history_sessions=19),
            row('D', average_volume_20d=None), row('E', average_volume_20d=float('inf')),
            dict(row('F'), volatility=float('nan'))]
    ranked, count = TradingAgentService._rank_volume_volatility(rows, '2026-09-22')
    assert count == 1 and [r['code'] for r in ranked] == ['A']


def test_ranked_refresh_preserves_approved_symbols():
    agent = object.__new__(TradingAgentService)
    agent.screener = lambda market: dict(candidates=[dict(code=code, industry='软件') for code in ['600001', '600002']])
    result = agent.resolve('CN', dict(mode='custom', candidateRanking='volume_volatility',
        selection=dict(candidates=['600001']), rule=dict(industryTerms=['软件'], minVolatility=None, description='软件')))
    assert [row['code'] for row in result['candidates']] == ['600001']


def test_history_only_snapshot_does_not_request_company_metadata():
    from src.services.screening.snapshot_us import fetch_us_snapshot
    bars = pd.DataFrame(dict(Close=list(range(100, 121)), Volume=[1000]*21),
                        index=pd.bdate_range('2026-08-24', periods=21))
    with patch('yfinance.download', return_value=bars) as download, patch('yfinance.Ticker') as ticker:
        result = fetch_us_snapshot(['2513.HK'], include_metadata=False, as_of='2026-09-22')
    ticker.assert_not_called()
    assert download.call_args.kwargs['end'] == '2026-09-23'
    assert result.iloc[0]['average_volume_20d'] == 1000


def test_scope_ranking_enum_is_backward_compatible():
    from api.v1.endpoints.simulation_portfolios import Scope
    assert Scope(mode='custom').candidateRanking == 'balanced'
    assert Scope(mode='custom', candidateRanking='volume_volatility').candidateRanking == 'volume_volatility'
    with pytest.raises(ValueError):
        Scope(mode='custom', candidateRanking='guess')


@pytest.mark.parametrize('code', ['BRK-B', 'BRK.A', 'BF-B'])
def test_us_share_classes_survive_market_filter(code):
    from src.market_context import detect_market
    assert detect_market(code) == 'us'
    agent = object.__new__(TradingAgentService)
    agent.screener = lambda market: dict(candidates=[dict(code=code, industry='Financial Services')])
    result = agent.resolve('US', dict(mode='custom', rule=dict(industryTerms=[], minVolatility=None, description='all')))
    assert len(result['candidates']) == 1
