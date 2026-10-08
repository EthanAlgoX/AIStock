"""Legacy paper APIs share real scoped storage without changing account balances."""
import json

import pytest
from sqlalchemy import select, func

from src.services.simulation_strategy_service import SimulationStrategyService
from src.storage import (DatabaseManager, SimulationAccountRecord, SimulationEquitySnapshotRecord,
                         SimulationFillRecord, SimulationOrderRecord, SimulationRunRecord)
from tests.test_member_workspaces import members  # noqa: F401


@pytest.mark.parametrize('body', [
    '{"name":"Invalid cash","initial_cash":1e30}',
    '{"name":"Invalid cash","initial_cash":1e999}',
    '{"name":"   ","initial_cash":1000}',
])
def test_invalid_paper_account_inputs_reject_without_writing_balance(members, body):
    owner, _, _, _ = members
    response = owner.post('/api/v1/simulation/accounts', content=body,
                          headers={'Content-Type': 'application/json'})
    assert response.status_code == 400, response.text
    assert owner.get('/api/v1/simulation/accounts').json()['items'] == []
    with DatabaseManager.get_instance().get_session() as session:
        assert session.scalar(select(func.count()).select_from(SimulationAccountRecord)) == 0
        assert session.scalar(select(func.count()).select_from(SimulationEquitySnapshotRecord)) == 0


def test_legacy_paper_rejection_is_idempotent_and_never_mutates_cash(members):
    owner, _, _, _ = members
    account_response = owner.post('/api/v1/simulation/accounts', json={
        'name': 'Paper evidence', 'initial_cash': 1000.005, 'currency': 'USD',
    })
    assert account_response.status_code == 200, account_response.text
    account = account_response.json()
    assert account['initial_cash'] == account['cash_balance'] == 1000.01
    db = DatabaseManager.get_instance()
    strategies = SimulationStrategyService(db)
    strategy = strategies.create_strategy({'name': 'Text research'})
    run = strategies.create_run({'strategy_version_id': strategy['latest_version']['id'],
                                'input_snapshot': {'stock_code': 'AAPL'}})
    payload = {'account_id': account['id'], 'run_id': run['id']}
    assert owner.post('/api/v1/simulation/paper-executions', json=payload).status_code == 400
    with db.session_scope() as session:
        record = session.get(SimulationRunRecord, run['id'])
        record.status = 'completed'
        record.result_snapshot_json = json.dumps({'agent_result': {'content': 'Buy suggestion'}})
    first = owner.post('/api/v1/simulation/paper-executions', json=payload)
    second = owner.post('/api/v1/simulation/paper-executions', json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()['status'] == 'rejected' and first.json()['idempotent'] is False
    assert second.json()['order_id'] == first.json()['order_id'] and second.json()['idempotent'] is True
    orders = owner.get(f"/api/v1/simulation/accounts/{account['id']}/orders").json()['items']
    assert len(orders) == 1 and orders[0]['quantity'] == 0
    with db.get_session() as session:
        assert session.get(SimulationAccountRecord, account['id']).cash_balance == 1000.01
        assert session.scalar(select(func.count()).select_from(SimulationOrderRecord)) == 1
        assert session.scalar(select(func.count()).select_from(SimulationFillRecord)) == 0
