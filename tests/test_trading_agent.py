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
from tests.test_simulation_portfolios import config, fetcher, run_sync


def fixed():
    return dict(mode='fixed', symbols=['AAPL'], query='', maxCandidates=12)


def test_range_filters_use_source_fields_and_freeze_interpretation(workspace):
    adapter = SimpleNamespace(call_text=lambda *a, **k: SimpleNamespace(content=json.dumps(dict(industryTerms=['Tech'], minVolatility=2, description='Tech行业且20日波动率至少2%')), usage={'total_tokens':100}, model='fixture', provider='fixture'))
    agent = TradingAgentService(workspace.db, adapter, lambda market: dict(snapshot_source='fixture-source', candidates=[
        dict(code='AAPL', industry='Technology', volatility_20d_pct=3),
        dict(code='MSFT', industry='Technology', volatility_20d_pct=1),
        dict(code='JPM', industry='Bank', volatility_20d_pct=4),
    ]))
    preview = agent.preview('US', dict(mode='custom', query='科技弹性大', symbols=[], maxCandidates=12))
    assert [c['code'] for c in preview['candidates']] == ['AAPL']
    assert agent.approved(preview['id'], 'US')['scope']['rule']['minVolatility'] == 2
    with pytest.raises(ValueError):
        agent.approved(preview['id'], 'CN')
    with pytest.raises(ValueError, match='缺少'):
        agent.recorded('US', preview['scope'], '2025-02-10')


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
