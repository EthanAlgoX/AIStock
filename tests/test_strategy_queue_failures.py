"""Rejected background work has an honest durable state and API response."""

from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from api.v1.endpoints import simulation
from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.storage import SimulationStrategyRecord, SimulationStrategyVersionRecord, SimulationStrategyRunBatchRecord
from tests.test_workspace_service import workspace  # noqa: F401


def _published_version(database):
    with database.session_scope() as session:
        strategy = SimulationStrategyRecord(name="Queue regression strategy")
        session.add(strategy)
        session.flush()
        version = SimulationStrategyVersionRecord(
            strategy_id=strategy.id, version=1, config_json="{}",
            status="PUBLISHED", immutable=True, strategy_purpose="trading_decision",
        )
        session.add(version)
        session.flush()
        return version.id


@pytest.mark.parametrize('entry', ['service', 'api'])
def test_rejected_automatic_batch_is_failed_and_never_claimed_as_accepted(workspace, entry):
    service = StrategyDefinitionService(workspace.db)
    version_id = _published_version(workspace.db)
    queue = Mock()
    queue.submit_background_task.side_effect = RuntimeError('private executor diagnostic')
    with patch('src.services.task_queue.get_task_queue', return_value=queue):
        if entry == 'service':
            with pytest.raises(StrategyDefinitionError) as caught:
                service.create_automatic_run_batch({'strategyVersionId': version_id})
            assert caught.value.code == 'AUTO_RUN_QUEUE_UNAVAILABLE'
            assert caught.value.status_code == 503
        else:
            app = FastAPI()
            app.include_router(simulation.router, prefix='/simulation')
            with patch.object(simulation, 'StrategyDefinitionService', return_value=service):
                with TestClient(app, raise_server_exceptions=False) as client:
                    response = client.post('/simulation/definition/automatic-runs', json={'strategyVersionId': version_id})
            assert response.status_code == 503
            assert response.json()['detail']['code'] == 'AUTO_RUN_QUEUE_UNAVAILABLE'
            assert 'private executor diagnostic' not in response.text
    queue.submit_background_task.assert_called_once()
    with workspace.db.get_session() as session:
        batch = session.scalars(select(SimulationStrategyRunBatchRecord)).one()
        assert batch.status == 'failed'
        assert batch.started_at is None and batch.completed_at is not None
        assert '队列' in batch.error_message and 'private executor diagnostic' not in batch.error_message
        assert service.get_automatic_run_batch(batch.id)['status'] == 'failed'
        strategy_id = session.get(SimulationStrategyVersionRecord, version_id).strategy_id
    assert {event['action'] for event in service.list_audit(strategy_id)} == {'AUTO_RUN_FAILED', 'AUTO_RUN_QUEUED'}


def test_unqueued_batch_keeps_the_continuous_worker_contract(workspace):
    service = StrategyDefinitionService(workspace.db)
    version_id = _published_version(workspace.db)
    with patch('src.services.task_queue.get_task_queue') as queue:
        result = service.create_automatic_run_batch({'strategyVersionId': version_id}, enqueue=False)
    queue.assert_not_called()
    assert result['status'] == 'queued' and result['completedAt'] is None


def test_queue_failure_does_not_overwrite_a_concurrent_terminal_batch(workspace):
    service = StrategyDefinitionService(workspace.db)
    version_id = _published_version(workspace.db)

    def cancel_then_reject(*args, **kwargs):
        with workspace.db.session_scope() as session:
            batch = session.scalars(select(SimulationStrategyRunBatchRecord)).one()
            batch.status = 'cancelled'
            batch.error_message = 'cancelled by user'
        raise RuntimeError('executor rejected')

    queue = Mock()
    queue.submit_background_task.side_effect = cancel_then_reject
    with patch('src.services.task_queue.get_task_queue', return_value=queue):
        with pytest.raises(StrategyDefinitionError):
            service.create_automatic_run_batch({'strategyVersionId': version_id})
    with workspace.db.get_session() as session:
        batch = session.scalars(select(SimulationStrategyRunBatchRecord)).one()
        assert batch.status == 'cancelled' and batch.error_message == 'cancelled by user'
