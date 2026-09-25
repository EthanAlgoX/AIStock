"""Evidence-bound trading decisions and approved, reproducible stock universes."""
from __future__ import annotations

import hashlib
import json
import math
import os
import requests
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


def _cn_constituent_count(label):
    """The board overview count is capped at 100; use the membership endpoint."""
    import requests
    response = requests.get(
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount',
        params={'node': label}, timeout=(5, 10))
    response.raise_for_status()
    count = int(response.json())
    if count < 0:
        raise RuntimeError('Invalid industry constituent count')
    return count


def _cn_industry_candidates(terms):
    """Discover industry constituents before any candidate-size bound."""
    import akshare as ak
    from src.services.screening.source_guard import call_with_timeout
    from src.workspace_scope import ContextThreadPoolExecutor
    catalog = call_with_timeout(lambda: ak.stock_sector_spot(indicator='行业'),
                                timeout_sec=15, label='trading industry catalog')
    boards = [row for row in catalog.to_dict('records')
              if not terms or any(term.casefold() in str(row.get('板块', '')).casefold() for term in terms)]
    if not boards:
        raise ValueError('行业目录未匹配所选行业，请调整行业或指定股票。')

    def fetch(board):
        expected = call_with_timeout(lambda: _cn_constituent_count(board['label']),
                                     timeout_sec=15, label='industry constituent count')
        frame = call_with_timeout(lambda: ak.stock_sector_detail(sector=board['label']),
                                  timeout_sec=25, label='trading industry constituents')
        rows = json.loads(frame.to_json(orient='records'))
        if not rows:
            raise ValueError(f"行业 {board['板块']} 未返回成分股，请稍后重试。")
        unique_codes = {str(row.get('code') or '') for row in rows}
        if len(unique_codes) != len(rows) or len(rows) != expected:
            raise RuntimeError('行业成分股数量与目录不一致，请稍后重试。')
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
        from src.services.crypto_portfolio_rules import RULES, skill_snapshot
        if skill_id in RULES:
            return skill_snapshot(skill_id)
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
        if market == 'CRYPTO':
            snapshot = self.resolve(market, scope)
            return self.store(market, scope, dict(snapshot, scope=scope, market=market, usage=None), kind='preview')
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
        if scope['mode'] == 'custom' and market in {'JP', 'KR'} and not scope.get('symbols'):
            raise ValueError('此市场请先指定股票，再按行业或波动率条件筛选。')
        if scope['mode'] == 'custom':
            query = scope.get('query', '').strip()
            discovery_scope = dict(scope, maxCandidates=50,
                rule=dict(industryTerms=[] if scope.get('allIndustries') else _industry_terms(selected_industries),
                          minVolatility=None, description='市场与行业候选发现'))
            try:
                discovered = self.resolve(market, discovery_scope)
            except (RuntimeError, TimeoutError, requests.RequestException) as exc:
                raise ValueError(self._scope_error(scope, 'source')) from exc
            evidence = []
            for candidate in discovered['candidates']:
                raw = candidate.get('raw') or {}
                evidence.append(dict(code=candidate['code'], name=candidate.get('name') or '',
                    industry=candidate.get('industry') or '', concepts=raw.get('concepts') or '',
                    totalMarketValue=raw.get('total_mv') or raw.get('market_cap') or raw.get('market_value'),
                    circulatingMarketValue=raw.get('circ_mv'), volatility20dPct=candidate.get('volatility'),
                    averageVolume20d=raw.get('average_volume_20d'), totalVolume20d=raw.get('total_volume_20d'),
                    historySessions=raw.get('history_sessions'), historyStartDate=raw.get('history_start_date'),
                    historyEndDate=raw.get('history_end_date'), quoteDate=raw.get('quote_date'),
                    volumePercentile=raw.get('volumePercentile'), volatilityPercentile=raw.get('volatilityPercentile'),
                    screeningScore=raw.get('screeningScore')))
            result, usage = self.call(
                '你是股票范围选择器。仅从候选列表选择符合用户范围的股票，绝不可编造或返回范围外代码。'
                '市场和所选行业已先按数据源分类筛选；行业分类可能较粗，需核实与用户意图的匹配。'
                '市值、波动、成长等自然语言要求由你根据证据判断，不按固定关键词规则筛选。'
                '市值单位为对应市场本币；没有明确阈值时说明采用的判断口径，不能把样本相对大小当全市场分位。'
                'averageVolume20d/totalVolume20d是最近20个交易日的日均/累计成交股数；'
                'volatility20dPct是20个日收益率的年化标准差百分比，不是月涨跌幅。'
                '过去一个月未指定日期时按最近20个交易日理解，核对数据日期与样本完整性。'
                '当前目录和行情不能验证历史时点范围；若用户指定历史日期，返回空列表并说明需历史数据支持。'
                '成交量高、波动大未给绝对阈值时可按当前候选内相对水平比较，并明确样本口径，不能宣称全市场排名。'
                '若提供volumePercentile和volatilityPercentile，则是完整有效数据子集中的分位；screeningScore为两项等权均值，不是买入信号。'
                '缺失指标不得推断为满足。若证据不足可返回空列表并在summary说明。'
                '仅基于给定证据简短筛选，不展开逐股长篇讨论。'
                '只返回严格JSON：candidates（最多12项，每项code和reason，reason不超过60字）和summary（不超过150字）。'
                + self.language_directive(scope),
                dict(market=market, requestedIndustries=selected_industries,
                    allIndustries=bool(scope.get('allIndustries')), query=query,
                    maxCandidates=scope.get('maxCandidates', 12), observedAt=discovered['observedAt'],
                    coverageStats=discovered.get('coverageStats'), candidates=evidence),
                60000, 'trading_range', max_output_tokens=16384)
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
                raise ValueError(self._scope_error(scope, 'model') + (' ' + selection.summary[:500] if selection.summary else ''))
            scope['selection'] = dict(summary=selection.summary, candidates=[item.code for item in selection.candidates])
            scope['rule'] = dict(industryTerms=discovery_scope['rule']['industryTerms'], minVolatility=None,
                                 description=selection.summary or '模型根据冻结候选范围选择')
            snapshot = dict(candidates=chosen, source=discovered['source'], observedAt=discovered['observedAt'],
                coverage=discovered['coverage'], coverageStats=discovered.get('coverageStats'))
        else:
            usage = None
            snapshot = self.resolve(market, scope)
        snapshot['scope'] = scope
        snapshot['market'] = market
        snapshot['usage'] = usage
        return self.store(market, scope, snapshot, kind='preview')

    @staticmethod
    def _scope_error(scope, kind):
        messages = {
            'zh': {'source': '范围数据源暂时不可用，未编造候选；请稍后重试，或改用指定股票/持仓范围。',
                   'empty': '数据源未找到符合范围且证据完整的同市场股票；请检查行情日期、调整条件或指定股票。',
                   'model': '模型未能从当前候选集中确认符合范围的股票；请放宽描述、选择全行业或指定股票。'},
            'zh-TW': {'source': '範圍資料源暫時無法使用，未編造候選；請稍後重試，或改用指定股票／持倉範圍。',
                      'empty': '未找到符合範圍且資料完整的同市場股票；請檢查行情日期、調整條件或指定股票。',
                      'model': '模型未能確認符合範圍的候選；請放寬描述、選擇全行業或指定股票。'},
            'en': {'source': 'Scope data is temporarily unavailable. No candidates were invented. Retry later or use specified stocks or holdings.',
                   'empty': 'No stocks in scope have sufficient current evidence. Check quote dates, adjust criteria or specify stocks.',
                   'model': 'The model could not confirm matching candidates. Broaden the criteria, select all industries or specify stocks.'},
            'ja': {'source': '対象データを取得できませんでした。候補は補完していません。再試行するか、銘柄・保有株を指定してください。',
                   'empty': '条件を満たす最新データ付きの銘柄がありません。日付・条件を確認するか銘柄を指定してください。',
                   'model': 'モデルが条件に合う候補を確認できませんでした。条件を緩めるか、全業種または銘柄を指定してください。'},
            'ko': {'source': '범위 데이터를 일시적으로 가져올 수 없습니다. 후보를 임의로 만들지 않았습니다. 나중에 재시도하거나 종목·보유 종목을 지정하세요.',
                   'empty': '범위 내에 충분한 최신 자료가 있는 종목이 없습니다. 시세 날짜·조건을 확인하거나 종목을 지정하세요.',
                   'model': '모델이 조건에 맞는 후보를 확인하지 못했습니다. 조건을 완화하거나 전체 업종 또는 종목을 지정하세요.'},
        }
        return messages.get(scope.get('reportLanguage', 'zh'), messages['en'])[kind]

    @staticmethod
    def language_directive(scope):
        from src.report_language import get_output_language_directive
        return '\n' + get_output_language_directive(scope.get('reportLanguage', 'en'))

    def resolve(self, market, scope, allow_empty=False):
        from src.agent.tools.execution import _normalize_tool_stock_code
        from src.market_context import detect_market
        if market == 'CRYPTO':
            from src.services.crypto_market_service import validate_symbol
            if scope['mode'] != 'fixed':
                raise ValueError('Crypto strategies require a fixed spot universe')
            symbols = list(dict.fromkeys(validate_symbol(s) for s in scope.get('symbols', [])))
            if not 1 <= len(symbols) <= 12:
                raise ValueError('Choose 1–12 USDT spot pairs')
            from data_provider.crypto_fetcher import realtime_quote
            for code in symbols:
                realtime_quote(code)
            return dict(candidates=[dict(code=c, name=c, reason='Binance Spot') for c in symbols],
                        source='Binance Spot', observedAt=datetime.now(timezone.utc).isoformat(),
                        coverage='fixed', market=market, scope=scope)
        candidates, source = [], 'specified'
        directory_filtered = False
        directory_count = 0
        enrich_sample = False
        snapshot_options = {}
        if scope['mode'] == 'custom' and scope.get('candidateRanking') == 'volume_volatility' and not scope.get('selection'):
            from src.services.simulation_portfolio_service import SimulationPortfolioService
            snapshot_options['as_of'] = SimulationPortfolioService._last_closed(market).isoformat()
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
            elif market in {'US', 'HK'} and not scope.get('symbols'):
                from src.services.industry_universe_service import equity_directory
                from src.services.screening.source_guard import call_with_timeout
                rows = call_with_timeout(
                    lambda: equity_directory(market, () if scope.get('allIndustries') else scope.get('industries', [])),
                    timeout_sec=90, label='market industry directory')
                data = dict(candidates=rows, snapshot_source='yahoo:paginated_equity_directory')
                directory_filtered = True
                enrich_sample = True
            elif market == 'TW':
                from data_provider.international_fetcher import taiwan_listings
                import time
                from src.services.screening.snapshot_us import fetch_us_snapshot
                tickers = scope.get('symbols') or [s['canonicalCode'] for s in taiwan_listings(int(time.time() // 3600))][:50]
                frame = fetch_us_snapshot(tickers=tickers, **snapshot_options)
                data = dict(candidates=json.loads(frame.to_json(orient='records')), snapshot_source='taiwan_directory:yfinance_snapshot')
            elif market in {'US', 'HK', 'JP', 'KR'}:
                import os
                from src.services.screening.snapshot_us import fetch_us_snapshot, fetch_us_universe
                from src.services.screening.source_guard import call_with_timeout
                tickers = scope.get('symbols') or fetch_us_universe('env' if os.getenv('SCREENING_US_TICKERS') else 'default')
                tickers = [str(int(s[2:])).zfill(4) + '.HK' if s.upper().startswith('HK') else s for s in tickers]
                frame = call_with_timeout(lambda: fetch_us_snapshot(tickers=tickers, **snapshot_options), timeout_sec=90, label='trading scope snapshot')
                data = dict(candidates=json.loads(frame.to_json(orient='records')), snapshot_source='yfinance:bounded_universe')
            else:
                from src.services.screening.source_guard import call_with_timeout
                data = call_with_timeout(lambda: _cn_industry_candidates(scope['rule']['industryTerms']),
                                         timeout_sec=90, label='A-share industry directory')
                enrich_sample = True
            source = data.get('snapshot_source') or data.get('run_id') or 'screening'
            directory_count = len({row.get('code') or row.get('symbol') for row in data.get('candidates', [])})
            rule = scope['rule']
            for candidate in data.get('candidates', []):
                row = dict(candidate.get('raw') or {}, **candidate)
                industry = str(row.get('industry') or '').strip()
                if not directory_filtered and rule['industryTerms'] and not any(t.casefold() in industry.casefold() for t in rule['industryTerms']):
                    continue
                vol = row.get('volatility_20d_pct')
                if rule['minVolatility'] is not None and (not isinstance(vol, (int, float)) or not math.isfinite(vol) or vol < rule['minVolatility']):
                    continue
                candidates.append({'code': row.get('code') or row.get('symbol'), 'name': row.get('name'),
                                   'industry': industry, 'volatility': vol, 'reason': rule['description'], 'raw': row})
        normalized = {}
        for item in candidates:
            code = _normalize_tool_stock_code(str(item.get('code') or ''))
            if market == 'CN' and scope['mode'] == 'custom' and not (
                len(code) == 6 and code.isdigit() and code.startswith(('00', '30', '60', '68', '4', '8', '92'))
            ):
                continue
            if code and detect_market(code).upper() == market:
                normalized[code] = dict(item, code=code)
        if scope['mode'] == 'custom' and scope.get('symbols'):
            restricted = {_normalize_tool_stock_code(s) for s in scope['symbols']}
            normalized = {k: v for k, v in normalized.items() if k in restricted}
        if scope['mode'] == 'custom' and scope.get('selection'):
            approved = set(scope['selection']['candidates'])
            normalized = {key: value for key, value in normalized.items() if key in approved}
        ordered = [normalized[k] for k in sorted(normalized)] if scope['mode'] == 'custom' else list(normalized.values())
        ranked_mode = scope['mode'] == 'custom' and scope.get('candidateRanking') == 'volume_volatility' and not scope.get('selection')
        if ranked_mode:
            from src.services.simulation_portfolio_service import SimulationPortfolioService
            as_of = SimulationPortfolioService._last_closed(market).isoformat()
            evaluated = self._enrich_scope_sample(market, ordered, history_only=True, as_of=as_of) if enrich_sample and ordered else ordered
            selected, valid_count = self._rank_volume_volatility(evaluated, as_of)
        else:
            selected = _bounded_industry_sample(ordered) if scope['mode'] == 'custom' else ordered[:scope.get('maxCandidates', 12)]
            if enrich_sample and selected:
                selected = self._enrich_scope_sample(market, selected)
            evaluated, valid_count = selected, None
        if not selected and not allow_empty:
            raise ValueError(self._scope_error(scope, 'empty'))
        stats = dict(directoryCount=directory_count or len(ordered), eligibleCount=len(ordered),
                     modelCount=len(selected), sampled=len(selected) < len(ordered),
                     monthlyEvidenceCount=sum(
                         (item.get('raw') or {}).get('average_volume_20d') is not None
                         and item.get('volatility') is not None for item in selected))
        if ranked_mode:
            stats.update(ranking='volume_volatility', evaluatedCount=len(evaluated),
                         validCount=valid_count, missingCount=len(evaluated)-valid_count, asOf=as_of)
        return dict(candidates=selected, source=source, observedAt=datetime.now(timezone.utc).isoformat(),
                    coverageStats=stats, coverage=self._coverage(scope, stats))

    @staticmethod
    def _coverage(scope, stats):
        language = scope.get('reportLanguage', 'en')
        if scope['mode'] != 'custom':
            return {'zh': '指定范围', 'zh-TW': '指定範圍', 'en': 'Specified universe',
                    'ja': '指定銘柄', 'ko': '지정 종목'}.get(language, 'Specified universe')
        if stats.get('ranking') == 'volume_volatility':
            ranked = {
                'zh': '范围内 {eligibleCount} 只，已检查 {evaluatedCount} 只，有效 {validCount} 只，缺失或过期 {missingCount} 只；截至 {asOf}，按20日成交量与波动率分位等权排序，前 {modelCount} 只进入模型复核。不代表数据源外股票或历史时点排名。',
                'zh-TW': '範圍內 {eligibleCount} 檔，已檢查 {evaluatedCount} 檔，有效 {validCount} 檔，缺失或過期 {missingCount} 檔；截至 {asOf}，按20日成交量與波動率分位等權排序，前 {modelCount} 檔進入模型覆核。不代表資料源外股票或歷史時點排名。',
                'en': 'Eligible {eligibleCount}; evaluated {evaluatedCount}; valid {validCount}; missing/stale {missingCount}. As of {asOf}, equal-weight 20-session volume/volatility percentiles rank the valid pool; top {modelCount} enter model review. Not a ranking of securities missing from the data source or historical constituents.',
                'ja': '対象 {eligibleCount}、確認済み {evaluatedCount}、有効 {validCount}、欠損・古いデータ {missingCount}。{asOf}時点の20日出来高・変動率の分位を等配分で評価し、上位 {modelCount}銘柄をモデルが確認します。データ元の対象外銘柄や過去の構成銘柄の順位ではありません。',
                'ko': '대상 {eligibleCount}개, 확인 {evaluatedCount}개, 유효 {validCount}개, 누락·오래된 자료 {missingCount}개. {asOf} 기준 20일 거래량·변동성 백분위에 동일 가중치를 적용하여 상위 {modelCount}개를 모델이 검토합니다. 제공처 미포함 종목이나 과거 구성 종목의 순위가 아닙니다.',
            }
            return ranked.get(language, ranked['en']).format(**stats)
        templates = {
            'zh': '来源目录 {directoryCount} 只，范围内 {eligibleCount} 只，模型候选 {modelCount} 只，月度量价证据完整 {monthlyEvidenceCount} 只。最多按行业与市值抽样 40 只，不代表全市场排名。仅覆盖普通股票；目录为当前分类，不支持历史时点选股。',
            'zh-TW': '來源目錄 {directoryCount} 檔，範圍內 {eligibleCount} 檔，模型候選 {modelCount} 檔，月度量價證據完整 {monthlyEvidenceCount} 檔。最多按行業與市值抽樣 40 檔，不代表全市場排名。僅涵蓋普通股票；目錄為目前分類，不支援歷史時點選股。',
            'en': 'Source directory: {directoryCount}; eligible: {eligibleCount}; model sample: {modelCount}; complete monthly evidence: {monthlyEvidenceCount}. Up to 40 stocks sampled by industry and market cap, not a market-wide ranking. Equities only; current classifications, no historical-date screening.',
            'ja': 'データ元の銘柄数：{directoryCount}、対象：{eligibleCount}、モデル候補：{modelCount}、月間出来高・変動率データ完備：{monthlyEvidenceCount}。業種・時価総額別に最大40銘柄を抽出し、市場全体の順位ではありません。普通株のみ。現在の業種分類を使用し、過去時点のスクリーニングには非対応です。',
            'ko': '데이터 제공처 목록 {directoryCount}개, 범위 내 {eligibleCount}개, 모델 후보 {modelCount}개, 월간 거래량·변동성 자료 완비 {monthlyEvidenceCount}개. 업종·시가총액별 최대 40개 표본이며 전체 시장 순위가 아닙니다. 일반 주식만 포함하며 현재 업종 분류를 사용합니다. 과거 시점 검색은 지원하지 않습니다.',
        }
        return templates.get(language, templates['en']).format(**stats)

    @staticmethod
    def _enrich_scope_sample(market, candidates, history_only=False, as_of=None):
        from src.services.screening.snapshot_us import fetch_us_snapshot
        from src.services.screening.source_guard import call_with_timeout
        def ticker(code):
            if market == 'CN':
                suffix = 'SS' if code.startswith('6') else ('BJ' if code.startswith(('4', '8', '9')) else 'SZ')
                return code + '.' + suffix
            if market == 'HK':
                return str(int(code[2:])).zfill(4) + '.HK'
            return code
        requested = {ticker(item['code']): item for item in candidates}
        def load():
            evidence = {}
            symbols = list(requested)
            for start in range(0, len(symbols), 200):
                kwargs = dict(include_metadata=False, as_of=as_of) if history_only else {}
                frame = fetch_us_snapshot(tickers=symbols[start:start+200], **kwargs)
                evidence.update({row['code']: row for row in json.loads(frame.to_json(orient='records'))})
            return evidence
        evidence = call_with_timeout(load, timeout_sec=180 if history_only else 90, label='scope monthly evidence')
        # Keep missing observations visible rather than silently dropping securities.
        fields = ('average_volume_20d', 'total_volume_20d', 'history_sessions',
                  'history_start_date', 'history_end_date', 'quote_date', 'volatility_20d_pct')
        result = []
        for symbol, item in requested.items():
            observed = evidence.get(symbol) or {}
            raw = dict(item.get('raw') or {}, **{key: observed.get(key) for key in fields})
            result.append(dict(item, raw=raw, volatility=observed.get('volatility_20d_pct'),
                               industry=item.get('industry') or observed.get('industry') or ''))
        return result

    @staticmethod
    def _rank_volume_volatility(candidates, as_of, limit=40):
        import pandas as pd
        valid = []
        for item in candidates:
            raw = item.get('raw') or {}
            volume, volatility = raw.get('average_volume_20d'), item.get('volatility')
            if raw.get('quote_date') != as_of or raw.get('history_sessions') != 20:
                continue
            if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0
                   for value in (volume, volatility)):
                continue
            valid.append(item)
        volumes = pd.Series([(item.get('raw') or {})['average_volume_20d'] for item in valid], dtype=float).rank(pct=True)
        volatility = pd.Series([item['volatility'] for item in valid], dtype=float).rank(pct=True)
        scored = [dict(item, raw=dict(item.get('raw') or {}, volumePercentile=float(volumes[i]),
                      volatilityPercentile=float(volatility[i]), screeningScore=float((volumes[i]+volatility[i])/2)))
                  for i, item in enumerate(valid)]
        scored.sort(key=lambda item: (-item['raw']['screeningScore'], item['code']))
        return scored[:limit], len(valid)

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
        if config.get('decisionBackend') == 'rules' and config['market'] == 'CRYPTO':
            from src.services.crypto_portfolio_rules import RULES, opinions
            version = RULES[config['skillSnapshot']['id']][1]
            if config.get('ruleVersion') != version or state.get('agentModel', version) != version:
                raise ValueError('Crypto rule version mismatch')
            return opinions(config, state, day, histories, candidates), dict(model=version, tokens=0)
        if config.get('decisionBackend') == 'rules':
            from src.services.simulation_portfolio_engine import GRID_RULE_VERSION, grid_rule_opinions
            if (config['skillSnapshot']['id'] != 'high_volume_volatility_grid'
                    or config.get('ruleVersion') != GRID_RULE_VERSION):
                raise ValueError('规则决策仅支持已固定版本的高量高波动网格策略。')
            if state.get('agentModel') and state['agentModel'] != GRID_RULE_VERSION:
                raise ValueError('规则版本已改变，请复制策略建立新验证。')
            return grid_rule_opinions(config, state, day, histories, candidates), dict(model=GRID_RULE_VERSION, tokens=0)
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
        from src.report_language import get_output_language_directive
        system += '\n' + get_output_language_directive(config.get('reportLanguage', 'en'))
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
                                             budget, run_id, config.get('portfolioId'), customization=config.get('jevTask'))
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
