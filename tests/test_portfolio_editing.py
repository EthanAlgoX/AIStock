"""Editing revisions preserves audit history and isolates new simulated capital."""
from datetime import date
from unittest.mock import patch

import pytest
from src.storage import SimulationPortfolioRunRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_member_workspaces import members, identity  # noqa: F401
from tests.test_trading_agent import setup_agent
from tests.test_portfolio_lifecycle import OPTIONS
from tests.test_simulation_portfolios import run_sync


def update_payload(saved, **changes):
    return dict(saved['config'], expectedRevision=saved['config'].get('definitionRevision', 1), **changes)


def test_edit_preserves_ledger_and_creates_new_revision_account(workspace):
    _, service, saved, _ = setup_agent(workspace)
    old = service.create_validation(saved['id'], OPTIONS)
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, old['id'])
    history = service.detail(old['id'])
    assert history['days']
    updated = service.update_definition(saved['id'], update_payload(saved, name='Revised', initialCash=200000,
        systemPrompt='Changed method', gridLevels=7, commissionRate=0.002))
    assert updated['id'] == saved['id'] and updated['config']['definitionRevision'] == 2
    assert service.detail(old['id'])['days'] == history['days']
    assert service.detail(old['id'])['config'] == old['config']
    assert service.detail(old['id'])['status'] == 'stopped'
    for action in ['run', 'start', 'pause']:
        with pytest.raises(ValueError, match='旧版'): service.control(old['id'], action)
    with pytest.raises(ValueError, match='旧版'): service.create(old['config'])
    new = service.create_validation(saved['id'], dict(mode='paper', initialCash=200000))
    assert new['config']['initialCash'] == 200000 and new['config']['gridLevels'] == 7
    assert new['config']['definitionRevision'] == 2 and new['days'] == []
    with workspace.db.get_session() as session:
        assert session.get(SimulationPortfolioRunRecord, new['id']).account_id != session.get(SimulationPortfolioRunRecord, old['id']).account_id
    with pytest.raises(ValueError, match='已更新'): service.update_definition(saved['id'], update_payload(saved))


def test_pause_allows_edit_and_revokes_in_flight_work(workspace):
    _, service, saved, calls = setup_agent(workspace)
    item = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    with patch('src.services.simulation_portfolio_service._POOL.submit') as submit:
        service.control(item['id'], 'start')
        token = submit.call_args.args[2]
    with pytest.raises(ValueError, match='先暂停'): service.update_definition(saved['id'], update_payload(saved))
    service.control(item['id'], 'pause')
    service.update_definition(saved['id'], update_payload(saved))
    service.execute(item['id'], token, automatic=True)
    assert calls == [] and not service.enqueue(item['id'])
    with patch.object(service, 'enqueue') as enqueue:
        service.due()
        enqueue.assert_not_called()


def test_busy_one_off_run_must_stop_before_editing(workspace):
    _, service, saved, _ = setup_agent(workspace)
    item = service.create_validation(saved['id'], OPTIONS)
    with patch('src.services.simulation_portfolio_service._POOL.submit'):
        service.control(item['id'], 'run')
    with pytest.raises(ValueError, match='先暂停'): service.update_definition(saved['id'], update_payload(saved))
    service.control(item['id'], 'stop')
    assert service.update_definition(saved['id'], update_payload(saved))['config']['definitionRevision'] == 2


def test_member_update_endpoint_is_private_and_checks_revision(members):
    from src.services.workspace_service import WorkspaceService
    from api.v1.endpoints.simulation_portfolios import StrategyConfig
    owner, alice, bob, member_service = members
    with member_service.scope(identity(member_service, alice)):
        _, service, saved, _ = setup_agent(WorkspaceService())
    payload = {key: value for key, value in saved['config'].items() if key in StrategyConfig.model_fields}
    payload.update(expectedRevision=1, name='Updated via API')
    root = '/api/v1/simulation/portfolios/definitions'
    # A valid update from another private workspace cannot find the preview/definition.
    for client in [bob, owner]:
        assert client.put(f"{root}/{saved['id']}", json=payload).status_code == 404
    response = alice.put(f"{root}/{saved['id']}", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['config']['definitionRevision'] == 2
    assert alice.put(f"{root}/{saved['id']}", json=payload).status_code == 422
    assert alice.put('/api/v1/simulation/portfolios/1', json=payload).status_code == 403


def test_edit_during_model_response_cannot_commit_old_decision(workspace):
    agent, service, saved, calls = setup_agent(workspace)
    item = service.create_validation(saved['id'], OPTIONS)
    completion = agent.adapter.call_text

    def edit_before_return(*args, **kwargs):
        service.control(item['id'], 'pause')
        service.update_definition(saved['id'], update_payload(saved))
        return completion(*args, **kwargs)

    with patch.object(agent.adapter, 'call_text', side_effect=edit_before_return), \
            patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    assert len(calls) == 1
    assert service.detail(item['id'])['days'] == []
    assert service.detail(item['id'])['status'] == 'stopped'
