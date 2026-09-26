"""Personal model credentials, selected only by the authenticated workspace.

Keys use the same private atomic file storage as instance credentials. They are
never returned to clients or copied into shared config/environment variables.
"""
import json
import re

from src import auth
from src.services.trial_service import TrialError

# Provider endpoints are fixed so public users cannot turn model configuration
# into requests to the deployment's private network or metadata service.
PROVIDERS = {
    'openai': {'name': 'OpenAI', 'base': 'https://api.openai.com/v1'},
    'deepseek': {'name': 'DeepSeek', 'base': 'https://api.deepseek.com'},
    'anthropic': {'name': 'Anthropic', 'base': 'https://api.anthropic.com'},
    'gemini': {'name': 'Google Gemini', 'base': 'https://generativelanguage.googleapis.com'},
}


def _path(db):
    from pathlib import Path
    path = Path(db._engine.url.database).resolve().parent / '.model-credentials.json'
    if path.is_symlink():
        raise TrialError('model_settings_unavailable', 503)
    return path


def load(db):
    path = _path(db)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text())
        if value.get('provider') not in PROVIDERS or not value.get('apiKey') or not value.get('model'):
            raise ValueError('Invalid personal model settings')
        return value
    except (OSError, ValueError):
        raise TrialError('model_settings_unavailable', 503) from None


def public_settings(db):
    value = load(db) or {}
    return {'provider': value.get('provider', ''), 'model': value.get('model', ''),
            'configured': bool(value), 'providers': [dict(id=k, name=v['name']) for k, v in PROVIDERS.items()]}


def save(db, provider, model, api_key):
    if provider not in PROVIDERS or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,159}', model):
        raise TrialError('personal_model_invalid')
    previous = load(db)
    if not api_key and previous and previous['provider'] == provider:
        api_key = previous['apiKey']
    if not api_key or not api_key.strip() or len(api_key) > 4096 or api_key.startswith('os.environ/') or any(c.isspace() for c in api_key):
        raise TrialError('personal_key_required')
    auth._atomic_private_write(_path(db), json.dumps(dict(provider=provider, model=model, apiKey=api_key)))
    return public_settings(db)


def remove(db):
    _path(db).unlink(missing_ok=True)
    return public_settings(db)


def model_params(value):
    provider = value['provider']
    return {'model': provider + '/' + value['model'], 'api_key': value['apiKey'],
            'api_base': PROVIDERS[provider]['base'], 'custom_llm_provider': provider}
