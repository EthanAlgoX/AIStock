"""Authenticated activity and call attribution, using the existing quota ledger."""
from contextlib import contextmanager
from contextvars import ContextVar
from collections import defaultdict
from datetime import date, datetime, time, timedelta
import logging
import uuid

from sqlalchemy import select, func, case, String

from src.storage import (UserActivityRecord, UserCallDetailRecord, TrialCallRecord,
                         TrialUserRecord, LLMUsage, OwnerCallAttributionRecord, DatabaseManager)

logger = logging.getLogger(__name__)
ACTIVITY = ContextVar('user_activity', default=None)
FEATURES = {'assistant', 'roundtable', 'research', 'screening', 'trading', 'holdings',
            'market', 'settings', 'history', 'alerts', 'schedules', 'workspace', 'other'}
PAGE_FEATURES = {'/overview': 'assistant', '/stock-research': 'research', '/screening': 'screening',
                 '/trading': 'trading', '/portfolio': 'holdings', '/portfolio/ledger': 'holdings',
                 '/market-intelligence': 'market', '/expert-review': 'roundtable',
                 '/settings': 'settings', '/usage': 'settings', '/runs': 'history',
                 '/alerts': 'alerts', '/schedules': 'schedules', '/runs/:runId': 'history',
                 '/capabilities': 'settings', '/capabilities/skills': 'settings',
                 '/capabilities/tools': 'settings', '/capabilities/mcp': 'settings',
                 '/capabilities/data': 'settings', '/capabilities/experts': 'settings'}


def feature_for_path(path):
    group = path.removeprefix('/api/v1/').split('/')[0]
    return {'agent': 'research' if '/research' in path else 'assistant', 'analysis': 'research',
            'screening': 'screening', 'simulation': 'trading', 'decision-signals': 'trading',
            'portfolio': 'holdings', 'intelligence': 'market', 'history': 'history',
            'alerts': 'alerts', 'workspace': 'workspace', 'auth': 'settings',
            'usage': 'settings'}.get(group, 'other')


@contextmanager
def activity_scope(feature, request_id=None):
    feature = {'expert_review': 'roundtable', 'market_analysis': 'market',
               'industry_analysis': 'research'}.get(feature, feature)
    previous = ACTIVITY.get() or {}
    token = ACTIVITY.set({'feature': feature if feature in FEATURES else 'other',
                          'request_id': request_id or previous.get('request_id') or uuid.uuid4().hex})
    try:
        yield ACTIVITY.get()
    finally:
        ACTIVITY.reset(token)


def record_activity(event, *, resource='', status='completed', content=None, duration_ms=None):
    """Best-effort diagnostics must not undo successful business writes.

    Failures are explicitly logged. Token attribution is instead transactional.
    """
    from src.services.member_service import current_member, control_plane
    member = current_member()
    from src import auth
    if not member and not auth.account_email():
        return
    database = member['service'].db if member else DatabaseManager.get_instance()
    user_id = member['id'] if member else 'owner'
    context = ACTIVITY.get() or {'feature': 'other', 'request_id': uuid.uuid4().hex}
    try:
        with control_plane(), database.session_scope() as session:
            session.add(UserActivityRecord(
                id=uuid.uuid4().hex, user_id=user_id, **context, event=event,
                resource=str(resource)[:300], status=str(status)[:40],
                content=content, duration_ms=duration_ms))
    except Exception:
        logger.exception('Activity persistence failed user=%s request=%s event=%s',
                         user_id, context['request_id'], event)


def record_message(session_id, role, content):
    # Only visible messages, never provider protocol, hidden reasoning or tool payloads.
    if role in {'user', 'assistant'}:
        record_activity('question' if role == 'user' else 'answer', resource=session_id, content=content)


def date_bounds(start, end):
    if end < start or (end - start).days > 365:
        raise ValueError('Choose at most 366 days')
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def analytics(db, start: date, end: date, user_id=None, feature=None):
    """Group in SQL so totals do not depend on a paginated detail list."""
    lo, hi = date_bounds(start, end)
    d, c = UserCallDetailRecord, TrialCallRecord
    feature_col = func.coalesce(d.feature, 'legacy_unknown')
    with db.get_session() as session:
        query = select(c.user_id, c.day_budget, feature_col,
                       func.count(), func.sum(c.charged),
                       func.sum(case((c.estimated.is_(False), c.charged), else_=0)),
                       func.sum(case((c.estimated.is_(True), c.charged), else_=0)),
                       func.sum(func.coalesce(d.prompt_tokens, 0)),
                       func.sum(func.coalesce(d.completion_tokens, 0))).outerjoin(d, d.call_id == c.id).where(
                           c.day_budget >= 'global:' + start.isoformat(),
                           c.day_budget <= 'global:' + end.isoformat())
        if user_id:
            query = query.where(c.user_id == user_id)
        if feature:
            query = query.where(feature_col == feature)
        rows = session.execute(query.group_by(c.user_id, c.day_budget, feature_col)).all()
        emails = dict(session.execute(select(TrialUserRecord.id, TrialUserRecord.email)).all())
        usage = [dict(userId=r[0], email=emails.get(r[0], r[0]), date=r[1].removeprefix('global:'),
                      feature=r[2], calls=r[3], charged=r[4], confirmed=r[5], estimated=r[6],
                      promptTokens=r[7], completionTokens=r[8]) for r in rows]
        from src import auth
        emails['owner'] = auth.account_email() or 'Administrator'
        if not user_id or user_id == 'owner':
            o, l = OwnerCallAttributionRecord, LLMUsage
            # New attribution dates are UTC. Legacy timestamps retain their original server convention.
            owner_date = func.date(func.coalesce(o.created_at, l.called_at))
            owner_feature = func.coalesce(o.feature, 'legacy_unknown')
            oq = select(owner_date, owner_feature, func.count(), func.sum(l.total_tokens),
                        func.sum(l.prompt_tokens), func.sum(l.completion_tokens)).outerjoin(
                            o, o.usage_id == l.id).where(owner_date >= start.isoformat(), owner_date <= end.isoformat())
            if feature:
                oq = oq.where(owner_feature == feature)
            for r in session.execute(oq.group_by(owner_date, owner_feature)):
                usage.append(dict(userId='owner', email=emails['owner'], date=r[0], feature=r[1],
                                  calls=r[2], charged=r[3], confirmed=r[3], estimated=0,
                                  promptTokens=r[4], completionTokens=r[5]))
        a = UserActivityRecord
        q = select(a.user_id, func.date(a.created_at), a.feature, a.event, a.resource,
                   func.count()).where(a.created_at >= lo, a.created_at < hi,
                                      a.event.in_(['page_view', 'operation', 'question']))
        if user_id:
            q = q.where(a.user_id == user_id)
        if feature:
            q = q.where(a.feature == feature)
        events = [dict(userId=r[0], date=r[1], feature=r[2], event=r[3], resource=r[4], count=r[5])
                  for r in session.execute(q.group_by(a.user_id, func.date(a.created_at),
                                                      a.feature, a.event, a.resource))]
    daily = defaultdict(lambda: {'charged': 0, 'confirmed': 0, 'estimated': 0, 'calls': 0})
    for row in usage:
        total = daily[(row['userId'], row['date'])]
        for key in total:
            total[key] += row[key]
    by_feature = defaultdict(lambda: {'charged': 0, 'confirmed': 0, 'estimated': 0, 'calls': 0})
    for row in usage:
        total = by_feature[(row['userId'], row['feature'])]
        for key in total:
            total[key] += row[key]
    return {'timezone': 'UTC', 'usage': usage,
            'featureTotals': [dict(userId=u, email=emails.get(u, u), feature=f, **v)
                              for (u, f), v in sorted(by_feature.items())], 'daily': [dict(userId=u, email=emails.get(u, u),
             date=day, **values) for (u, day), values in sorted(daily.items())], 'activity': events}


def activity_details(db, start, end, user_id=None, feature=None, request_id=None, offset=0):
    lo, hi = date_bounds(start, end)
    a = UserActivityRecord
    q = select(a).where(a.created_at >= lo, a.created_at < hi)
    if user_id:
        q = q.where(a.user_id == user_id)
    if feature:
        q = q.where(a.feature == feature)
    if request_id:
        q = q.where(a.request_id == request_id)
    with db.get_session() as session:
        count = session.scalar(select(func.count()).select_from(q.subquery()))
        rows = session.scalars(q.order_by(a.created_at.desc(), a.id).offset(offset).limit(50)).all()
        return {'total': count, 'items': [dict(id=r.id, userId=r.user_id, requestId=r.request_id,
                feature=r.feature, event=r.event, resource=r.resource, status=r.status,
                durationMs=r.duration_ms, content=r.content, createdAt=r.created_at.isoformat() + 'Z') for r in rows]}


def call_details(db, start, end, user_id=None, feature=None, request_id=None, offset=0):
    from sqlalchemy import literal, union_all
    date_bounds(start, end)
    c, d = TrialCallRecord, UserCallDetailRecord
    member = select(c.id.label('id'), c.user_id.label('userId'), c.day_budget.label('date'),
                    func.coalesce(d.request_id, c.run_id).label('requestId'),
                    func.coalesce(d.feature, 'legacy_unknown').label('feature'), d.model.label('model'),
                    c.charged.label('charged'), c.estimated.label('estimated'),
                    d.prompt_tokens.label('promptTokens'), d.completion_tokens.label('completionTokens'),
                    d.duration_ms.label('durationMs'), d.error_code.label('error'),
                    d.created_at.label('createdAt')).outerjoin(d, c.id == d.call_id).where(
                        c.day_budget >= 'global:' + start.isoformat(), c.day_budget <= 'global:' + end.isoformat())
    l, o = LLMUsage, OwnerCallAttributionRecord
    stamp = func.coalesce(o.created_at, l.called_at)
    owner = select(func.cast(l.id, String).label('id'), literal('owner'),
                   func.date(stamp), func.coalesce(o.request_id, 'legacy'),
                   func.coalesce(o.feature, 'legacy_unknown'), l.model, l.total_tokens, literal(False),
                   l.prompt_tokens, l.completion_tokens, literal(None), literal(None), stamp).outerjoin(
                       o, o.usage_id == l.id).where(func.date(stamp) >= start.isoformat(), func.date(stamp) <= end.isoformat())
    combined = union_all(member, owner).subquery()
    q = select(combined)
    for key, value in [('userId', user_id), ('feature', feature), ('requestId', request_id)]:
        if value:
            q = q.where(combined.c[key] == value)
    with db.get_session() as session:
        total = session.scalar(select(func.count()).select_from(q.subquery()))
        rows = session.execute(q.order_by(combined.c.date.desc(), combined.c.createdAt.desc(),
                                          combined.c.id).offset(offset).limit(50)).mappings()
        items = []
        for row in rows:
            item = dict(row)
            item['date'] = item['date'].removeprefix('global:')
            item['createdAt'] = item['createdAt'].isoformat() + 'Z' if item['createdAt'] else None
            items.append(item)
        return {'total': total, 'items': items}
