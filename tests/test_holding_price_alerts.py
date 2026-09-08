import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.config import Config
from src.notification import NotificationChannel, NotificationService, NotificationDispatchResult, ChannelAttemptResult
from src.services.alert_service import AlertService, AlertServiceError
from src.services.alert_worker import AlertWorker
from src.services.portfolio_research_service import PortfolioResearchService
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_portfolio_research import holding


def payload(account=None):
    return {"target": "600519", "alert_type": "price_cross", "parameters": {"direction": "below", "price": 90},
            "notification_policy": {"channels": ["email"], "report": "price_brief", "language": "en",
                                    **({"holding_account_id": account} if account else {})},
            "cooldown_policy": {"cooldown_seconds": 3600}}


@pytest.mark.parametrize("policy", [{"channels": ["bogus"]}, {"channels": []}, {"channels": "email"},
                                   {"holding_account_id": True}, {"language": "bogus"}])
def test_policy_validation(workspace, policy):
    with pytest.raises(AlertServiceError):
        AlertService(workspace.db).create_rule({**payload(), "notification_policy": policy})


@pytest.mark.parametrize("price", [float("nan"), float("inf"), -1, 0])
def test_invalid_thresholds(workspace, price):
    with pytest.raises(AlertServiceError):
        AlertService(workspace.db).create_rule({**payload(), "parameters": {"direction": "below", "price": price}})


def test_bound_holding_worker_report_channels_cooldown_and_closed_position(workspace):
    portfolio = PortfolioResearchService(workspace)
    account = holding(portfolio)
    other = holding(portfolio, cost=300)
    service = AlertService(workspace.db)
    saved = service.create_rule(payload(account))
    notifier = Mock()
    notifier.send_with_results.return_value = NotificationDispatchResult(
        status="sent", success=True, dispatched=True, channel_results=[ChannelAttemptResult(channel="email", success=True)])
    worker = AlertWorker(service=service, notifier=notifier,
                         config_provider=lambda: SimpleNamespace(agent_event_monitor_enabled=True, agent_event_alert_rules_json=""))
    quote = SimpleNamespace(price=85, provider_timestamp="2026-09-08T10:00:00", is_stale=False)
    with patch("src.agent.events.EventMonitor._get_realtime_quote", AsyncMock(return_value=quote)), \
         patch.object(worker, "_attach_decision_signal_summary_safely"), \
         patch.object(worker, "_build_analysis_visibility", return_value={}):
        assert worker.run_once()["triggered"] == 1
        call = notifier.send_with_results.call_args
        assert call.kwargs["channels"] == [NotificationChannel.EMAIL]
        brief = call.args[0]
        assert "100" in brief and "-15.00%" in brief and "300" not in brief
        assert "not a new AI research report" in brief and "2026-09-08" in brief
        assert service.list_notifications()["items"][0]["success"] is True
        assert service.get_rule(saved["id"])["cooldown_active"] is True
        worker.run_once()
        assert notifier.send_with_results.call_count == 1
        portfolio.portfolio.record_trade(account_id=account, symbol="600519", market="cn", currency="CNY",
                                         trade_date=date.today(), side="sell", quantity=10, price=85)
        assert worker.run_once()["triggered"] == 0
        assert other != account  # the remaining account must not keep this bound rule alive


def test_stale_and_nonfinite_quotes_never_trigger(workspace):
    service = AlertService(workspace.db)
    saved = service.create_rule(payload())
    rule = service.build_runtime_payloads(service.repo.get_rule(saved["id"]))[0].rule
    for quote in [SimpleNamespace(price=80, is_stale=True), SimpleNamespace(price=float("nan")), SimpleNamespace(price=float("inf"))]:
        result = asyncio.run(service._evaluate_rule(rule, SimpleNamespace(_get_realtime_quote=AsyncMock(return_value=quote))))
        assert result["record_status"] == "skipped"
        assert result["triggered"] is False


def test_explicit_channels_cannot_bypass_alert_route():
    config = Config(stock_list=[], notification_alert_channels=["email"])
    with patch("src.notification.get_config", return_value=config):
        service = NotificationService()
    service._available_channels = [NotificationChannel.EMAIL, NotificationChannel.FEISHU]
    with patch.object(service, "send_to_email") as email, patch.object(service, "send_to_feishu") as feishu:
        result = service.send_with_results("No real delivery", route_type="alert", channels=[NotificationChannel.FEISHU])
    assert not result.success
    assert result.status == "no_channel"
    email.assert_not_called()
    feishu.assert_not_called()


def test_poller_enable_disable_and_stop_without_model_schedule():
    from src.services.alert_polling import AlertPollingService

    config = SimpleNamespace(agent_event_monitor_enabled=False, agent_event_monitor_interval_minutes=5)
    worker = Mock()
    poller = AlertPollingService(worker=worker, config_provider=lambda: config)
    # Drive the real loop deterministically, without sleeping or external I/O.
    steps = iter([False, False, False, True])
    def wait(_):
        step = next(steps)
        config.agent_event_monitor_enabled = not config.agent_event_monitor_enabled
        return step
    poller._stop.wait = wait
    poller._loop()
    assert worker.run_once.call_count == 2
    assert poller.last_checked_at


def test_poller_config_failure_really_backs_off():
    from src.services.alert_polling import AlertPollingService

    config = SimpleNamespace(agent_event_monitor_enabled=True, agent_event_monitor_interval_minutes=5)
    provider = Mock(side_effect=[RuntimeError("temporary config failure"), config])
    worker = Mock()
    poller = AlertPollingService(worker=worker, config_provider=provider)
    clock = [0]
    ticks = iter([0, 1, 20, 59, 60])
    def wait(_):
        current = next(ticks, None)
        if current is None:
            return True
        clock[0] = current
        return False
    poller._stop.wait = wait
    with patch("src.services.alert_polling.time.monotonic", side_effect=lambda: clock[0]):
        poller._loop()
    assert provider.call_count == 2
    worker.run_once.assert_called_once()
    assert poller.last_error is None


def test_poller_uses_updated_interval_without_waiting_for_old_deadline():
    from src.services.alert_polling import AlertPollingService

    config = SimpleNamespace(agent_event_monitor_enabled=True, agent_event_monitor_interval_minutes=5)
    worker = Mock()
    poller = AlertPollingService(worker=worker, config_provider=lambda: config)
    clock = [0]
    ticks = iter([(0, 5), (59, 1), (60, 1), (120, 5), (360, 5)])
    def wait(_):
        current = next(ticks, None)
        if current is None:
            return True
        clock[0], config.agent_event_monitor_interval_minutes = current
        return False
    poller._stop.wait = wait
    with patch("src.services.alert_polling.time.monotonic", side_effect=lambda: clock[0]):
        poller._loop()
    assert worker.run_once.call_count == 3  # 0, 60, 360


def test_status_endpoint_only_exposes_channel_identifiers():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.v1.endpoints.alerts import router

    app = FastAPI()
    app.include_router(router)
    app.state.alert_poller = SimpleNamespace(status=lambda: {"running": True, "last_error": None})
    notifier = Mock()
    notifier.get_channels_for_route.return_value = [NotificationChannel.EMAIL]
    notifier.get_available_channels.return_value = [NotificationChannel.EMAIL, NotificationChannel.FEISHU]
    with patch("src.notification.NotificationService", return_value=notifier), patch("src.config.get_config", return_value=SimpleNamespace(agent_event_monitor_enabled=False, agent_event_monitor_interval_minutes=5)):
        response = TestClient(app).get('/status')
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "interval_minutes": 5, "owner": "web", "worker": {"running": True, "last_error": None}, "channels": ["email"], "configured_channels": ["email", "feishu"]}
