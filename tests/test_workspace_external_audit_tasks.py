"""External execution history cannot become an editable or runnable task."""
from datetime import date, timedelta
import json
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import func, select

from src.services import workspace_service
from src.services.workspace_external_runs import begin
from src.services.workspace_service import WorkspaceService
from src.storage import (
    DatabaseManager, WorkspaceRunRecord, WorkspaceScheduleRecord,
    WorkspaceTaskRecord, utc_naive_now,
)
from tests.test_member_workspaces import members  # noqa: F401
from tests.test_portfolio_lifecycle import OPTIONS
from tests.test_simulation_portfolios import run_sync
from tests.test_trading_agent import setup_agent


def proposal(**changes):
    return dict(dict(kind='trading', name='Editable proposal', market='US', objective='Research only',
                     subject={'stock': 'AAPL'}, config={}, capabilities={}), **changes)


def schedule(task_id):
    return dict(taskId=task_id, name='Must not schedule audit', scheduleMode='daily', runAt='08:30')


def assert_read_only(client, task_id):
    responses = [
        client.patch(f'/api/v1/workspace/tasks/{task_id}', json={
            'enabled': True, 'name': 'Must not overwrite', 'config': {}, 'subject': {'stock': 'AAPL'},
        }),
        client.post(f'/api/v1/workspace/tasks/{task_id}/runs', json={}),
        client.post('/api/v1/workspace/schedules', json=schedule(task_id)),
        client.delete(f'/api/v1/workspace/tasks/{task_id}'),
    ]
    for response in responses:
        assert response.status_code == 409, response.text
        assert response.json()['detail']['code'] == 'external_task_read_only'


def test_real_native_execution_keeps_audit_readable_but_out_of_proposal_directory(members, monkeypatch):
    owner, alice, _, _ = members
    workspace = WorkspaceService(DatabaseManager.get_instance())
    _, native, definition, _ = setup_agent(workspace)
    account = native.create_validation(definition['id'], OPTIONS)
    with patch.object(native, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(native, account['id'])
    before = native.detail(account['id'])
    with workspace.db.get_session() as session:
        audit_id = session.scalar(select(WorkspaceRunRecord.id))
    audit = owner.get(f'/api/v1/workspace/runs/{audit_id}').json()
    assert audit['status'] == 'completed' and audit['resultSummary']['externalExecutor'] is True
    assert audit['taskSnapshot']['config']['portfolioId'] == account['id']
    editable = owner.post('/api/v1/workspace/tasks', json=proposal(enabled=False)).json()
    directory = owner.get('/api/v1/workspace/tasks', params={'kind': 'trading'}).json()
    assert [task['id'] for task in directory] == [editable['id']]
    assert audit['taskId'] not in [task['id'] for task in
        owner.get('/api/v1/workspace/tasks', params={'include_archived': True}).json()]
    saved_task = owner.get(f"/api/v1/workspace/tasks/{audit['taskId']}").json()
    workers = Mock()
    monkeypatch.setattr(workspace_service, '_WORKERS', workers)
    assert_read_only(owner, audit['taskId'])
    assert owner.get(f"/api/v1/workspace/tasks/{audit['taskId']}").json() == saved_task
    assert owner.get(f'/api/v1/workspace/runs/{audit_id}').json() == audit
    assert native.detail(account['id']) == before
    assert owner.get('/api/v1/workspace/run-history').json()['total'] == 1
    assert owner.get('/api/v1/workspace/schedules').json() == []
    assert alice.get(f'/api/v1/workspace/runs/{audit_id}').status_code == 404
    assert alice.get(f"/api/v1/workspace/tasks/{audit['taskId']}").status_code == 404
    workers.submit.assert_not_called()


@pytest.mark.parametrize('kind', ['trading', 'research', 'screening', 'market_analysis'])
def test_trusted_external_marker_protects_legacy_tasks_even_after_old_edits(members, kind):
    owner, _, _, _ = members
    workspace = WorkspaceService(DatabaseManager.get_instance())
    run_id = begin(workspace, kind, 'Executor history', 'US', {'stock': 'AAPL'}, {'portfolioId': 7})
    task_id = workspace.get_run(run_id)['taskId']
    with workspace.db.session_scope() as session:
        # Earlier releases allowed editing and enabling the audit shell. The run provenance remains.
        row = session.get(WorkspaceTaskRecord, task_id)
        row.enabled, row.config_json = True, '{}'
    assert owner.get('/api/v1/workspace/tasks').json() == []
    assert_read_only(owner, task_id)
    assert owner.get(f'/api/v1/workspace/runs/{run_id}').status_code == 200
    with workspace.db.get_session() as session:
        assert session.scalar(select(func.count()).select_from(WorkspaceRunRecord)) == 1
        assert session.scalar(select(func.count()).select_from(WorkspaceScheduleRecord)) == 0
        assert session.get(WorkspaceTaskRecord, task_id).archived_at is None


def test_existing_bad_audit_schedule_cannot_enable_or_execute_and_can_be_removed(members, monkeypatch):
    owner, _, _, _ = members
    workspace = WorkspaceService(DatabaseManager.get_instance())
    run_id = begin(workspace, 'trading', 'Executor history', 'US', {}, {'portfolioId': 7})
    task_id = workspace.get_run(run_id)['taskId']
    with workspace.db.session_scope() as session:
        session.get(WorkspaceTaskRecord, task_id).enabled = True
        session.add(WorkspaceScheduleRecord(id='legacy-audit-schedule', task_id=task_id, name='Old mistake',
                    schedule_mode='daily', run_at='08:30', timezone='UTC', enabled=True,
                    next_run_at=utc_naive_now() - timedelta(days=1)))
    response = owner.patch('/api/v1/workspace/schedules/legacy-audit-schedule', json={'enabled': True})
    assert response.status_code == 409, response.text
    workers = Mock()
    monkeypatch.setattr(workspace_service, '_WORKERS', workers)
    assert workspace.run_due_schedules() == []
    workers.submit.assert_not_called()
    assert owner.delete('/api/v1/workspace/schedules/legacy-audit-schedule').status_code == 200
    assert owner.get(f'/api/v1/workspace/runs/{run_id}').status_code == 200
    assert owner.get(f'/api/v1/workspace/tasks/{task_id}').status_code == 200


def test_normal_disabled_proposal_with_portfolio_id_remains_editable_and_schedulable(members):
    owner, _, _, _ = members
    response = owner.post('/api/v1/workspace/tasks', json=proposal(enabled=False, config={'portfolioId': 7}))
    assert response.status_code == 201, response.text
    task_id = response.json()['id']
    assert owner.get('/api/v1/workspace/tasks?kind=trading').json()[0]['id'] == task_id
    response = owner.patch(f'/api/v1/workspace/tasks/{task_id}', json={'enabled': True, 'name': 'Edited proposal'})
    assert response.status_code == 200, response.text
    response = owner.post('/api/v1/workspace/schedules', json=schedule(task_id))
    assert response.status_code == 201, response.text
    assert owner.delete(f'/api/v1/workspace/tasks/{task_id}').status_code == 200
    assert owner.get('/api/v1/workspace/schedules').json()[0]['enabled'] is False


def test_legacy_standalone_workflow_audit_is_distinct_from_normal_agent_tool_run(members, monkeypatch):
    owner, _, _, _ = members
    workspace = WorkspaceService(DatabaseManager.get_instance())
    plan = owner.get('/api/v1/workspace/default-task-plan',
                     params={'kind': 'research', 'market': 'US', 'stock': 'AAPL'}).json()
    result = dict(status='success', contract='ResearchReport',
                  workflowVersionId=plan['task']['config']['strategyVersionId'],
                  result={'summary': 'Frozen deterministic evidence'})
    run_id = workspace.record_workflow_result(result, {'stock': 'AAPL'})
    task_id = workspace.get_run(run_id)['taskId']
    assert workspace.get_run(run_id)['resultSummary']['externalExecutor'] is True
    with workspace.db.session_scope() as session:
        # Before the explicit marker, this path still had an unambiguous provenance signature.
        row = session.get(WorkspaceRunRecord, run_id)
        summary = json.loads(row.result_summary_json)
        summary.pop('externalExecutor')
        row.result_summary_json = json.dumps(summary)
    assert owner.get('/api/v1/workspace/tasks').json() == []
    assert_read_only(owner, task_id)
    response = owner.post('/api/v1/workspace/tasks', json=plan['task'])
    assert response.status_code == 201, response.text
    normal_id = response.json()['id']
    monkeypatch.setattr(workspace_service, '_WORKERS', Mock())
    normal = workspace.create_run(normal_id, trigger_type='agent_tool')
    workspace._store_artifact(normal['id'], 'ResearchReport', 'Normal result', result)
    workspace._finish_run(normal['id'], 'completed')
    assert workspace.get_run(normal['id'])['dataSnapshotId'] is not None
    assert owner.get('/api/v1/workspace/tasks').json()[0]['id'] == normal_id
    response = owner.patch(f'/api/v1/workspace/tasks/{normal_id}', json={'name': 'Normal edit'})
    assert response.status_code == 200, response.text
    assert owner.post('/api/v1/workspace/schedules', json=schedule(normal_id)).status_code == 201
    assert owner.delete(f'/api/v1/workspace/tasks/{normal_id}').status_code == 200
    assert owner.get(f'/api/v1/workspace/runs/{run_id}').status_code == 200


@pytest.mark.parametrize('field', ['result_summary_json', 'task_snapshot_json'])
@pytest.mark.parametrize('raw', ['{"score":NaN}', '{broken historical JSON'])
def test_invalid_run_json_cannot_break_normal_task_directory_or_edits(members, monkeypatch, field, raw):
    owner, _, _, _ = members
    workspace = WorkspaceService(DatabaseManager.get_instance())
    monkeypatch.setattr(workspace_service, '_WORKERS', Mock())
    kind = 'research' if field == 'task_snapshot_json' else 'trading'
    response = owner.post('/api/v1/workspace/tasks', json=proposal(kind=kind))
    assert response.status_code == 201, response.text
    task_id = response.json()['id']
    run = workspace.create_run(task_id)
    if field == 'result_summary_json' and raw == '{"score":NaN}':
        # The existing Python JSON writer permits NaN; SQL JSON functions do not.
        workspace._finish_run(run['id'], 'completed', summary={'score': float('nan')})
    else:
        with workspace.db.session_scope() as session:
            row = session.get(WorkspaceRunRecord, run['id'])
            if field == 'task_snapshot_json':
                # Exercise snapshot parsing for an older standalone history record.
                row.trigger_type, row.status, row.data_snapshot_id = 'agent_tool', 'completed', None
                row.result_summary_json = json.dumps({'parentRunId': None, 'artifactTypes': ['ResearchReport']})
            setattr(row, field, raw)
    external = begin(workspace, 'trading', 'Real executor audit', 'US', {}, {'portfolioId': 7})
    external_task_id = workspace.get_run(external)['taskId']
    response = owner.get('/api/v1/workspace/tasks')
    assert response.status_code == 200, response.text
    assert [task['id'] for task in response.json()] == [task_id]
    response = owner.patch(f'/api/v1/workspace/tasks/{task_id}', json={'name': 'Still editable'})
    assert response.status_code == 200, response.text
    assert response.json()['name'] == 'Still editable'
    assert_read_only(owner, external_task_id)
