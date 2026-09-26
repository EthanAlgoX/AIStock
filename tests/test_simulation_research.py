"""Frozen-sample research exercises the production ledger and scoped persistence."""
import json
from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import select
from src.services.simulation_research_service import SimulationResearchService, replay, verdict
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.trading_agent_service import TradingAgentService
from src.storage import SimulationRunRecord, SimulationPortfolioResearchRecord
from api.v1.endpoints.simulation_portfolios import StrategyConfig, ResearchCreate
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_simulation_portfolios import run_sync
from tests.test_crypto_integrated_portfolio import spot_fetcher


@pytest.fixture(params=['crypto_rotation', 'crypto_equal_weight', 'crypto_btc_hold'])
def completed(workspace, request):
    agent = TradingAgentService(workspace.db)
    with patch('data_provider.crypto_fetcher.realtime_quote'):
        preview = agent.preview('CRYPTO', dict(mode='fixed', symbols=['BTCUSDT'], query='', maxCandidates=12))
    payload = StrategyConfig(name='Research fixture', market='CRYPTO', decisionBackend='rules',
        skillId=request.param, universePreviewId=preview['id'], lotSize=1e-8, maxWeight=.8).model_dump()
    service = SimulationPortfolioService(workspace.db, spot_fetcher(), agent)
    saved = service.save_definition(payload)
    run = service.create_validation(saved['id'], dict(mode='backtest', initialCash=10000,
        startDate='2025-01-01', endDate='2025-04-30', historyMode='rules', universeHistory='frozen'))
    with patch.object(service, '_last_closed', return_value=date(2025, 4, 30)), patch.object(agent, 'call', side_effect=AssertionError('No models')):
        for _ in range(6):
            run_sync(service, run['id'])
    assert service.detail(run['id'])['status'] == 'completed'
    return service, run['id']


def test_replay_matches_real_ledger_and_research_is_persistent(completed):
    service, source_id = completed
    detail = service.detail(source_id)
    with service.db.get_session() as session:
        snapshots = [json.loads(row.input_snapshot_json) for row in session.scalars(select(SimulationRunRecord).where(
            SimulationRunRecord.strategy_version_id == detail['versionId']).order_by(SimulationRunRecord.id))]
    reproduced = replay(detail['config'], snapshots)
    assert reproduced['cumulativeReturn'] == pytest.approx(detail['metrics']['cumulativeReturn'])
    assert reproduced['filledOrders'] == detail['evaluation']['filledOrders']
    research = SimulationResearchService(service.db)
    with patch('data_provider.DataFetcherManager', side_effect=AssertionError('Frozen data only')):
        result = research.create(source_id)
    assert result['windows']['train']['samples'] == 72
    assert result['windows']['validation']['end'] < result['windows']['final']['start']
    assert research.create(source_id)['id'] == result['id']
    assert research.list(source_id)[0]['sampleHash'] == detail['evaluation']['sampleHash']
    assert service.detail(source_id)['metrics'] == detail['metrics']
    assert len(service.definitions()) == 1


def test_adoption_clones_without_touching_original_and_is_idempotent(completed):
    service, source_id = completed
    research = SimulationResearchService(service.db)
    result = research.create(source_id)
    with service.db.session_scope() as session:
        row = session.get(SimulationPortfolioResearchRecord, result['id'])
        data = json.loads(row.result_json)
        data.update(accepted=True, candidateConfig=dict(service.detail(source_id)['config'], cryptoAllocation=.3))
        row.result_json = json.dumps(data)
    adopted = research.adopt(result['id'])
    assert research.adopt(result['id']) == adopted
    definitions = service.definitions()
    assert len(definitions) == 2
    candidate = next(d for d in definitions if d['id'] == adopted['id'])
    assert candidate['config']['cryptoAllocation'] == .3
    assert 'mode' not in candidate['config']
    assert service.detail(source_id)['config']['cryptoAllocation'] == .5


def test_rejects_unfinished_and_nonfinite_limits(completed):
    service, source_id = completed
    service.control(source_id, 'stop')
    with pytest.raises(ValueError, match='completed'):
        SimulationResearchService(service.db).create(source_id)
    with pytest.raises(ValueError):
        ResearchCreate(maxDrawdown=float('nan'))


def test_sharpe_selection_and_drawdown_gate():
    baseline = dict(sharpe=1, filledOrders=1, maxDrawdown=.1)
    assert verdict(dict(baseline, sharpe=2, maxDrawdown=.3), baseline, .2) == 'drawdown_limit'
    assert verdict(dict(baseline, sharpe=1.04), baseline, .2) == 'no_improvement'
    assert verdict(dict(baseline, sharpe=1.1), baseline, .2) == 'passed'
    assert verdict(dict(baseline, sharpe=None), baseline, .2) == 'invalid_score'
