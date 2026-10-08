"""Exercise competing plan controls and receipts through real SQLite writes."""
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from threading import Event, get_ident

import pytest
from sqlalchemy import event

from src.storage import RuntimeResearchOperationRecord as Operation
from src.storage import RuntimeResearchPlanRecord as Plan
from tests.test_runtime_research_plans import due, plans  # noqa: F401


def _write_lock_is_held(database):
    connection = sqlite3.connect(database._engine.url.database, timeout=0)
    try:
        try:
            connection.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError as exc:
            if 'locked' not in str(exc):
                raise
            return True
        connection.rollback()
        return False
    finally:
        connection.close()


def _compete_after_read(database, monkeypatch, entity, reader_action, writer_action):
    """Pause after the real row read; a competing writer wins only without a lock."""
    original_scope = database.session_scope
    reader_ready, release_reader, writer_sql = Event(), Event(), Event()
    reader_thread, writer_thread = [None], [None]

    @contextmanager
    def coordinated_scope():
        with original_scope() as session:
            original_get = session.get

            def get(model, *args, **kwargs):
                row = original_get(model, *args, **kwargs)
                if get_ident() == reader_thread[0] and model is entity and not reader_ready.is_set():
                    reader_ready.set()
                    assert release_reader.wait(timeout=10)
                return row

            session.get = get
            yield session

    def before_write(_connection, _cursor, statement, _parameters, _context, _executemany):
        if get_ident() == writer_thread[0] and statement.lstrip().upper().startswith('UPDATE '):
            writer_sql.set()

    def reader():
        reader_thread[0] = get_ident()
        return reader_action()

    def writer():
        writer_thread[0] = get_ident()
        return writer_action()

    monkeypatch.setattr(database, 'session_scope', coordinated_scope)
    event.listen(database._engine, 'before_cursor_execute', before_write)
    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            first = workers.submit(reader)
            try:
                assert reader_ready.wait(timeout=10)
                locked = _write_lock_is_held(database)
                second = workers.submit(writer)
                if locked:
                    # The writer has reached SQLite and must wait for the reader's transaction.
                    assert writer_sql.wait(timeout=10)
                else:
                    # Reproduce the old SELECT/commit window deterministically.
                    second.result(timeout=10)
            finally:
                release_reader.set()
            first.result(timeout=10)
            second.result(timeout=10)
    finally:
        event.remove(database._engine, 'before_cursor_execute', before_write)


@pytest.mark.parametrize('action', ['pause', 'resume'])
def test_control_cannot_overwrite_concurrent_final_receipt(plans, monkeypatch, action):
    service, source, now = plans
    plan = due(service, now, maxRuns=1)
    service.tick()
    plan_id, token = service.repo.claim_due(now[0])[0]
    operation = service.repo.get(plan_id)['operations'][0]
    if action == 'resume':
        service.repo.control(plan_id, 'pause', now[0])
    completed = source.operation(operation['request_id'], 'SUCCEEDED')
    _compete_after_read(service.repo.db, monkeypatch, Plan,
                       lambda: service.repo.control(plan_id, action, now[0]),
                       lambda: service.repo.receive(plan_id, token, operation['id'], completed, now[0]))
    service.repo.release(plan_id, token)
    stored = service.repo.get(plan['id'])
    assert stored['status'] == 'completed'
    assert stored['operations'][0]['status'] == 'SUCCEEDED'
    assert stored['runs_reserved'] == 1
    assert len(source.writes()) == 1


def test_receipt_write_serializes_with_expired_claim_replacement(plans, monkeypatch):
    service, source, now = plans
    plan = due(service, now, maxRuns=1)
    service.tick()
    plan_id, token = service.repo.claim_due(now[0])[0]
    operation = service.repo.get(plan_id)['operations'][0]
    expired_at = now[0] + timedelta(seconds=301)

    def replacement():
        claimed_id, replacement_token = service.repo.claim_due(expired_at)[0]
        assert claimed_id == plan_id and replacement_token != token
        receipt = source.operation(operation['request_id'], 'SUCCEEDED')
        service.repo.receive(plan_id, replacement_token, operation['id'], receipt, expired_at)
        service.repo.release(plan_id, replacement_token)

    unknown = source.operation(operation['request_id'], 'UNKNOWN')
    _compete_after_read(service.repo.db, monkeypatch, Operation,
                       lambda: service.repo.receive(plan_id, token, operation['id'], unknown, now[0]),
                       replacement)
    # An old release must also leave the replacement's persisted result intact.
    service.repo.release(plan_id, token)
    stored = service.repo.get(plan['id'])
    assert stored['status'] == 'completed'
    assert stored['operations'][0]['status'] == 'SUCCEEDED'
    assert stored['operations'][0]['request_id'] == operation['request_id']
    assert stored['runs_reserved'] == 1 and stored['claim_token'] is None
    assert len(source.writes()) == 1
