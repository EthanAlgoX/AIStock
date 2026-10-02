"""Member research workers use owned stores and stop at the API boundary."""

from datetime import timedelta
from threading import Event
from unittest.mock import Mock

from fastapi.testclient import TestClient as _Client

from src.services.member_service import current_member, run_member_maintenance, reset_member_stores
from src.services.strategy_continuous_run_service import StrategyContinuousRunService
from src.storage import SimulationStrategyRunBatchRecord, SimulationStrategyRunControlRecord, utc_naive_now
from src.workspace_scope import current_workspace_database
from tests.test_member_workspaces import identity, members  # noqa: F401
from tests.test_strategy_continuous_run_service import _control


def test_member_restart_reconciles_research_and_restores_owned_controller(members, monkeypatch):
    _, alice, bob, service = members
    seen = []

    def record_cycle(controller, control_id, database=None):
        member = current_member()
        seen.append((member['id'], controller.db._workspace_id, member['config'].database_path))
        with controller.db.session_scope() as session:
            session.get(SimulationStrategyRunControlRecord, control_id).next_run_at = utc_naive_now() + timedelta(hours=1)
        finished.set()

    monkeypatch.setattr(StrategyContinuousRunService, '_run_cycle', record_cycle)
    finished = Event()
    controls = []
    for client in (alice, bob):
        member = identity(service, client)
        with service.scope(member):
            db = current_workspace_database()
            control_id = _control(db, due=client is alice)
            with db.session_scope() as session:
                control = session.get(SimulationStrategyRunControlRecord, control_id)
                batch = SimulationStrategyRunBatchRecord(strategy_version_id=control.strategy_version_id, status='running')
                session.add(batch)
                session.flush()
                controls.append((member, db, control_id, batch.id))
    run_member_maintenance(reconcile=True)
    try:
        assert finished.wait(timeout=2)
        assert seen == [(controls[0][0]['id'], controls[0][0]['id'], controls[0][1]._engine.url.database)]
        for member, db, control_id, batch_id in controls:
            with service.scope(member), db.get_session() as session:
                assert session.get(SimulationStrategyRunBatchRecord, batch_id).status == 'failed'
                assert db._continuous_run_service._workers[control_id].is_alive()
    finally:
        for _, db, _, _ in controls:
            controller = getattr(db, '_continuous_run_service', None)
            if controller:
                controller.stop_workers()


def test_member_status_wake_does_not_target_owner_with_same_control_id(members):
    _, alice, _, service = members
    owner_controller = StrategyContinuousRunService()
    owner_event = Event()
    owner_controller._wake_events[1] = owner_event
    member = identity(service, alice)
    try:
        with service.scope(member):
            controller = StrategyContinuousRunService()
            member_event = Event()
            controller._wake_events[1] = member_event
            StrategyContinuousRunService.wake_registered_controls([1])
            assert member_event.is_set()
            assert not owner_event.is_set()
    finally:
        owner_controller._wake_events.pop(1, None)


def test_api_shutdown_stops_member_controllers_without_changing_running_intent(members, monkeypatch, tmp_path):
    from api.app import create_app
    _, alice, _, service = members
    member = identity(service, alice)
    with service.scope(member):
        controller = StrategyContinuousRunService()
        control_id = _control(controller.db)
        controller._ensure_worker(control_id)
        worker = controller._workers[control_id]
    # Keep the real lifespan and member workers; unrelated pollers and market
    # refreshes are substituted so this check cannot issue network or LLM calls.
    monkeypatch.setattr('api.app._schedule_stock_index_background_refresh', Mock())
    producers = []
    runtime = Mock()
    runtime.stop.side_effect = lambda: producers.append('runtime')
    workspace = Mock()
    workspace.stop.side_effect = lambda: producers.append('workspace')
    monkeypatch.setattr('api.app.RuntimeSchedulerService', Mock(return_value=runtime))
    monkeypatch.setattr('src.services.workspace_service.WorkspaceSchedulerService', Mock(return_value=workspace))
    monkeypatch.setattr('src.services.alert_polling.AlertPollingService', Mock())
    original_stop = StrategyContinuousRunService.stop_all_workers

    def stop_controllers():
        assert set(producers) == {'runtime', 'workspace'}
        original_stop()

    monkeypatch.setattr(StrategyContinuousRunService, 'stop_all_workers', stop_controllers)
    try:
        with _Client(create_app(static_dir=tmp_path)):
            assert worker.is_alive()
        worker.join(timeout=2)
        assert not worker.is_alive()
        with service.scope(member), controller.db.get_session() as session:
            assert session.get(SimulationStrategyRunControlRecord, control_id).status == 'running'
    finally:
        controller.stop_workers()
        worker.join(timeout=2)


def test_member_store_reset_preserves_inflight_barrier_when_same_file_reopens(members, monkeypatch):
    _, alice, _, service = members
    member = identity(service, alice)
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
    controllers, workers = [], []
    try:
        with service.scope(member):
            original = StrategyContinuousRunService()
            controllers.append(original)
            control_id = _control(original.db, due=True)
            original._ensure_worker(control_id)
            first = original._workers[control_id]
            workers.append(first)
            assert started.wait(timeout=2)
            original.stop_workers()
            original.resume_active()
            waiting = original._workers[control_id]
            workers.append(waiting)
        # Real lifecycle cleanup disposes the engine and clears the member DB
        # cache while an already dispatched research call can still complete.
        reset_member_stores()
        waiting.join(timeout=2)
        assert not waiting.is_alive()
        with service.scope(member):
            reopened = StrategyContinuousRunService()
            controllers.append(reopened)
            assert reopened is not original and reopened.db is not original.db
            assert reopened.db._engine.url.database == original.db._engine.url.database
            reopened.resume_active()
            newest = reopened._workers[control_id]
            workers.append(newest)
        assert first.is_alive()
        assert not overlap.wait(timeout=0.2)
        assert definition.create_automatic_run_batch.call_count == 1
        release.set()
        first.join(timeout=2)
        assert not first.is_alive()
        with service.scope(member), reopened.db.session_scope() as session:
            row = session.get(SimulationStrategyRunControlRecord, control_id)
            assert row.last_completed_at is not None
            row.next_run_at = utc_naive_now() - timedelta(seconds=1)
        reopened._wake(control_id)
        assert overlap.wait(timeout=2)
        assert definition.create_automatic_run_batch.call_count == 2
    finally:
        release.set()
        for controller in controllers:
            controller.stop_workers()
        for worker in workers:
            worker.join(timeout=2)
