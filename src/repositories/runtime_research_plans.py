"""Owner database persistence and claims for source rules research plans."""
import json
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import exists, or_, select, update

from src.storage import RuntimeResearchOperationRecord as Operation
from src.storage import RuntimeResearchPlanRecord as Plan
from src.workspace_scope import current_workspace_database

UNRESOLVED = ('RESERVED', 'PENDING', 'RUNNING', 'UNKNOWN')
CLAIM_SECONDS = 300


def _snapshot(row):
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


class RuntimeResearchPlanRepository:
    def __init__(self, database):
        self.db = database
        self.guard_owner()

    def guard_owner(self):
        if current_workspace_database() is not None or getattr(self.db, '_workspace_id', None):
            raise HTTPException(403, 'Source research plans are available only to the owner')

    def create(self, payload, source_fingerprint, capability_fingerprint, now):
        self.guard_owner()
        with self.db.session_scope() as session:
            row = Plan(
                request_namespace=str(uuid.uuid4()),
                source_strategy_id=payload['sourceStrategyId'], source_version_id=payload['sourceVersionId'],
                source_backtest_id=payload['sourceBacktestId'], source_fingerprint=source_fingerprint,
                capability_fingerprint=capability_fingerprint, interval_seconds=payload['intervalSeconds'],
                budget=payload['budget'], max_runs=payload['maxRuns'], runs_reserved=0, status='active',
                next_run_at=now + timedelta(seconds=payload['intervalSeconds']), created_at=now, updated_at=now,
            )
            session.add(row)
            session.flush()
            return row.id

    def get(self, plan_id):
        self.guard_owner()
        with self.db.session_scope() as session:
            row = session.get(Plan, plan_id)
            if row is None:
                raise HTTPException(404, 'Source research plan not found')
            result = _snapshot(row)
            result['operations'] = [_snapshot(op) for op in session.execute(
                select(Operation).where(Operation.plan_id == plan_id).order_by(Operation.ordinal)
            ).scalars()]
            return result

    def list(self):
        self.guard_owner()
        with self.db.session_scope() as session:
            ids = session.execute(select(Plan.id).order_by(Plan.id.desc())).scalars().all()
        return [self.get(plan_id) for plan_id in ids]

    def control(self, plan_id, action, now):
        self.guard_owner()
        with self.db.session_scope() as session:
            row = session.get(Plan, plan_id)
            if row is None:
                raise HTTPException(404, 'Source research plan not found')
            if row.status in ('completed', 'failed'):
                raise HTTPException(409, 'A finished source research plan cannot be resumed or paused')
            if action == 'pause':
                row.status = 'paused'
            elif action == 'resume':
                row.status, row.last_error = 'active', None
                # Resume keeps both the reservation and its original request ID.
                # A future interval is retained; an overdue one is eligible now.
            else:
                raise HTTPException(422, 'Unsupported source research plan action')
            row.updated_at = now

    def claim_due(self, now, limit=1):
        """Claim active due plans, plus unresolved receipts on paused plans."""
        self.guard_owner()
        outstanding = exists().where(Operation.plan_id == Plan.id, Operation.status.in_(UNRESOLVED))
        lease_free = or_(Plan.claim_token.is_(None), Plan.claimed_at < now - timedelta(seconds=CLAIM_SECONDS))
        eligible = or_(
            (Plan.status == 'active') & (Plan.next_run_at <= now),
            Plan.status.in_(('active', 'paused')) & outstanding,
        )
        with self.db.session_scope() as session:
            ids = session.execute(select(Plan.id).where(eligible, lease_free).order_by(
                Plan.last_checked_at.asc().nullsfirst(), Plan.id,
            ).limit(limit)).scalars().all()
        claimed = []
        for plan_id in ids:
            token = str(uuid.uuid4())
            with self.db.session_scope() as session:
                changed = session.execute(update(Plan).where(
                    Plan.id == plan_id, eligible, lease_free,
                ).values(claim_token=token, claimed_at=now, last_checked_at=now)).rowcount
            if changed:
                claimed.append((plan_id, token))
        return claimed

    def owns(self, plan_id, token, active=False):
        self.guard_owner()
        with self.db.session_scope() as session:
            query = select(Plan.id).where(Plan.id == plan_id, Plan.claim_token == token)
            if active:
                query = query.where(Plan.status == 'active')
            return session.execute(query).scalar_one_or_none() is not None

    def reserve(self, plan_id, token, now):
        """CAS the ordinal and commit its deterministic UUID before HTTP."""
        self.guard_owner()
        outstanding = exists().where(Operation.plan_id == Plan.id, Operation.status.in_(UNRESOLVED))
        with self.db.session_scope() as session:
            changed = session.execute(update(Plan).where(
                Plan.id == plan_id, Plan.claim_token == token, Plan.status == 'active',
                Plan.runs_reserved < Plan.max_runs, ~outstanding,
            ).values(runs_reserved=Plan.runs_reserved + 1,
                     last_error=None, updated_at=now), execution_options={'synchronize_session': False}).rowcount
            if not changed:
                return None
            row = session.get(Plan, plan_id)
            row.next_run_at = now + timedelta(seconds=row.interval_seconds)
            request_id = str(uuid.uuid5(uuid.UUID(row.request_namespace), f'research:{row.runs_reserved}'))
            operation = Operation(plan_id=plan_id, ordinal=row.runs_reserved, request_id=request_id,
                                  status='RESERVED', created_at=now, updated_at=now)
            session.add(operation)
            session.flush()
            return _snapshot(operation)

    def receive(self, plan_id, token, operation_id, receipt, now):
        self.guard_owner()
        with self.db.session_scope() as session:
            row = session.execute(select(Plan).where(Plan.id == plan_id, Plan.claim_token == token)).scalar_one_or_none()
            if row is None:
                return
            operation = session.get(Operation, operation_id)
            if operation is None or operation.plan_id != plan_id:
                return
            operation.status = receipt['status']
            operation.receipt_json = json.dumps(receipt, ensure_ascii=False, allow_nan=False)
            operation.updated_at = now
            if receipt['status'] == 'UNKNOWN':
                row.status = 'paused'
                row.last_error = 'Source request outcome is unknown; inspect the source runtime before resuming'
            elif receipt['status'] in ('FAILED', 'CANCELLED'):
                row.status = 'failed'
                row.last_error = receipt.get('error') or 'Source rules research did not complete'
            elif receipt['status'] == 'SUCCEEDED' and row.runs_reserved >= row.max_runs:
                row.status = 'completed'
                row.last_error = None
            elif row.status == 'active':
                row.last_error = None
            row.updated_at = now

    def note_error(self, plan_id, token, message, now, pause=False):
        self.guard_owner()
        values = dict(last_error=message, updated_at=now)
        if pause:
            values['status'] = 'paused'
        with self.db.session_scope() as session:
            session.execute(update(Plan).where(Plan.id == plan_id, Plan.claim_token == token).values(**values))

    def release(self, plan_id, token):
        self.guard_owner()
        with self.db.session_scope() as session:
            session.execute(update(Plan).where(Plan.id == plan_id, Plan.claim_token == token).values(
                claim_token=None, claimed_at=None,
            ))
