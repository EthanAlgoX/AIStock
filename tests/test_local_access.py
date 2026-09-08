"""Local single-user access must never become an anonymous public API."""
import asyncio

import httpx
import pytest
from fastapi import FastAPI

from api.middlewares.auth import add_auth_middleware
from api.v1.endpoints.auth import router
from src import auth


@pytest.fixture
def local_app(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_FILE', str(tmp_path / '.env'))
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'local')
    monkeypatch.setenv('MULTI_USER_ENABLED', 'true')
    monkeypatch.setenv('ADMIN_AUTH_ENABLED', 'true')
    monkeypatch.setattr(auth, '_get_data_dir', lambda: tmp_path)
    auth.refresh_auth_state()
    app = FastAPI()
    app.include_router(router, prefix='/api/v1/auth')
    @app.get('/api/v1/private')
    @app.post('/api/v1/private')
    def private():
        return {'ok': True}
    add_auth_middleware(app)
    yield app
    auth.refresh_auth_state()


def request(app, path, *, peer='127.0.0.1', host='localhost', method='GET', headers=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(peer, 12345)), base_url=f'http://{host}') as client:
            return await client.request(method, path, headers=headers)
    return asyncio.run(run())


def test_local_needs_no_registration_even_with_stored_owner(local_app):
    assert request(local_app, '/api/v1/private').status_code == 200
    status = request(local_app, '/api/v1/auth/status').json()
    assert not status['authEnabled'] and not status['accountMode'] and not status['multiUserEnabled']
    assert status['registrationMode'] == 'closed'
    auth._get_credential_path().write_text('{"email":"owner@example.com","password_hash":"unused"}')
    assert request(local_app, '/api/v1/private').status_code == 200
    assert request(local_app, '/api/v1/auth/login', method='POST').status_code == 403


@pytest.mark.parametrize('kwargs', [
    {'peer': '192.0.2.10'}, {'host': 'attacker.example'},
    {'headers': {'X-Forwarded-For': '127.0.0.1'}},
    {'headers': {'Forwarded': 'for=127.0.0.1'}},
    {'method': 'POST', 'headers': {'Origin': 'https://attacker.example'}},
    {'method': 'POST', 'headers': {'Sec-Fetch-Site': 'cross-site'}},
])
def test_local_rejects_remote_rebinding_proxy_and_csrf(local_app, kwargs):
    assert request(local_app, '/api/v1/private', **kwargs).status_code == 403


def test_server_never_honors_legacy_auth_disable(local_app, monkeypatch):
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'server')
    monkeypatch.setenv('ADMIN_AUTH_ENABLED', 'false')
    assert auth.is_auth_enabled()
    assert request(local_app, '/api/v1/private').status_code == 403
