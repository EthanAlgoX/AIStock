"""Trading decisions exercise real private snapshots and the existing ledger."""
import json
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select, func
from src.services.trading_agent_service import TradingAgentService
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.storage import SimulationAccountRecord, SimulationFillRecord, SimulationUniverseSnapshotRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_simulation_portfolios import config, fetcher, history, run_sync


def fixed():
    return dict(mode='fixed', symbols=['AAPL'], query='', maxCandidates=12)


def test_industry_filter_precedes_sampling_and_preserves_market_cap(workspace):
    captured = []
    rows = [dict(code=f'{600000+i}', industry='银行', total_mv=1e12) for i in range(80)]
    rows += [dict(code='688001', name='行业候选', industry='半导体', total_mv=2e10),
             dict(code='NVDA', industry='半导体', total_mv=5e12)]
    adapter = SimpleNamespace(call_text=lambda messages, **kw: captured.append(json.loads(messages[-1]['content'])) or
        SimpleNamespace(content=json.dumps(dict(candidates=[dict(code='688001', reason='规模满足')], summary='已筛选')),
                        usage={'total_tokens': 100}, model='fixture', provider='fixture'))
    agent = TradingAgentService(workspace.db, adapter, lambda market: dict(candidates=rows))
    result = agent.preview('CN', dict(mode='custom', query='中市值以上', industries=['半导体'], maxCandidates=12))
    assert [row['code'] for row in captured[0]['candidates']] == ['688001']
    assert captured[0]['candidates'][0]['totalMarketValue'] == 2e10
    assert result['scope']['rule']['industryTerms']
    rows.append(dict(code='688002', industry='半导体', total_mv=3e10))
    assert [row['code'] for row in agent.resolve('CN', result['scope'])['candidates']] == ['688001']


def test_sample_covers_industries_and_size_scales():
    from src.services.trading_agent_service import _bounded_industry_sample
    rows = [dict(code=f'{group}-{i}', industry=group, raw={'total_mv': i + 1})
            for group in ('半导体', '软件') for i in range(100)]
    selected = _bounded_industry_sample(rows)
    assert len(selected) == 40
    assert len({row['code'] for row in selected}) == 40
    for group in ('半导体', '软件'):
        caps = [row['raw']['total_mv'] for row in selected if row['industry'] == group]
        assert min(caps) == 1 and max(caps) == 100


def test_cn_source_reads_matching_industry_constituents_and_normalizes_units():
    import pandas as pd
    from src.services.trading_agent_service import _cn_industry_candidates
    with patch('akshare.stock_sector_spot', return_value=pd.DataFrame([
        {'label': 'tech', '板块': '计算机、通信和其他电子设备制造业'},
        {'label': 'bank', '板块': '货币金融服务'},
    ])), patch('akshare.stock_sector_detail', return_value=pd.DataFrame([
        {'code': '688001', 'name': '样本', 'mktcap': 2000000, 'nmc': 1000000},
    ])) as detail:
        result = _cn_industry_candidates(['电子'])
    detail.assert_called_once_with(sector='tech')
    assert result['candidates'][0]['total_mv'] == 2e10
    assert result['candidates'][0]['industry'] == '计算机、通信和其他电子设备制造业'


@pytest.mark.parametrize('codes', [['AAPL', 'AAPL'], ['MSFT']])
def test_preview_rejects_duplicate_and_outside_codes(workspace, codes):
    adapter = SimpleNamespace(call_text=lambda *a, **kw: SimpleNamespace(
        content=json.dumps(dict(candidates=[dict(code=code, reason='test') for code in codes])),
        usage={'total_tokens': 100}, model='fixture', provider='fixture'))
    agent = TradingAgentService(workspace.db, adapter, lambda market: dict(candidates=[dict(code='AAPL', industry='Software')]))
    with pytest.raises(ValueError, match='范围外或重复'):
        agent.preview('US', dict(mode='custom', query='中市值以上', industries=['信息技术']))


def test_range_filters_use_source_fields_and_freeze_interpretation(workspace):
    calls = []
    adapter = SimpleNamespace(call_text=lambda *a, **k: calls.append(k) or SimpleNamespace(content=json.dumps(dict(candidates=[dict(code='AAPL', reason='科技且中市值以上')], summary='科技范围')), usage={'total_tokens':100}, model='fixture', provider='fixture'))
    agent = TradingAgentService(workspace.db, adapter, lambda market: dict(snapshot_source='fixture-source', candidates=[
        dict(code='AAPL', industry='Technology', volatility_20d_pct=3),
        dict(code='MSFT', industry='Technology', volatility_20d_pct=1),
        dict(code='JPM', industry='Bank', volatility_20d_pct=4),
    ]))
    preview = agent.preview('US', dict(mode='custom', query='科技弹性大', symbols=[], maxCandidates=12))
    assert [c['code'] for c in preview['candidates']] == ['AAPL']
    assert calls[0]['max_tokens'] == 16384
    assert calls[0]['timeout'] == 60
    assert agent.approved(preview['id'], 'US')['scope']['selection']['candidates'] == ['AAPL']
    with pytest.raises(ValueError):
        agent.approved(preview['id'], 'CN')
    with pytest.raises(ValueError, match='缺少'):
        agent.recorded('US', preview['scope'], '2025-02-10')


def test_industry_selection_previews_without_llm_and_all_industries_is_unrestricted(workspace):
    screener = lambda market: dict(snapshot_source='fixture', candidates=[
        dict(code='600001', name='半导体样本', industry='半导体', volatility_20d_pct=3),
        dict(code='600002', name='金融样本', industry='金融', volatility_20d_pct=2),
    ])
    agent = TradingAgentService(workspace.db, SimpleNamespace(call_text=lambda *a, **k: SimpleNamespace(content=json.dumps(dict(candidates=[dict(code='600001', reason='半导体')], summary='半导体')), usage={'total_tokens':100}, model='fixture', provider='fixture')), screener)
    selected = agent.preview('CN', dict(mode='custom', query='', industries=['半导体'], allIndustries=False, symbols=[], maxCandidates=12))
    assert [item['code'] for item in selected['candidates']] == ['600001']
    assert selected['scope']['selection']['candidates'] == ['600001']
    all_industries = agent.preview('CN', dict(mode='custom', query='', industries=[], allIndustries=True, symbols=[], maxCandidates=12))
    assert [item['code'] for item in all_industries['candidates']] == ['600001']
    assert all_industries['scope']['selection']['candidates'] == ['600001']


def test_grid_skill_is_available_to_agent_and_receives_frozen_parameters(workspace):
    captured = []
    response = SimpleNamespace(
        content=json.dumps({'opinions': [{'code': 'AAPL', 'targetWeight': 0.2, 'reason': '网格条件满足'}]}),
        usage={'total_tokens': 100}, model='fixture-model', provider='fixture',
    )
    agent = TradingAgentService(workspace.db, SimpleNamespace(call_text=lambda messages, **kwargs: captured.append(json.loads(messages[-1]['content'])) or response))
    snapshot = agent.skill_snapshot('high_volume_volatility_grid')
    assert snapshot['name'] == '高量高波动网格'
    opinions, _ = agent.decide(
        dict(market='US', maxPositions=1, maxWeight=0.25, portfolioId=1, skillSnapshot=snapshot,
             gridLookbackDays=5, gridMinVolumeRatio=1.2, gridMinRange=0.05, gridLevels=5),
        {'cash': 100000, 'equity': 100000, 'positions': {}}, '2025-02-10',
        {'AAPL': history()}, ['AAPL'], 100000, 'run-1',
    )
    assert opinions[0]['targetWeight'] == 0.2
    assert captured[0]['grid'] == {'lookbackDays': 5, 'minVolumeRatio': 1.2, 'minRange': 0.05, 'levels': 5}


def setup_agent(workspace, bad=False):
    calls = []
    weights = iter([0.2, 0.1, 0, 0, 0])
    def completion(messages, **kwargs):
        payload = json.loads(messages[-1]['content'])
        calls.append(payload)
        assert all(bar['date'] <= payload['date'] for bars in payload['bars'].values() for bar in bars)
        weight = next(weights)
        result = dict(opinions=[dict(code='MSFT' if bad else code, targetWeight=weight, reason='仅依据本日输入行情') for code in payload['bars']])
        return SimpleNamespace(content=json.dumps(result), usage={'prompt_tokens':80,'completion_tokens':20,'total_tokens':100}, model='fixture-model', provider='fixture')
    agent = TradingAgentService(workspace.db, SimpleNamespace(call_text=completion))
    skill = workspace.create_skill(dict(name='价格交易方法', instructions='仅根据输入日线形成目标仓位，禁止引用外部信息。'))
    preview = agent.preview('US', fixed())
    service = SimulationPortfolioService(workspace.db, fetcher(), agent)
    payload = config(engine='agent', skillId=skill['id'], universePreviewId=preview['id'], runTokenBudget=100000)
    saved = service.save_definition(payload)
    return agent, service, saved, calls


def test_agent_replay_executes_next_open_and_partial_rebalances(workspace):
    agent, service, saved, calls = setup_agent(workspace)
    with pytest.raises(ValueError, match='历史回放'):
        service.create_validation(saved['id'], dict(mode='backtest'))
    account = service.create_validation(saved['id'], dict(mode='backtest', historyMode='ai_replay', universeHistory='frozen', initialCash=100000, startDate='2025-02-10', endDate='2025-02-14'))
    with patch.object(service, '_last_closed', return_value=date(2025,2,14)):
        run_sync(service, account['id'])
    result = service.detail(account['id'])
    assert not result['error'], result['error']
    assert len(result['days']) == len(calls) == 5
    assert result['days'][0]['trades'] == []
    assert result['days'][1]['trades'][0]['side'] == 'buy'
    assert result['days'][2]['trades'][0]['side'] == 'sell'
    assert result['days'][2]['holdings'][0]['quantity'] > 0
    assert result['days'][3]['holdings'] == []
    assert all(d['usage']['tokens'] == 100 for d in result['days'])
    assert result['config']['skillSnapshot']['instructions']
    with workspace.db.get_session() as session:
        assert session.scalar(select(func.count()).select_from(SimulationFillRecord)) == 3
    with patch.object(service, '_last_closed', return_value=date(2025,2,14)):
        run_sync(service, account['id'])
    assert len(calls) == 5


def test_invalid_agent_decision_never_writes_account_day(workspace):
    _, service, saved, _ = setup_agent(workspace, bad=True)
    account = service.create_validation(saved['id'], dict(mode='backtest', historyMode='ai_replay', initialCash=100000, startDate='2025-02-10', endDate='2025-02-14'))
    with patch.object(service, '_last_closed', return_value=date(2025,2,14)):
        run_sync(service, account['id'])
    result = service.detail(account['id'])
    assert result['error'] and not result['days']
    with workspace.db.get_session() as session:
        assert session.scalar(select(func.count()).select_from(SimulationFillRecord)) == 0
        assert session.get(SimulationAccountRecord, 1).cash_balance == 100000
        assert session.scalar(select(func.count()).select_from(SimulationUniverseSnapshotRecord)) == 1


def test_rejected_answers_remain_auditable(workspace):
    _, service, saved, _ = setup_agent(workspace, bad=True)
    account = service.create_validation(saved['id'], dict(mode='backtest', historyMode='ai_replay', initialCash=100000, startDate='2025-02-10', endDate='2025-02-14'))
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, account['id'])
    call = service.detail(account['id'])['agentCalls'][0]
    assert call['status'] == 'rejected'
    assert 'MSFT' in call['answer'] and call['usage']['total_tokens'] == 100
    assert call['error'] and call['input']


def test_budget_prevents_provider_call_and_missing_usage_is_failed(workspace):
    from src.storage import SimulationTradingCallRecord
    from unittest.mock import Mock
    adapter = Mock()
    agent = TradingAgentService(workspace.db, adapter)
    with pytest.raises(ValueError, match='预算不足'):
        agent.call('system', {'bars': 'x' * 1000}, 100)
    adapter.call_text.assert_not_called()
    adapter.call_text.return_value = SimpleNamespace(content='{}', usage={}, model='fixture', provider='fixture')
    with pytest.raises(ValueError, match='Token'):
        agent.call('system', {}, 10000)
    with workspace.db.get_session() as session:
        row = session.scalar(select(SimulationTradingCallRecord))
        assert row.status == 'failed' and row.output_text == '{}'


def test_daily_empty_scope_still_manages_previous_holdings(workspace):
    agent, service, saved, calls = setup_agent(workspace)
    with workspace.db.session_scope() as session:
        from src.storage import SimulationPortfolioDefinitionRecord
        row = session.get(SimulationPortfolioDefinitionRecord, saved['id'])
        cfg = json.loads(row.config_json)
        cfg['scopeRefresh'] = 'daily'
        row.config_json = json.dumps(cfg)
    with patch('src.services.simulation_portfolio_service.datetime', wraps=datetime) as clock:
        clock.now.return_value = datetime(2025, 2, 10)
        account = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    for day in (10, 11):
        with patch.object(service, '_last_closed', return_value=date(2025, 2, day)):
            run_sync(service, account['id'])
    with patch.object(agent, 'resolve', return_value=dict(candidates=[], source='empty', observedAt='fixture')), patch.object(service, '_last_closed', return_value=date(2025, 2, 12)):
        run_sync(service, account['id'])
    result = service.detail(account['id'])
    assert not result['error'], result['error']
    assert calls[-1]['candidates'] == [] and 'AAPL' in calls[-1]['bars']
    assert result['days'][-1]['opinions'][0]['targetWeight'] == 0


def test_us_scope_uses_us_snapshot_instead_of_cn_only_strategy(workspace):
    import pandas as pd
    from src.services.screening import snapshot_us
    agent = TradingAgentService(workspace.db)
    scope = dict(mode='custom', symbols=['NVDA'], maxCandidates=3,
                 rule=dict(industryTerms=['Semiconductor'], minVolatility=20, description='半导体且年化波动率至少20%'))
    with patch.object(snapshot_us, 'fetch_us_snapshot', return_value=pd.DataFrame([
        dict(code='NVDA', industry='Semiconductors', volatility_20d_pct=35),
    ])) as fetch:
        result = agent.resolve('US', scope)
    assert result['candidates'][0]['code'] == 'NVDA'
    fetch.assert_called_once_with(tickers=['NVDA'])
    with pytest.raises(ValueError, match='港股'):
        agent.preview('HK', dict(mode='custom', query='科技行业', symbols=[]))


def test_us_scope_volatility_and_industry_come_from_provider_data():
    import pandas as pd
    import yfinance as yf
    from src.services.screening.snapshot_us import fetch_us_snapshot
    from src.services.screening.daily import _volatility_20d_pct
    bars = pd.DataFrame({'Close':[100+i for i in range(21)],'Volume':[1000]*21}, index=pd.date_range('2026-08-01', periods=21))
    ticker = SimpleNamespace(fast_info=SimpleNamespace(market_cap=1000000, shares=10000),
                             info=dict(industry='Semiconductors', shortName='Fixture', trailingPE=20, priceToBook=3))
    with patch.object(yf, 'download', return_value=bars), patch.object(yf, 'Ticker', return_value=ticker):
        frame = fetch_us_snapshot(tickers=['NVDA'])
    assert frame.iloc[0]['industry'] == 'Semiconductors'
    assert frame.iloc[0]['volatility_20d_pct'] == pytest.approx(_volatility_20d_pct(bars['Close']))


def test_range_source_failure_is_actionable_and_preserves_model_usage(workspace):
    from src.storage import SimulationTradingCallRecord
    response = SimpleNamespace(content=json.dumps(dict(candidates=[], summary='科技')),
                               usage={'total_tokens':100}, model='fixture', provider='fixture')
    def unavailable(market):
        raise TimeoutError('provider timeout')
    agent = TradingAgentService(workspace.db, SimpleNamespace(call_text=lambda *a, **k: response), unavailable)
    with pytest.raises(ValueError, match='数据源暂时不可用'):
        agent.preview('US', dict(mode='custom', query='科技行业', symbols=[]))
    with workspace.db.get_session() as session:
        assert session.scalar(select(SimulationTradingCallRecord)) is None
        assert session.scalar(select(func.count()).select_from(SimulationUniverseSnapshotRecord)) == 0
