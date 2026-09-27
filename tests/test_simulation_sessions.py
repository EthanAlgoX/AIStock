"""Exercise lifecycle changes with real SQLite transactions, not mocked storage."""
import json
from datetime import date
from unittest.mock import patch
from sqlalchemy import select
from src.repositories import simulation_session_repo as sessions
from src.repositories.simulation_audit_repo import records
from src.storage import SimulationPortfolioRunRecord, SimulationSessionEvidenceRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_trading_agent import setup_agent
from tests.test_portfolio_lifecycle import OPTIONS
from tests.test_simulation_portfolios import run_sync


def test_stop_restart_new_period_pause_and_redundant_start_keep_period(workspace):
    _, service, saved, _ = setup_agent(workspace)
    item = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    with patch.object(service, 'enqueue'):
        first = service.control(item['id'], 'start')
        period = first['executionSessions'][0]
        assert period['startedAt'] is not None
        service.control(item['id'], 'pause')
        assert service.control(item['id'], 'start')['executionSessions'] == first['executionSessions']
        assert len(service.control(item['id'], 'start')['executionSessions']) == 1
        service.control(item['id'], 'stop')
        stopped = service.detail(item['id'])['executionSessions'][0]
        assert stopped['endReason'] == 'stopped' and stopped['endedAt'] is not None
        again = service.control(item['id'], 'start')
    assert len(again['executionSessions']) == 2
    assert again['executionSessions'][1]['previousId'] == period['id']
    assert again['executionSessions'][1]['startState']['cash'] == 100000
    assert again['marketVersion'] == first['marketVersion']
    assert again['id'] == first['id']  # Account is continuous; period is new.
    assert records(service.db, item['id'], 'sessions', limit=1)['nextCursor'] is not None


def test_daily_run_model_calls_orders_and_batch_share_period(workspace):
    _, service, saved, _ = setup_agent(workspace)
    item = service.create_validation(saved['id'], OPTIONS)
    with patch.object(service, '_last_closed', return_value=date(2025, 2, 14)):
        run_sync(service, item['id'])
    result = service.detail(item['id'])
    period = result['executionSessions'][0]
    assert period['endReason'] == 'completed'
    assert all(d['executionSessionId'] == period['id'] for d in result['days'])
    assert all(d['timeContract']['executionAt'] is None for d in result['days'])
    assert all(d['timeContract']['executionPrecision'] == 'trading_day' for d in result['days'])
    evidence = records(service.db, item['id'], 'executions', limit=100)['items']
    assert {'batch', 'day', 'model_call', 'order'} <= {e['kind'] for e in evidence}
    assert {e['session_id'] for e in evidence} == {period['id']}
    for e in evidence:
        if e['kind'] == 'order':
            payload = json.loads(e['payload_json'])
            assert payload['decisionReason']
            assert payload['rejectionReason'] is None


def test_market_revision_reuse_and_unknown_legacy_start(workspace):
    _, service, saved, _ = setup_agent(workspace)
    a = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    b = service.create_validation(saved['id'], dict(mode='paper', initialCash=200000))
    assert a['marketVersion'] == b['marketVersion']
    with service.db.session_scope() as db:
        row = db.get(SimulationPortfolioRunRecord, a['id'])
        period = sessions.ensure(db, row)
        assert period.started_at is None and period.start_kind == 'adopted_unknown_start'
        ident = period.id
    with service.db.session_scope() as db:
        assert sessions.ensure(db, db.get(SimulationPortfolioRunRecord, a['id'])).id == ident
    assert len(service.detail(a['id'])['executionSessions']) == 1
    service.delete_portfolio(a['id'])
    assert records(service.db, a['id'], 'sessions')['items'][0]['end_reason'] == 'deleted'


def test_market_versions_have_separate_sequences_and_frozen_snapshots(workspace):
    _, service, saved, _ = setup_agent(workspace)
    first = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    second = service.create_validation(saved['id'], dict(mode='paper', initialCash=100000))
    from src.storage import SimulationPortfolioLineageRecord, SimulationMarketVersionRecord
    # Exercise registry behavior with an explicit changed market/revision snapshot.
    with service.db.session_scope() as db:
        db.delete(db.get(SimulationPortfolioLineageRecord, second['id']))
        db.flush()
        row = db.get(SimulationPortfolioRunRecord, second['id'])
        cfg = json.loads(row.config_json)
        cfg['market'] = 'CN'
        row.config_json = json.dumps(cfg)
        cn = sessions.lineage(db, row)
        assert cn.version == 1 and cn.market == 'CN'
        original = db.get(SimulationMarketVersionRecord, first['marketVersion']['id'])
        assert original.market == 'US' and json.loads(original.config_json)['market'] == 'US'
