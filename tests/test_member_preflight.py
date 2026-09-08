from types import SimpleNamespace

from src.services import member_preflight as preflight


def test_preflight_is_read_only_and_reports_deployment_boundaries(tmp_path, monkeypatch):
    monkeypatch.setattr(preflight.auth, 'access_mode', lambda: 'server')
    monkeypatch.setattr(preflight.auth, 'account_email', lambda: 'owner@example.com')
    monkeypatch.setattr(preflight, 'get_config', lambda: SimpleNamespace(database_path=str(tmp_path / 'database.db')))
    monkeypatch.setattr(preflight, 'trial_model_params', lambda: {'model': 'deepseek/test'})
    monkeypatch.setattr(preflight, 'trial_enabled', lambda: False)
    monkeypatch.setenv('WEB_CONCURRENCY', '1')
    monkeypatch.setenv('CORS_ALLOW_ALL', 'false')
    result = preflight.check()
    assert result['readyForDeploymentChecks']
    assert any('HTTPS' in warning for warning in result['warnings'])
    assert not list(tmp_path.iterdir())
    monkeypatch.setenv('WEB_CONCURRENCY', '2')
    monkeypatch.setenv('CORS_ALLOW_ALL', 'true')
    assert len(preflight.check()['errors']) == 2
