"""Private workspace integration with real accounts, middleware and SQLite.

Only paid model transport is substituted. Tests never touch deployment data.
"""
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import auth
from src.config import Config
from src.storage import DatabaseManager, TrialBudgetRecord
from src.services.member_service import MemberService, reset_member_stores, current_member
from src.services.trial_service import TrialError
from src.workspace_scope import ContextThreadPoolExecutor, current_workspace_database
from api.middlewares.auth import add_auth_middleware
from api.v1.router import router


@pytest.fixture
def members(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('ENV_FILE', str(tmp_path / '.env'))
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'server')
    monkeypatch.setenv('MULTI_USER_ENABLED', 'true')
    monkeypatch.setenv('TRIAL_ENABLED', 'true')
    monkeypatch.setenv('TRIAL_DAILY_TOKEN_LIMIT', '2000000')
    monkeypatch.setenv('TRUST_X_FORWARDED_FOR', 'false')
    monkeypatch.setenv('CORS_ORIGINS', '')
    monkeypatch.setattr(auth, '_get_data_dir', lambda: tmp_path)
    monkeypatch.setattr(Config, '_instance', Config())
    auth.refresh_auth_state()
    auth._rate_limit = {}
    DatabaseManager.reset_instance()
    root = DatabaseManager(f'sqlite:///{tmp_path / "owner.db"}')
    app = FastAPI()
    app.include_router(router, prefix='/api/v1')
    add_auth_middleware(app)
    owner = TestClient(app, base_url='https://testserver')
    assert auth.setup_token_cli() == 0
    setup_token = capsys.readouterr().out.strip().splitlines()[-1]
    assert owner.post('/api/v1/auth/register', json={
        'email': 'owner@example.com', 'password': 'owner-password',
        'passwordConfirm': 'owner-password', 'setupToken': setup_token,
    }).status_code == 200
    service = MemberService(root)
    clients = []
    for email in ('alice@example.com', 'bob@example.com'):
        invitation = service.trials.invite()
        client = TestClient(app, base_url='https://testserver')
        response = client.post('/api/v1/auth/register', json={
            'email': email, 'password': 'member-password', 'passwordConfirm': 'member-password',
            'memberRegistration': True, 'inviteCode': invitation['inviteCode'],
        })
        assert response.status_code == 200, response.text
        clients.append(client)
    yield owner, *clients, service
    reset_member_stores()
    DatabaseManager.reset_instance()
    auth.refresh_auth_state()
    auth._rate_limit = {}


def identity(service, client):
    return service.resolve(client.cookies.get(auth.COOKIE_NAME))


def test_two_real_sessions_have_private_holdings_tasks_and_chats(members):
    owner, alice, bob, service = members
    assert alice.get('/api/v1/auth/status').json()['role'] == 'member'
    assert owner.get('/api/v1/auth/status').json()['role'] == 'admin'
    response = alice.post('/api/v1/portfolio/accounts', json={'name': 'Alice portfolio', 'market': 'cn', 'base_currency': 'CNY'})
    assert response.status_code == 200, response.text
    assert 'Alice portfolio' not in bob.get('/api/v1/portfolio/accounts').text
    assert 'Alice portfolio' not in owner.get('/api/v1/portfolio/accounts').text
    for client, text in ((alice, 'Alice secret'), (bob, 'Bob secret')):
        with service.scope(identity(service, client)):
            DatabaseManager.get_instance().save_conversation_message('same-session', 'user', text)
    assert 'Alice secret' in alice.get('/api/v1/agent/chat/sessions/same-session').text
    assert 'Alice secret' not in bob.get('/api/v1/agent/chat/sessions/same-session').text
    assert alice.delete('/api/v1/agent/chat/sessions/same-session').status_code == 200
    assert 'Bob secret' in bob.get('/api/v1/agent/chat/sessions/same-session').text
    response = alice.post('/api/v1/workspace/tasks', json={
        'kind': 'screening', 'name': 'Alice strategy', 'market': 'CN',
        'objective': 'Private screening task', 'subject': {}, 'config': {}, 'capabilities': {},
    })
    assert response.status_code == 201, response.text
    task_id = response.json()['id']
    assert bob.get(f'/api/v1/workspace/tasks/{task_id}').status_code == 404
    assert bob.patch(f'/api/v1/workspace/tasks/{task_id}', json={'name': 'Stolen'}).status_code == 404
    assert bob.delete(f'/api/v1/workspace/tasks/{task_id}').status_code == 404
    assert 'Alice strategy' in alice.get('/api/v1/workspace/tasks').text


@pytest.mark.parametrize('method,path,body', [
    ('get', '/api/v1/system/config', None),
    ('post', '/api/v1/auth/settings', {'authEnabled': False}),
    ('get', '/api/v1/trial/admin/users', None),
    ('post', '/api/v1/workspace/mcp-servers', {}),
    ('post', '/api/v1/workspace/data-sources', {}),
    ('post', '/api/v1/simulation/definition/strategy-packages/intake', {}),
    ('post', '/api/v1/agent/chat/send', {'content': 'Do not send to owner'}),
    ('post', '/api/v1/stocks/extract-from-image', {}),
])
def test_member_cannot_reach_platform_operations(members, method, path, body):
    _, alice, _, _ = members
    kwargs = {'json': body} if body is not None else {}
    assert getattr(alice, method)(path, **kwargs).status_code in {401, 403}


def test_headers_and_query_cannot_select_another_workspace(members):
    _, alice, bob, service = members
    user = identity(service, bob)
    with service.scope(user):
        DatabaseManager.get_instance().save_conversation_message('bob-session', 'user', 'Bob secret')
    response = alice.get('/api/v1/agent/chat/sessions/bob-session',
                         params={'user_id': user['id'], 'workspaceId': user['id']},
                         headers={'X-User-Id': user['id'], 'X-Workspace-Id': user['id']})
    assert response.status_code == 200 and 'Bob secret' not in response.text
    assert response.headers['cache-control'] == 'private, no-store'
    assert alice.post('/api/v1/auth/logout', headers={'Origin': 'https://attacker.example'}).status_code == 403


def test_logout_password_change_and_suspension_are_per_identity(members):
    owner, alice, bob, service = members
    user = identity(service, alice)
    assert alice.post('/api/v1/auth/logout').status_code == 204
    assert alice.get('/api/v1/workspace/tasks').status_code == 401
    assert bob.get('/api/v1/workspace/tasks').status_code == 200
    assert owner.get('/api/v1/auth/status').json()['loggedIn']
    assert alice.post('/api/v1/auth/login', json={'email': user['email'], 'password': 'member-password'}).status_code == 200
    assert alice.post('/api/v1/auth/change-password', json={
        'currentPassword': 'member-password', 'newPassword': 'changed-password',
        'newPasswordConfirm': 'changed-password',
    }).status_code == 204
    assert alice.get('/api/v1/workspace/tasks').status_code == 401
    assert alice.post('/api/v1/auth/login', json={'email': user['email'], 'password': 'changed-password'}).status_code == 200
    service.trials.set_enabled(user['id'], False)
    assert alice.get('/api/v1/workspace/tasks').status_code == 401
    assert bob.get('/api/v1/workspace/tasks').status_code == 200


def test_private_queues_memory_files_and_notification_destinations(members, monkeypatch):
    _, alice, bob, service = members
    from src.services.task_queue import get_task_queue
    from src.agent.conversation import conversation_manager
    from src.notification import NotificationService
    from src.config import get_config
    from pathlib import Path
    platform = get_config()
    platform.email_sender = 'sender@example.com'
    platform.email_password = 'test-only-secret'
    platform.email_receivers = ['owner@example.com']
    platform.telegram_chat_id = 'owner-channel'
    queues, sessions, paths = [], [], []
    for client, name in ((alice, 'Alice'), (bob, 'Bob')):
        member = identity(service, client)
        with service.scope(member):
            queues.append(get_task_queue())
            sessions.append(conversation_manager.get_or_create('same-id'))
            assert get_config().email_sender is None
            assert not get_config().telegram_chat_id
            paths.append(NotificationService().save_report_to_file(name, 'same-report.md'))
    assert queues[0] is not queues[1]
    assert sessions[0] is not sessions[1]
    assert paths[0] != paths[1]
    assert [Path(path).read_text() for path in paths] == ['Alice', 'Bob']
    assert alice.put('/api/v1/workspace/notification-settings', json={'enabled': True}).status_code == 200
    assert not bob.get('/api/v1/workspace/notification-settings').json()['enabled']
    with service.scope(identity(service, alice)):
        assert get_config().email_receivers == ['alice@example.com']
        assert get_config().email_password == 'test-only-secret'
    assert platform.email_receivers == ['owner@example.com']


def test_worker_context_is_retained_after_request_and_cleared_on_reuse(members):
    _, alice, bob, service = members
    with ContextThreadPoolExecutor(max_workers=1) as pool:
        for client in (alice, bob):
            member = identity(service, client)
            with service.scope(member):
                future = pool.submit(lambda: (current_member()['id'], DatabaseManager.get_instance()._workspace_id))
            assert future.result() == (member['id'], member['id'])
    assert current_workspace_database() is None
    assert current_member() is None


def test_all_member_model_calls_use_shared_atomic_trial_budget(members, monkeypatch):
    _, alice, bob, service = members
    from src.services import member_completion as module
    import litellm
    monkeypatch.setattr(module, 'trial_model_params', lambda: {'model': 'deepseek/test'})
    calls = []
    def completion(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(model='deepseek/test', usage=SimpleNamespace(
            prompt_tokens=20, completion_tokens=10, total_tokens=30))
    monkeypatch.setattr(litellm, 'completion', completion)
    user = identity(service, alice)
    with service.scope(user):
        with ContextThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(module.member_completion, [{'role': 'user', 'content': 'Private question'}]) for _ in range(2)]
            for job in jobs:
                job.result()
    assert service.trials.status(user['id'])['used'] == 60
    assert service.trials.status(identity(service, bob)['id'])['used'] == 0
    assert all(c['stream'] is False and c['num_retries'] == 0 for c in calls)
    service.trials.reserve(user['id'], 'quota-regression', 199939, workspace=True)
    with service.scope(user):
        with pytest.raises(TrialError, match='quota_exhausted'):
            module.member_completion([{'role': 'user', 'content': 'Over quota'}])
    assert len(calls) == 2


def test_unknown_model_usage_stops_sibling_calls_without_refund(members, monkeypatch):
    _, alice, _, service = members
    from src.services import member_completion as module
    import litellm
    monkeypatch.setattr(module, 'trial_model_params', lambda: {'model': 'deepseek/test'})
    monkeypatch.setattr(litellm, 'completion', lambda **kwargs: SimpleNamespace(usage=None))
    user = identity(service, alice)
    with service.scope(user):
        with pytest.raises(TrialError, match='usage_unverified'):
            module.member_completion([{'role': 'user', 'content': 'Question'}])
        with pytest.raises(TrialError, match='model_run_stopped'):
            module.member_completion([{'role': 'user', 'content': 'Followup'}])
    assert service.trials.status(user['id'])['used'] > 0


def test_watchlists_report_downloads_and_stream_cancellation_are_private(members):
    import json
    import threading
    from src.storage import AnalysisHistory
    from api.v1.endpoints.agent import _ACTIVE_CANCELLABLE_STREAMS, _stream_key
    _, alice, bob, service = members
    assert alice.post('/api/v1/stocks/watchlist/add', json={'stock_code': '600519'}).status_code == 200
    assert alice.get('/api/v1/stocks/watchlist').json()['stock_codes'] == ['600519']
    assert bob.get('/api/v1/stocks/watchlist').json()['stock_codes'] == []
    user = identity(service, alice)
    with service.scope(user):
        assert Config.get_instance().stock_list == ['600519']
        assert Config.get_instance().agent_event_alert_rules_json == ''
        with DatabaseManager.get_instance().session_scope() as session:
            row = AnalysisHistory(code='600519', query_id='private-report', analysis_summary='Private research',
                                  raw_result=json.dumps({'code': '600519', 'name': 'Alice private', 'analysis_summary': 'Private research'}))
            session.add(row)
        key = _stream_key('same-request')
        event = threading.Event()
        _ACTIVE_CANCELLABLE_STREAMS[key] = event
    try:
        assert bob.get('/api/v1/history/private-report/markdown').status_code == 404
        response = alice.get('/api/v1/history/private-report/markdown')
        assert response.status_code == 200, response.text
        assert bob.post('/api/v1/agent/chat/stream/same-request/cancel').status_code == 404
        assert not event.is_set()
        assert alice.post('/api/v1/agent/chat/stream/same-request/cancel').status_code == 200
        assert event.is_set()
    finally:
        _ACTIVE_CANCELLABLE_STREAMS.pop(key, None)


@pytest.mark.parametrize('kind', ['research', 'screening', 'trading'])
def test_private_default_plans_are_available(members, kind):
    _, alice, bob, _ = members
    for client in (alice, bob):
        response = client.get('/api/v1/workspace/default-task-plan', params={'kind': kind, 'market': 'CN'})
        assert response.status_code == 200, response.text


def test_maintenance_reopens_owned_stores_and_skips_disabled_users(members, monkeypatch):
    from src.services.member_service import run_member_maintenance
    from src.services.workspace_service import WorkspaceService
    _, alice, bob, service = members
    alice_id, bob_id = identity(service, alice)['id'], identity(service, bob)['id']
    seen = []
    def check(workspace):
        seen.append((current_member()['id'], workspace.db._workspace_id))
    monkeypatch.setattr(WorkspaceService, 'run_due_schedules', check)
    monkeypatch.setattr(WorkspaceService, 'reconcile_interrupted_runs', check)
    reset_member_stores()
    run_member_maintenance(reconcile=True)
    assert set(seen) == {(alice_id, alice_id), (bob_id, bob_id)}
    service.trials.set_enabled(bob_id, False)
    seen.clear()
    run_member_maintenance()
    assert seen == [(alice_id, alice_id)]


def test_agent_and_report_adapters_charge_the_same_identity(members, monkeypatch):
    import litellm
    from litellm import ModelResponse
    from src.agent.llm_adapter import LLMToolAdapter
    from src.analyzer import GeminiAnalyzer
    from src.services import member_completion as completion_module
    _, alice, bob, service = members
    monkeypatch.setattr(completion_module, 'trial_model_params', lambda: {'model': 'deepseek/test'})
    calls = []
    def transport(**kwargs):
        calls.append(kwargs)
        return ModelResponse(model='deepseek/test', choices=[{'message': {'role': 'assistant', 'content': 'Private answer'}}],
                             usage={'prompt_tokens': 20, 'completion_tokens': 10, 'total_tokens': 30})
    monkeypatch.setattr(litellm, 'completion', transport)
    user = identity(service, alice)
    with service.scope(user):
        # Construction is skipped to avoid probing platform model routes; the
        # real public completion entry and physical transport/meter run below.
        adapter = LLMToolAdapter.__new__(LLMToolAdapter)
        adapter._config = Config.get_instance()
        response = adapter.call_completion([{'role': 'user', 'content': 'Private question'}])
        assert response.content == 'Private answer'
        analyzer = GeminiAnalyzer.__new__(GeminiAnalyzer)
        text, _, usage = analyzer._call_litellm_impl('Private report', {})
        assert text == 'Private answer' and usage['total_tokens'] == 30
    assert len(calls) == 2
    assert service.trials.status(user['id'])['used'] == 60
    assert service.trials.status(identity(service, bob)['id'])['used'] == 0


def test_host_recovery_preserves_workspace_and_budget(members, monkeypatch):
    from src.services.member_service import main
    _, alice, _, service = members
    user = identity(service, alice)
    monkeypatch.setattr('sys.argv', ['member_service', 'reset-password', '--email', user['email']])
    monkeypatch.setattr('getpass.getpass', lambda prompt: 'recovered-member-password')
    before = service.trials.status(user['id'])
    assert main() == 0
    assert alice.get('/api/v1/portfolio/accounts').status_code == 401
    assert alice.post('/api/v1/auth/login', json={'email': user['email'], 'password': 'recovered-member-password'}).status_code == 200
    assert identity(service, alice)['id'] == user['id']
    assert service.trials.status(user['id'])['used'] == before['used']


def test_activity_owner_member_tokens_and_admin_boundaries(members):
    from src.storage import utc_naive_now
    from src.services.user_activity_service import activity_scope, analytics
    from src.services.member_service import control_plane
    from src.storage import UserActivityRecord, UserCallDetailRecord
    from sqlalchemy import select
    owner, alice, bob, service = members
    member = identity(service, alice)
    day = utc_naive_now().date().isoformat()
    params = {'start': day, 'end': day}
    assert alice.post('/api/v1/usage/activity', json={'page': '/screening'}).status_code == 204
    assert owner.post('/api/v1/usage/activity', json={'page': '/trading'}).status_code == 204
    assert alice.post('/api/v1/usage/activity', json={'page': '/screening?secret=x'}).status_code == 400
    with service.scope(member), activity_scope('screening', 'trace-screening'):
        from src.storage import get_db
        get_db().save_conversation_user_turn('session-a', 'Which stocks meet my criteria?')
        get_db().save_conversation_message('session-a', 'assistant', 'Check the source dates first.')
        # Secondary workspace telemetry must not be counted twice.
        get_db().record_llm_usage('agent', 'test-model', 7, 3, 10)
        with control_plane():
            call_id = service.trials.reserve(member['id'], 'workspace:test', 100, workspace=True, model='test-model')
            service.trials.settle(call_id, 10, prompt_tokens=7, completion_tokens=3, duration_ms=5)
            service.trials.settle(call_id, 10, prompt_tokens=7, completion_tokens=3, duration_ms=5)
        get_db().delete_conversation_session('session-a')
    with activity_scope('trading', 'trace-owner'):
        service.db.record_llm_usage('agent', 'test-model', 20, 5, 25)
    with service.db.get_session() as session:
        assert session.get(UserCallDetailRecord, call_id).feature == 'screening'
        messages = session.scalars(select(UserActivityRecord).where(UserActivityRecord.request_id == 'trace-screening')).all()
        assert {m.event for m in messages} == {'question', 'answer'}
        assert all(m.user_id == member['id'] for m in messages)
    result = owner.get('/api/v1/trial/admin/analytics', params=params)
    assert result.status_code == 200, result.text
    rows = result.json()['usage']
    assert sum(r['charged'] for r in rows) == 35
    assert {r['feature'] for r in rows} == {'screening', 'trading'}
    assert {r['userId'] for r in rows} == {member['id'], 'owner'}
    calls = owner.get('/api/v1/trial/admin/calls', params=params)
    assert calls.status_code == 200, calls.text
    assert calls.json()['total'] == 2
    activity = owner.get('/api/v1/trial/admin/activity', params={**params, 'request_id': 'trace-screening'})
    assert activity.status_code == 200
    assert activity.json()['total'] == 2
    for path in ['analytics', 'activity', 'calls']:
        assert bob.get('/api/v1/trial/admin/' + path, params=params).status_code == 403
        assert alice.get('/api/v1/trial/admin/' + path, params=params).status_code == 403
    assert owner.get('/api/v1/trial/admin/analytics', params={'start': day, 'end': '2020-01-01'}).status_code == 400
    # API responses never contain the password or its hash.
    assert 'member-password' not in activity.text and 'password_hash' not in activity.text
    filtered = analytics(service.db, utc_naive_now().date(), utc_naive_now().date(), member['id'], 'screening')
    assert filtered['daily'][0]['charged'] == service.trials.status(member['id'])['used'] == 10


def test_paginated_run_history_and_usage_remain_private(members):
    owner, alice, bob, service = members
    from src.services.workspace_external_runs import begin
    from src.services.workspace_service import WorkspaceService
    with service.scope(identity(service, alice)):
        run_id = begin(WorkspaceService(), 'research', 'Alice private report', 'CN', {'stock':'600519'}, {})
    response = alice.get('/api/v1/workspace/run-history?stock=600519')
    assert response.status_code == 200 and response.json()['total'] == 1
    detail = alice.get(f'/api/v1/workspace/runs/{run_id}')
    assert detail.status_code == 200 and not detail.json()['usage']['recorded']
    for other in (owner, bob):
        page = other.get('/api/v1/workspace/run-history?stock=600519')
        assert page.status_code == 200 and page.json()['total'] == 0
        assert other.get(f'/api/v1/workspace/runs/{run_id}').status_code == 404
    assert alice.post('/api/v1/workspace/run-history', json={}).status_code == 403
