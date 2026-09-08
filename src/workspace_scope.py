"""Internal workspace storage context; not an authentication mechanism.

Only an authenticated request/job boundary may select a workspace database.
Never construct this context from a client-supplied workspace ID or database URL.
"""

from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from threading import Thread
from typing import TYPE_CHECKING, Callable, TypeVar

if TYPE_CHECKING:
    from src.storage import DatabaseManager

T = TypeVar('T')
_DATABASE: ContextVar['DatabaseManager | None'] = ContextVar('workspace_database', default=None)


class WorkspaceScopeError(RuntimeError):
    """Missing scope or attempted access to a different workspace."""


def current_workspace_database():
    return _DATABASE.get()


@contextmanager
def suspend_workspace_scope():
    """Internal control-plane operations only; never wrap caller-supplied code."""
    token = _DATABASE.set(None)
    try:
        yield
    finally:
        _DATABASE.reset(token)


@contextmanager
def workspace_scope(database: 'DatabaseManager'):
    """Bind a server-selected database and always restore the preceding context.

Nested scopes may reuse the same database, but may not switch identities. Jobs
must establish their own authorization before entering this context.
"""
    if not getattr(database, '_workspace_id', None) or not database._initialized:
        raise WorkspaceScopeError('An initialized workspace database is required')
    previous = _DATABASE.get()
    if previous is not None and previous is not database:
        raise WorkspaceScopeError('Cannot switch workspace inside an active scope')
    token = _DATABASE.set(database)
    try:
        yield database
    finally:
        _DATABASE.reset(token)


def check_database_scope(database: 'DatabaseManager') -> None:
    active = _DATABASE.get()
    if active is not None and active is not database:
        raise WorkspaceScopeError('Database does not belong to the active workspace')
    if getattr(database, '_workspace_id', None) and active is not database:
        raise WorkspaceScopeError('Workspace context is required')


def submit_workspace_work(executor: Executor, function: Callable[..., T], *args, **kwargs) -> Future[T]:
    """Propagate a verified in-process scope, without leaking it into pool reuse.

This does not authorize durable/delayed work. Such jobs must persist ownership
and recheck account status at execution time before establishing their scope.
"""
    if _DATABASE.get() is None:
        raise WorkspaceScopeError('Workspace context is required for workspace work')
    context = copy_context()
    return executor.submit(context.run, function, *args, **kwargs)


def _run_scoped(function, args, kwargs):
    from src.services.member_service import recheck_member
    recheck_member()
    return function(*args, **kwargs)


class ContextThreadPoolExecutor(ThreadPoolExecutor):
    """Preserve scope for every task, including nested expert/tool work."""

    def submit(self, function, /, *args, **kwargs):
        context = copy_context()
        return super().submit(context.run, _run_scoped, function, args, kwargs)


class ContextThread(Thread):
    """Propagate request identity when legacy services start dedicated workers."""

    def __init__(self, *args, **kwargs):
        self._workspace_context = copy_context()
        super().__init__(*args, **kwargs)

    def run(self):
        self._workspace_context.run(_run_scoped, super().run, (), {})


def context_thread(*args, **kwargs):
    """Keep the legacy thread constructor outside tenant work (including tests)."""
    if current_workspace_database() is None:
        import threading
        return threading.Thread(*args, **kwargs)
    return ContextThread(*args, **kwargs)
