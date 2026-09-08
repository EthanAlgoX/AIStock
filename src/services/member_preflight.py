"""Read-only deployment checks: python -m src.services.member_preflight.

Does not send email, invoke models, mutate accounts or migrate private data.
TLS, reverse-proxy exposure and cross-host backups require deployment validation.
"""
import json
import os
from pathlib import Path

from src import auth
from src.config import get_config
from src.services.trial_service import trial_enabled, trial_model_params


def check():
    errors, warnings = [], []
    if auth.access_mode() != 'server':
        errors.append('Set ADMIN_ACCESS_MODE=server before public deployment.')
    if not auth.account_email():
        errors.append('Initialize the owner account on the deployment host first.')
    if int(os.getenv('WEB_CONCURRENCY', '1')) != 1:
        errors.append('Use one application process; queues and scheduling are process-local.')
    config = get_config()
    directory = Path(config.database_path).resolve().parent
    if not directory.is_dir() or not os.access(directory, os.W_OK):
        errors.append('The database directory must exist and be writable and persistent.')
    elif os.name == 'posix' and directory.stat().st_mode & 0o077:
        warnings.append('Restrict the database directory to the deployment OS user.')
    try:
        trial_model_params()
    except Exception:
        errors.append('Configure an available official HTTPS DeepSeek route for shared metered calls.')
    if not trial_enabled():
        warnings.append('TRIAL_ENABLED is false: invited accounts cannot make paid model calls.')
    if os.getenv('CORS_ALLOW_ALL', 'false').lower() == 'true':
        errors.append('Disable wildcard CORS for a public deployment.')
    warnings.extend([
        'Verify HTTPS, trusted proxy headers and a non-public backend port on the server.',
        'Apply reverse-proxy request/body limits and verify independent backups and restore.',
        'Registration is invitation-only; no automatic email verification or self-service recovery.',
    ])
    return {'readyForDeploymentChecks': not errors, 'errors': errors, 'warnings': warnings}


def main():
    try:
        result = check()
    except Exception:
        result = {'readyForDeploymentChecks': False, 'errors': ['Configuration could not be validated. Check deployment settings.'], 'warnings': []}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['readyForDeploymentChecks'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
