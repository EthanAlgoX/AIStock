from datetime import datetime
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from api.v1.schemas.workspace import PortfolioResearchRequest
from src.services.portfolio_research_service import PortfolioResearchService
from src.services.workspace_service import WorkspaceService, WorkspaceError
from src.storage import WorkspaceScheduleRecord
from tests.test_portfolio_research import holding
from tests.test_workspace_service import workspace  # noqa: F401


@pytest.mark.parametrize('days', [1, 2, 3])
def test_calendar_cadence(days):
    anchor = datetime(2026, 9, 1, 8, 30)
    assert WorkspaceService._next_run('daily', '16:30', None, 'Asia/Shanghai', anchor, days, anchor) == datetime(2026, 9, 1 + days, 8, 30)


def test_missed_cycles_and_dst():
    assert WorkspaceService._next_run('daily', '16:30', None, 'Asia/Shanghai', datetime(2026, 9, 8, 10), 3, datetime(2026, 9, 1, 8, 30)) == datetime(2026, 9, 10, 8, 30)
    assert WorkspaceService._next_run('daily', '17:00', None, 'America/New_York', datetime(2026, 3, 7, 22), 2, datetime(2026, 3, 7, 22)) == datetime(2026, 3, 9, 21)


@pytest.mark.parametrize('days', [0, -1, 366, 1.5, True, '2'])
def test_invalid_period(days):
    with pytest.raises(ValidationError):
        PortfolioResearchRequest(intervalDays=days)
    with pytest.raises(WorkspaceError):
        WorkspaceService._validate_interval_days(days)


def test_holding_plan_uses_same_persistent_task_and_cadence(workspace):
    service = PortfolioResearchService(workspace)
    account = holding(service)
    saved = service.configure(account, '600519', {'dailyEnabled': True, 'intervalDays': 3})
    schedule_id = saved['schedule']['id']
    with workspace.db.session_scope() as session:
        session.get(WorkspaceScheduleRecord, schedule_id).next_run_at = datetime(2026, 9, 1, 8, 30)
    again = service.configure(account, '600519', {'dailyEnabled': True})
    assert again['schedule']['id'] == schedule_id
    assert again['schedule']['intervalDays'] == 3
    assert again['schedule']['nextRunAt'].startswith('2026-09-01T08:30')
    assert len(workspace.list_schedules()) == 1
    with patch.object(workspace, 'create_run', return_value={'id': 'scheduled-test'}) as run:
        workspace.run_due_schedules(datetime(2026, 9, 1, 8, 30))
    run.assert_called_once_with(saved['task']['id'], trigger_type='schedule')
    assert workspace.list_schedules()[0]['nextRunAt'].startswith('2026-09-04T08:30')
