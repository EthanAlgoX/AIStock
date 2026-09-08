"""API-owned alert polling, separate from daily model research schedules."""

import logging
import threading
from src.workspace_scope import context_thread as ContextThread
import time
from datetime import datetime

from src.config import get_config
from src.services.alert_worker import AlertWorker
from src.services.runtime_scheduler import _agent_event_monitor_interval_seconds

logger = logging.getLogger(__name__)


class AlertPollingService:
    def __init__(self, worker=None, config_provider=get_config):
        self.config_provider = config_provider
        self.worker = worker or AlertWorker(config_provider=config_provider)
        self._stop = threading.Event()
        self._thread = None
        self.last_checked_at = None
        self.last_error = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = ContextThread(target=self._loop, name="alert-poller", daemon=True)
        self._thread.start()

    def _loop(self):
        last_check = None
        retry_after = 0.0
        while not self._stop.wait(1):
            try:
                now = time.monotonic()
                if now < retry_after:
                    continue
                config = self.config_provider()
                from src.services.member_service import multi_user_enabled
                if not config.agent_event_monitor_enabled and not multi_user_enabled():
                    last_check = None
                    continue
                interval = _agent_event_monitor_interval_seconds(config)
                if last_check is not None and now - last_check < interval:
                    continue
                if config.agent_event_monitor_enabled:
                    self.worker.run_once()
                from src.services.member_service import run_member_maintenance
                run_member_maintenance(alerts=True)
                self.last_checked_at = datetime.now().isoformat()
                self.last_error = None
                last_check = time.monotonic()
            except Exception:
                logger.exception("Alert polling failed")
                self.last_error = "Alert polling failed; check server logs"
                retry_after = time.monotonic() + 60

    def status(self):
        return {"running": bool(self._thread and self._thread.is_alive()),
                "last_checked_at": self.last_checked_at, "last_error": self.last_error}

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
