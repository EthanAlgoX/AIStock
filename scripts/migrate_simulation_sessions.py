"""Add execution identities to an existing SQLite database while its writers are stopped.

Back up first. Never assign old transactions to guessed periods or reset capital.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine, select, update  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from src.storage import (Base, SimulationPortfolioRunRecord,  # noqa: E402
    SimulationMarketVersionRecord, SimulationPortfolioLineageRecord,
    SimulationExecutionSessionRecord, SimulationSessionEvidenceRecord, SimulationAuditEventRecord)
from src.repositories import simulation_session_repo as periods  # noqa: E402


def migrate(database):
    path = Path(database).resolve(strict=True)
    engine = create_engine('sqlite:///' + str(path))
    try:
        Base.metadata.create_all(engine, tables=[c.__table__ for c in (
            SimulationMarketVersionRecord, SimulationPortfolioLineageRecord,
            SimulationExecutionSessionRecord, SimulationSessionEvidenceRecord, SimulationAuditEventRecord)])
        with Session(engine) as session, session.begin():
            session.execute(update(SimulationPortfolioRunRecord).values(id=SimulationPortfolioRunRecord.id))
            rows = session.scalars(select(SimulationPortfolioRunRecord).order_by(SimulationPortfolioRunRecord.id)).all()
            active = 0
            for row in rows:
                periods.lineage(session, row)
                if row.mode == 'paper' and row.status in {'running', 'paused'}:
                    periods.ensure(session, row)
                    active += 1
            result = dict(accounts=len(rows), activeAccounts=active, historicalTradesReassigned=0)
            session.add(SimulationAuditEventRecord(action='execution_periods.migrated',
                object_type='migration', object_id=0, after_summary_json=json.dumps(result)))
            return result
    finally:
        engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    print(json.dumps(migrate(parser.parse_args().database)))
