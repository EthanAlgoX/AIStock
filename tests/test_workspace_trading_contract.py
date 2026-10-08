"""Trading proposal inputs use real authenticated APIs and scoped SQLite."""
from copy import deepcopy
import json
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select

from src.services import workspace_service
from src.storage import (
    DatabaseManager, SimulationAccountRecord, SimulationFillRecord,
    SimulationOrderRecord, WorkspaceDataSnapshotRecord, WorkspaceRunRecord,
    WorkspaceTaskRecord,
)
from tests.test_member_workspaces import members  # noqa: F401


def payload(config=None, **changes):
    return dict(dict(kind='trading', name='Proposal evidence', market='US',
                     objective='Research a proposal without execution', subject={'stock': 'AAPL'},
                     config={} if config is None else config, capabilities={}), **changes)


def set_value(config, field, value):
    if field == 'initialCapital':
        config[field] = value
    else:
        config.setdefault('riskPolicy', {})[field] = value


def assert_no_execution_writes(database):
    with database.get_session() as session:
        for record in (WorkspaceRunRecord, WorkspaceDataSnapshotRecord, SimulationAccountRecord,
                       SimulationOrderRecord, SimulationFillRecord):
            assert session.scalar(select(func.count()).select_from(record)) == 0


@pytest.mark.parametrize('field,values', [
    ('initialCapital', [9999, 0, -1, True, None, '', 'invalid', 'NaN', 'Infinity',
                        '-Infinity', float('nan'), float('inf'), -float('inf'), 10 ** 400]),
    ('maxPositions', [1.5, '1.5', True, False, None, '', 'NaN', 'Infinity',
                      float('nan'), float('inf'), 0, 101, 10 ** 400]),
    ('maxPositionPercent', ['NaN', float('nan'), 'Infinity', float('inf'),
                            '-Infinity', None, 0, 100.1, 10 ** 400]),
    ('maxDailyLossPercent', ['NaN', float('nan'), 'Infinity', float('inf'),
                             '-Infinity', None, 0, 100.1, 10 ** 400]),
])
def test_invalid_numeric_proposal_inputs_reject_before_task_write(members, field, values):
    owner, _, _, _ = members
    database = DatabaseManager.get_instance()
    for value in values:
        config = {}
        set_value(config, field, value)
        # Raw JSON also exercises non-finite numeric tokens accepted by a Dict config.
        response = owner.post('/api/v1/workspace/tasks', content=json.dumps(payload(config)),
                              headers={'Content-Type': 'application/json'})
        assert response.status_code == 422, (field, value, response.text)
        assert field in response.json()['detail']['details']['fields']
        with database.get_session() as session:
            assert session.scalar(select(func.count()).select_from(WorkspaceTaskRecord)) == 0
        assert_no_execution_writes(database)


def test_invalid_trading_edits_roll_back_config_name_and_revision(members):
    owner, _, _, _ = members
    config = {'initialCapital': '10000', 'riskPolicy': {
        'maxPositions': '1', 'maxPositionPercent': '0.1', 'maxDailyLossPercent': '100',
    }}
    response = owner.post('/api/v1/workspace/tasks', json=payload(config))
    assert response.status_code == 201, response.text
    original = response.json()
    for field, value in [('initialCapital', 9999), ('maxPositions', True),
                         ('maxPositionPercent', 'NaN'), ('maxDailyLossPercent', 'Infinity')]:
        invalid = deepcopy(config)
        set_value(invalid, field, value)
        response = owner.patch(f"/api/v1/workspace/tasks/{original['id']}",
                               json={'name': 'Must roll back', 'config': invalid})
        assert response.status_code == 422, response.text
        restored = owner.get(f"/api/v1/workspace/tasks/{original['id']}").json()
        assert restored == original
    assert_no_execution_writes(DatabaseManager.get_instance())


@pytest.mark.parametrize('field,value', [
    ('initialCapital', 9999), ('maxPositions', True),
    ('maxPositionPercent', 'NaN'), ('maxDailyLossPercent', float('inf')),
])
def test_invalid_saved_legacy_proposal_cannot_start_run(members, monkeypatch, field, value):
    owner, _, _, _ = members
    response = owner.post('/api/v1/workspace/tasks', json=payload())
    assert response.status_code == 201, response.text
    task_id = response.json()['id']
    database = DatabaseManager.get_instance()
    config = {}
    set_value(config, field, value)
    # Represent an already persisted task from before the input contract was enforced.
    with database.session_scope() as session:
        session.get(WorkspaceTaskRecord, task_id).config_json = json.dumps(config)
    workers = Mock()
    monkeypatch.setattr(workspace_service, '_WORKERS', workers)
    response = owner.post(f'/api/v1/workspace/tasks/{task_id}/runs', json={})
    assert response.status_code == 422, response.text
    assert field in response.json()['detail']['details']['fields']
    workers.submit.assert_not_called()
    assert_no_execution_writes(database)


def test_numeric_strings_boundaries_and_omitted_defaults_remain_compatible(members):
    owner, _, _, _ = members
    configs = [
        {}, {'riskPolicy': {}},
        {'initialCapital': '10000', 'riskPolicy': {
            'maxPositions': '1.0', 'maxPositionPercent': '0.1', 'maxDailyLossPercent': '100',
        }},
        {'initialCapital': 1000000, 'riskPolicy': {
            'maxPositions': '100', 'maxPositionPercent': '100', 'maxDailyLossPercent': '0.1',
        }},
    ]
    for config in configs:
        response = owner.post('/api/v1/workspace/tasks', json=payload(config))
        assert response.status_code == 201, response.text
        assert response.json()['config'] == config
    plan = owner.get('/api/v1/workspace/default-task-plan',
                     params={'kind': 'trading', 'market': 'US', 'stock': 'AAPL'})
    assert plan.status_code == 200, plan.text
    assert plan.json()['task']['config']['initialCapital'] == 1000000
    assert_no_execution_writes(DatabaseManager.get_instance())


@pytest.mark.parametrize('kind,subject', [('research', {'stock': 'AAPL'}), ('screening', {})])
def test_other_task_kinds_do_not_gain_trading_numeric_restrictions(members, kind, subject):
    owner, _, _, _ = members
    config = {'initialCapital': 'NaN', 'riskPolicy': {'maxPositions': True}}
    response = owner.post('/api/v1/workspace/tasks', json=payload(config, kind=kind, subject=subject))
    assert response.status_code == 201, response.text
    assert response.json()['config'] == config
    assert_no_execution_writes(DatabaseManager.get_instance())
