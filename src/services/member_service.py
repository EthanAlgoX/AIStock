"""Private workspaces for existing invited identities; one identity/one budget.

The legacy owner store remains the control plane. Only server-authenticated
identity IDs select private stores; no HTTP workspace selector is accepted.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import os
import re
import threading
import copy
from dataclasses import fields, MISSING

from src import auth
from src.services.trial_service import TrialService, TrialError
from src.storage import DatabaseManager, TrialUserRecord, WorkspaceCapabilityPreferenceRecord
from sqlalchemy import select
from src.workspace_scope import workspace_scope, suspend_workspace_scope

MEMBER_PREFIX = 'member:'
_MEMBER = ContextVar('authenticated_member', default=None)
_STORES = {}
_STORE_LOCK = threading.RLock()
_TASK_POOL = None


def member_task_executor():
    """Share bounded execution capacity, not task dictionaries or SSE listeners."""
    global _TASK_POOL
    from src.workspace_scope import ContextThreadPoolExecutor
    with _STORE_LOCK:
        if _TASK_POOL is None:
            _TASK_POOL = ContextThreadPoolExecutor(max_workers=3, thread_name_prefix='member-analysis')
        return _TASK_POOL


def multi_user_enabled():
    auth._ensure_env_loaded()
    return auth.access_mode() == 'server' and os.getenv('MULTI_USER_ENABLED', 'true').lower() == 'true'


def current_member():
    return _MEMBER.get()


@contextmanager
def control_plane():
    """Narrow internal boundary for identity/quota operations, never user callbacks."""
    token = _MEMBER.set(None)
    try:
        with suspend_workspace_scope():
            yield
    finally:
        _MEMBER.reset(token)


class MemberService:
    def __init__(self, db=None):
        if current_member() is not None:
            raise RuntimeError('Resolve members at the control-plane boundary')
        self.db = db or DatabaseManager.get_instance()
        self.trials = TrialService(self.db)

    def resolve(self, cookie):
        if not multi_user_enabled() or not cookie or not cookie.startswith(MEMBER_PREFIX):
            raise TrialError('credentials_invalid', 401)
        user_id = self.trials.identity(cookie[len(MEMBER_PREFIX):])
        with self.db.get_session() as session:
            row = session.get(TrialUserRecord, user_id)
            return {'id': row.id, 'email': row.email, 'service': self}

    def require_enabled(self, user_id):
        if not multi_user_enabled():
            raise TrialError('account_disabled', 403)
        with self.db.get_session() as session:
            row = session.get(TrialUserRecord, user_id)
            if not row or not row.enabled or not row.password_hash:
                raise TrialError('account_disabled', 403)

    def database(self, user_id):
        self.require_enabled(user_id)
        if not re.fullmatch(r'[a-f0-9]{32}', user_id):
            raise TrialError('credentials_invalid', 401)
        # Derive from the actual control database, not a mutable process cwd/env.
        if self.db._engine.url.get_backend_name() != 'sqlite' or self.db._engine.url.database in (None, '', ':memory:'):
            raise TrialError('workspace_storage_unsupported', 503)
        root = Path(self.db._engine.url.database).resolve().parent
        directory = root / 'workspaces' / user_id
        for path in (root / 'workspaces', directory):
            if path.is_symlink():
                raise TrialError('workspace_storage_invalid', 503)
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = directory / 'workspace.db'
        if path.is_symlink():
            raise TrialError('workspace_storage_invalid', 503)
        key = str(path)
        with _STORE_LOCK:
            if key not in _STORES:
                if len(_STORES) >= 256:
                    raise TrialError('workspace_capacity_reached', 503)
                _STORES[key] = DatabaseManager.open_workspace('sqlite:///' + key, user_id)
            return _STORES[key]

    def change_credentials(self, user_id, current_password, *, email=None, password=None):
        with self.db.session_scope() as session:
            user = session.get(TrialUserRecord, user_id)
            if not user or not user.enabled:
                raise TrialError('credentials_invalid', 401)
            salt, expected = auth._parse_password_hash(user.password_hash)
            if not auth._verify_password_hash(current_password, salt, expected, auth.ACCOUNT_PBKDF2_ITERATIONS):
                raise TrialError('credentials_invalid', 401)
            if email is not None:
                # Email changes require renewed invitation/verification, not an
                # unverified transfer to an arbitrary address or owner identity.
                raise TrialError('email_change_requires_verification', 403)
            if password is not None:
                if not 8 <= len(password) <= 128 or not password.strip():
                    raise TrialError('password_length')
                user.password_hash = auth._account_hash(password)
                user.session_hash = None

    @contextmanager
    def scope(self, member):
        database = self.database(member['id'])
        from src.config import get_config
        platform_config = get_config()
        config = copy.deepcopy(platform_config)
        for field in fields(config):
            if field.name.startswith(('email_', 'stock_email_', 'feishu_', 'wechat_', 'dingtalk_',
                                      'telegram_', 'discord_', 'slack_', 'astrbot_', 'custom_webhook_',
                                      'pushover_', 'pushplus_', 'serverchan', 'ntfy_', 'gotify_')):
                value = field.default_factory() if field.default_factory is not MISSING else field.default
                setattr(config, field.name, copy.deepcopy(value))
        config.database_path = database._engine.url.database
        config.stock_list = []
        config.agent_event_alert_rules_json = ''
        config.agent_skill_dir = ''
        config.generation_backend = 'litellm'
        config.agent_generation_backend = 'litellm'
        config.agent_backend = 'auto'
        config.max_workers = 1
        config.markdown_to_image_channels = []
        config.agent_event_monitor_enabled = True
        with workspace_scope(database):
            with database.get_session() as session:
                compression = session.scalar(select(WorkspaceCapabilityPreferenceRecord).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == 'member_chat',
                    WorkspaceCapabilityPreferenceRecord.capability_id == 'compression',
                ))
                config.agent_context_compression_enabled = compression.enabled if compression else True
                config.stock_list = list(session.scalars(select(WorkspaceCapabilityPreferenceRecord.capability_id).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == 'watchlist',
                    WorkspaceCapabilityPreferenceRecord.enabled.is_(True),
                ).order_by(WorkspaceCapabilityPreferenceRecord.id)))
                preference = session.scalar(select(WorkspaceCapabilityPreferenceRecord).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == 'member_notification',
                    WorkspaceCapabilityPreferenceRecord.capability_id == 'email',
                ))
                if preference and preference.enabled:
                    config.email_sender = platform_config.email_sender
                    config.email_password = platform_config.email_password
                    config.email_sender_name = platform_config.email_sender_name
                    config.email_receivers = [member['email']]
        member = {**member, 'config': config}
        token = _MEMBER.set(member)
        try:
            with workspace_scope(database):
                yield
        finally:
            _MEMBER.reset(token)


def recheck_member():
    member = current_member()
    if member:
        with control_plane():
            member['service'].require_enabled(member['id'])


def run_member_maintenance(*, alerts=False, reconcile=False):
    """Restore durable per-user jobs without sharing scheduler/alert repositories."""
    if not multi_user_enabled():
        return
    from src.services.workspace_service import WorkspaceService
    from src.services.alert_worker import AlertWorker
    import logging
    service = MemberService()
    for user in service.trials.users():
        if not user['enabled'] or not user['enrolled']:
            continue
        try:
            member = {'id': user['id'], 'email': user['email'], 'service': service}
            with service.scope(member):
                workspace = WorkspaceService()
                if reconcile:
                    workspace.reconcile_interrupted_runs()
                elif alerts:
                    AlertWorker().run_once()
                else:
                    workspace.run_due_schedules()
        except Exception:
            logging.getLogger(__name__).exception('Private workspace maintenance failed for %s', user['id'])


def reset_member_stores():
    """Test/lifecycle cleanup only, never an HTTP operation."""
    with _STORE_LOCK:
        for database in _STORES.values():
            database._engine.dispose()
        _STORES.clear()


def main():
    """Host-only account recovery; never changes ownership or replenishes quota."""
    import argparse
    import getpass
    parser = argparse.ArgumentParser(description='Recover an invited private workspace account on the deployment host.')
    parser.add_argument('action', choices=['reset-password'])
    parser.add_argument('--email', required=True)
    args = parser.parse_args()
    email = auth.normalize_email(args.email)
    password = getpass.getpass('New password (8–128 characters): ')
    confirmation = getpass.getpass('Confirm new password: ')
    if password != confirmation or not 8 <= len(password) <= 128 or not password.strip():
        print('Passwords must match and contain 8–128 characters.')
        return 1
    service = MemberService()
    with service.db.session_scope() as session:
        user = session.scalar(select(TrialUserRecord).where(TrialUserRecord.email == email))
        if not user or not user.password_hash:
            print('No enrolled account found. No changes made.')
            return 1
        user.password_hash = auth._account_hash(password)
        user.session_hash, user.session_expires = None, None
    print('Password reset. Existing sessions revoked; workspace and quota preserved.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
