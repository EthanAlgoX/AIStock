"""Workspace-scoped simulation evidence, including partial and failed attempts."""
import json
from dataclasses import asdict, is_dataclass

from sqlalchemy import select
from src.storage import (SimulationAuditEventRecord, SimulationTradingCallRecord,
                         SimulationTradingCallEvidenceRecord, SimulationPortfolioRunRecord,
                         SimulationRunRecord, SimulationPortfolioResearchRecord, utc_naive_now,
                         SimulationExecutionSessionRecord, SimulationSessionEvidenceRecord)


def json_evidence(value):
    """Keep provider content without transport credentials or opaque object reprs."""
    if hasattr(value, 'model_dump'):
        value = value.model_dump()
    elif is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        return {str(k): '[redacted]' if str(k).lower() in {
            'authorization', 'api_key', 'apikey', 'access_token', 'refresh_token',
            'headers', '_hidden_params', 'api_base',
        } else json_evidence(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_evidence(v) for v in value]
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    return {'unserializedType': type(value).__name__}


def event(session, portfolio_id, action, payload, *, request_id=None, version_id=None, object_type='portfolio'):
    session.add(SimulationAuditEventRecord(action=action, object_type=object_type, object_id=portfolio_id,
                strategy_version_id=version_id, request_id=request_id,
                after_summary_json=json.dumps(payload, ensure_ascii=False, default=str)))


def complete_call(session, call_id, response):
    row = session.get(SimulationTradingCallEvidenceRecord, call_id)
    if row is None:
        raise LookupError('Model call evidence was not started')
    row.response_json = json.dumps(json_evidence(response), ensure_ascii=False)
    row.completed_at = utc_naive_now()


def records(db, portfolio_id, kind, before=None, limit=50):
    if kind not in {'calls', 'events', 'days', 'research', 'sessions', 'executions'} or not 1 <= limit <= 100:
        raise ValueError('Invalid simulation record page')
    with db.get_session() as session:
        portfolio = session.get(SimulationPortfolioRunRecord, portfolio_id)
        if portfolio is None:
            raise LookupError('Portfolio not found')
        definition_id = json.loads(portfolio.config_json).get('definitionId')
        event_condition = ((SimulationAuditEventRecord.object_type == 'portfolio') &
                           (SimulationAuditEventRecord.object_id == portfolio_id))
        if definition_id is not None:
            event_condition |= ((SimulationAuditEventRecord.object_type == 'definition') &
                                (SimulationAuditEventRecord.object_id == definition_id))
        period_ids = select(SimulationExecutionSessionRecord.id).where(
            SimulationExecutionSessionRecord.portfolio_id == portfolio_id)
        model, condition = {
            'sessions': (SimulationExecutionSessionRecord, SimulationExecutionSessionRecord.portfolio_id == portfolio_id),
            'executions': (SimulationSessionEvidenceRecord, SimulationSessionEvidenceRecord.session_id.in_(period_ids)),
            'calls': (SimulationTradingCallRecord, SimulationTradingCallRecord.portfolio_id == portfolio_id),
            'events': (SimulationAuditEventRecord, event_condition),
            'days': (SimulationRunRecord, (SimulationRunRecord.strategy_version_id == portfolio.strategy_version_id) &
                     (SimulationRunRecord.execution_mode == 'portfolio_day')),
            'research': (SimulationPortfolioResearchRecord, SimulationPortfolioResearchRecord.source_id == portfolio_id),
        }[kind]
        query = select(model).where(condition)
        if before is not None:
            query = query.where(model.id < before)
        rows = session.scalars(query.order_by(model.id.desc()).limit(limit + 1)).all()
        items = []
        for row in rows[:limit]:
            item = {column.name: getattr(row, column.name) for column in model.__table__.columns}
            if kind == 'calls':
                extra = session.get(SimulationTradingCallEvidenceRecord, row.id)
                item['evidence'] = None if extra is None else dict(request=json.loads(extra.request_json),
                    response=json.loads(extra.response_json) if extra.response_json else None,
                    completedAt=extra.completed_at)
            items.append(item)
        return dict(items=items, nextCursor=items[-1]['id'] if len(rows) > limit else None)
