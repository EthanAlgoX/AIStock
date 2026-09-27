"""SQLite lifecycle identities; never infer a historical start from a trading date."""
import json
from contextvars import ContextVar
from datetime import timezone
from sqlalchemy import select, func, update
from src.storage import (SimulationMarketVersionRecord as MarketVersion,
    SimulationPortfolioLineageRecord as Lineage, SimulationExecutionSessionRecord as Period,
    SimulationSessionEvidenceRecord as Evidence, SimulationPortfolioRunRecord,
    utc_naive_now)

current_execution_session = ContextVar('simulation_execution_session', default=None)


def lineage(session, portfolio):
    existing = session.get(Lineage, portfolio.id)
    if existing:
        return session.get(MarketVersion, existing.market_version_id)
    config = json.loads(portfolio.config_json)
    key = ('definition:' + str(config['definitionId']) if config.get('definitionId') is not None
           else 'portfolio:' + str(portfolio.id))
    revision = config.get('definitionRevision', 1)
    predicate = (MarketVersion.definition_key == key) & (MarketVersion.market == config['market'])
    version = session.scalar(select(MarketVersion).where(predicate, MarketVersion.source_revision == revision))
    if version is None:
        number = (session.scalar(select(func.max(MarketVersion.version)).where(predicate)) or 0) + 1
        # Runtime settings belong to the run snapshot, not the reusable version.
        snapshot = {k: v for k, v in config.items() if k not in {
            'initialCash', 'mode', 'startDate', 'endDate', 'historyMode', 'universeHistory', 'definitionId',
        }}
        version = MarketVersion(definition_key=key, market=config['market'], version=number,
                                source_revision=revision, config_json=json.dumps(snapshot))
        session.add(version)
        session.flush()
    session.add(Lineage(portfolio_id=portfolio.id, market_version_id=version.id))
    session.flush()
    return version


def ensure(session, portfolio, *, explicit=False):
    # Serialize callers before reading the active period, including scheduler starts.
    session.execute(update(SimulationPortfolioRunRecord).where(
        SimulationPortfolioRunRecord.id == portfolio.id).values(id=portfolio.id))
    latest = session.scalar(select(Period).where(Period.portfolio_id == portfolio.id)
                            .order_by(Period.sequence.desc()).limit(1))
    if latest is not None and latest.status == 'open':
        return latest
    version = lineage(session, portfolio)
    adopted = latest is None and not explicit
    row = Period(portfolio_id=portfolio.id, market_version_id=version.id,
        strategy_version_id=portfolio.strategy_version_id,
        sequence=latest.sequence + 1 if latest else 1, previous_id=latest.id if latest else None,
        started_at=None if adopted else utc_naive_now(),
        start_kind='adopted_unknown_start' if adopted else 'manual_start',
        start_state_json=portfolio.state_json, config_json=portfolio.config_json)
    session.add(row)
    session.flush()
    return row


def close(session, portfolio, reason):
    row = session.scalar(select(Period).where(Period.portfolio_id == portfolio.id, Period.status == 'open'))
    if row:
        row.status, row.ended_at, row.end_reason = 'closed', utc_naive_now(), reason
        row.end_state_json = portfolio.state_json


def link(session, period_id, kind, record_id, payload=None):
    session.add(Evidence(session_id=period_id, kind=kind, record_id=str(record_id),
                         payload_json=json.dumps(payload or {}, ensure_ascii=False)))


def link_call(session, call_id):
    period_id = current_execution_session.get()
    if period_id is not None:
        link(session, period_id, 'model_call', call_id)


def describe(session, portfolio):
    def stamp(value):
        return value.replace(tzinfo=timezone.utc).isoformat() if value is not None else None

    binding = session.get(Lineage, portfolio.id)
    version = session.get(MarketVersion, binding.market_version_id) if binding else None
    periods = session.scalars(select(Period).where(Period.portfolio_id == portfolio.id)
                               .order_by(Period.sequence)).all()
    return dict(marketVersion=None if version is None else dict(id=version.id, market=version.market,
                version=version.version, definitionKey=version.definition_key, sourceRevision=version.source_revision),
                executionSessions=[dict(id=p.id, sequence=p.sequence, previousId=p.previous_id,
                    status=p.status, startedAt=stamp(p.started_at), observedAt=stamp(p.observed_at), endedAt=stamp(p.ended_at),
                    startKind=p.start_kind, endReason=p.end_reason,
                    startState=json.loads(p.start_state_json),
                    endState=json.loads(p.end_state_json) if p.end_state_json else None) for p in periods])
