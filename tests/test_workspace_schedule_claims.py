"""Durable schedule claims stay exclusive across stale reads and workers."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.sql import Select

from src.services.workspace_service import WorkspaceService
from src.storage import WorkspaceScheduleRecord
from tests.test_workspace_service import _task_payload, workspace  # noqa: F401


def _due_schedule(workspace, now):
    task = workspace.create_task(_task_payload())
    schedule = workspace.create_schedule({
        "taskId": task["id"], "name": "research schedule", "scheduleMode": "interval",
        "intervalMinutes": 5, "timezone": "Asia/Shanghai",
    })
    with workspace.db.session_scope() as session:
        session.get(WorkspaceScheduleRecord, schedule["id"]).next_run_at = now
    return schedule


def _intercept_due_reads(database, monkeypatch, after_read):
    """Keep real SQLite reads/writes, but reproduce a stale-reader interleaving."""
    original_scope = database.session_scope

    @contextmanager
    def coordinated_scope():
        with original_scope() as session:
            original_execute = session.execute

            def execute(statement, *args, **kwargs):
                result = original_execute(statement, *args, **kwargs)
                if (
                    isinstance(statement, Select)
                    and statement.column_descriptions[0].get("entity") is WorkspaceScheduleRecord
                    and statement._limit_clause is not None
                ):
                    rows = result.scalars().all()
                    after_read()
                    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))
                return result

            session.execute = execute
            yield session

    monkeypatch.setattr(database, "session_scope", coordinated_scope)


def test_two_pollers_claim_one_due_schedule_only_once(workspace, monkeypatch):
    now = datetime(2026, 9, 1, 8, 30)
    _due_schedule(workspace, now)
    other = WorkspaceService(workspace.db)
    barrier = Barrier(2)
    _intercept_due_reads(workspace.db, monkeypatch, lambda: barrier.wait(timeout=5))
    create_run = Mock(return_value={"id": "created-run"})
    monkeypatch.setattr(workspace, "create_run", create_run)
    monkeypatch.setattr(other, "create_run", create_run)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = [workers.submit(service.run_due_schedules, now) for service in (workspace, other)]
        created = [run_id for result in results for run_id in result.result(timeout=10)]

    assert created == ["created-run"]
    assert create_run.call_count == 1


@pytest.mark.parametrize("failed", [False, True])
def test_expired_worker_does_not_clear_a_new_claim_or_overwrite_its_result(workspace, monkeypatch, failed):
    now = datetime(2026, 9, 1, 8, 30)
    schedule = _due_schedule(workspace, now)

    def finish_old_run(*args, **kwargs):
        with workspace.db.session_scope() as session:
            row = session.get(WorkspaceScheduleRecord, schedule["id"])
            row.claim_token = "replacement-worker"
            row.claimed_at = now + timedelta(minutes=11)
            row.last_run_id = "newer-run"
            row.last_run_at = now + timedelta(minutes=11)
        if failed:
            raise RuntimeError("old worker failed after lease expiry")
        return {"id": "old-run"}

    monkeypatch.setattr(workspace, "create_run", finish_old_run)
    workspace.run_due_schedules(now)

    with workspace.db.get_session() as session:
        row = session.get(WorkspaceScheduleRecord, schedule["id"])
        assert row.claim_token == "replacement-worker"
        assert row.claimed_at == now + timedelta(minutes=11)
        assert row.last_run_id == "newer-run"
        assert row.last_run_at == now + timedelta(minutes=11)


@pytest.mark.parametrize("claimed_minutes_ago,expected_calls", [(9, 0), (11, 1)])
def test_claim_timeout_releases_only_expired_due_schedules(workspace, monkeypatch, claimed_minutes_ago, expected_calls):
    now = datetime(2026, 9, 1, 8, 30)
    schedule = _due_schedule(workspace, now)
    with workspace.db.session_scope() as session:
        row = session.get(WorkspaceScheduleRecord, schedule["id"])
        row.claim_token = "earlier-worker"
        row.claimed_at = now - timedelta(minutes=claimed_minutes_ago)
    create_run = Mock(return_value={"id": "new-run"})
    monkeypatch.setattr(workspace, "create_run", create_run)

    workspace.run_due_schedules(now)

    assert create_run.call_count == expected_calls


def test_schedule_disabled_after_selection_is_not_launched(workspace, monkeypatch):
    now = datetime(2026, 9, 1, 8, 30)
    schedule = _due_schedule(workspace, now)
    original_scope = workspace.db.session_scope

    def disable():
        with original_scope() as session:
            session.get(WorkspaceScheduleRecord, schedule["id"]).enabled = False

    _intercept_due_reads(workspace.db, monkeypatch, disable)
    create_run = Mock(return_value={"id": "must-not-run"})
    monkeypatch.setattr(workspace, "create_run", create_run)

    assert workspace.run_due_schedules(now) == []
    create_run.assert_not_called()


def test_schedule_timing_changed_after_selection_keeps_new_next_run(workspace, monkeypatch):
    now = datetime(2026, 9, 1, 8, 30)
    schedule = _due_schedule(workspace, now)
    new_next_run = now + timedelta(hours=1)
    original_scope = workspace.db.session_scope

    def reschedule():
        with original_scope() as session:
            row = session.get(WorkspaceScheduleRecord, schedule["id"])
            row.next_run_at = new_next_run
            row.interval_minutes = 60

    _intercept_due_reads(workspace.db, monkeypatch, reschedule)
    create_run = Mock(return_value={"id": "must-not-run"})
    monkeypatch.setattr(workspace, "create_run", create_run)
    assert workspace.run_due_schedules(now) == []
    create_run.assert_not_called()
    with workspace.db.get_session() as session:
        assert session.get(WorkspaceScheduleRecord, schedule["id"]).next_run_at == new_next_run


def test_pause_resume_manual_run_and_schedule_keep_independent_triggers(workspace, monkeypatch):
    now = datetime(2026, 9, 1, 8, 30)
    schedule = _due_schedule(workspace, now)
    monkeypatch.setattr("src.services.workspace_service.utc_naive_now", lambda: now)
    workspace.update_schedule(schedule["id"], {"enabled": False})
    create_run = Mock(return_value={"id": "new-run"})
    monkeypatch.setattr(workspace, "create_run", create_run)
    assert workspace.run_due_schedules(now) == []
    workspace.create_run(schedule["taskId"])
    resumed = workspace.update_schedule(schedule["id"], {"enabled": True})
    assert resumed["nextRunAt"] == "2026-09-01T08:35:00Z"
    assert workspace.run_due_schedules(now) == []
    assert workspace.run_due_schedules(now + timedelta(minutes=5)) == ["new-run"]
    assert create_run.call_args_list[0].kwargs == {}
    assert create_run.call_args_list[1].kwargs == {"trigger_type": "schedule"}
    assert workspace.list_schedules()[0]["nextRunAt"] == "2026-09-01T08:40:00Z"
