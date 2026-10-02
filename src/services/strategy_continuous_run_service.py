"""Persistent control loop for repeated published-strategy research batches.

The loop only creates automatic *research* batches.  It has no order, broker,
fill, position, or ledger capability.  Pausing or terminating is cooperative:
it prevents the next cycle; a batch already executing is allowed to finish so
its reproducibility record is never torn down half way through.
"""

from __future__ import annotations

from pathlib import Path
import threading
import time
from weakref import WeakSet, WeakValueDictionary
from src.workspace_scope import context_thread as ContextThread
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import select

from src.storage import (
    DatabaseManager,
    SimulationStrategyRunControlRecord,
    SimulationStrategyVersionRecord,
    utc_naive_now,
)


class StrategyContinuousRunError(ValueError):
    pass


class StrategyContinuousRunService:
    """Own the start/pause/terminate lifecycle of recurring research runs."""

    _instance: Optional["StrategyContinuousRunService"] = None
    _instance_lock = threading.Lock()
    _controllers = WeakSet()
    _controllers_lock = threading.Lock()
    _cycle_locks = WeakValueDictionary()

    def __new__(cls, db_manager: Optional[DatabaseManager] = None):
        if db_manager is not None:
            return super().__new__(cls)
        from src.workspace_scope import current_workspace_database
        database = current_workspace_database()
        if database is not None:
            with cls._instance_lock:
                if not hasattr(database, '_continuous_run_service'):
                    database._continuous_run_service = super().__new__(cls)
                    cls.__init__(database._continuous_run_service, database)
                return database._continuous_run_service
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        current_db = db_manager or DatabaseManager.get_instance()
        if getattr(self, "_initialized", False) and self.db is current_db:
            return
        if getattr(self, "_initialized", False):
            # DatabaseManager can be rebuilt during tests, hot reloads, or an
            # explicit connection reset.  Do not retain its disposed session
            # factory in the process-wide continuous-run controller.
            self.stop_workers()
        self.db = current_db
        self._workers: dict[int, threading.Thread] = {}
        self._wake_events: dict[int, threading.Event] = {}
        self._stop_events: dict[int, threading.Event] = {}
        self._lock = threading.RLock()
        self._initialized = True
        with self._controllers_lock:
            self._controllers.add(self)

    def start(self, strategy_version_id: int, interval_seconds: int = 900) -> dict[str, Any]:
        interval = self._validate_interval(interval_seconds)
        # Keep the runtime boundary defensive even when a caller bypasses the
        # filtered frontend selector. A published kernel is reusable logic, not
        # a complete runnable strategy until an independent configuration has
        # been created and published from it.
        from src.services.strategy_definition_service import StrategyDefinitionService

        version_detail = StrategyDefinitionService(self.db).get_version(strategy_version_id)
        if version_detail.get("productRole") == "kernel":
            raise StrategyContinuousRunError("策略内核不能直接持续运行；请先在策略中心创建并发布运行配置。")
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, strategy_version_id)
            if not version or version.status != "PUBLISHED" or not version.immutable:
                raise StrategyContinuousRunError("只能持续运行不可修改的正式发布策略版本。")
            control = session.execute(
                select(SimulationStrategyRunControlRecord).where(
                    SimulationStrategyRunControlRecord.strategy_version_id == strategy_version_id
                )
            ).scalar_one_or_none()
            now = utc_naive_now()
            if control is None:
                control = SimulationStrategyRunControlRecord(
                    strategy_version_id=strategy_version_id,
                    status="running",
                    interval_seconds=interval,
                    next_run_at=now,
                )
                session.add(control)
                session.flush()
            else:
                control.status = "running"
                control.interval_seconds = interval
                control.next_run_at = now
                control.error_message = None
            control_id = control.id
            result = self._detail(control)
        self._ensure_worker(control_id)
        self._wake(control_id)
        return result

    def pause(self, control_id: int) -> dict[str, Any]:
        return self._change_status(control_id, "paused")

    def terminate(self, control_id: int) -> dict[str, Any]:
        return self._change_status(control_id, "terminated")

    def list_controls(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationStrategyRunControlRecord)
                .order_by(SimulationStrategyRunControlRecord.updated_at.desc(), SimulationStrategyRunControlRecord.id.desc())
                .limit(max(1, min(int(limit), 100)))
            ).scalars().all()
            return [self._detail(row) for row in rows]

    def resume_active(self) -> None:
        """Restore running controls after an API process restart."""
        with self.db.get_session() as session:
            ids = session.execute(
                select(SimulationStrategyRunControlRecord.id).where(
                    SimulationStrategyRunControlRecord.status == "running"
                )
            ).scalars().all()
        for control_id in ids:
            self._ensure_worker(control_id)

    def stop_workers(self) -> None:
        """Stop new cycles during shutdown; durable intent resumes next start."""
        with self._lock:
            events = list(self._wake_events.values())
            for stop_event in self._stop_events.values():
                stop_event.set()
        for event in events:
            event.set()

    @classmethod
    def stop_all_workers(cls) -> None:
        """Stop all controller cycles, with a bounded wait for idle workers."""
        with cls._controllers_lock:
            controllers = list(cls._controllers)
        for controller in controllers:
            controller.stop_workers()
        deadline = time.monotonic() + 2.0
        for controller in controllers:
            with controller._lock:
                workers = list(controller._workers.values())
            for worker in workers:
                if worker is not threading.current_thread():
                    worker.join(timeout=max(0.0, deadline - time.monotonic()))

    @classmethod
    def wake_registered_controls(cls, control_ids: list[int], db_manager: Optional[DatabaseManager] = None) -> None:
        """Wake only workers attached to the database whose state changed."""
        from src.workspace_scope import current_workspace_database
        database = db_manager or current_workspace_database()
        if database is None and cls._instance is not None:
            database = cls._instance.db
        with cls._controllers_lock:
            controllers = [controller for controller in cls._controllers if controller.db is database]
        for controller in controllers:
            for control_id in control_ids:
                controller._wake(control_id)

    def _change_status(self, control_id: int, status: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            control = session.get(SimulationStrategyRunControlRecord, control_id)
            if not control:
                raise StrategyContinuousRunError("持续运行控制不存在。")
            control.status = status
            control.next_run_at = None
            result = self._detail(control)
        self._wake(control_id)
        return result

    def _ensure_worker(self, control_id: int) -> None:
        with self._lock:
            worker = self._workers.get(control_id)
            previous_stop = self._stop_events.get(control_id)
            if worker and worker.is_alive() and not (previous_stop and previous_stop.is_set()):
                return
            event = threading.Event()
            stop_event = threading.Event()
            self._wake_events[control_id] = event
            self._stop_events[control_id] = stop_event
            worker = ContextThread(
                target=self._worker,
                args=(control_id, event, stop_event, self.db, self._cycle_lock(self.db, control_id)),
                name=f"strategy-continuous-{control_id}",
                daemon=True,
            )
            self._workers[control_id] = worker
            worker.start()

    @classmethod
    def _cycle_lock(cls, database: DatabaseManager, control_id: int):
        """Retain the in-flight barrier across worker/controller generations."""
        url = database._engine.url
        if url.get_backend_name() == 'sqlite':
            # Independent in-memory engines are independent stores. File-backed
            # reopenings share a barrier even after the member store cache resets.
            if url.database in (None, '', ':memory:') or url.query.get('mode') == 'memory':
                store = database
            else:
                store = ('sqlite', str(Path(url.database).resolve()))
        else:
            store = url
        key = (store, control_id)
        with cls._controllers_lock:
            cycle_lock = cls._cycle_locks.get(key)
            if cycle_lock is None:
                cycle_lock = threading.Lock()
                cls._cycle_locks[key] = cycle_lock
            return cycle_lock

    def _wake(self, control_id: int) -> None:
        with self._lock:
            event = self._wake_events.get(control_id)
        if event:
            event.set()

    def _worker(
        self, control_id: int, event: threading.Event, stop_event: threading.Event,
        database: DatabaseManager, cycle_lock,
    ) -> None:
        try:
            while not stop_event.is_set():
                if not cycle_lock.acquire(timeout=0.1):
                    continue
                try:
                    # A stopped waiting generation may exit, while its ancestor
                    # still owns this barrier through the batch's final DB write.
                    if stop_event.is_set():
                        return
                    with database.get_session() as session:
                        control = session.get(SimulationStrategyRunControlRecord, control_id)
                        if not control or control.status != "running":
                            return
                        now = utc_naive_now()
                        due_at = control.next_run_at or now
                        wait_seconds = max(0.0, (due_at - now).total_seconds())
                    if not wait_seconds:
                        if stop_event.is_set():
                            return
                        self._run_cycle(control_id, database)
                finally:
                    cycle_lock.release()
                if wait_seconds:
                    event.wait(wait_seconds)
                    event.clear()
        finally:
            with self._lock:
                # A stopped generation may finish after a replacement started.
                if self._workers.get(control_id) is threading.current_thread():
                    self._workers.pop(control_id, None)
                    self._wake_events.pop(control_id, None)
                    self._stop_events.pop(control_id, None)

    def _run_cycle(self, control_id: int, database: Optional[DatabaseManager] = None) -> None:
        database = database or self.db
        with database.get_session() as session:
            control = session.get(SimulationStrategyRunControlRecord, control_id)
            if not control or control.status != "running":
                return
            version_id = control.strategy_version_id
        try:
            # Import lazily to avoid a service-level circular dependency.
            from src.services.strategy_definition_service import StrategyDefinitionService

            definition = StrategyDefinitionService(database)
            batch = definition.create_automatic_run_batch({"strategyVersionId": version_id}, enqueue=False)
            completed_batch = definition.execute_automatic_run_batch(batch["id"])
            error_message = completed_batch.get("errorMessage") if completed_batch.get("status") in {"failed", "completed_with_failures"} else None
            batch_id = batch["id"]
        except Exception as exc:  # Persist a useful cycle failure but keep control alive.
            error_message = str(exc)[:2000]
            batch_id = None
        with database.session_scope() as session:
            control = session.get(SimulationStrategyRunControlRecord, control_id)
            if not control:
                return
            now = utc_naive_now()
            if batch_id:
                control.last_batch_id = batch_id
            control.last_started_at = now
            control.last_completed_at = now
            control.error_message = error_message
            if control.status == "running":
                control.next_run_at = now + timedelta(seconds=self._validate_interval(control.interval_seconds))

    @staticmethod
    def _validate_interval(value: Any) -> int:
        try:
            seconds = int(value)
        except (TypeError, ValueError):
            seconds = 900
        return max(60, min(seconds, 24 * 60 * 60))

    @staticmethod
    def _detail(control: SimulationStrategyRunControlRecord) -> dict[str, Any]:
        return {
            "id": control.id,
            "strategyVersionId": control.strategy_version_id,
            "status": control.status,
            "intervalSeconds": control.interval_seconds,
            "lastBatchId": control.last_batch_id,
            "nextRunAt": control.next_run_at.isoformat() if control.next_run_at else None,
            "lastStartedAt": control.last_started_at.isoformat() if control.last_started_at else None,
            "lastCompletedAt": control.last_completed_at.isoformat() if control.last_completed_at else None,
            "errorMessage": control.error_message,
            "createdAt": control.created_at.isoformat() if control.created_at else None,
            "updatedAt": control.updated_at.isoformat() if control.updated_at else None,
        }
