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

INDUSTRY_ALIASES = {
    '金融': ('金融', '银行', '证券', '保险', '多元金融'),
    '医药生物': ('医药', '医疗', '生物', '制药'),
    '信息技术': ('信息技术', '计算机', '软件', 'IT服务'),
    '半导体': ('半导体', '芯片', '集成电路', '电子'),
    '通信': ('通信', '电信', '通信设备'),
    '能源': ('能源', '煤炭', '石油', '油气'),
    '原材料': ('原材料', '化工', '有色', '钢铁', '建材'),
    '工业制造': ('工业', '机械', '制造', '设备', '军工'),
    '可选消费': ('可选消费', '汽车', '家电', '消费电子', '零售'),
    '必选消费': ('必选消费', '食品饮料', '农林牧渔', '日用'),
    '公用事业': ('公用事业', '电力', '环保', '燃气'),
    '房地产': ('房地产', '地产', '建筑装饰'),
    '传媒教育': ('传媒', '教育', '文化', '游戏'),
}


def _industry_terms(selected_industries):
    terms = []
    for industry in selected_industries:
        terms.extend(INDUSTRY_ALIASES.get(industry, (industry,)))
    return list(dict.fromkeys(terms))


TRADING_PROMPT = """你是模拟交易决策 Agent。依据本次冻结的 Skill、截止决策日的行情和账户状态，
逐股判断买入、持有、减仓或退出，输出目标仓位和简明依据。可以不交易。
不得虚构消息、价格、持仓或成交；缺少 Skill 所需证据时说明缺口并保持现有仓位。
目标仓位必须满足账户的资金、单股比例与持仓数量约束。你只提出计划，成交由程序在后续开盘模拟。
历史回放只可引用输入中截至当日的数据；不得引用后来发生的事件。"""


class RangeRule(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    industryTerms: list[str] = Field(default_factory=list, max_length=32)
    minVolatility: float | None = Field(default=None, ge=0, le=100)
    description: str = Field(min_length=1, max_length=1000)


class RangeSelectionItem(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str
    reason: str = Field(min_length=1, max_length=1000)


class RangeSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    candidates: list[RangeSelectionItem] = Field(default_factory=list, max_length=12)
    summary: str = Field(default='')


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
                response = (self.adapter or LLMToolAdapter()).call_text(messages, temperature=0, max_tokens=4096, timeout=45)
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
            if not raw:
                raise ValueError('模型未返回完整回答，本次未生成计划；请重试或调整模型输出配置。')
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError('模型回答不是有效 JSON，本次未生成计划；原始回答已记录，可重试或调整指令。') from exc
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
        selected_industries = list(dict.fromkeys(
            str(item).strip() for item in scope.get('industries', []) if str(item).strip()
        ))
        scope['industries'] = selected_industries
        if scope['mode'] == 'custom' and not (
            scope.get('query', '').strip() or selected_industries or scope.get('allIndustries')
        ):
            raise ValueError('请选择行业、选择全行业，或输入行业/波动率范围描述。')
        if scope['mode'] == 'custom' and market == 'HK' and not scope.get('symbols'):
            raise ValueError('港股暂缺行业候选目录，请先指定股票，再按行业或弹性条件筛选。')
        if scope['mode'] == 'custom':
            query = scope.get('query', '').strip()
            discovery_scope = dict(scope, maxCandidates=50,
                rule=dict(industryTerms=[], minVolatility=None, description='候选发现'))
            try:
                discovered = self.resolve(market, discovery_scope)
            except (RuntimeError, TimeoutError) as exc:
                raise ValueError('范围数据源暂时不可用，未编造候选；请稍后重试，或改用指定股票/持仓范围。') from exc
            evidence = []
            for candidate in discovered['candidates']:
                raw = candidate.get('raw') or {}
                evidence.append(dict(code=candidate['code'], name=candidate.get('name') or '',
                    industry=candidate.get('industry') or '', concepts=raw.get('concepts') or '',
                    totalMarketValue=raw.get('total_mv') or raw.get('market_cap') or raw.get('market_value'),
                    circulatingMarketValue=raw.get('circ_mv'), volatility20dPct=candidate.get('volatility')))
            result, usage = self.call(
                '你是股票范围选择器。仅从候选列表选择符合用户范围的股票，绝不可编造或返回范围外代码。'
                '行业、市场和市值要求均由你结合候选证据判断；市值单位未知时只比较候选间相对规模。'
                '中市值以上表示排除候选集中市值较小的一档。若证据不足，可保守返回空列表并在summary说明。'
                '只返回严格JSON：candidates（最多12项，每项code和reason）和summary。',
                dict(market=market, requestedIndustries=selected_industries,
                    allIndustries=bool(scope.get('allIndustries')), query=query,
                    maxCandidates=scope.get('maxCandidates', 12), candidates=evidence),
                30000, 'trading_range')
            selection = RangeSelection.model_validate(result)
            by_code = {item['code']: item for item in discovered['candidates']}
            chosen = []
            for item in selection.candidates:
                code = item.code
                if code in by_code and len(chosen) < scope.get('maxCandidates', 12):
                    chosen.append(dict(by_code[code], reason=item.reason))
            if not chosen:
                raise ValueError('模型未能从当前候选集中确认符合范围的股票；请放宽描述、选择全行业或指定股票。')
            scope['selection'] = dict(summary=selection.summary, candidates=[item.code for item in selection.candidates])
            scope['rule'] = dict(industryTerms=[], minVolatility=None, description=selection.summary or '模型根据冻结候选范围选择')
            snapshot = dict(candidates=chosen, source=discovered['source'], observedAt=discovered['observedAt'],
                coverage='LLM 仅从冻结候选集中选择，程序已校验返回代码。')
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
            elif market in {'US', 'HK'}:
                import os
                from src.services.screening.snapshot_us import fetch_us_snapshot, fetch_us_universe
                from src.services.screening.source_guard import call_with_timeout
                tickers = scope.get('symbols') or fetch_us_universe('env' if os.getenv('SCREENING_US_TICKERS') else 'default')
                tickers = [str(int(s[2:])).zfill(4) + '.HK' if s.upper().startswith('HK') else s for s in tickers[:50]]
                frame = call_with_timeout(lambda: fetch_us_snapshot(tickers=tickers), timeout_sec=90, label='trading scope snapshot')
                data = dict(candidates=json.loads(frame.to_json(orient='records')), snapshot_source='yfinance:bounded_universe')
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
        ordered = [normalized[k] for k in sorted(normalized)] if scope['mode'] == 'custom' else list(normalized.values())
        selected = ordered[:scope.get('maxCandidates', 12)]
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
        if config['skillSnapshot']['id'] == 'high_volume_volatility_grid':
            payload['grid'] = dict(
                lookbackDays=config.get('gridLookbackDays', 5),
                minVolumeRatio=config.get('gridMinVolumeRatio', 1.3),
                minRange=config.get('gridMinRange', 0.05),
                levels=config.get('gridLevels', 5),
            )
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
