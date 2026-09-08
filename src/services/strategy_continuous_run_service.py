"""Persistent control loop for repeated published-strategy research batches.

The loop only creates automatic *research* batches.  It has no order, broker,
fill, position, or ledger capability.  Pausing or terminating is cooperative:
it prevents the next cycle; a batch already executing is allowed to finish so
its reproducibility record is never torn down half way through.
"""

from __future__ import annotations

import threading
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
        self._lock = threading.RLock()
        self._initialized = True

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
        """Wake workers during API shutdown; durable controls resume next start."""
        with self._lock:
            events = list(self._wake_events.values())
        for event in events:
            event.set()

    @classmethod
    def wake_registered_controls(cls, control_ids: list[int]) -> None:
        """Wake live singleton workers after another service changes status."""
        instance = cls._instance
        if instance is None:
            return
        for control_id in control_ids:
            instance._wake(control_id)

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
            if worker and worker.is_alive():
                return
            event = self._wake_events.setdefault(control_id, threading.Event())
            event.clear()
            worker = ContextThread(
                target=self._worker,
                args=(control_id, event),
                name=f"strategy-continuous-{control_id}",
                daemon=True,
            )
            self._workers[control_id] = worker
            worker.start()

    def _wake(self, control_id: int) -> None:
        with self._lock:
            event = self._wake_events.get(control_id)
        if event:
            event.set()

    def _worker(self, control_id: int, event: threading.Event) -> None:
        try:
            while True:
                with self.db.get_session() as session:
                    control = session.get(SimulationStrategyRunControlRecord, control_id)
                    if not control or control.status != "running":
                        return
                    now = utc_naive_now()
                    due_at = control.next_run_at or now
                    wait_seconds = max(0.0, (due_at - now).total_seconds())
                if wait_seconds:
                    event.wait(wait_seconds)
                    event.clear()
                    continue
                self._run_cycle(control_id)
        finally:
            with self._lock:
                self._workers.pop(control_id, None)

    def _run_cycle(self, control_id: int) -> None:
        with self.db.get_session() as session:
            control = session.get(SimulationStrategyRunControlRecord, control_id)
            if not control or control.status != "running":
                return
            version_id = control.strategy_version_id
        try:
            # Import lazily to avoid a service-level circular dependency.
            from src.services.strategy_definition_service import StrategyDefinitionService

            definition = StrategyDefinitionService(self.db)
            batch = definition.create_automatic_run_batch({"strategyVersionId": version_id}, enqueue=False)
            completed_batch = definition.execute_automatic_run_batch(batch["id"])
            error_message = completed_batch.get("errorMessage") if completed_batch.get("status") in {"failed", "completed_with_failures"} else None
            batch_id = batch["id"]
        except Exception as exc:  # Persist a useful cycle failure but keep control alive.
            error_message = str(exc)[:2000]
            batch_id = None
        with self.db.session_scope() as session:
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
