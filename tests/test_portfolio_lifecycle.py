"""Stopping/removing a strategy revokes writes without discarding audit ledgers."""
import json
from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import select, func
from src.storage import (SimulationPortfolioRunRecord, SimulationPortfolioDefinitionRecord,
                         SimulationFillRecord, WorkspaceRunRecord)
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_trading_agent import setup_agent
from tests.test_simulation_portfolios import run_sync


OPTIONS = dict(mode='backtest', historyMode='ai_replay', initialCash=100000,
               startDate='2025-02-10', endDate='2025-02-14')


def test_delete_definition_hides_all_runs_but_preserves_ledger(workspace):
    _, service, saved, _ = setup_agent(workspace)
    first = service.create_validation(saved['id'], OPTIONS)
    second = service.create_validation(saved['id'], OPTIONS)
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, first['id'])
    with workspace.db.get_session() as session:
        fills = session.scalar(select(func.count()).select_from(SimulationFillRecord))
    assert fills > 0
    service.control_definition(saved['id'], remove=True)
    assert service.definitions() == [] and service.list() == []
    with workspace.db.get_session() as session:
        assert session.get(SimulationPortfolioDefinitionRecord, saved['id']).deleted_at is not None
        assert session.scalar(select(func.count()).select_from(SimulationFillRecord)) == fills
    for item in [first, second]:
        with pytest.raises(LookupError): service.detail(item['id'])
        with pytest.raises(LookupError): service.control(item['id'], 'start')
        assert not service.enqueue(item['id'])
    with pytest.raises(LookupError): service.create_validation(saved['id'], OPTIONS)
    # Even a stale create payload must recheck the definition inside its write transaction.
    with pytest.raises(LookupError): service.create(dict(first['config']))


@pytest.mark.parametrize('operation', ['stop', 'delete', 'delete_definition'])
def test_in_flight_model_cannot_commit_after_stop_or_delete(workspace, operation):
    agent, service, saved, calls = setup_agent(workspace)
    item = service.create_validation(saved['id'], OPTIONS)
    original = agent.adapter.call_text

    def completion(*args, **kwargs):
        if operation == 'stop': service.control(item['id'], 'stop')
        elif operation == 'delete': service.delete_portfolio(item['id'])
        else: service.control_definition(saved['id'], remove=True)
        return original(*args, **kwargs)

    with patch.object(agent.adapter, 'call_text', side_effect=completion), \
            patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    assert len(calls) == 1
    with workspace.db.get_session() as session:
        row = session.get(SimulationPortfolioRunRecord, item['id'])
        assert row.status == ('stopped' if operation == 'stop' else 'deleted')
        assert row.last_date is None and row.lease_token is None
        assert json.loads(row.state_json).get('pending') is None
        assert session.scalar(select(func.count()).select_from(SimulationFillRecord)) == 0
        assert session.scalars(select(WorkspaceRunRecord)).one().status == 'cancelled'


def test_stop_all_disables_scheduler_revokes_queued_work_and_can_resume(workspace):
    _, service, saved, calls = setup_agent(workspace)
    item = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    with patch('src.services.simulation_portfolio_service._POOL.submit') as submit:
        service.control(item['id'], 'start')
        token = submit.call_args.args[2]
    service.control_definition(saved['id'])
    service.execute(item['id'], token, automatic=True)
    with patch.object(service, 'enqueue') as enqueue:
        service.due()
        enqueue.assert_not_called()
    assert calls == [] and service.detail(item['id'])['status'] == 'stopped'
    assert len(service.definitions()) == 1
    with patch('src.services.simulation_portfolio_service._POOL.submit') as submit:
        service.control(item['id'], 'start')
        submit.assert_called_once()
    assert service.detail(item['id'])['status'] == 'running'


def test_removing_one_validation_does_not_remove_its_siblings(workspace):
    _, service, saved, _ = setup_agent(workspace)
    first = service.create_validation(saved['id'], OPTIONS)
    second = service.create_validation(saved['id'], OPTIONS)
    service.delete_portfolio(first['id'])
    service.delete_portfolio(first['id'])
    assert [row['id'] for row in service.list()] == [second['id']]
    assert len(service.definitions()) == 1
    assert service.detail(second['id'])['status'] == 'ready'


def test_legacy_definition_table_is_upgraded_idempotently(workspace):
    from sqlalchemy import inspect
    with workspace.db._engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE simulation_portfolio_definitions DROP COLUMN deleted_at')
    workspace.db._ensure_strategy_definition_schema()
    workspace.db._ensure_strategy_definition_schema()
    assert 'deleted_at' in {c['name'] for c in inspect(workspace.db._engine).get_columns('simulation_portfolio_definitions')}


from tests.test_member_workspaces import members, identity  # noqa: E402, F401


def test_lifecycle_endpoints_remain_in_authenticated_workspace(members):
    from src.storage import DatabaseManager
    from src.services.simulation_portfolio_service import SimulationPortfolioService
    from tests.test_simulation_portfolios import config
    owner, alice, bob, member_service = members
    with member_service.scope(identity(member_service, alice)):
        service = SimulationPortfolioService(DatabaseManager.get_instance())
        saved = service.save_definition(config())
        item = service.create(config(definitionId=saved['id']))
    root = '/api/v1/simulation/portfolios'
    for client in [bob, owner]:
        assert client.delete(f"{root}/definitions/{saved['id']}").status_code == 404
        assert client.post(f"{root}/definitions/{saved['id']}/stop").status_code == 404
        assert client.delete(f"{root}/{item['id']}").status_code == 404
    assert alice.post(f"{root}/{item['id']}/control", json={'action':'stop'}).status_code == 200
    assert alice.post(f"{root}/definitions/{saved['id']}/stop").status_code == 200
    assert alice.delete(f"{root}/definitions/{saved['id']}").status_code == 200
    assert alice.get(root).json()['items'] == []
    assert alice.get(f"{root}/{item['id']}").status_code == 404


def test_stop_during_market_fetch_prevents_starting_a_model_request(workspace):
    _, service, saved, calls = setup_agent(workspace)
    item = service.create_validation(saved['id'], OPTIONS)
    load = service._load

    def fetch_then_stop(*args, **kwargs):
        result = load(*args, **kwargs)
        service.control(item['id'], 'stop')
        return result

    with patch.object(service, '_load', side_effect=fetch_then_stop), \
            patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    assert calls == []
    assert service.detail(item['id'])['days'] == []
