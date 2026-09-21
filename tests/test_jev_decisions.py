"""Exercise the HTTP boundary, saved config and real next-open simulation ledger."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import requests
from sqlalchemy import select

from api.v1.endpoints.simulation_portfolios import StrategyConfig
from src.core.config_manager import ConfigManager
from src.services.system_config_service import SystemConfigService
from src.services.jev_decision_service import JevDecisionService, allocation_plan
from src.services.simulation_portfolio_engine import step
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.trading_agent_service import TradingAgentService
from src.storage import SimulationTradingCallRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_simulation_portfolios import config, history, fetcher, run_sync


@pytest.fixture
def jev_config():
    return SimpleNamespace(typesafe_api_key='test-secret', typesafe_base_url='https://api.typesafe.ai',
                           typesafe_model='jev-latest')


def response(choice='buy', model='jev-test-version'):
    return dict(model=model, answers={'stock_0': dict(type='choice', choice=choice,
                probabilities={c: 0.8 if c == choice else 0.1 for c in ('buy', 'sell', 'hold')}, confidence=0.6)},
                usage=dict(input_tokens=100, output_tokens=20))


def http_result(body, status=200):
    result = MagicMock()
    result.__enter__.return_value = result
    result.status_code = status
    result.json.return_value = body
    return result


def inputs():
    return dict(date='2025-02-10', bars={'AAPL': history()}, holdings={}, equity=100000, allocationStep=0.05)


def test_official_request_preserves_probabilities_and_audits_usage(workspace, jev_config):
    with patch('requests.post', return_value=http_result(response())) as post:
        answers, usage = JevDecisionService(jev_config).evaluate(
            workspace.db, inputs(), 'Frozen grid skill', 'jev-latest', 100000, 'test', None)
    assert answers['AAPL']['probabilities'] == {'buy': 0.8, 'sell': 0.1, 'hold': 0.1}
    assert usage['tokens'] == 120 and usage['model'] == 'jev-test-version'
    args = post.call_args
    assert args.args[0] == 'https://api.typesafe.ai/v1/systemone'
    assert args.kwargs['allow_redirects'] is False
    assert args.kwargs['headers']['Authorization'] == 'Bearer test-secret'
    assert args.kwargs['json']['state']['allocationStep'] == 0.05
    assert args.kwargs['json']['questions']['stock_0']['type'] == 'choice'
    with workspace.db.get_session() as session:
        record = session.get(SimulationTradingCallRecord, usage['callId'])
        assert record.status == 'received'
        assert 'test-secret' not in record.input_json + record.output_text
        assert json.loads(record.output_text)['model'] == 'jev-test-version'


@pytest.mark.parametrize('failure', ['missing', 'extra', 'category', 'nan', 'sum', 'mismatch', 'usage', 'model'])
def test_invalid_answers_never_become_plans(workspace, jev_config, failure):
    body = response()
    answer = body['answers']['stock_0']
    if failure == 'missing':
        body['answers'] = {}
    elif failure == 'extra':
        body['answers']['unknown'] = answer
    elif failure == 'category':
        answer['choice'] = 'short'
    elif failure == 'nan':
        answer['confidence'] = float('nan')
    elif failure == 'sum':
        answer['probabilities']['buy'] = 0.3
    elif failure == 'mismatch':
        answer['choice'] = 'sell'
    elif failure == 'usage':
        body['usage'] = {}
    else:
        del body['model']
    with patch('requests.post', return_value=http_result(body)), pytest.raises(ValueError):
        JevDecisionService(jev_config).evaluate(workspace.db, inputs(), 'skill', 'jev-latest', 100000, 'test', None)
    with workspace.db.get_session() as session:
        record = session.scalar(select(SimulationTradingCallRecord))
        assert record.status == 'failed' and record.error_message


@pytest.mark.parametrize('status', [401, 422, 429, 529, 302])
def test_http_errors_are_safe_and_have_no_fallback(workspace, jev_config, status):
    with patch('requests.post', return_value=http_result({'secret': 'must not leak'}, status)) as post:
        with pytest.raises(ValueError, match=f'HTTP {status}') as error:
            JevDecisionService(jev_config).evaluate(workspace.db, inputs(), 'skill', 'jev-latest', 100000, 'test', None)
    assert 'must not leak' not in str(error.value)
    assert post.call_count == 1


def test_timeout_and_input_budget(workspace, jev_config):
    service = JevDecisionService(jev_config)
    with patch('requests.post', side_effect=requests.Timeout('secret')) as post:
        with pytest.raises(ValueError, match='budget'):
            service.evaluate(workspace.db, inputs(), 'skill', 'jev-latest', 1, 'test', None)
        post.assert_not_called()
        with pytest.raises(ValueError, match='timed out') as error:
            service.evaluate(workspace.db, inputs(), 'skill', 'jev-latest', 100000, 'test', None)
        assert 'secret' not in str(error.value)


def test_allocation_step_and_limits_are_not_probability_weights():
    answers = {c: response()['answers']['stock_0'] for c in ['AAPL', 'MSFT', 'NVDA']}
    state = dict(cash=95000, equity=100000, positions={'AAPL': dict(quantity=50, averageCost=100)})
    plan = allocation_plan(answers, dict(maxPositions=2, maxWeight=0.25, jevWeightStep=0.05),
                           state, {c: history() for c in answers}, list(answers))
    weights = {o['code']: o['targetWeight'] for o in plan}
    assert weights == {'AAPL': 0.1, 'MSFT': 0.05, 'NVDA': 0}
    assert all(o['confidence'] == 0.6 for o in plan)
    # Exiting a universe cannot increase the old position.
    plan = allocation_plan({'AAPL': answers['AAPL']}, dict(maxPositions=2, maxWeight=0.25),
                           state, {'AAPL': history()}, [])
    assert plan[0]['targetWeight'] == 0.05


@pytest.mark.parametrize('direction,price', [('hold', 200), ('hold', 50), ('buy', 200), ('sell', 50)])
def test_next_open_cannot_reverse_jev_direction(direction, price):
    state = dict(cash=90000, positions={'AAPL': dict(quantity=100, averageCost=100)},
                 pending=dict(date='2025-02-10', selected=['AAPL'], weights={'AAPL': 0.1},
                              reasons={'AAPL': 'JEV'}, directions={'AAPL': direction}))
    final, output = step(config(engine='agent'), state, '2025-02-11', {'AAPL': history('2025-02-11', price)}, 100)
    assert not output['trades']
    assert final['positions']['AAPL']['quantity'] == 100


def test_real_decide_branch_and_version_guard(workspace, jev_config):
    agent = TradingAgentService(workspace.db, adapter=MagicMock())
    c = dict(market='US', maxPositions=2, maxWeight=0.25, skillSnapshot={'id': 'test', 'instructions': 'grid'},
             decisionBackend='jev', jevModel='jev-latest')
    state = dict(cash=100000, equity=100000, positions={})
    with patch('src.services.jev_decision_service.get_config', return_value=jev_config), \
            patch('requests.post', return_value=http_result(response())):
        opinions, usage = agent.decide(c, state, '2025-02-10', {'AAPL': history()}, ['AAPL'], 100000, 'test')
        assert opinions[0]['targetWeight'] == 0.05
        assert opinions[0]['decisionBackend'] == 'jev'
        state['agentModel'] = 'different-version'
        with pytest.raises(ValueError, match='模型版本'):
            agent.decide(c, state, '2025-02-10', {'AAPL': history()}, ['AAPL'], 100000, 'test')
    agent.adapter.call_text.assert_not_called()
    with workspace.db.get_session() as session:
        rows = session.scalars(select(SimulationTradingCallRecord).order_by(SimulationTradingCallRecord.id)).all()
        assert [r.status for r in rows] == ['received', 'rejected']


def test_settings_save_and_reload_key_and_defaults(tmp_path, monkeypatch):
    from src.config import Config
    path = tmp_path / '.env'
    path.write_text('')
    monkeypatch.setenv('ENV_FILE', str(path))
    for key in ('TYPESAFE_API_KEY', 'TYPESAFE_MODEL', 'TYPESAFE_BASE_URL'):
        monkeypatch.setenv(key, "")
    manager = ConfigManager(path)
    service = SystemConfigService(manager)
    result = service.update(config_version=manager.get_config_version(), items=[
        {'key': 'TYPESAFE_API_KEY', 'value': 'test-secret'},
        {'key': 'TYPESAFE_BASE_URL', 'value': 'https://api.typesafe.ai'},
        {'key': 'TYPESAFE_MODEL', 'value': 'jev-test-version'},
    ], reload_now=True)
    try:
        assert result['reload_triggered']
        assert Config.get_instance().typesafe_api_key == 'test-secret'
        assert Config.get_instance().typesafe_model == 'jev-test-version'
        fields = {f['key']: f for f in service.get_config()['items']}
        assert fields['TYPESAFE_API_KEY']['schema']['is_sensitive'] is True
    finally:
        Config.reset_instance()


def test_api_default_and_invalid_backend():
    assert StrategyConfig(name='test', market='US').decisionBackend == 'llm'
    with pytest.raises(ValueError):
        StrategyConfig(name='test', market='US', decisionBackend='unknown')


def test_saved_strategy_and_real_ledger_daily_run(workspace, jev_config):
    agent = TradingAgentService(workspace.db)
    service = SimulationPortfolioService(workspace.db, fetcher(), agent)
    scope = dict(mode='fixed', symbols=['AAPL'], query='', maxCandidates=12)
    preview = agent.preview('US', scope)
    payload = config(engine='agent', decisionBackend='jev', jevWeightStep=0.05,
                     jevTask={'question': 'Compare the range position.', 'lookbackDays': 7,
                              'criteria': {'buy': 'Lower range'}, 'background': 'Patient allocation.'},
                     universePreviewId=preview['id'], skillId='high_volume_volatility_grid', runTokenBudget=100000)
    with patch('src.services.jev_decision_service.get_config', return_value=jev_config), \
            patch('src.config.get_config', return_value=jev_config), \
            patch('requests.post', return_value=http_result(response())):
        saved = service.save_definition(payload)
    assert saved['config']['jevModel'] == 'jev-latest'
    assert saved['config']['jevTask']['lookbackDays'] == 7
    with patch('src.services.jev_decision_service.get_config', return_value=jev_config), \
            patch('requests.post', return_value=http_result(response())):
        portfolio = service.create_validation(saved['id'], dict(mode='backtest', startDate='2025-02-10',
                                               endDate='2025-02-14', historyMode='ai_replay'))
        run_sync(service, portfolio['id'])
    result = service.detail(portfolio['id'])
    assert result['error'] is None
    assert result['config']['jevTask'] == saved['config']['jevTask']
    with workspace.db.get_session() as session:
        requests_sent = session.scalars(select(SimulationTradingCallRecord)).all()
        assert len(requests_sent) == 5
        for row in requests_sent:
            sent = json.loads(row.input_json)
            assert sent['questions']['stock_0']['instructions']['customQuestion'] == 'Compare the range position.'
            assert len(sent['state']['bars']['AAPL']) <= 7
    assert len(result['days']) == 5
    assert result['days'][0]['opinions'][0]['decision'] == 'buy'
    assert not result['days'][0]['trades']
    assert any(d['trades'] for d in result['days'][1:])
    assert result['days'][-1]['usage']['model'] == 'jev-test-version'


def test_grid_evidence_uses_only_the_frozen_window_and_preserves_source():
    from src.services.jev_decision_service import decision_state
    payload = inputs()
    payload['holdings'] = {'AAPL': {'quantity': 100}}
    payload['grid'] = {'lookbackDays': 5}
    for row in payload['bars']['AAPL']:
        row.update(low=90, high=110, volume=100)
    payload['bars']['AAPL'][-1].update(close=91, volume=300)
    payload['bars']['AAPL'][0].update(high=1000, volume=1000000)
    facts = decision_state(payload)['derivedFacts']['AAPL']
    assert facts['currentWeight'] == pytest.approx(0.091)
    assert facts['rangeLow'] == 90 and facts['rangeHigh'] == 110
    assert facts['volumeRatio'] == 3
    assert facts['rangeRatio'] == pytest.approx(20 / 90)
    assert facts['rangePosition'] == 0.05
    assert 'derivedFacts' not in payload


def test_target_weight_skill_has_explicit_direction_adapter(workspace, jev_config):
    with patch('requests.post', return_value=http_result(response())) as post:
        JevDecisionService(jev_config).evaluate(workspace.db, inputs(), 'targetWeight must be zero',
                                               'jev-latest', 100000, 'test', None)
    instructions = post.call_args.kwargs['json']['questions']['stock_0']['instructions']['strategy']
    assert 'sell when shares are held' in instructions
    assert 'hold when none are held' in instructions
    assert 'higher means buy, lower means sell' in instructions


def test_grid_missing_history_and_zero_volume_are_not_invented():
    from src.services.jev_decision_service import decision_state
    payload = inputs()
    payload['grid'] = {'lookbackDays': 5}
    for row in payload['bars']['AAPL']:
        row['volume'] = 0
    assert decision_state(payload)['derivedFacts']['AAPL']['volumeRatio'] is None
    payload['bars']['AAPL'] = payload['bars']['AAPL'][-2:]
    assert decision_state(payload)['derivedFacts']['AAPL']['gridEvidence'] == 'insufficient_history'


def test_custom_task_reaches_official_http_and_preserves_account_facts(workspace, jev_config):
    payload = inputs()
    settings = dict(question='Choose the grid direction.', criteria={'buy': 'Lower range with volume.',
                    'sell': 'Upper range or failed volume.', 'hold': 'Neither condition applies.'},
                    background='Long-term allocation mandate.', lookbackDays=5)
    with patch('requests.post', return_value=http_result(response())) as post:
        JevDecisionService(jev_config).evaluate(workspace.db, payload, 'Skill', 'jev-latest',
                                               100000, 'test', None, customization=settings)
    request = post.call_args.kwargs['json']
    question = request['questions']['stock_0']
    assert question['instructions']['customQuestion'] == settings['question']
    assert question['criteria']['buy']['conditions'] == settings['criteria']['buy']
    assert 'Increase' in question['criteria']['buy']['action']
    assert len(request['state']['bars']['AAPL']) == 5
    assert request['state']['equity'] == payload['equity']
    assert request['state']['strategyBackground'] == settings['background']
    assert len(payload['bars']['AAPL']) > 5
    assert 'strategyBackground' not in payload
    with workspace.db.get_session() as session:
        row = session.scalars(select(SimulationTradingCallRecord)).one()
        assert json.loads(row.input_json) == request


@pytest.mark.parametrize('settings', [
    {'lookbackDays': 0}, {'lookbackDays': 22}, {'lookbackDays': 3.5},
    {'criteria': {'short': 'Open a short position'}}, {'equity': 1000000},
    {'question': 'x' * 4001}, {'criteria': {'buy': 'x' * 2001}},
])
def test_custom_task_rejects_invalid_contract_before_http(workspace, jev_config, settings):
    with patch('requests.post') as post, pytest.raises(ValueError):
        JevDecisionService(jev_config).evaluate(workspace.db, inputs(), 'Skill', 'jev-latest',
                                               100000, 'test', None, customization=settings)
    post.assert_not_called()


def test_custom_history_must_cover_grid_window(workspace, jev_config):
    payload = dict(inputs(), grid={'lookbackDays': 10})
    with patch('requests.post') as post, pytest.raises(ValueError, match='grid lookback'):
        JevDecisionService(jev_config).evaluate(workspace.db, payload, 'Skill', 'jev-latest',
                                               100000, 'test', None, customization={'lookbackDays': 5})
    post.assert_not_called()


@pytest.mark.parametrize('customization', [
    {}, {'question': '', 'criteria': {'buy': '', 'sell': '', 'hold': ''}, 'background': ''},
    {'question': '  ', 'criteria': {'buy': '  ', 'sell': '\n', 'hold': '\t'}, 'background': '  '},
])
def test_blank_task_uses_same_request_as_default(workspace, jev_config, customization):
    service = JevDecisionService(jev_config)
    with patch('requests.post', return_value=http_result(response())) as post:
        service.evaluate(workspace.db, inputs(), 'Skill', 'jev-latest', 100000, 'test', None)
        default_request = post.call_args.kwargs['json']
        service.evaluate(workspace.db, inputs(), 'Skill', 'jev-latest', 100000, 'test', None,
                         customization=customization)
        assert post.call_args.kwargs['json'] == default_request
    assert 'strategyBackground' not in default_request['state']
