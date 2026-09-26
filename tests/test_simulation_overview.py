"""Curve reduction must retain drawdowns and never invent observations."""
from datetime import date, timedelta
from unittest.mock import patch
import pytest
from src.services.simulation_overview import summarize
from src.storage import SimulationPortfolioRunRecord
from tests.test_simulation_research import completed  # noqa: F401
from tests.test_workspace_service import workspace  # noqa: F401


def account():
    return dict(id=1, name='Example', market='US', status='running', config={'initialCash':100})


def test_preserves_extremes_endpoints_and_full_history_drawdown():
    days=[dict(date=(date(2020,1,1)+timedelta(days=i)).isoformat(),equity=100+i/100) for i in range(2000)]
    days[543]['equity']=180
    days[544]['equity']=30
    row=summarize(account(),days)
    assert len(row['curve'])<=258
    assert row['curve'][0]['time']==days[0]['date']
    assert row['curve'][-1]['time']==days[-1]['date']
    assert any(p['value']==pytest.approx(-.7) for p in row['curve'])
    assert row['maxDrawdown']==pytest.approx(1-30/180)
    assert all(p['benchmark'] is None for p in row['curve'])


def test_empty_or_invalid_history_is_not_a_zero_return():
    for days in ([],[dict(date='2026-01-01',equity=float('nan'))]):
        row=summarize(account(),days)
        assert row['curve']==[]
        assert row['cumulativeReturn'] is None
        assert row['maxDrawdown'] is None


def test_overview_reads_completed_paper_ledger_without_backtest_or_detail_side_effects(completed):
    service,source_id=completed
    assert service.overview()==[]  # Completed historical runs cannot appear as live profits.
    source=service.detail(source_id)
    with service.db.get_session() as session:
        session.get(SimulationPortfolioRunRecord,source_id).mode='paper'
        session.commit()
    with patch.object(service,'detail',side_effect=AssertionError('No full detail fan-out')):
        overview=service.overview()
    assert len(overview)==1
    assert overview[0]['cumulativeReturn']==pytest.approx(source['metrics']['cumulativeReturn'])
    assert overview[0]['observations']==len(source['days'])
    assert overview[0]['timing']==source['timing']
    assert source['timing']['signalTimeframe']=='1d'
    assert source['timing']['execution']=='next_open'
    with service.db.get_session() as session:
        session.get(SimulationPortfolioRunRecord,source_id).status='deleted'
        session.commit()
    assert service.overview()==[]


def test_preserves_signal_and_valuation_contract_without_guessing_missing_timing():
    timing=dict(signalTimeframe='1h',valuation='live_quote',execution='quote_simulation',timezone='UTC',granularity='observation')
    assert summarize(dict(account(),timing=timing),[])['timing']==timing
    assert summarize(account(),[])['timing'] is None
