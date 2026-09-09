"""Paid trial boundaries tested with a real database, never a paid model call."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.services import trial_service as module
from src.services.trial_service import TrialService, TrialError
from src.storage import DatabaseManager, TrialRunRecord, TrialCallRecord, TrialBudgetRecord, utc_naive_now


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_FILE', str(tmp_path / '.env'))
    monkeypatch.setenv('TRIAL_ENABLED', 'true')
    monkeypatch.setenv('TRIAL_DAILY_TOKEN_LIMIT', '2000000')
    monkeypatch.setattr(module, 'trial_model_params', lambda: {'model': 'deepseek/test'})
    DatabaseManager.reset_instance()
    db = DatabaseManager(f'sqlite:///{tmp_path / "trial.db"}')
    yield TrialService(db)
    DatabaseManager.reset_instance()


def enroll(service, email='guest@example.com'):
    invite = service.invite()
    token = service.enroll(email, 'trial-password', invite['inviteCode'])
    return service.identity(token), token


def start(service, user, **values):
    request = dict(requestId=str(uuid4()), kind='research', topic='Review business risks',
                   stock='', language='en', experts=[], mode='independent')
    request.update(values)
    return service.start(user, request)[0]


def test_grant_once_login_and_invite_replay(service):
    user, token = enroll(service)
    run = start(service, user)
    service.reserve(user, run, 100)
    service.logout(user)
    with pytest.raises(TrialError):
        service.identity(token)
    token = service.login('GUEST@example.com', 'trial-password')
    assert service.identity(token) == user
    assert service.status(user)['used'] == 100
    unused = service.invite()['inviteCode']
    with pytest.raises(TrialError, match='already_enrolled'):
        service.enroll('guest@example.com', 'new-password', unused)
    assert service.identity(service.enroll('other@example.com', 'new-password', unused))
    with pytest.raises(TrialError, match='invite_invalid'):
        service.enroll('guest@example.com', 'new-password', 'fake')


def test_batch_invitations_bind_email_only_when_claimed(service):
    invitation = service.invite(3)
    assert len(invitation['inviteCodes']) == 3
    assert len(set(invitation['inviteCodes'])) == 3
    assert service.users() == []

    first = service.enroll('chosen@example.com', 'trial-password', invitation['inviteCodes'][0])
    assert service.status(service.identity(first))['email'] == 'chosen@example.com'
    with pytest.raises(TrialError, match='invite_invalid'):
        service.enroll('replay@example.com', 'trial-password', invitation['inviteCodes'][0])
    second = service.enroll('another@example.com', 'trial-password', invitation['inviteCodes'][1])
    assert service.status(service.identity(second))['email'] == 'another@example.com'


def test_atomic_user_cap_and_idempotent_settlement(service):
    user, _ = enroll(service)
    run = start(service, user)
    def reserve(_):
        try:
            return service.reserve(user, run, 120000)
        except TrialError as exc:
            assert exc.code == 'quota_exhausted'
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        calls = list(pool.map(reserve, range(2)))
    assert len([c for c in calls if c]) == 1
    assert service.status(user)['used'] == 120000
    call = next(c for c in calls if c)
    service.settle(call, 123)
    service.settle(call, 123)
    assert service.status(user)['used'] == 123


def test_global_cap_rolls_back_personal_debit(service, monkeypatch):
    user, _ = enroll(service)
    run = start(service, user)
    monkeypatch.setenv('TRIAL_DAILY_TOKEN_LIMIT', '100')
    with pytest.raises(TrialError, match='global_quota_exhausted'):
        service.reserve(user, run, 101)
    assert service.status(user)['used'] == 0


def test_isolation_idempotency_revoke_and_stale_recovery(service):
    user, token = enroll(service)
    other, _ = enroll(service, 'other@example.com')
    run = start(service, user)
    assert service.start(user, {'requestId': run}) == (run, False)
    with pytest.raises(TrialError, match='not_found'):
        service.start(other, {'requestId': run})
    assert not service.runs(other)
    with pytest.raises(TrialError, match='run_in_progress'):
        start(service, user)
    with service.db.session_scope() as session:
        session.get(TrialRunRecord, run).created_at = utc_naive_now() - timedelta(minutes=16)
    assert service.status(user)['activeRun'] is None
    assert service.runs(user)[0]['error'] == 'interrupted'
    service.set_enabled(user, False)
    with pytest.raises(TrialError):
        service.identity(token)


def response(total=30):
    return SimpleNamespace(usage=SimpleNamespace(total_tokens=total, prompt_tokens=20, completion_tokens=10),
                           choices=[SimpleNamespace(message=SimpleNamespace(content='## Conclusion\nCheck the evidence.'))])


def test_every_expert_review_and_summary_is_charged(service, monkeypatch):
    import litellm
    calls = []
    def completion(**kwargs):
        calls.append(kwargs)
        return response()
    monkeypatch.setattr(litellm, 'completion', completion)
    user, _ = enroll(service)
    run = start(service, user, experts=['warren-buffett', 'charlie-munger'], mode='debate')
    service.execute(user, run)
    service.execute(user, run)
    assert len(calls) == 5
    assert all(c['num_retries'] == 0 and c['max_tokens'] == 2048 and not c['stream'] for c in calls)
    assert service.status(user)['used'] == 150
    result = service.runs(user)[0]
    assert result['status'] == 'completed' and len(result['events']) == 5
    assert service.status(user)['activeRun'] is None


def test_unknown_usage_stops_followups_and_keeps_reservation(service, monkeypatch):
    import litellm
    calls = []
    def completion(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(usage=None)
    monkeypatch.setattr(litellm, 'completion', completion)
    user, _ = enroll(service)
    run = start(service, user, experts=['warren-buffett', 'charlie-munger'])
    service.execute(user, run)
    assert len(calls) == 1
    assert service.status(user)['used'] > 2048
    assert service.runs(user)[0]['error'] == 'usage_unverified'


def test_provider_overflow_is_accounted_and_suspends_identity(service):
    user, token = enroll(service)
    call = service.reserve(user, start(service, user), 100)
    with pytest.raises(TrialError, match='usage_unverified'):
        service.settle(call, 101)
    assert service.status(user)['used'] == 101
    with pytest.raises(TrialError):
        service.identity(token)
    with service.db.get_session() as session:
        assert session.get(TrialCallRecord, call).charged == 101


def test_quota_persists_in_new_service(service):
    user, _ = enroll(service)
    service.reserve(user, start(service, user), 200000)
    assert TrialService(service.db).status(user)['remaining'] == 0
    with service.db.get_session() as session:
        assert session.get(TrialBudgetRecord, user).limit == 200000


def test_duplicate_executor_does_not_clear_active_owner(service):
    user, _ = enroll(service)
    run = start(service, user)
    with service.db.session_scope() as session:
        session.get(TrialRunRecord, run).status = 'processing'
    service.execute(user, run)
    assert service.status(user)['activeRun'] == run


def test_partial_report_survives_later_provider_failure(service, monkeypatch):
    import litellm
    calls = []
    def completion(**kwargs):
        calls.append(kwargs)
        if len(calls) > 1:
            raise TimeoutError('provider connection interrupted')
        return response()
    monkeypatch.setattr(litellm, 'completion', completion)
    user, _ = enroll(service)
    run = start(service, user, experts=['warren-buffett'])
    service.execute(user, run)
    result = service.runs(user)[0]
    assert len(result['events']) == 1 and result['status'] == 'failed'
    assert result['error'] == 'upstream_failed'
    assert service.status(user)['used'] > 30


def test_route_validation_uses_existing_alias_and_rejects_proxies(monkeypatch):
    from src.agent import litellm_route_resolution
    from src import config
    monkeypatch.setenv('TRIAL_MODEL', '')
    monkeypatch.setattr(config, 'get_config', lambda: object())
    params = {'model': 'openai/configured-deepseek', 'api_key': 'test-only',
              'api_base': 'https://api.deepseek.com/v1', 'num_retries': 5}
    monkeypatch.setattr(litellm_route_resolution, 'resolve_agent_litellm_route', lambda _: SimpleNamespace(
        available=True, primary_model='trial-route', model_list=[{'model_name': 'trial-route', 'litellm_params': params}]))
    assert module.trial_model_params() == {k: v for k, v in params.items() if k != 'num_retries'}
    params['api_base'] = 'https://proxy.example/v1'
    with pytest.raises(TrialError, match='model_unavailable'):
        module.trial_model_params()


def test_daily_limit_adjustment_before_and_after_claim(service):
    invitation = service.invite(daily_limit=100)
    identifier = invitation['invitationIds'][0]
    service.set_daily_limit(identifier, 200000)
    user = service.identity(service.enroll('dynamic@example.com', 'trial-password', invitation['inviteCode']))
    run = start(service, user)
    service.reserve(user, run, 200000)
    with pytest.raises(TrialError, match='quota_exhausted'):
        service.reserve(user, run, 1)
    service.set_daily_limit(identifier, 300000)
    service.reserve(user, run, 100000)
    assert service.status(user)['remaining'] == 0
    service.set_daily_limit(identifier, 100000)
    assert service.status(user)['used'] == 300000
    with pytest.raises(TrialError, match='quota_exhausted'):
        service.reserve(user, run, 1)
    row = service.invitations()[0]
    assert row['email'] == 'dynamic@example.com'
    assert row['history'][-1]['used'] == 300000
    assert row['history'][-1]['estimatedCalls'] == 2
    assert row['dailyLimit'] == 100000


def test_day_reset_and_late_settlement_preserve_history(service, monkeypatch):
    now = utc_naive_now()
    monkeypatch.setattr(module, 'utc_naive_now', lambda: now)
    user, _ = enroll(service)
    run = start(service, user)
    call = service.reserve(user, run, 200000)
    tomorrow = now + timedelta(days=1)
    monkeypatch.setattr(module, 'utc_naive_now', lambda: tomorrow)
    assert service.status(user)['used'] == 0
    run = start(service, user)
    service.reserve(user, run, 150000)
    service.settle(call, 123)
    status = service.status(user)
    assert status['used'] == 150000
    assert status['lifetimeUsed'] == 150123
    assert service.users()[0]['used'] == 150000
    assert service.users()[0]['lifetimeUsed'] == 150123
    rows = service.invitations()[0]['history']
    assert rows[-2]['used'] == 123 and rows[-2]['estimatedCalls'] == 0
    assert rows[-1]['used'] == 150000


def test_existing_invitation_and_legacy_budget_remain_adjustable(service):
    from src.storage import TrialInvitationRecord
    invitation = service.invite()
    identifier = invitation['invitationIds'][0]
    with service.db.session_scope() as session:
        session.delete(session.get(TrialBudgetRecord, 'invite:' + identifier))
    service.set_daily_limit(identifier, 300000)
    user = service.identity(service.enroll('legacy@example.com', 'trial-password', invitation['inviteCode']))
    assert service.status(user)['limit'] == 300000
    with service.db.session_scope() as session:
        session.delete(session.get(TrialInvitationRecord, identifier))
    service.set_daily_limit('legacy:' + user, 0)
    assert service.invitations()[0]['dailyLimit'] == 0
    with pytest.raises(TrialError, match='quota_exhausted'):
        start(service, user)


@pytest.mark.parametrize('limit', [-1, 10000001, True, 1.5])
def test_invalid_dynamic_limit(service, limit):
    with pytest.raises(TrialError, match='invalid_input'):
        service.invite(daily_limit=limit)


def test_usage_attribution_reservation_midnight_and_legacy(service, monkeypatch):
    from datetime import datetime
    from src.services.user_activity_service import analytics
    from src.storage import UserCallDetailRecord
    now = datetime(2026, 9, 10, 23, 59)
    monkeypatch.setattr(module, 'utc_naive_now', lambda: now)
    user, _ = enroll(service)
    run = start(service, user, kind='trading')
    call = service.reserve(user, run, 100)
    now = datetime(2026, 9, 11, 0, 1)
    service.settle(call, 30, prompt_tokens=20, completion_tokens=10)
    pending = service.reserve(user, run, 70)
    report = analytics(service.db, datetime(2026, 9, 10).date(), now.date(), user)
    assert [(r['date'], r['charged'], r['estimated']) for r in report['daily']] == [('2026-09-10', 30, 0), ('2026-09-11', 70, 70)]
    assert sum(r['charged'] for r in report['usage']) == 100
    with service.db.session_scope() as session:
        session.delete(session.get(UserCallDetailRecord, pending))
    report = analytics(service.db, now.date(), now.date(), user)
    assert report['usage'][0]['feature'] == 'legacy_unknown'
    assert report['usage'][0]['charged'] == 70
