"""Storage-boundary regressions against real, independent SQLite databases.

These are not HTTP multi-user acceptance tests; public onboarding stays closed
until authentication, workers, files, notifications and UI have been integrated.
"""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.pool import NullPool

from src.storage import DatabaseManager, PortfolioAccount, WorkspaceTaskRecord
from src.services.agent_chat_session_service import AgentChatSessionService
from src.services.workspace_service import WorkspaceService, WorkspaceError
from src.workspace_scope import (
    WorkspaceScopeError, current_workspace_database, workspace_scope,
    submit_workspace_work,
)


@pytest.fixture
def stores(tmp_path):
    DatabaseManager.reset_instance()
    root = DatabaseManager(f'sqlite:///{tmp_path / "legacy.db"}')
    first = DatabaseManager.open_workspace(f'sqlite:///{tmp_path / "a.db"}', uuid4().hex)
    second = DatabaseManager.open_workspace(f'sqlite:///{tmp_path / "b.db"}', uuid4().hex)
    yield root, first, second
    first._engine.dispose()
    second._engine.dispose()
    DatabaseManager.reset_instance()


def test_existing_owner_data_is_not_copied_or_reassigned(stores):
    root, first, second = stores
    root.save_conversation_message('same-id', 'user', 'Legacy private text')
    for database in (first, second):
        with workspace_scope(database):
            assert DatabaseManager.get_instance() is database
            assert DatabaseManager() is database
            assert not AgentChatSessionService().get_session_detail('same-id', 20).messages
        assert isinstance(database._engine.pool, NullPool)
    assert DatabaseManager.get_instance() is root
    assert root.get_conversation_messages('same-id')[0]['content'] == 'Legacy private text'


def test_identical_chat_ids_do_not_share_read_delete_or_skill_state(stores):
    _, first, second = stores
    for database, content in ((first, 'A only'), (second, 'B only')):
        with workspace_scope(database):
            database.save_conversation_message('same-id', 'user', content)
    with workspace_scope(first):
        service = AgentChatSessionService()
        assert service.get_session_detail('same-id', 20).messages[0]['content'] == 'A only'
        service.delete_session('same-id')
    with workspace_scope(second):
        assert AgentChatSessionService().get_session_detail('same-id', 20).messages[0]['content'] == 'B only'


def test_real_workspace_repository_cannot_resolve_other_users_task(stores):
    _, first, second = stores
    with workspace_scope(first):
        with first.session_scope() as session:
            session.add(WorkspaceTaskRecord(id='private-task', task_kind='research',
                                           name='Private research', market='CN', objective='Private objective'))
        assert WorkspaceService().get_task('private-task')['name'] == 'Private research'
    with workspace_scope(second):
        assert WorkspaceService().list_tasks() == []
        with pytest.raises(WorkspaceError) as error:
            WorkspaceService().get_task('private-task')
        assert error.value.status_code == 404
        with pytest.raises(WorkspaceError):
            WorkspaceService().update_task('private-task', {'name': 'Overwrite'})


def test_portfolio_integer_ids_can_repeat_without_sharing_accounts(stores):
    _, first, second = stores
    for database, name in ((first, 'A portfolio'), (second, 'B portfolio')):
        with workspace_scope(database):
            with database.session_scope() as session:
                session.add(PortfolioAccount(id=1, name=name))
            with database.get_session() as session:
                assert session.get(PortfolioAccount, 1).name == name


def test_scope_blocks_captured_root_and_other_tenant_services(stores):
    root, first, second = stores
    captured = AgentChatSessionService(root)
    with workspace_scope(first):
        for database in (root, second):
            with pytest.raises(WorkspaceScopeError):
                database.get_session()
            with database._engine.connect() as connection:
                with pytest.raises(WorkspaceScopeError):
                    connection.execute(text('SELECT 1'))
        with pytest.raises(WorkspaceScopeError):
            captured.get_session_detail('private', 20)
        with pytest.raises(RuntimeError):
            DatabaseManager('sqlite:///:memory:')


def test_retained_session_identity_map_and_queries_are_guarded(stores):
    _, first, second = stores
    with workspace_scope(first):
        session = first.get_session()
        session.add(PortfolioAccount(id=1, name='Secret'))
        session.commit()
        account = session.get(PortfolioAccount, 1)
        assert account.name == 'Secret'
    try:
        with workspace_scope(second):
            with pytest.raises(WorkspaceScopeError):
                session.get(PortfolioAccount, 1)  # identity map hit, no SQL
            with pytest.raises(WorkspaceScopeError):
                session.execute(select(PortfolioAccount))
            account.name = 'Forbidden update'
            with pytest.raises(WorkspaceScopeError):
                session.flush()
    finally:
        session.close()


def test_missing_context_does_not_open_a_workspace(stores):
    root, first, _ = stores
    with pytest.raises(WorkspaceScopeError):
        first.get_session()
    with pytest.raises(WorkspaceScopeError):
        with workspace_scope(root):
            pass
    assert current_workspace_database() is None


def test_exception_cleanup_and_nested_switch_rejected(stores):
    root, first, second = stores
    with pytest.raises(ValueError):
        with workspace_scope(first):
            with workspace_scope(first):
                assert DatabaseManager.get_instance() is first
            with pytest.raises(WorkspaceScopeError):
                with workspace_scope(second):
                    pass
            raise ValueError('Expected')
    assert current_workspace_database() is None
    assert DatabaseManager.get_instance() is root


def test_background_work_and_reused_threads_keep_separate_contexts(stores):
    root, first, second = stores
    def write(content):
        database = DatabaseManager.get_instance()
        database.save_conversation_message('same-id', 'user', content)
        return database
    with ThreadPoolExecutor(max_workers=1) as pool:
        with workspace_scope(first):
            a = submit_workspace_work(pool, write, 'Background A')
        with workspace_scope(second):
            b = submit_workspace_work(pool, write, 'Background B')
        assert a.result() is first
        assert b.result() is second
        assert pool.submit(current_workspace_database).result() is None
        with pytest.raises(WorkspaceScopeError):
            submit_workspace_work(pool, write, 'Missing identity')
    assert root.get_conversation_messages('same-id') == []
    for database, content in ((first, 'Background A'), (second, 'Background B')):
        with workspace_scope(database):
            assert database.get_conversation_messages('same-id')[0]['content'] == content


def test_provision_failure_preserves_legacy_singleton(stores):
    root, first, _ = stores
    with pytest.raises(ValueError):
        DatabaseManager.open_workspace('sqlite:///:memory:', '../../legacy')
    with pytest.raises(Exception):
        DatabaseManager.open_workspace('unknown-dialect://', uuid4().hex)
    with workspace_scope(first):
        with pytest.raises(WorkspaceScopeError):
            DatabaseManager.open_workspace('sqlite:///:memory:', uuid4().hex)
    assert DatabaseManager.get_instance() is root
