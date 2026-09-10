"""Evidence-bound trading decisions and approved, reproducible stock universes."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from contextlib import nullcontext

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from src.storage import DatabaseManager, SimulationUniverseSnapshotRecord, SimulationTradingCallRecord, persist_llm_usage

TRADING_PROMPT = """你是模拟交易决策 Agent。依据本次冻结的 Skill、截止决策日的行情和账户状态，
逐股判断买入、持有、减仓或退出，输出目标仓位和简明依据。可以不交易。
不得虚构消息、价格、持仓或成交；缺少 Skill 所需证据时说明缺口并保持现有仓位。
目标仓位必须满足账户的资金、单股比例与持仓数量约束。你只提出计划，成交由程序在后续开盘模拟。
历史回放只可引用输入中截至当日的数据；不得引用后来发生的事件。"""


class RangeRule(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    industryTerms: list[str] = Field(default_factory=list, max_length=12)
    minVolatility: float | None = Field(default=None, ge=0, le=100)
    description: str = Field(min_length=1, max_length=1000)


class StockDecision(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    code: str
    targetWeight: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=2000)


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    opinions: list[StockDecision] = Field(min_length=1, max_length=36)


class TradingAgentService:
    def __init__(self, db=None, adapter=None, screener=None):
        self.db = db or DatabaseManager.get_instance()
        self.adapter = adapter
        self.screener = screener

    def call(self, system, payload, budget, resource='trading_agent', portfolio_id=None):
        from src.agent.llm_adapter import LLMToolAdapter
        from src.services.user_activity_service import activity_scope
        messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}]
        # Conservative byte reservation also bounds contexts for private-workspace calls.
        reservation = len(json.dumps(messages, ensure_ascii=False).encode()) + 4096
        if reservation > budget:
            raise ValueError('本次 Agent Token 预算不足以容纳输入与回答，请提高预算或缩小股票范围。')
        with self.db.session_scope() as session:
            record = SimulationTradingCallRecord(portfolio_id=portfolio_id, resource=resource, input_json=json.dumps(messages, ensure_ascii=False))
            session.add(record)
            session.flush()
            call_id = record.id
        response = None
        try:
            with activity_scope('trading', resource):
                response = (self.adapter or LLMToolAdapter()).call_text(messages, temperature=0, max_tokens=2048, timeout=45)
                usage = getattr(response, 'usage', None) or {}
                if usage:
                    persist_llm_usage(usage, response.model or response.provider, call_type=resource, usage_scope='trading')
            if response.provider == 'error':
                raise ValueError('交易 Agent 调用失败：' + str(response.content)[:300])
            tokens = usage.get('total_tokens')
            if type(tokens) is not int or tokens <= 0:
                raise ValueError('模型未返回可核验 Token 用量，本次不生成交易计划。')
            if tokens > budget:
                raise ValueError('模型实际消耗超过本次预算，本次不生成交易计划。')
            raw = str(response.content).strip()
            if raw.startswith('```'):
                raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            parsed = json.loads(raw)
            return parsed, dict(model=response.model or response.provider, tokens=tokens, callId=call_id)
        except Exception as exc:
            with self.db.session_scope() as session:
                record = session.get(SimulationTradingCallRecord, call_id)
                record.error_message = str(exc)[:1000]
                record.status = 'failed'
            raise
        finally:
            with self.db.session_scope() as session:
                record = session.get(SimulationTradingCallRecord, call_id)
                if response is not None:
                    record.output_text = str(response.content)
                    record.usage_json = json.dumps(getattr(response, 'usage', None) or {}, default=str)
                    record.model = response.model or response.provider
                if record.status == 'started':
                    record.status = 'received'

    def skill_snapshot(self, skill_id):
        from src.services.workspace_service import WorkspaceService
        from src.agent.factory import get_skill_manager
        workspace = WorkspaceService(self.db)
        item = next((s for s in workspace.list_skills() if s['id'] == skill_id and s['enabled']), None)
        if item is None:
            raise ValueError('请选择已启用的策略 Skill。')
        builtins, extra = workspace.resolve_skill_selection([skill_id])
        instructions = get_skill_manager().get(builtins[0]).instructions if builtins else extra
        if not instructions.strip():
            raise ValueError('Skill 缺少策略说明。')
        return dict(id=skill_id, name=item['name'], version=item.get('version', 1), instructions=instructions,
                    digest=hashlib.sha256(instructions.encode()).hexdigest())

    def holdings(self, account_id):
        from src.services.portfolio_service import PortfolioService
        result = PortfolioService().get_portfolio_snapshot(account_id=account_id, include_realtime=False)
        return [p for a in result['accounts'] for p in a.get('positions', []) if p.get('quantity', 0) > 0]

    @staticmethod
    def key(market, scope):
        return hashlib.sha256(json.dumps([market, scope], sort_keys=True).encode()).hexdigest()

    def preview(self, market, scope):
        scope = dict(scope)
        if scope['mode'] == 'holdings' and not scope.get('accountId'):
            raise ValueError('请选择持仓账户。')
        if scope['mode'] == 'custom' and not scope.get('query', '').strip():
            raise ValueError('请输入范围描述。')
        if scope['mode'] == 'custom':
            result, usage = self.call(
                '将股票范围描述转成严格 JSON：industryTerms（行业英文/中文匹配词列表），minVolatility（20日收益率标准差的百分数下限或null），description（明确筛选含义）。'
                '行业词作用于数据源行业/概念字段，不是股票名称。弹性大可解释为较高20日波动率，必须说明这不是收益保证。不能表达的条件不要伪装支持，description说明并返回空条件。',
                {'query': scope['query'], 'market': market}, 30000, 'trading_range')
            rule = RangeRule.model_validate(result).model_dump()
            if not rule['industryTerms'] and rule['minVolatility'] is None:
                raise ValueError('当前范围支持行业/概念和20日波动率条件，请具体描述行业或弹性范围。')
            scope['rule'] = rule
        else:
            usage = None
        snapshot = self.resolve(market, scope)
        snapshot['scope'] = scope
        snapshot['market'] = market
        snapshot['usage'] = usage
        return self.store(market, scope, snapshot, kind='preview')

    def resolve(self, market, scope, allow_empty=False):
        from src.agent.tools.execution import _normalize_tool_stock_code
        from src.market_context import detect_market
        candidates, source = [], 'specified'
        if scope['mode'] == 'fixed':
            candidates = [{'code': s, 'reason': '用户指定股票'} for s in scope['symbols']]
        elif scope['mode'] == 'holdings':
            source = 'private_holdings'
            rows = self.holdings(scope['accountId'])
            chosen = scope.get('symbols') or []
            candidates = [{'code': p.get('symbol') or p.get('stock_code'), 'reason': '来自所选持仓账户'} for p in rows]
            if chosen:
                allowed = {_normalize_tool_stock_code(s) for s in chosen}
                candidates = [c for c in candidates if _normalize_tool_stock_code(c['code']) in allowed]
        else:
            from src.config import get_config
            from src.services.screening_service import _call_screening_screen, _normalize_candidates, _to_plain
            if self.screener:
                data = self.screener(market)
            else:
                raw = _to_plain(_call_screening_screen('balanced_alpha', market.lower(), 50, get_config(), use_llm=False))
                data = dict(candidates=_normalize_candidates(raw), snapshot_source=raw.get('snapshot_source', 'screening'))
            source = data.get('snapshot_source') or data.get('run_id') or 'screening'
            rule = scope['rule']
            for candidate in data.get('candidates', []):
                row = dict(candidate.get('raw') or {}, **candidate)
                industry = str(row.get('industry') or '') + ' ' + str(row.get('concepts') or '')
                if rule['industryTerms'] and not any(t.casefold() in industry.casefold() for t in rule['industryTerms']):
                    continue
                vol = row.get('volatility_20d_pct')
                if rule['minVolatility'] is not None and (not isinstance(vol, (int, float)) or not math.isfinite(vol) or vol < rule['minVolatility']):
                    continue
                candidates.append({'code': row.get('code') or row.get('symbol'), 'name': row.get('name'),
                                   'industry': industry, 'volatility': vol, 'reason': rule['description']})
        normalized = {}
        for item in candidates:
            code = _normalize_tool_stock_code(str(item.get('code') or ''))
            if code and detect_market(code).upper() == market:
                normalized[code] = dict(item, code=code)
        if scope['mode'] == 'custom' and scope.get('symbols'):
            restricted = {_normalize_tool_stock_code(s) for s in scope['symbols']}
            normalized = {k: v for k, v in normalized.items() if k in restricted}
        selected = list(normalized.values())[:scope.get('maxCandidates', 12)]
        if not selected and not allow_empty:
            raise ValueError('数据源未找到符合范围的同市场股票，未扩大范围或编造候选；请调整条件或指定股票。')
        return dict(candidates=selected, source=source, observedAt=datetime.now(timezone.utc).isoformat(),
                    coverage='自定义范围在现有选股源返回的最多50个候选中筛选，不代表全市场行业成分股。' if scope['mode'] == 'custom' else '指定范围')

    def store(self, market, scope, payload, kind='daily', session=None):
        with (nullcontext(session) if session is not None else self.db.session_scope()) as session:
            row = SimulationUniverseSnapshotRecord(scope_key=self.key(market, scope), kind=kind,
                payload_json=json.dumps(payload, ensure_ascii=False))
            session.add(row)
            session.flush()
            return dict(payload, id=row.id)

    def approved(self, preview_id, market):
        with self.db.get_session() as session:
            row = session.get(SimulationUniverseSnapshotRecord, preview_id)
            if row is None or row.kind != 'preview':
                raise ValueError('请先预览并确认股票范围。')
            payload = json.loads(row.payload_json)
            if row.scope_key != self.key(market, payload['scope']):
                raise ValueError('股票范围市场已改变，请重新预览。')
            return payload

    def recorded(self, market, scope, day):
        with self.db.get_session() as session:
            rows = session.scalars(select(SimulationUniverseSnapshotRecord).where(
                SimulationUniverseSnapshotRecord.scope_key == self.key(market, scope),
                SimulationUniverseSnapshotRecord.kind == 'daily',
            ).order_by(SimulationUniverseSnapshotRecord.id)).all()
            for row in rows:
                payload = json.loads(row.payload_json)
                if payload.get('decisionDate') == day:
                    return dict(payload, id=row.id)
        raise ValueError(f'{day} 缺少当时记录的范围快照，不能用今日名单补造历史范围。')

    def decide(self, config, state, day, histories, candidates, budget, run_id):
        payload = dict(date=day, market=config['market'], cash=state['cash'], equity=state['equity'],
                       holdings=state['positions'], candidates=candidates, bars=histories,
                       maxPositions=config['maxPositions'], maxWeight=config['maxWeight'])
        system = TRADING_PROMPT + '\n策略 Skill：\n' + config['skillSnapshot']['instructions'] + '\n用户交易指令：\n' + config.get('systemPrompt', '')
        system += '\n只返回JSON：{"opinions":[{"code":"股票代码","targetWeight":0.0,"reason":"依据"}]}。必须覆盖输入中的所有股票且不重复，仓位和不能超过1。'
        result, usage = self.call(system, payload, budget, run_id, config.get("portfolioId"))
        try:
            decisions = Decision.model_validate(result).opinions
            weights = {d.code: d.targetWeight for d in decisions}
            if len(weights) != len(decisions) or set(weights) != set(histories):
                raise ValueError('Agent 输出未完整覆盖范围或包含重复/范围外股票，未记账。')
            if sum(w > 0 for w in weights.values()) > config['maxPositions'] or sum(weights.values()) > 1.000001:
                raise ValueError('Agent 目标仓位超过资金或持仓数量上限，未记账。')
            for code, weight in weights.items():
                if weight > config['maxWeight'] + 1e-8:
                    raise ValueError('Agent 目标仓位超过单股限制，未记账。')
                if code not in candidates and weight > 0:
                    held = state['positions'].get(code, {}).get('quantity', 0) * histories[code][-1]['close'] / state['equity']
                    if weight > held + 1e-8:
                        raise ValueError('退出候选范围的持仓不得增仓，未记账。')
            if state.get('agentModel') and state['agentModel'] != usage['model']:
                raise ValueError('模型版本已改变，请复制策略建立新验证。')
            return [dict(code=d.code, targetWeight=d.targetWeight, reason=d.reason,
                         stance='bullish' if d.targetWeight > 0 else 'bearish' if d.code in state['positions'] else 'neutral',
                         held=d.code in state['positions']) for d in decisions], usage
        except Exception as exc:
            with self.db.session_scope() as session:
                record = session.get(SimulationTradingCallRecord, usage['callId'])
                record.status, record.error_message = 'rejected', str(exc)[:1000]
            raise
