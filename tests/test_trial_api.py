"""Trial namespace must not bypass owner authentication or CSRF checks."""
from api.v1.endpoints import trial
from src.services.trial_service import TRIAL_COOKIE
from tests.test_instance_account import instance, payload  # noqa: F401
from tests.test_trial_service import service, enroll  # noqa: F401


def attach(instance, service, monkeypatch):
    instance.app.include_router(trial.router, prefix='/api/v1/trial')
    monkeypatch.setattr(trial, 'TrialService', lambda: service)


def test_public_demo_trial_cookie_is_not_admin(instance, service, monkeypatch):
    attach(instance, service, monkeypatch)
    assert instance.get('/api/v1/trial/status').status_code == 200
    assert instance.get('/api/v1/trial/runs').status_code == 401
    user, token = enroll(service)
    instance.cookies.set(TRIAL_COOKIE, token)
    assert instance.get('/api/v1/trial/status').json()['user']['remaining'] == 200000
    assert instance.get('/api/v1/trial/runs').json() == []
    assert instance.get('/api/v1/private').status_code == 401
    assert instance.get('/api/v1/trial/admin/users').status_code == 403
    assert instance.post('/api/v1/trial/admin/invitations', json={'count': 1}).status_code == 403
    assert instance.patch(f'/api/v1/trial/admin/users/{user}', json={'enabled': False}).status_code == 403
    assert instance.post('/api/v1/trial/logout', headers={'Origin': 'https://evil.example'}).status_code == 403


def test_admin_invitation_and_trial_enrollment_cookie(instance, service, monkeypatch, capsys):
    attach(instance, service, monkeypatch)
    assert instance.post('/api/v1/auth/register', json=payload(capsys)).status_code == 200
    invitation = instance.post('/api/v1/trial/admin/invitations', json={'count': 2})
    assert invitation.status_code == 200
    assert len(invitation.json()['inviteCodes']) == 2
    assert instance.get('/api/v1/trial/admin/users').json() == []
    instance.cookies.clear()
    body = dict(email='invite@example.com', password='trial-password', inviteCode=invitation.json()['inviteCode'])
    response = instance.post('/api/v1/trial/enroll', json=body)
    assert response.status_code == 200
    assert len(service.users()) == 1
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'Path=/api/v1/trial' in cookie and 'SameSite=lax' in cookie
    assert instance.get('/api/v1/private').status_code == 401
    assert instance.post('/api/v1/trial/enroll', json=body).status_code == 401
    assert instance.get('/api/v1/trial/status').json()['user']['limit'] == 200000


def test_rejects_arbitrary_experts_tools_and_long_inputs(instance, service, monkeypatch):
    attach(instance, service, monkeypatch)
    _, token = enroll(service)
    instance.cookies.set(TRIAL_COOKIE, token)
    base = dict(requestId='745e1e18-0787-47d1-8891-dd4223a2dafe', kind='research', topic='Review risks')
    for extra in ({'tools': ['shell']}, {'experts': ['custom-private']}, {'topic': 'x' * 2001},
                  {'stock': 'http://internal.example'}):
        assert instance.post('/api/v1/trial/runs', json={**base, **extra}).status_code == 422


def test_trial_csrf_is_enforced_even_in_legacy_mode(instance, service, monkeypatch):
    from src import auth
    attach(instance, service, monkeypatch)
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'legacy')
    monkeypatch.setenv('ADMIN_AUTH_ENABLED', 'false')
    auth.refresh_auth_state()
    assert instance.post('/api/v1/trial/login', json={'email': 'x@example.com', 'password': 'password'},
                         headers={'Origin': 'https://evil.example'}).status_code == 403


def test_admin_daily_limit_api_and_authorization(instance, service, monkeypatch, capsys):
    attach(instance, service, monkeypatch)
    assert instance.post('/api/v1/auth/register', json=payload(capsys)).status_code == 200
    invitation = instance.post('/api/v1/trial/admin/invitations', json={'dailyLimit': 300000}).json()
    identifier = invitation['invitationIds'][0]
    route = f'/api/v1/trial/admin/invitations/{identifier}'
    assert instance.get('/api/v1/trial/admin/invitations').json()[0]['dailyLimit'] == 300000
    assert instance.patch(route, json={'dailyLimit': 400000}).status_code == 200
    assert instance.patch(route, json={'dailyLimit': -1}).status_code == 422
    assert instance.patch(route, json={'dailyLimit': True}).status_code == 422
    assert instance.patch(route, json={'dailyLimit': 1}, headers={'Origin': 'https://evil.example'}).status_code == 403
    instance.cookies.clear()
    assert instance.patch(route, json={'dailyLimit': 1}).status_code == 403
    assert instance.get('/api/v1/trial/admin/invitations').status_code == 403
    _, token = enroll(service)
    instance.cookies.set(TRIAL_COOKIE, token)
    assert instance.patch(route, json={'dailyLimit': 1}).status_code == 403
