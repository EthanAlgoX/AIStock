"""End-to-end account contracts against real file credentials and middleware."""
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.auth as auth
from api.middlewares.auth import add_auth_middleware
from api.v1.endpoints.auth import router


@pytest.fixture
def instance(tmp_path, monkeypatch):
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'server')
    monkeypatch.setenv('MULTI_USER_ENABLED', 'false')
    monkeypatch.setenv('ENV_FILE', str(tmp_path / '.env'))
    monkeypatch.setenv('TRUST_X_FORWARDED_FOR', 'false')
    monkeypatch.setenv('CORS_ORIGINS', '')
    monkeypatch.setattr(auth, '_get_data_dir', lambda: tmp_path)
    auth.refresh_auth_state()
    auth._rate_limit = {}
    app = FastAPI()
    app.include_router(router, prefix='/api/v1/auth')

    @app.get('/api/v1/private')
    def private():
        return {'private': True}

    add_auth_middleware(app)
    yield TestClient(app, base_url='https://testserver')
    auth.refresh_auth_state()
    auth._rate_limit = {}


def payload(capsys):
    assert auth.setup_token_cli() == 0
    token = capsys.readouterr().out.strip().splitlines()[-1]
    return {'email': 'Owner@Example.com', 'password': 'secure-password',
            'passwordConfirm': 'secure-password', 'setupToken': token}


def test_full_lifecycle_and_no_anonymous_email_leak(instance, capsys):
    assert instance.get('/api/v1/private').status_code == 401
    status = instance.get('/api/v1/auth/status').json()
    assert status['accountState'] == 'register' and status['authEnabled']
    data = payload(capsys)
    response = instance.post('/api/v1/auth/register', json=data)
    assert response.status_code == 200
    assert 'HttpOnly' in response.headers['set-cookie']
    assert instance.get('/api/v1/private').status_code == 200
    assert instance.get('/api/v1/auth/status').json()['email'] == 'owner@example.com'
    old = instance.cookies.get(auth.COOKIE_NAME)
    assert instance.post('/api/v1/auth/register', json=data).status_code == 409
    assert instance.post('/api/v1/auth/change-email', json={'email': 'next@example.com', 'currentPassword': 'secure-password'}).status_code == 200
    assert not auth.verify_session(old)
    old = instance.cookies.get(auth.COOKIE_NAME)
    assert instance.post('/api/v1/auth/change-password', json={
        'currentPassword': 'secure-password', 'newPassword': 'new-password', 'newPasswordConfirm': 'new-password',
    }).status_code == 204
    assert not auth.verify_session(old)
    assert instance.get('/api/v1/private').status_code == 200
    assert instance.post('/api/v1/auth/logout').status_code == 204
    assert instance.get('/api/v1/auth/status').json()['email'] is None
    assert instance.post('/api/v1/auth/login', json={'email': 'next@example.com', 'password': 'new-password'}).status_code == 200


def test_old_password_is_required_for_migration(instance):
    assert auth.set_initial_password('legacy123') is None
    assert instance.get('/api/v1/auth/status').json()['accountState'] == 'migrate'
    before = auth._get_credential_path().read_bytes()
    assert instance.post('/api/v1/auth/register', json={'email': 'owner@example.com', 'currentPassword': 'wrong'}).status_code == 400
    assert auth._get_credential_path().read_bytes() == before
    assert instance.post('/api/v1/auth/login', json={'password': 'legacy123'}).status_code == 409
    assert instance.post('/api/v1/auth/register', json={'email': 'owner@example.com', 'currentPassword': 'legacy123'}).status_code == 200
    assert auth.verify_stored_password('legacy123')


def test_expired_token_no_credentials_written(instance, capsys):
    data = payload(capsys)
    path = auth._get_data_dir() / '.admin_setup_token'
    value = json.loads(path.read_text())
    value['expires'] = 0
    path.write_text(json.dumps(value))
    assert instance.post('/api/v1/auth/register', json=data).json()['error'] == 'setup_token_invalid'
    assert not auth._get_credential_path().exists()


def test_csrf_and_untrusted_proxy_headers(instance, capsys, monkeypatch):
    data = payload(capsys)
    assert instance.post('/api/v1/auth/register', json=data, headers={'Origin': 'https://attacker.example'}).status_code == 403
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'server')
    instance.base_url = 'http://testserver'
    assert instance.post('/api/v1/auth/register', json=data, headers={'X-Forwarded-Proto': 'https'}).status_code == 403
    instance.base_url = 'https://testserver'
    response = instance.post('/api/v1/auth/register', json=data)
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie']


def test_concurrent_registration_has_single_winner(instance, capsys):
    data = payload(capsys)

    def register(index):
        try:
            auth.register_account(f'owner{index}@example.com', data['password'], data['passwordConfirm'], '', data['setupToken'])
            return True
        except ValueError as exc:
            assert str(exc) == 'registration_closed'
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(register, range(4))) == 1


def test_legacy_config_cannot_disable_registered_account(instance, capsys, monkeypatch):
    assert instance.post('/api/v1/auth/register', json=payload(capsys)).status_code == 200
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'legacy')
    monkeypatch.setenv('ADMIN_AUTH_ENABLED', 'false')
    assert auth.is_auth_enabled()
    assert instance.post('/api/v1/auth/settings', json={'authEnabled': False, 'currentPassword': 'secure-password'}).status_code == 403
    instance.cookies.clear()
    assert instance.get('/api/v1/private').status_code == 401
    assert instance.post('/api/v1/auth/login', json={'password': 'secure-password'}).status_code == 401


def test_recovery_preserves_email_and_invalidates_sessions(instance, capsys):
    instance.post('/api/v1/auth/register', json=payload(capsys))
    old = instance.cookies.get(auth.COOKIE_NAME)
    assert auth.overwrite_password('recovered-password') is None
    assert auth.account_email() == 'owner@example.com'
    assert not auth.verify_session(old)
    assert instance.post('/api/v1/auth/login', json={'email': 'owner@example.com', 'password': 'recovered-password'}).status_code == 200


def test_rate_limit_and_email_errors_are_uniform(instance, capsys):
    instance.post('/api/v1/auth/register', json=payload(capsys))
    instance.cookies.clear()
    a = instance.post('/api/v1/auth/login', json={'email': 'unknown@example.com', 'password': 'secure-password'})
    b = instance.post('/api/v1/auth/login', json={'email': 'owner@example.com', 'password': 'wrong'})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()
    for _ in range(3):
        instance.post('/api/v1/auth/login', json={'email': 'owner@example.com', 'password': 'wrong'})
    assert instance.post('/api/v1/auth/login', json={'email': 'owner@example.com', 'password': 'secure-password'}).status_code == 429


def test_real_portfolio_api_requires_registered_session(instance, capsys, monkeypatch):
    from api.app import create_app
    from src.config import Config
    from src.storage import DatabaseManager
    monkeypatch.setenv('DATABASE_PATH', str(auth._get_data_dir() / 'portfolio.db'))
    Config.reset_instance()
    DatabaseManager.reset_instance()
    try:
        client = TestClient(create_app(static_dir=auth._get_data_dir() / 'static'), base_url='https://testserver')
        assert client.get('/api/v1/portfolio/accounts').status_code == 401
        assert client.post('/api/v1/auth/register', json=payload(capsys)).status_code == 200
        assert client.get('/api/v1/portfolio/accounts').status_code == 200
    finally:
        Config.reset_instance()
        DatabaseManager.reset_instance()


def test_packaged_entry_routes_account_action_without_starting_app(instance, monkeypatch):
    import main
    monkeypatch.setattr('sys.argv', ['stock_analysis', '--account-action', 'setup-token'])
    monkeypatch.setattr(auth, 'setup_token_cli', lambda: 23)
    assert main.main() == 23
