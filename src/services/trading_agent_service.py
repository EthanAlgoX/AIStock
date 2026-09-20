"""Evidence-bound trading decisions and approved, reproducible stock universes."""
from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timezone
from contextlib import nullcontext

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from src.storage import DatabaseManager, SimulationUniverseSnapshotRecord, SimulationTradingCallRecord, persist_llm_usage

INDUSTRY_ALIASES = {
    '金融': ('金融', '银行', '证券', '保险', '资本市场', '多元金融'),
    '医药生物': ('医药', '医疗', '生物', '制药', '卫生'),
    '信息技术': ('信息技术', '计算机', '软件', '互联网', 'IT服务'),
    '半导体': ('半导体', '芯片', '集成电路', '电子'),
    '通信': ('通信', '电信', '通信设备'),
    '能源': ('能源', '煤炭', '石油', '油气'),
    '原材料': ('原材料', '化工', '有色', '钢铁', '建材'),
    '工业制造': ('工业', '机械', '通用设备', '专用设备', '运输设备', '仪器', '军工'),
    '可选消费': ('可选消费', '汽车', '家电', '消费电子', '零售'),
    '必选消费': ('必选消费', '食品饮料', '农林牧渔', '日用'),
    '公用事业': ('公用事业', '电力', '环保', '燃气'),
    '房地产': ('房地产', '地产', '建筑装饰'),
    '传媒教育': ('传媒', '教育', '文化', '游戏'),
}

INDUSTRY_ENGLISH = {
    '金融': ('bank', 'insurance', 'financial', 'capital markets', 'credit services'),
    '医药生物': ('health', 'medical', 'biotech', 'pharma', 'drug'),
    '信息技术': ('technology', 'software', 'information', 'computer', 'internet'),
    '半导体': ('semiconductor',), '通信': ('telecom', 'communication'),
    '能源': ('energy', 'oil', 'gas', 'coal'),
    '原材料': ('material', 'chemical', 'steel', 'mining', 'metal'),
    '工业制造': ('industrial', 'machinery', 'aerospace', 'defense', 'equipment'),
    '可选消费': ('auto', 'retail', 'leisure', 'apparel', 'restaurant', 'travel'),
    '必选消费': ('food', 'beverage', 'household', 'tobacco', 'farm'),
    '公用事业': ('utilities',), '房地产': ('real estate', 'reit'),
    '传媒教育': ('entertainment', 'media', 'education', 'publishing'),
}


def _broader_cn_candidates(limit):
    """Use the cached market snapshot as a broad, market-value-bearing LLM pool."""
    path = os.path.join(os.getenv('SCREENING_DATA_DIR', 'data/screening'), 'snapshot.last_good.json')
    try:
        frame = json.loads(open(path, encoding='utf-8').read())['frame']
        columns, rows = frame['columns'], frame['data']
        records = [dict(zip(columns, row)) for row in rows]
        records = [row for row in records if str(row.get('code') or '').zfill(6).isdigit()]
        records.sort(key=lambda row: float(row.get('total_mv') or 0), reverse=True)
        return [dict(code=str(row['code']).zfill(6), name=row.get('name') or '', industry='',
                     volatility=None, raw=row, reason='市场快照候选') for row in (records[:limit] if limit else records)]
    except (OSError, KeyError, TypeError, ValueError):
        return []


def _industry_terms(selected_industries):
    terms = []
    for industry in selected_industries:
        terms.extend(INDUSTRY_ALIASES.get(industry, (industry,)))
        terms.extend(INDUSTRY_ENGLISH.get(industry, ()))
    return list(dict.fromkeys(terms))


def _cn_industry_candidates(terms):
    """Discover industry constituents before any candidate-size bound."""
    import akshare as ak
    from src.services.screening.source_guard import call_with_timeout
    from src.workspace_scope import ContextThreadPoolExecutor
    catalog = call_with_timeout(lambda: ak.stock_sector_spot(indicator='行业'),
                                timeout_sec=15, label='trading industry catalog')
    boards = [row for row in catalog.to_dict('records')
              if any(term.casefold() in str(row.get('板块', '')).casefold() for term in terms)]
    if not boards:
        raise ValueError('行业目录未匹配所选行业，请调整行业或指定股票。')

    def fetch(board):
        frame = call_with_timeout(lambda: ak.stock_sector_detail(sector=board['label']),
                                  timeout_sec=25, label='trading industry constituents')
        rows = json.loads(frame.to_json(orient='records'))
        if not rows:
            raise ValueError(f"行业 {board['板块']} 未返回成分股，请稍后重试。")
        for row in rows:
            row['industry'] = board['板块']
            for source, target in (('mktcap', 'total_mv'), ('nmc', 'circ_mv')):
                value = row.get(source)
                row[target] = float(value) * 10000 if value is not None else None
        return rows

    with ContextThreadPoolExecutor(max_workers=6) as pool:
        rows = [row for group in pool.map(fetch, boards) for row in group]
    return dict(candidates=rows, snapshot_source='sina:industry_constituents')


def _bounded_industry_sample(candidates, limit=40):
    """Balance industry coverage and market-cap scales, not just the largest stocks."""
    groups = {}
    for item in candidates:
        groups.setdefault(item.get('industry') or '', []).append(item)
    for index, key in enumerate(sorted(groups)):
        rows = groups[key]
        rows.sort(key=lambda item: float((item.get('raw') or {}).get('total_mv') or 0), reverse=True)
        # Spread each industry's representatives over its size distribution.
        quota = max(1, limit // max(len(groups), 1) + (index < limit % max(len(groups), 1)))
        count = min(len(rows), quota)
        groups[key] = [rows[round(i * (len(rows) - 1) / max(count - 1, 1))] for i in range(count)]
    result = []
    for i in range(limit):
        for key in sorted(groups):
            if i < len(groups[key]):
                result.append(groups[key][i])
                if len(result) == limit:
                    return result
    return result


TRADING_PROMPT = """你是模拟交易决策 Agent。依据本次冻结的 Skill、截止决策日的行情和账户状态，
逐股判断买入、持有、减仓或退出，输出目标仓位和简明依据。可以不交易。
不得虚构消息、价格、持仓或成交；缺少 Skill 所需证据时说明缺口并保持现有仓位。
目标仓位必须满足账户的资金、单股比例与持仓数量约束。你只提出计划，成交由程序在后续开盘模拟。
历史回放只可引用输入中截至当日的数据；不得引用后来发生的事件。
Skill 定义交易方法，本任务负责账户调仓决策，不重新进行选股排名或生成个股研究报告。
逐股比较当前仓位与目标仓位，说明 Skill 触发条件、调整依据；维持仓位也要解释原因。
targetWeight 是占账户总权益的目标比例，不是买卖数量、研究评分或策略匹配分；
不得把研究高分或选股排名直接转换为买入。真实账户与本次模拟账户不得混用。"""


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

    def call(self, system, payload, budget, resource='trading_agent', portfolio_id=None, max_output_tokens=4096):
        from src.agent.llm_adapter import LLMToolAdapter
        from src.services.user_activity_service import activity_scope
        messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}]
        # Conservative byte reservation also bounds contexts for private-workspace calls.
        reservation = len(json.dumps(messages, ensure_ascii=False).encode()) + max_output_tokens
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
                response = (self.adapter or LLMToolAdapter()).call_text(
                    messages,
                    temperature=0,
                    max_tokens=max_output_tokens,
                    timeout=60 if resource == 'trading_range' else 45,
                )
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
                rule=dict(industryTerms=[] if scope.get('allIndustries') else _industry_terms(selected_industries),
                          minVolatility=None, description='市场与行业候选发现'))
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
                '市场和所选行业已先按数据源分类筛选；行业分类可能较粗，需核实与用户意图的匹配。'
                '市值、波动、成长等自然语言要求由你根据证据判断，不按固定关键词规则筛选。'
                '市值单位为对应市场本币；没有明确阈值时说明采用的判断口径，不能把样本相对大小当全市场分位。'
                '缺失指标不得推断为满足。若证据不足可返回空列表并在summary说明。'
                '仅基于给定证据简短筛选，不展开逐股长篇讨论。'
                '只返回严格JSON：candidates（最多12项，每项code和reason，reason不超过60字）和summary（不超过150字）。',
                dict(market=market, requestedIndustries=selected_industries,
                    allIndustries=bool(scope.get('allIndustries')), query=query,
                    maxCandidates=scope.get('maxCandidates', 12), candidates=evidence),
                30000, 'trading_range', max_output_tokens=16384)
            selection = RangeSelection.model_validate(result)
            by_code = {item['code']: item for item in discovered['candidates']}
            chosen = []
            for item in selection.candidates:
                code = item.code
                if code not in by_code or any(row['code'] == code for row in chosen):
                    raise ValueError('模型返回范围外或重复股票，本次未生成范围，请重试。')
                if len(chosen) >= scope.get('maxCandidates', 12):
                    raise ValueError('模型返回股票数量超过配置上限，请重试。')
                chosen.append(dict(by_code[code], reason=item.reason))
            if not chosen:
                raise ValueError('模型未能从当前候选集中确认符合范围的股票；请放宽描述、选择全行业或指定股票。')
            scope['selection'] = dict(summary=selection.summary, candidates=[item.code for item in selection.candidates])
            scope['rule'] = dict(industryTerms=discovery_scope['rule']['industryTerms'], minVolatility=None,
                                 description=selection.summary or '模型根据冻结候选范围选择')
            snapshot = dict(candidates=chosen, source=discovered['source'], observedAt=discovered['observedAt'],
                coverage=discovered['coverage'] + ' LLM 按自然语言筛选，程序校验代码与数量。')
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
            if self.screener:
                data = self.screener(market)
            elif market in {'US', 'HK'}:
                import os
                from src.services.screening.snapshot_us import fetch_us_snapshot, fetch_us_universe
                from src.services.screening.source_guard import call_with_timeout
                tickers = scope.get('symbols') or fetch_us_universe('env' if os.getenv('SCREENING_US_TICKERS') else 'default')
                tickers = [str(int(s[2:])).zfill(4) + '.HK' if s.upper().startswith('HK') else s for s in tickers]
                frame = call_with_timeout(lambda: fetch_us_snapshot(tickers=tickers), timeout_sec=90, label='trading scope snapshot')
                data = dict(candidates=json.loads(frame.to_json(orient='records')), snapshot_source='yfinance:bounded_universe')
            else:
                if scope['rule']['industryTerms']:
                    data = _cn_industry_candidates(scope['rule']['industryTerms'])
                else:
                    rows = _broader_cn_candidates(None)
                    if not rows:
                        raise ValueError('市场候选快照不可用，请先刷新选股行情或指定股票。')
                    data = dict(candidates=rows, snapshot_source='market_snapshot')
            source = data.get('snapshot_source') or data.get('run_id') or 'screening'
            rule = scope['rule']
            for candidate in data.get('candidates', []):
                row = dict(candidate.get('raw') or {}, **candidate)
                industry = str(row.get('industry') or '').strip()
                if rule['industryTerms'] and not any(t.casefold() in industry.casefold() for t in rule['industryTerms']):
                    continue
                vol = row.get('volatility_20d_pct')
                if rule['minVolatility'] is not None and (not isinstance(vol, (int, float)) or not math.isfinite(vol) or vol < rule['minVolatility']):
                    continue
                candidates.append({'code': row.get('code') or row.get('symbol'), 'name': row.get('name'),
                                   'industry': industry, 'volatility': vol, 'reason': rule['description'], 'raw': row})
        normalized = {}
        for item in candidates:
            code = _normalize_tool_stock_code(str(item.get('code') or ''))
            if code and detect_market(code).upper() == market:
                normalized[code] = dict(item, code=code)
        if scope['mode'] == 'custom' and scope.get('symbols'):
            restricted = {_normalize_tool_stock_code(s) for s in scope['symbols']}
            normalized = {k: v for k, v in normalized.items() if k in restricted}
        if scope['mode'] == 'custom' and scope.get('selection'):
            approved = set(scope['selection']['candidates'])
            normalized = {key: value for key, value in normalized.items() if key in approved}
        ordered = [normalized[k] for k in sorted(normalized)] if scope['mode'] == 'custom' else list(normalized.values())
        selected = _bounded_industry_sample(ordered) if scope['mode'] == 'custom' else ordered[:scope.get('maxCandidates', 12)]
        if not selected and not allow_empty:
            raise ValueError('数据源未找到符合范围的同市场股票，未扩大范围或编造候选；请调整条件或指定股票。')
        return dict(candidates=selected, source=source, observedAt=datetime.now(timezone.utc).isoformat(),
                    coverage=(f'数据源按市场及行业得到 {len(ordered)} 只候选；送入模型 {len(selected)} 只，'
                              '按行业及市值规模分层取样，不代表全市场穷尽筛选。') if scope['mode'] == 'custom' else '指定范围')

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
        jev_opinions = None
        if config.get('decisionBackend', 'llm') == 'jev':
            from src.services.jev_decision_service import JevDecisionService, allocation_plan
            service = JevDecisionService()
            payload['allocationStep'] = config.get('jevWeightStep', 0.05)
            # Use the frozen method and user instruction, not the LLM's JSON/report contract.
            instructions = config['skillSnapshot']['instructions'] + '\n' + config.get('systemPrompt', '')
            answers, usage = service.evaluate(self.db, payload, instructions,
                                             config.get('jevModel') or service.config.typesafe_model,
                                             budget, run_id, config.get('portfolioId'))
            result = None
        else:
            result, usage = self.call(system, payload, budget, run_id, config.get("portfolioId"))
        try:
            if config.get('decisionBackend', 'llm') == 'jev':
                jev_opinions = allocation_plan(answers, config, state, histories, candidates)
                result = {'opinions': [{k: o[k] for k in ('code', 'targetWeight', 'reason')} for o in jev_opinions]}
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
            if jev_opinions is not None:
                return [dict(o, stance='bullish' if o['decision'] == 'buy' else
                             'bearish' if o['decision'] == 'sell' else 'neutral',
                             held=o['code'] in state['positions']) for o in jev_opinions], usage
            return [dict(code=d.code, targetWeight=d.targetWeight, reason=d.reason,
                         stance='bullish' if d.targetWeight > 0 else 'bearish' if d.code in state['positions'] else 'neutral',
                         held=d.code in state['positions']) for d in decisions], usage
        except Exception as exc:
            with self.db.session_scope() as session:
                record = session.get(SimulationTradingCallRecord, usage['callId'])
                record.status, record.error_message = 'rejected', str(exc)[:1000]
            raise
