"""Exercise holding/watch execution through the real JEV HTTP adapter and artifact storage."""
import threading
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import select

from src.services.portfolio_research_service import PortfolioResearchService
from src.services.portfolio_jev_service import decision_notification
from src.storage import SimulationTradingCallRecord
from tests.test_workspace_service import workspace, _empty_bindings  # noqa: F401
from tests.test_portfolio_research import holding
from tests.test_jev_decisions import http_result


@pytest.fixture
def settings():
    return SimpleNamespace(typesafe_api_key='test-secret', typesafe_base_url='https://api.typesafe.ai',
                           typesafe_model='jev-test', agent_deep_research_budget=30000)


def bars():
    return pd.DataFrame([{'date': '2026-09-21', 'open': 99, 'high': 102, 'low': 98, 'close': 100, 'volume': 1000}])


def body(watch):
    categories = ['bullish', 'bearish', 'neutral'] if watch else ['buy', 'sell', 'hold']
    return {'model': 'jev-test-version', 'answers': {'stock_0': {'type': 'choice', 'choice': categories[0],
            'confidence': 0.7, 'probabilities': dict(zip(categories, [0.8, 0.1, 0.1]))}},
            'usage': {'input_tokens': 100, 'output_tokens': 20}}


def task_for(workspace, watch):
    service = PortfolioResearchService(workspace)
    config = {'decisionBackend': 'jev', 'portfolioWatch': {'symbol': '600519'}} if watch else {
        'decisionBackend': 'jev', 'portfolioHolding': {'accountId': holding(service), 'symbol': '600519'}}
    return workspace.create_task({'kind': 'research', 'name': 'JEV test', 'market': 'CN',
                                  'subject': {'stock': '600519'}, 'objective': 'test',
                                  'capabilities': _empty_bindings(), 'config': config})


@pytest.mark.parametrize('watch', [False, True])
def test_direct_classifier_never_calls_report_workflow_or_fabricates_explanations(workspace, settings, watch):
    task = task_for(workspace, watch)
    with patch('src.services.workspace_service._WORKERS'):
        run = workspace.create_run(task['id'])
    with patch('src.services.jev_decision_service.get_config', return_value=settings), \
         patch('src.services.simulation_portfolio_service.SimulationPortfolioService._last_closed', return_value=date(2026, 9, 21)), \
         patch('data_provider.DataFetcherManager.get_daily_data', return_value=(bars(), 'fixture')), \
         patch('requests.post', return_value=http_result(body(watch))) as post, \
         patch('src.agent.tools.workflow_tools.execute_research_workflow', side_effect=AssertionError('LLM workflow forbidden')):
        workspace._execute_run(run['id'], threading.Event())
    result = workspace.get_run(run['id'])
    assert result['status'] == 'completed', result.get('errorMessage')
    assert [a['type'] for a in result['artifacts']] == ['PortfolioDecision']
    content = result['artifacts'][0]['content']
    assert content['category'] == ('bullish' if watch else 'buy')
    assert content['confidence'] == 0.7
    assert not ({'summary', 'report', 'reason', 'targetWeight'} & content.keys())
    request = post.call_args.kwargs['json']
    assert set(request['questions']['stock_0']['criteria']) == set(body(watch)['answers']['stock_0']['probabilities'])
    if watch:
        assert 'holding' not in request['state'] and 'portfolioContext' not in request['state']
    else:
        assert request['state']['holding']['avg_cost'] == 100
    assert post.call_args.args[0] == 'https://api.typesafe.ai/v1/systemone'
    dashboard = PortfolioResearchService(workspace).dashboard()
    item = dashboard['watches' if watch else 'items'][0]
    assert item['decision']['confidence'] == 0.7 and item['brief'] is None


def test_invalid_watch_category_fails_without_llm_fallback(workspace, settings):
    task = task_for(workspace, True)
    with patch('src.services.workspace_service._WORKERS'):
        run = workspace.create_run(task['id'])
    with patch('src.services.jev_decision_service.get_config', return_value=settings), \
         patch('src.services.simulation_portfolio_service.SimulationPortfolioService._last_closed', return_value=date(2026, 9, 21)), \
         patch('data_provider.DataFetcherManager.get_daily_data', return_value=(bars(), 'fixture')), \
         patch('requests.post', return_value=http_result(body(False))) as post:
        workspace._execute_run(run['id'], threading.Event())
    result = workspace.get_run(run['id'])
    assert result['status'] == 'failed' and result['artifacts'] == []
    assert post.call_count == 1
    with workspace.db.get_session() as session:
        call = session.scalar(select(SimulationTradingCallRecord).where(SimulationTradingCallRecord.resource == run['id']))
        assert call.status == 'failed' and call.error_message


def test_stale_evidence_fails_before_paid_call(workspace, settings):
    task = task_for(workspace, True)
    with patch('src.services.workspace_service._WORKERS'):
        run = workspace.create_run(task['id'])
    with patch('src.services.jev_decision_service.get_config', return_value=settings), \
         patch('src.services.simulation_portfolio_service.SimulationPortfolioService._last_closed', return_value=date(2026, 9, 22)), \
         patch('data_provider.DataFetcherManager.get_daily_data', return_value=(bars(), 'fixture')), patch('requests.post') as post:
        workspace._execute_run(run['id'], threading.Event())
    assert workspace.get_run(run['id'])['status'] == 'failed'
    post.assert_not_called()


def test_backend_change_does_not_reuse_completed_llm_session_or_change_schedule(workspace, settings):
    task = task_for(workspace, False)
    workspace.update_task(task['id'], {'config': {**task['config'], 'decisionBackend': 'llm'}})
    schedule = workspace.create_schedule({'taskId': task['id'], 'scheduleMode': 'daily', 'runAt': '16:30', 'timezone': 'Asia/Shanghai', 'enabled': True})
    with patch('src.services.workspace_service._WORKERS'):
        old = workspace.create_run(task['id'], 'schedule')
        workspace._finish_run(old['id'], 'completed', summary={})
        with patch('src.services.jev_decision_service.get_config', return_value=settings):
            PortfolioResearchService(workspace).set_backend(task['config']['portfolioHolding']['accountId'], '600519', 'jev')
        new = workspace.create_run(task['id'], 'schedule')
    assert new['id'] != old['id']
    assert next(s for s in workspace.list_schedules() if s['id'] == schedule['id'])['enabled']
    assert new['taskSnapshot']['config']['decisionBackend'] == 'jev'


@pytest.mark.parametrize('language', ['zh', 'en', 'ko', 'ja', 'zh-TW'])
def test_notification_is_classification_only(language):
    result = decision_notification({'symbol': 'AAPL', 'category': 'bullish', 'confidence': 0.7,
                                    'asOf': '2026-09-21', 'model': 'jev-test'}, language)
    assert '70.0%' in result and 'AAPL' in result
    assert 'report' not in result


def test_model_selection_is_validated_before_saving_and_does_not_call_api(workspace, settings):
    from api.v1.schemas.workspace import PortfolioWatchCreateRequest, PortfolioResearchBackendRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PortfolioResearchBackendRequest(decisionBackend='unknown')
    assert PortfolioWatchCreateRequest(symbol='AAPL', market='us').decisionBackend is None
    service = PortfolioResearchService(workspace)
    task = task_for(workspace, True)
    with patch('src.services.jev_decision_service.get_config', return_value=settings), patch('requests.post') as post:
        plan = service.create_watch('600519', 'cn', 'jev')
    assert plan['task']['id'] == task['id'] and plan['task']['config']['decisionBackend'] == 'jev'
    post.assert_not_called()
    settings.typesafe_api_key = ''
    with patch('src.services.jev_decision_service.get_config', return_value=settings):
        with pytest.raises(ValueError, match='Configure the JEV API key'):
            service.validate_backend('jev')


def test_scheduled_jev_notification_contains_only_api_result(workspace):
    service = PortfolioResearchService(workspace)
    decision = {'symbol': 'AAPL', 'category': 'neutral', 'confidence': 0.73, 'asOf': '2026-09-21', 'model': 'jev-test'}
    run = {'status': 'completed', 'triggerType': 'schedule', 'artifacts': [{'type': 'PortfolioDecision', 'content': decision}]}
    with patch.object(workspace, 'get_run', return_value=run), patch('src.notification.NotificationService') as notify:
        notify.return_value.send_with_results.return_value.success = True
        assert service.notify_scheduled_brief('test-run', {'config': {'decisionBackend': 'jev', 'portfolioDailyNotify': True, 'reportLanguage': 'en'}})
    sent = notify.return_value.send_with_results.call_args.args[0]
    assert 'Neutral' in sent and '73.0%' in sent and 'summary' not in sent
