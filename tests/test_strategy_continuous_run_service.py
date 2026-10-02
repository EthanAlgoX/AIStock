from __future__ import annotations

from pathlib import Path
from datetime import timedelta
from threading import Event
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import create_engine

from src.services.strategy_continuous_run_service import StrategyContinuousRunService
from src.storage import (
    DatabaseManager, SimulationStrategyRecord, SimulationStrategyVersionRecord,
    SimulationStrategyRunControlRecord, utc_naive_now,
)
from src.workspace_scope import workspace_scope


def _control(database, *, due=False):
    with database.session_scope() as session:
        strategy = SimulationStrategyRecord(name="lifecycle regression")
        session.add(strategy)
        session.flush()
        version = SimulationStrategyVersionRecord(strategy_id=strategy.id, version=1, config_json="{}")
        session.add(version)
        session.flush()
        control = SimulationStrategyRunControlRecord(
            strategy_version_id=version.id, status="running", interval_seconds=900,
            next_run_at=utc_naive_now() + timedelta(seconds=-1 if due else 3600),
        )
        session.add(control)
        session.flush()
        return control.id


@pytest.fixture
def controller(tmp_path):
    DatabaseManager.reset_instance()
    service = StrategyContinuousRunService(DatabaseManager(f"sqlite:///{tmp_path / 'worker.sqlite'}"))
    yield service
    workers = list(service._workers.values())
    service.stop_workers()
    for worker in workers:
        worker.join(timeout=2)
    DatabaseManager.reset_instance()


def test_default_controller_rebinds_after_database_manager_reset(tmp_path: Path) -> None:
    StrategyContinuousRunService._instance = None
    DatabaseManager.reset_instance()
    try:
        first_db = DatabaseManager(f"sqlite:///{tmp_path / 'first.sqlite'}")
        first_controller = StrategyContinuousRunService()

        DatabaseManager.reset_instance()
        second_db = DatabaseManager(f"sqlite:///{tmp_path / 'second.sqlite'}")
        rebound_controller = StrategyContinuousRunService()

        assert rebound_controller is first_controller
        assert rebound_controller.db is second_db
        assert rebound_controller.db is not first_db
        with rebound_controller.db.get_session():
            pass
    finally:
        controller = StrategyContinuousRunService._instance
        if controller is not None:
            controller.stop_workers()
        StrategyContinuousRunService._instance = None
        DatabaseManager.reset_instance()


def test_shutdown_stops_sleeping_worker_without_changing_durable_intent(controller):
    control_id = _control(controller.db)
    controller._ensure_worker(control_id)
    worker = controller._workers[control_id]
    try:
        controller.stop_workers()
        worker.join(timeout=2)
        assert not worker.is_alive()
        with controller.db.get_session() as session:
            assert session.get(SimulationStrategyRunControlRecord, control_id).status == "running"
    finally:
        # Also makes the regression safe when run against the pre-fix worker.
        controller.pause(control_id)
        worker.join(timeout=2)


def test_resume_waits_for_stopped_inflight_batch_and_keeps_replacement_registered(controller, monkeypatch):
    control_id = _control(controller.db, due=True)
    started, release = Event(), Event()

    def finish(*args):
        started.set()
        assert release.wait(timeout=5)
        return {"status": "completed"}

    definition = Mock()
    definition.create_automatic_run_batch.return_value = {"id": None}
    definition.execute_automatic_run_batch.side_effect = finish
    monkeypatch.setattr("src.services.strategy_definition_service.StrategyDefinitionService", Mock(return_value=definition))
    controller._ensure_worker(control_id)
    old_worker = controller._workers[control_id]
    try:
        assert started.wait(timeout=2)
        controller.stop_workers()
        controller.resume_active()
        replacement = controller._workers[control_id]
        assert replacement is not old_worker
        assert definition.create_automatic_run_batch.call_count == 1
        release.set()
        old_worker.join(timeout=2)
        assert not old_worker.is_alive()
        assert controller._workers[control_id] is replacement
        with controller.db.get_session() as session:
            row = session.get(SimulationStrategyRunControlRecord, control_id)
            assert row.last_completed_at is not None
            assert row.status == "running"
    finally:
        release.set()
        controller.stop_workers()
        old_worker.join(timeout=2)


@pytest.mark.parametrize('second_stop', ['controller', 'host'])
def test_repeated_stop_resume_keeps_original_batch_barrier(controller, monkeypatch, second_stop):
    control_id = _control(controller.db, due=True)
    started, release, overlap = Event(), Event(), Event()
    definition = Mock()
    definition.create_automatic_run_batch.return_value = {'id': None}

    def execute(*args):
        if not started.is_set():
            started.set()
            assert release.wait(timeout=10)
        else:
            overlap.set()
        return {'status': 'completed'}

    definition.execute_automatic_run_batch.side_effect = execute
    monkeypatch.setattr('src.services.strategy_definition_service.StrategyDefinitionService', Mock(return_value=definition))
    workers = []
    try:
        controller._ensure_worker(control_id)
        original = controller._workers[control_id]
        workers.append(original)
        assert started.wait(timeout=2)
        controller.stop_workers()
        controller.resume_active()
        waiting = controller._workers[control_id]
        workers.append(waiting)
        assert waiting is not original
        if second_stop == 'host':
            StrategyContinuousRunService.stop_all_workers()
        else:
            controller.stop_workers()
        waiting.join(timeout=2)
        assert not waiting.is_alive()
        controller.resume_active()
        latest = controller._workers[control_id]
        workers.append(latest)
        assert original.is_alive()
        assert not overlap.wait(timeout=0.2)
        assert definition.create_automatic_run_batch.call_count == 1
        release.set()
        original.join(timeout=2)
        assert not original.is_alive()
        assert controller._workers[control_id] is latest
        # Prove the resumed worker can continue after the old batch and its
        # final DB write complete, rather than merely suppressing all new work.
        with controller.db.session_scope() as session:
            row = session.get(SimulationStrategyRunControlRecord, control_id)
            assert row.last_completed_at is not None
            row.next_run_at = utc_naive_now() - timedelta(seconds=1)
        controller._wake(control_id)
        assert overlap.wait(timeout=2)
        assert definition.create_automatic_run_batch.call_count == 2
    finally:
        release.set()
        controller.stop_workers()
        for worker in workers:
            worker.join(timeout=2)


def test_cycle_barrier_identity_reuses_file_paths_and_isolates_memory_stores(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    class MemoryStore:
        def __init__(self):
            self._engine = create_engine('sqlite:///:memory:')

    databases = [
        DatabaseManager.open_workspace('sqlite:///shared.sqlite', uuid4().hex),
        DatabaseManager.open_workspace(f"sqlite:///{tmp_path / 'shared.sqlite'}", uuid4().hex),
        DatabaseManager.open_workspace('sqlite:///other.sqlite', uuid4().hex),
        # Use real independent memory engines; the full manager's legacy
        # schema migrations require a persistent store and are outside this test.
        MemoryStore(),
        MemoryStore(),
    ]
    try:
        file_lock = StrategyContinuousRunService._cycle_lock(databases[0], 1)
        assert StrategyContinuousRunService._cycle_lock(databases[1], 1) is file_lock
        assert StrategyContinuousRunService._cycle_lock(databases[2], 1) is not file_lock
        assert StrategyContinuousRunService._cycle_lock(databases[0], 2) is not file_lock
        memory_lock = StrategyContinuousRunService._cycle_lock(databases[3], 1)
        assert StrategyContinuousRunService._cycle_lock(databases[4], 1) is not memory_lock
    finally:
        for database in databases:
            database._engine.dispose()


def test_rebound_worker_finishes_in_original_workspace_without_removing_new_worker(tmp_path, monkeypatch):
    first = DatabaseManager.open_workspace(f"sqlite:///{tmp_path / 'first-member.sqlite'}", uuid4().hex)
    second = DatabaseManager.open_workspace(f"sqlite:///{tmp_path / 'second-member.sqlite'}", uuid4().hex)
    started, release = Event(), Event()
    definition = Mock()
    definition.create_automatic_run_batch.return_value = {"id": None}

    def finish(*args):
        started.set()
        assert release.wait(timeout=5)
        return {"status": "completed"}

    definition.execute_automatic_run_batch.side_effect = finish
    factory = Mock(return_value=definition)
    monkeypatch.setattr("src.services.strategy_definition_service.StrategyDefinitionService", factory)
    with workspace_scope(first):
        first_id = _control(first, due=True)
        service = StrategyContinuousRunService(first)
        service._ensure_worker(first_id)
        old_worker = service._workers[first_id]
    assert started.wait(timeout=2)
    try:
        with workspace_scope(second):
            second_id = _control(second)
            assert second_id == first_id
            service.__init__(second)
            service._ensure_worker(second_id)
            new_worker = service._workers[second_id]
        release.set()
        old_worker.join(timeout=2)
        assert not old_worker.is_alive()
        assert service._workers[second_id] is new_worker
        factory.assert_called_once_with(first)
        with workspace_scope(first), first.get_session() as session:
            assert session.get(SimulationStrategyRunControlRecord, first_id).last_completed_at is not None
        with workspace_scope(second), second.get_session() as session:
            assert session.get(SimulationStrategyRunControlRecord, second_id).last_completed_at is None
    finally:
        release.set()
        workers = list(service._workers.values())
        service.stop_workers()
        old_worker.join(timeout=2)
        for worker in workers:
            worker.join(timeout=2)
        first._engine.dispose()
        second._engine.dispose()
