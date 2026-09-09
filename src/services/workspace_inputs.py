"""Read-only, user-scoped inputs and history. Frozen sources never imply execution."""
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, select
from src.storage import WorkspaceRunRecord as Run, WorkspaceArtifactRecord as Artifact


def stock_code(value):
    from src.services.portfolio_research_service import research_symbol
    return research_symbol(str(value).strip())


def history(workspace, *, kind=None, status=None, query=None, stock=None, market=None,
            start=None, end=None, offset=0, limit=30):
    from src.services.workspace_service import WorkspaceError
    filters = []
    if kind:
        filters.append(Run.task_kind == kind)
    if status:
        filters.append(Run.status == status)
    if market:
        filters.append(func.json_extract(Run.task_snapshot_json, '$.market') == market.upper())
    if query:
        filters.append(or_(Run.id == query, *[
            func.json_extract(Run.task_snapshot_json, path).contains(query, autoescape=True)
            for path in ('$.name', '$.objective')]))
    try:
        if start:
            filters.append(Run.created_at >= datetime.combine(date.fromisoformat(start), datetime.min.time()))
        if end:
            filters.append(Run.created_at < datetime.combine(date.fromisoformat(end) + timedelta(days=1), datetime.min.time()))
        if start and end and start > end:
            raise ValueError()
    except ValueError as exc:
        raise WorkspaceError('invalid_dates', '请选择有效的日期范围（UTC）。', 422) from exc
    if stock:
        code = stock_code(stock)
        aliases = {code, str(stock).strip().upper()}
        if code.isdigit() and len(code) == 6:
            aliases.update(prefix + code for prefix in ('SH', 'SZ', 'BJ'))
            aliases.update(code + '.' + suffix for suffix in ('SH', 'SZ', 'BJ'))
        if code.startswith('HK') and code[2:].isdigit():
            aliases.update({code[2:], code[2:] + '.HK'})
        # Only structured identities; never infer a ticker from generated prose.
        expressions = [func.upper(func.json_extract(Run.task_snapshot_json, path)).in_(aliases)
                       for path in ('$.subject.stock', '$.subject.stockCode', '$.subject.symbol')]
        expressions.append(select(Artifact.id).where(
            Artifact.run_id == Run.id, Artifact.artifact_type == 'CandidateResearch',
            func.upper(func.json_extract(Artifact.content_json, '$.symbol')).in_(aliases)).exists())
        filters.append(or_(*expressions))
    with workspace.db.get_session() as session:
        total = session.scalar(select(func.count()).select_from(Run).where(*filters))
        counts = dict(session.execute(select(Run.status, func.count()).where(*filters).group_by(Run.status)).all())
        rows = session.scalars(select(Run).where(*filters).order_by(Run.created_at.desc(), Run.id.desc())
                               .offset(offset).limit(limit)).all()
        ids = [r.id for r in rows]
        artifacts = session.scalars(select(Artifact).where(Artifact.run_id.in_(ids))).all() if ids else []
        grouped = {}
        for artifact in artifacts:
            grouped.setdefault(artifact.run_id, []).append(artifact)
        items = [workspace._run_item(row, None, grouped.get(row.id, [])) for row in rows]
        from src.services.workspace_report_history import annotate_report_history
        annotate_report_history(items)
        for item in items:
            item['artifacts'] = []
    return dict(items=items, total=total, statusCounts=counts, offset=offset, limit=limit)


def freeze_trading_inputs(workspace, task):
    from src.services.workspace_service import WorkspaceError
    from src.core.trading_calendar import get_market_for_stock
    from src.services.member_service import current_member
    from src.storage import WorkspaceCapabilityPreferenceRecord
    from src.config import get_config
    subject = task.get('subject') or {}
    market = task['market'].upper()
    mode = subject.get('universeMode', 'watchlist')
    source_id, as_of = None, None
    if subject.get('stock'):
        codes, mode = [subject['stock']], 'stock'
    elif mode == 'screening':
        source_id = subject.get('sourceRunId')
        if not source_id:
            raise WorkspaceError('screening_source_required', '请先选择一份已完成的选股结果。', 422)
        source = workspace.get_run(source_id)
        if source['kind'] != 'screening' or source['status'] != 'completed' or source['taskSnapshot'].get('market') != market:
            raise WorkspaceError('screening_source_invalid', '候选来源必须是同市场已完成的选股运行。', 422)
        codes = []
        for artifact in source['artifacts']:
            if artifact['type'] == 'CandidateList':
                content = artifact['content']
                result = content.get('result', content)
                if isinstance(result, dict):
                    codes.extend(row.get('symbol') or row.get('code') for row in result.get('candidates', []) if isinstance(row, dict))
        as_of = (source.get('dataSnapshot') or {}).get('asOf') or source['createdAt']
    elif mode == 'watchlist':
        if current_member():
            with workspace.db.get_session() as session:
                codes = list(session.scalars(select(WorkspaceCapabilityPreferenceRecord.capability_id).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == 'watchlist',
                    WorkspaceCapabilityPreferenceRecord.enabled.is_(True))))
        else:
            codes = get_config().stock_list
    elif mode == 'portfolio':
        from src.services.portfolio_research_service import PortfolioResearchService
        snapshot = PortfolioResearchService(workspace).portfolio.get_portfolio_snapshot(include_realtime=False)
        codes = [p['symbol'] for a in snapshot.get('accounts', []) for p in a.get('positions', []) if p.get('quantity', 0) > 0]
        as_of = snapshot.get('as_of')
    else:
        raise WorkspaceError('universe_invalid', '候选来源不受支持。', 422)
    symbols = list(dict.fromkeys(stock_code(c) for c in codes if c and (get_market_for_stock(str(c)) or "").upper() == market))
    if not symbols:
        raise WorkspaceError('universe_empty', '该来源没有当前市场的股票，请先选股、添加自选股或录入持仓。', 422)
    return dict(mode=mode, sourceRunId=source_id, symbols=symbols, market=market, asOf=as_of,
                executionEnabled=False, note='冻结的研究范围；来源日期不代表最新行情，不产生订单或模拟成交。')


def run_usage(db, run_id):
    from src.services.member_service import current_member, control_plane
    from src.storage import LLMUsage, OwnerCallAttributionRecord as Owner, TrialCallRecord as Call, UserCallDetailRecord as Detail
    member = current_member()
    database = member['service'].db if member else db
    with control_plane(), database.get_session() as session:
        if member:
            rows = session.execute(select(Call.charged, Call.estimated).join(Detail, Detail.call_id == Call.id)
                                   .where(Detail.request_id == run_id, Call.user_id == member['id'])).all()
        else:
            rows = [(value, False) for value in session.scalars(select(LLMUsage.total_tokens).join(Owner, Owner.usage_id == LLMUsage.id)
                                                               .where(Owner.request_id == run_id))]
    return dict(calls=len(rows), tokens=sum(r[0] for r in rows), estimatedTokens=sum(r[0] for r in rows if r[1]),
                recorded=bool(rows), scope='direct_run', note='仅统计归属于本次运行的调用；无记录不等于零消耗。')
