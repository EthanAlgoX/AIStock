"""Persistent strategy-definition and publication boundary.

This module intentionally stops before runtime execution.  It owns the
versioned definition of a multi-Agent strategy, not runs, evidence, orders or
ledger entries.  Keeping this boundary explicit prevents a draft from being
mistaken for an executable or a published strategy from being mutated later.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlsplit

from sqlalchemy import desc, func, select

from src.data.default_news_sources import DEFAULT_FINANCE_NEWS_SOURCES
from src.services.strategy_graph_validator import StrategyGraphValidator
from src.services.simulation_strategy_service import SimulationStrategyService
from src.services.strategy_graph_runtime_service import StrategyGraphRuntimeService, StrategyGraphRunError
from src.services.strategy_screening_runtime_service import StrategyScreeningRuntimeService, StrategyScreeningRunError
from src.storage import (
    DatabaseManager,
    SimulationAgentConnectionRecord,
    SimulationAgentInstanceRecord,
    SimulationAgentTemplateRecord,
    SimulationAgentTemplateVersionRecord,
    SimulationAuditEventRecord,
    SimulationDataSourceRecord,
    SimulationPublishRequestRecord,
    SimulationRunRecord,
    SimulationStrategyRunBatchRecord,
    SimulationStrategyRunControlRecord,
    SimulationStrategyForkRequestRecord,
    SimulationStrategyRecord,
    SimulationStrategyVersionRecord,
    StockDaily,
    utc_naive_now,
)


class StrategyDefinitionError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: Optional[dict[str, Any]] = None):
        super().__init__(message)
        self.code, self.message, self.status_code, self.details = code, message, status_code, details or {}


class StrategyDefinitionService:
    """Transactional owner of strategies, drafts, publication and audit."""

    DAILY_RESEARCH_WORKFLOW_NAME = "Daily · 单股研究工作流"
    DAILY_SCREENING_WORKFLOW_NAME = "Daily · 选股扫描工作流"
    DAILY_TRADING_WORKFLOW_NAME = "标准多 Agent 研究工作流"
    DAILY_RESEARCH_STRATEGY_NAME = "单股研究策略"
    DAILY_SCREENING_STRATEGY_NAME = "多因子选股策略"
    DAILY_TRADING_STRATEGY_NAME = "研究决策基线"
    LEGACY_DAILY_STRATEGY_NAMES = {
        DAILY_RESEARCH_STRATEGY_NAME: "Daily · 单股研究策略",
        DAILY_SCREENING_STRATEGY_NAME: "Daily · 选股策略",
        DAILY_TRADING_STRATEGY_NAME: "Daily · 研究决策基线",
    }
    STARTER_BACKTEST_PROFILE = "fixed_ohlcv_v1"

    BUILTIN_DATA_SOURCES = (
        {"sourceId": "system_market_data", "name": "系统自动选择", "kind": "kline", "description": "按市场和可用性自动选择行情来源；失败时按系统顺序切换。", "connectionKey": "system_market_data", "required": True, "selectionMode": "automatic", "markets": ["cn", "hk", "us", "jp", "kr", "tw"]},
        {"sourceId": "local_stock_daily", "name": "本地日线库 stock_daily", "kind": "kline", "description": "只使用数据库中已经留存的日线数据，不主动请求外部行情。", "connectionKey": "local_stock_daily", "required": False, "selectionMode": "local", "markets": ["cn", "hk", "us", "jp", "kr", "tw"]},
        {"sourceId": "system_news", "name": "系统自动选择", "kind": "news", "description": "保留已配置新闻渠道的优先级；未配置密钥时默认使用免密钥财经 RSS 聚合，并继续故障切换。每次运行记录真实来源。", "connectionKey": "system_news", "required": False, "selectionMode": "automatic", "markets": ["cn", "hk", "us"]},
        {"sourceId": "system_fundamentals", "name": "按市场自动选择", "kind": "fundamentals", "description": "A 股优先使用 AkShare，海外市场使用 YFinance，并按现有管线补充可用字段。", "connectionKey": "system_fundamentals", "required": False, "selectionMode": "automatic", "markets": ["cn", "hk", "us", "jp", "kr", "tw"]},
        {"sourceId": "system_macro_data", "name": "系统宏观数据", "kind": "macro", "description": "按市场合并官方与公开宏观序列；缺失项保持缺失，不使用示例值。", "connectionKey": "system_macro_data", "required": False, "selectionMode": "automatic", "markets": ["cn", "hk", "us"]},
        {"sourceId": "system_sentiment", "name": "系统情绪与社交信号", "kind": "other", "description": "预留的情绪与社交研究输入；当前没有绑定可执行适配器，不能挂载到新任务。", "connectionKey": "system_sentiment", "required": False, "selectionMode": "automatic", "selectable": False, "markets": ["cn", "hk", "us"]},
    )

    PROVIDER_DATA_SOURCES = (
        {"sourceId": "kline:tencent", "name": "腾讯行情", "kind": "kline", "description": "指定腾讯日线接口；该连接失败时不会静默改用其他 K 线提供方。", "connectionKey": "kline:tencent", "providerName": "TencentFetcher", "markets": ["cn"], "availabilityKey": "always"},
        {"sourceId": "kline:akshare", "name": "AkShare 行情", "kind": "kline", "description": "指定 AkShare 行情适配器，支持 A 股和港股。", "connectionKey": "kline:akshare", "providerName": "AkshareFetcher", "markets": ["cn", "hk"], "availabilityKey": "always"},
        {"sourceId": "kline:baostock", "name": "Baostock 行情", "kind": "kline", "description": "指定 Baostock 日线数据，仅用于 A 股。", "connectionKey": "kline:baostock", "providerName": "BaostockFetcher", "markets": ["cn"], "availabilityKey": "always"},
        {"sourceId": "kline:yfinance", "name": "YFinance 行情", "kind": "kline", "description": "指定 YFinance 行情，适合美股及部分海外市场。", "connectionKey": "kline:yfinance", "providerName": "YfinanceFetcher", "markets": ["cn", "hk", "us", "jp", "kr", "tw"], "availabilityKey": "always"},
        {"sourceId": "kline:efinance", "name": "Efinance 行情", "kind": "kline", "description": "指定 Efinance 行情适配器，仅用于 A 股。", "connectionKey": "kline:efinance", "providerName": "EfinanceFetcher", "markets": ["cn"], "availabilityKey": "always"},
        {"sourceId": "kline:pytdx", "name": "通达信 Pytdx", "kind": "kline", "description": "指定 Pytdx 行情；使用系统设置中的通达信节点。", "connectionKey": "kline:pytdx", "providerName": "PytdxFetcher", "markets": ["cn"], "availabilityKey": "always"},
        {"sourceId": "kline:tushare", "name": "Tushare 行情", "kind": "kline", "description": "指定 Tushare 行情，需要先配置 TUSHARE_TOKEN。", "connectionKey": "kline:tushare", "providerName": "TushareFetcher", "markets": ["cn", "hk"], "availabilityKey": "tushare"},
        {"sourceId": "kline:hithink_finance", "name": "同花顺金融数据", "kind": "kline", "description": "同花顺官方 Financial API，提供 A 股行情快照、前复权日 K 与主要指数；需要先配置 HITHINK_FINANCE_API_KEY。", "connectionKey": "kline:hithink_finance", "providerName": "HiThinkFinanceFetcher", "markets": ["cn"], "availabilityKey": "hithink_finance"},
        {"sourceId": "news:finance_rss", "name": "财经资讯 RSS 聚合", "kind": "news", "description": "免密钥定向检索财经媒体、企业公告线与监管机构；只保存标题、摘要、时间、来源和原文链接。", "connectionKey": "news:finance_rss", "providerName": "FinanceRSS", "includedSources": [dict(source) for source in DEFAULT_FINANCE_NEWS_SOURCES], "markets": ["cn", "hk", "us"], "availabilityKey": "always"},
        {"sourceId": "news:searxng", "name": "SearXNG 新闻搜索", "kind": "news", "description": "指定 SearXNG；可使用自建实例或系统允许的公共实例。", "connectionKey": "news:searxng", "providerName": "SearXNG", "markets": ["cn", "hk", "us"], "availabilityKey": "searxng"},
        {"sourceId": "news:bocha", "name": "Bocha 新闻搜索", "kind": "news", "description": "指定 Bocha 中文搜索，需要先配置 API Key。", "connectionKey": "news:bocha", "providerName": "Bocha", "markets": ["cn", "hk", "us"], "availabilityKey": "bocha"},
        {"sourceId": "news:tavily", "name": "Tavily 新闻搜索", "kind": "news", "description": "指定 Tavily 新闻搜索，需要先配置 API Key。", "connectionKey": "news:tavily", "providerName": "Tavily", "markets": ["cn", "hk", "us"], "availabilityKey": "tavily"},
        {"sourceId": "news:brave", "name": "Brave 新闻搜索", "kind": "news", "description": "指定 Brave Search，需要先配置 API Key。", "connectionKey": "news:brave", "providerName": "Brave", "markets": ["cn", "hk", "us"], "availabilityKey": "brave"},
        {"sourceId": "news:serpapi", "name": "SerpAPI 新闻搜索", "kind": "news", "description": "指定 SerpAPI，需要先配置 API Key。", "connectionKey": "news:serpapi", "providerName": "SerpAPI", "markets": ["cn", "hk", "us"], "availabilityKey": "serpapi"},
        {"sourceId": "news:minimax", "name": "MiniMax Web Search", "kind": "news", "description": "指定 MiniMax Web Search，需要先配置 API Key。", "connectionKey": "news:minimax", "providerName": "MiniMax", "markets": ["cn", "hk", "us"], "availabilityKey": "minimax"},
        {"sourceId": "news:anspire", "name": "Anspire 新闻搜索", "kind": "news", "description": "指定 Anspire Search，需要先配置 API Key。", "connectionKey": "news:anspire", "providerName": "Anspire", "markets": ["cn", "hk", "us"], "availabilityKey": "anspire"},
        {"sourceId": "fundamentals:akshare", "name": "AkShare 基本面", "kind": "fundamentals", "description": "指定 AkShare 基本面适配器，主要用于 A 股。", "connectionKey": "fundamentals:akshare", "providerName": "AkShare", "markets": ["cn"], "availabilityKey": "fundamentals"},
        {"sourceId": "fundamentals:yfinance", "name": "YFinance 基本面", "kind": "fundamentals", "description": "指定 YFinance 基本面适配器，主要用于海外市场。", "connectionKey": "fundamentals:yfinance", "providerName": "YFinance", "markets": ["hk", "us", "jp", "kr", "tw"], "availabilityKey": "fundamentals"},
        {"sourceId": "macro:fred", "name": "FRED 官方宏观数据", "kind": "macro", "description": "美国圣路易斯联储官方序列：美债收益率、实际利率、信用利差、通胀和就业；需要 FRED_API_KEY。", "connectionKey": "macro:fred", "providerName": "FredMacroFetcher", "markets": ["cn", "hk", "us"], "availabilityKey": "fred"},
        {"sourceId": "macro:apocdata", "name": "ApocData 中国宏观", "kind": "macro", "description": "免密钥公共接口，提供中国 GDP、CPI、PPI 和 PMI；属于第三方聚合数据，运行时保留来源与时间。", "connectionKey": "macro:apocdata", "providerName": "ApocDataMacroFetcher", "markets": ["cn", "hk"], "availabilityKey": "always"},
        {"sourceId": "macro:yfinance", "name": "YFinance 宏观行情代理", "kind": "macro", "description": "免密钥高频市场观测：美债 10Y、美元、人民币、日元、VIX、原油和铜；不替代官方低频宏观发布。", "connectionKey": "macro:yfinance", "providerName": "YfinanceFetcher", "markets": ["cn", "hk", "us"], "availabilityKey": "always"},
    )

    DATA_SOURCE_SETUP = {
        "system_market_data": {"accessMode": "automatic", "setupUrl": None, "configurationKeys": []},
        "local_stock_daily": {"accessMode": "local", "setupUrl": None, "configurationKeys": []},
        "system_news": {"accessMode": "automatic", "setupUrl": None, "configurationKeys": []},
        "system_fundamentals": {"accessMode": "automatic", "setupUrl": None, "configurationKeys": []},
        "system_macro_data": {"accessMode": "automatic", "setupUrl": None, "configurationKeys": []},
        "system_sentiment": {"accessMode": "automatic", "setupUrl": None, "configurationKeys": []},
        "kline:tencent": {"accessMode": "no_credential", "setupUrl": "https://gu.qq.com/", "configurationKeys": []},
        "kline:akshare": {"accessMode": "no_credential", "setupUrl": "https://akshare.akfamily.xyz/tutorial.html", "configurationKeys": []},
        "kline:baostock": {"accessMode": "no_credential", "setupUrl": "https://baostock.com/", "configurationKeys": []},
        "kline:yfinance": {"accessMode": "no_credential", "setupUrl": "https://ranaroussi.github.io/yfinance/", "configurationKeys": []},
        "kline:efinance": {"accessMode": "no_credential", "setupUrl": "https://github.com/Micro-sheep/efinance", "configurationKeys": []},
        "kline:pytdx": {"accessMode": "no_credential", "setupUrl": "https://github.com/rainx/pytdx", "configurationKeys": ["PYTDX_SERVERS"]},
        "kline:tushare": {"accessMode": "token", "setupUrl": "https://tushare.pro/document/1?doc_id=37", "configurationKeys": ["TUSHARE_TOKEN"]},
        "kline:hithink_finance": {"accessMode": "api_key", "setupUrl": "https://github.com/HiThink-Tech/Financial-API", "configurationKeys": ["HITHINK_FINANCE_API_KEY"]},
        "news:finance_rss": {"accessMode": "no_credential", "setupUrl": None, "configurationKeys": []},
        "news:searxng": {"accessMode": "base_url", "setupUrl": "https://docs.searxng.org/dev/search_api.html", "configurationKeys": ["SEARXNG_BASE_URLS"]},
        "news:bocha": {"accessMode": "api_key", "setupUrl": "https://open.bocha.cn/", "configurationKeys": ["BOCHA_API_KEYS"]},
        "news:tavily": {"accessMode": "api_key", "setupUrl": "https://app.tavily.com/", "configurationKeys": ["TAVILY_API_KEYS"]},
        "news:brave": {"accessMode": "api_key", "setupUrl": "https://api-dashboard.search.brave.com/app/keys", "configurationKeys": ["BRAVE_API_KEYS"]},
        "news:serpapi": {"accessMode": "api_key", "setupUrl": "https://serpapi.com/manage-api-key", "configurationKeys": ["SERPAPI_API_KEYS"]},
        "news:minimax": {"accessMode": "api_key", "setupUrl": "https://platform.minimaxi.com/", "configurationKeys": ["MINIMAX_API_KEYS"]},
        "news:anspire": {"accessMode": "api_key", "setupUrl": "https://open.anspire.cn/", "configurationKeys": ["ANSPIRE_API_KEYS"]},
        "fundamentals:akshare": {"accessMode": "no_credential", "setupUrl": "https://akshare.akfamily.xyz/tutorial.html", "configurationKeys": ["ENABLE_FUNDAMENTAL_PIPELINE"]},
        "fundamentals:yfinance": {"accessMode": "no_credential", "setupUrl": "https://ranaroussi.github.io/yfinance/", "configurationKeys": ["ENABLE_FUNDAMENTAL_PIPELINE"]},
        "macro:fred": {"accessMode": "api_key", "setupUrl": "https://fred.stlouisfed.org/docs/api/api_key.html", "configurationKeys": ["FRED_API_KEY"]},
        "macro:apocdata": {"accessMode": "no_credential", "setupUrl": "https://github.com/ApocData/ApocData-skill", "configurationKeys": []},
        "macro:yfinance": {"accessMode": "no_credential", "setupUrl": "https://ranaroussi.github.io/yfinance/", "configurationKeys": []},
    }

    def __init__(self, db_manager: Optional[DatabaseManager] = None, actor_id: str = "local-admin"):
        self.db = db_manager or DatabaseManager.get_instance()
        self.actor_id = actor_id
        self.validator = StrategyGraphValidator()

    # --- Strategy and draft lifecycle -------------------------------------------------
    def create_strategy(self, payload: dict[str, Any], request_id: Optional[str] = None) -> dict[str, Any]:
        name = self._required(payload.get("name"), "STRATEGY_NAME_REQUIRED", "策略名称不能为空。", 120)
        description = self._text(payload.get("description"), 4000)
        template = self._strategy_template(payload.get("templateId"))
        based_on_version_id = self._integer(payload.get("basedOnVersionId"))
        kernel_version_id = self._integer(payload.get("kernelVersionId"))
        if sum(bool(item) for item in (template, based_on_version_id, kernel_version_id)) > 1:
            raise StrategyDefinitionError(
                "STRATEGY_CREATE_SOURCE_CONFLICT",
                "策略只能选择一个创建来源。",
            )
        workflow_version_id = None
        if template:
            from src.services.agent_center_service import AgentCenterService
            published_workflows = AgentCenterService(self.db).list_published_workflow_versions()
            compatible = next(
                (
                    item for item in published_workflows
                    if item.get("workflowName") == "标准多 Agent 研究工作流"
                    and item.get("outputContract") == "DecisionProposal"
                ),
                None,
            ) or next(
                (item for item in published_workflows if item.get("outputContract") == "DecisionProposal"),
                None,
            )
            if not compatible:
                raise StrategyDefinitionError(
                    "AGENT_WORKFLOW_VERSION_REQUIRED",
                    "官方策略模板需要能力中心至少存在一个已发布的交易决策工作流。",
                    409,
                )
            workflow_version_id = compatible["id"]
        with self.db.session_scope() as session:
            if session.execute(select(SimulationStrategyRecord.id).where(SimulationStrategyRecord.name == name)).scalar_one_or_none():
                raise StrategyDefinitionError("DATABASE_CONFLICT", "策略名称已存在。", 409)
            source_id = kernel_version_id or based_on_version_id
            source = self._version(session, source_id) if source_id else None
            source_strategy = self._strategy(session, source.strategy_id) if source else None
            source_config = self._load(source.config_json) if source else {}
            source_is_kernel = bool(
                source
                and (
                    source_config.get("productRole") == "kernel"
                    or source_strategy.name in {
                        self.DAILY_RESEARCH_STRATEGY_NAME,
                        self.DAILY_SCREENING_STRATEGY_NAME,
                        self.DAILY_TRADING_STRATEGY_NAME,
                    }
                )
            )
            if kernel_version_id and not source_is_kernel:
                raise StrategyDefinitionError(
                    "STRATEGY_KERNEL_REQUIRED",
                    "只能从策略中心的策略内核创建运行配置。",
                    409,
                )
            if based_on_version_id and source and (source.status != "PUBLISHED" or not source.immutable):
                raise StrategyDefinitionError(
                    "STRATEGY_COPY_SOURCE_NOT_PUBLISHED",
                    "只能复制正式发布且不可变的策略版本。",
                    409,
                )
            strategy = SimulationStrategyRecord(name=name, description=description, lifecycle_status="draft", revision=1)
            session.add(strategy); session.flush()
            screening_policy = self._load(source.screening_policy_json) if source else self._template_screening_policy(template)
            data_source_config = self._effective_data_source_config(self._load(source.data_permission_snapshot_json)) if source else self._template_data_source_config(template)
            kernel_source_version_id = (
                self._integer(source_config.get("kernelSourceVersionId"))
                if source and not kernel_version_id
                else source.id if source else None
            )
            draft_config: dict[str, Any] = {"productRole": "configured"}
            if kernel_source_version_id:
                draft_config["kernelSourceVersionId"] = kernel_source_version_id
            if isinstance(source_config.get("strategyPackage"), dict):
                draft_config["strategyPackage"] = source_config["strategyPackage"]
            draft = SimulationStrategyVersionRecord(
                strategy_id=strategy.id, version=1, config_json=self._dump(draft_config), status="DRAFT", immutable=False, revision=1,
                strategy_purpose=(source.strategy_purpose or "trading_decision") if source else "trading_decision",
                agent_workflow_version_id=source.agent_workflow_version_id if source else workflow_version_id,
                objective=source.objective if source else template.get("description") if template else None,
                market_scope_json=source.market_scope_json if source else "{}",
                time_horizon=source.time_horizon if source else None,
                risk_policy_json=source.risk_policy_json if source else self._dump(template.get("risk_rules") or {}) if template else "{}",
                decision_policy_json=source.decision_policy_json if source else "{}",
                memory_policy_json=source.memory_policy_json if source else "{}",
                data_permission_snapshot_json=self._dump(data_source_config),
                screening_policy_json=self._dump(screening_policy),
                based_on_version_id=source.id if source else None,
            )
            session.add(draft); session.flush()
            if source:
                old_agents = session.execute(select(SimulationAgentInstanceRecord).where(
                    SimulationAgentInstanceRecord.strategy_version_id == source.id,
                )).scalars().all()
                mapping: dict[int, int] = {}
                for old in old_agents:
                    if old.agent_type == "INPUT":
                        continue
                    clone = self._clone_agent(old, draft.id, uuid.uuid4().hex)
                    session.add(clone); session.flush(); mapping[old.id] = clone.id
                for old in session.execute(select(SimulationAgentConnectionRecord).where(
                    SimulationAgentConnectionRecord.strategy_version_id == source.id,
                )).scalars().all():
                    if old.source_agent_id not in mapping or old.target_agent_id not in mapping:
                        continue
                    session.add(SimulationAgentConnectionRecord(
                        strategy_version_id=draft.id,
                        source_agent_id=mapping[old.source_agent_id],
                        target_agent_id=mapping[old.target_agent_id],
                        connection_type=old.connection_type,
                        condition=old.condition,
                        field_mapping_json=old.field_mapping_json,
                    ))
                self._snapshot(session, draft)
            elif template:
                from src.services.agent_center_service import AgentCenterService
                agents, connections = AgentCenterService(self.db).workflow_snapshot(session, workflow_version_id)
                self._replace_graph(session, draft, agents, connections)
                self._snapshot(session, draft)
            strategy.active_draft_version_id = draft.id
            self._audit(session, "STRATEGY_CREATED", "Strategy", strategy.id, strategy.id, draft.id, None, {"name": name, "basedOnVersionId": based_on_version_id, "kernelVersionId": kernel_version_id}, request_id)
            self._audit(session, "DRAFT_CREATED", "StrategyVersion", draft.id, strategy.id, draft.id, None, {"status": "DRAFT"}, request_id)
            session.flush()
            return {"strategy": self._strategy_summary(session, strategy), "draft": self._version_detail(session, draft)}

    @staticmethod
    def _strategy_template(template_id: Optional[str]) -> dict[str, Any]:
        if not template_id:
            return {}
        template = next((item for item in SimulationStrategyService().list_templates() if item.get("id") == template_id), None)
        if not template:
            raise StrategyDefinitionError("STRATEGY_TEMPLATE_NOT_FOUND", "策略模板不存在。", 404)
        return template

    def list_strategies(self, include_archived: bool = False) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            statement = select(SimulationStrategyRecord).order_by(desc(SimulationStrategyRecord.updated_at))
            if not include_archived:
                statement = statement.where(SimulationStrategyRecord.archived_at.is_(None))
            return [self._strategy_summary(session, row) for row in session.execute(statement).scalars().all()]

    def ensure_daily_product_strategies(self) -> list[dict[str, Any]]:
        """Create starter kernels and usable configurations, including screening rules.

        This is an explicit bootstrap operation used by the Strategy Center
        API.  It deliberately does not run a report or screening task.  Each
        version binds a published workflow and freezes the same inputs and
        compatibility parameters consumed by the existing mature executors.
        Starter configurations are ordinary user-visible strategies: they can
        be copied, edited or deleted and carry no separate "Daily" category.
        An archived preset is not recreated, so deleting it remains durable.
        """
        from src.services.agent_center_service import AgentCenterService
        from src.strategy_kernels.catalog import builtin_package

        workflows = AgentCenterService(self.db).list_published_workflow_versions()
        workflow_by_name = {item.get("workflowName"): item for item in workflows}
        presets = (
            {
                "name": self.DAILY_RESEARCH_STRATEGY_NAME,
                "description": "参考成熟单股分析流程生成可解释研究报告；股票在每次研究时指定，不进入回测或交易运行。",
                "workflowName": self.DAILY_RESEARCH_WORKFLOW_NAME,
                "purpose": "research_report",
                "objective": "运行时指定一只 A 股后，汇集真实行情、筹码、基本面、新闻、技术趋势和市场环境，先完成确定性证据处理，再生成带引用、数据覆盖和风险说明的综合研究报告；它不进入交易回测，也不产生订单。",
                "marketScope": {"universeMode": "runtime_symbol", "symbols": []},
                "timeHorizon": "single_research_run",
                "screeningPolicy": {"strategy": "single_stock_research", "market": "cn", "maxCandidates": 1},
                "decisionPolicy": {
                    "executorProfile": "daily_stock_analysis",
                    "reportType": "detailed",
                    "analysisPhase": "auto",
                    "evidenceModules": [
                        "historical_kline",
                        "realtime_quote",
                        "chip_distribution",
                        "fundamentals",
                        "technical_trend",
                        "news_intelligence",
                        "market_context",
                    ],
                    "missingEvidencePolicy": "retain_reason_and_continue",
                    "outputContract": "ResearchReport",
                    "runInterval": "on_demand",
                },
                "memoryPolicy": {
                    "persistReport": True,
                    "persistEvidenceProvenance": True,
                    "bindRuntimeSymbol": True,
                },
            },
            {
                "name": self.DAILY_SCREENING_STRATEGY_NAME,
                "description": "参考成熟选股扫描流程，从真实市场快照经硬筛、因子评分与可选 LLM 重排生成候选清单。",
                "workflowName": self.DAILY_SCREENING_WORKFLOW_NAME,
                "purpose": "candidate_screening",
                "objective": "从真实 A 股市场快照出发，先执行确定性硬筛与多因子评分，再在候选池内进行可选 LLM 重排，输出带排名、入选依据、风险和降级说明的候选清单；它不产生交易指令或订单。",
                "marketScope": {"universeMode": "screening", "symbols": []},
                "timeHorizon": "market_snapshot",
                "screeningPolicy": {"strategy": "dual_low", "market": "cn", "maxCandidates": 3},
                "decisionPolicy": {
                    "executorProfile": "daily_stock_screening",
                    "hardFilterFirst": True,
                    "dailyEnrichment": "when_required_or_enabled",
                    "factorScoring": True,
                    "candidateContext": True,
                    "llmRerank": "when_configured",
                    "llmCandidatePoolOnly": True,
                    "llmFailureFallback": "screen_score",
                    "riskOverlay": True,
                    "postAnalyzers": ["scorecard"],
                    "outputContract": "CandidateList",
                    "runInterval": "on_demand",
                },
                "memoryPolicy": {
                    "persistScreeningRun": True,
                    "persistCandidateEvidence": True,
                    "persistDegradationReasons": True,
                },
            },
            {
                "name": self.DAILY_TRADING_STRATEGY_NAME,
                "description": "使用真实 A 股候选筛选与研究输入生成可回测的研究决策提案；它是研究基线，不执行订单，也不代表已经验证有效。",
                "workflowName": self.DAILY_TRADING_WORKFLOW_NAME,
                "purpose": "trading_decision",
                "objective": "从真实 A 股双低候选池开始，把候选市场快照与可用的基本面、新闻证据交给分析、决策和复盘步骤，形成可回测的结构化 DecisionProposal；它只提供研究决策，不执行订单，也不代表已经验证有效。",
                "marketScope": {"universeMode": "screening", "symbols": []},
                "timeHorizon": "daily_research_cycle",
                "screeningPolicy": {"strategy": "dual_low", "market": "cn", "maxCandidates": 3},
                "decisionPolicy": {
                    "executorProfile": "daily_research_decision",
                    "candidateSource": "daily_stock_screening",
                    "evidenceSource": "daily_stock_analysis",
                    "outputContract": "DecisionProposal",
                    "executionBoundary": "research_only",
                    "runInterval": "1d",
                },
                "riskPolicy": {
                    "max_asset_weight": 0.2,
                    "decision_validity": {"max": "1d"},
                },
                "memoryPolicy": {
                    "persistDecisionProposal": True,
                    "persistEvidenceProvenance": True,
                    "persistReflection": True,
                },
            },
        )
        for preset in presets:
            output_contract = str(preset["decisionPolicy"]["outputContract"])
            preset["strategyPackage"] = builtin_package(
                preset["name"],
                purpose=preset["purpose"],
                output_contract=output_contract,
                timeframe=preset["timeHorizon"],
                run_interval=str(preset["decisionPolicy"]["runInterval"]),
            )
        with self.db.session_scope() as session:
            for preset in presets:
                existing = session.execute(select(SimulationStrategyRecord).where(
                    SimulationStrategyRecord.name == preset["name"],
                )).scalar_one_or_none()
                if not existing:
                    legacy_name = self.LEGACY_DAILY_STRATEGY_NAMES[preset["name"]]
                    existing = session.execute(select(SimulationStrategyRecord).where(
                        SimulationStrategyRecord.name == legacy_name,
                    )).scalar_one_or_none()
                    if existing:
                        existing.name = preset["name"]
                        existing.description = preset["description"]
                        session.flush()
                workflow = workflow_by_name.get(preset["workflowName"])
                if not workflow:
                    raise StrategyDefinitionError(
                        "DAILY_WORKFLOW_NOT_FOUND",
                        f"系统工作流“{preset['workflowName']}”不存在，无法创建 Daily 策略。",
                        500,
                    )
                if existing and existing.archived_at is not None:
                    continue
                strategy = existing
                current_version = session.get(SimulationStrategyVersionRecord, strategy.current_published_version_id) if strategy and strategy.current_published_version_id else None
                current_package = self._load(current_version.config_json).get("strategyPackage") if current_version else None
                if isinstance(current_package, dict) and current_package.get("sha256") == preset["strategyPackage"]["sha256"]:
                    continue
                if strategy is None:
                    strategy = SimulationStrategyRecord(
                        name=preset["name"],
                        description=preset["description"],
                        lifecycle_status="published",
                        revision=1,
                    )
                    session.add(strategy)
                    session.flush()
                else:
                    strategy.description = preset["description"]
                    strategy.lifecycle_status = "published"
                    strategy.revision += 1
                    strategy.updated_at = utc_naive_now()
                now = utc_naive_now()
                next_version = (session.execute(select(func.max(SimulationStrategyVersionRecord.version)).where(SimulationStrategyVersionRecord.strategy_id == strategy.id)).scalar() or 0) + 1
                next_number = (session.execute(select(func.max(SimulationStrategyVersionRecord.version_number)).where(SimulationStrategyVersionRecord.strategy_id == strategy.id)).scalar() or 0) + 1
                version = SimulationStrategyVersionRecord(
                    strategy_id=strategy.id,
                    version=int(next_version),
                    config_json=self._dump({"productRole": "kernel", "strategyPackage": preset["strategyPackage"]}),
                    version_number=int(next_number),
                    status="PUBLISHED",
                    immutable=True,
                    revision=1,
                    based_on_version_id=current_version.id if current_version else None,
                    strategy_purpose=preset["purpose"],
                    agent_workflow_version_id=int(workflow["id"]),
                    objective=preset["objective"],
                    market_scope_json=self._dump(preset["marketScope"]),
                    time_horizon=preset["timeHorizon"],
                    decision_policy_json=self._dump(preset["decisionPolicy"]),
                    risk_policy_json=self._dump(preset.get("riskPolicy") or {}),
                    memory_policy_json=self._dump(preset["memoryPolicy"]),
                    data_permission_snapshot_json=self._dump(
                        self._builtin_data_source_config(preset["strategyPackage"])
                    ),
                    screening_policy_json=self._dump(preset["screeningPolicy"]),
                    change_log="迁移为统一 Python 策略内核入口并补齐数据依赖契约" if current_version else "参考成熟项目链路生成的初始正式策略内核",
                    published_at=now,
                    last_validated_at=now,
                )
                session.add(version)
                session.flush()
                agents, connections = AgentCenterService(self.db).workflow_snapshot(session, int(workflow["id"]))
                self._replace_graph(session, version, agents, connections)
                self._snapshot(session, version)
                validation = self._validate_session(session, version)
                if not validation["valid"]:
                    raise StrategyDefinitionError(
                        "DAILY_STRATEGY_INVALID",
                        f"初始策略“{preset['name']}”未通过校验。",
                        500,
                        {"errors": validation["errors"]},
                    )
                strategy.current_published_version_id = version.id
                self._audit(
                    session,
                    "STRATEGY_SYSTEM_PRESET_PUBLISHED",
                    "StrategyVersion",
                    version.id,
                    strategy.id,
                    version.id,
                    None,
                    {
                        "strategyPurpose": preset["purpose"],
                        "workflowVersionId": int(workflow["id"]),
                        "versionNumber": int(next_number),
                        "entrypoint": preset["strategyPackage"]["entrypoint"],
                    },
                    "system-daily-preset-bootstrap",
                )

            configuration_names = {
                self.DAILY_RESEARCH_STRATEGY_NAME: "单股研究 · A股配置",
                self.DAILY_SCREENING_STRATEGY_NAME: "多因子选股 · A股配置",
                self.DAILY_TRADING_STRATEGY_NAME: "研究决策 · A股日线配置",
            }
            # Reuse the shipped screening rules and the same execution kernel.
            # Each rule gets an immutable configuration, not a parallel Agent.
            from src.services.screening.config import Config as ScreeningConfig
            from src.services.screening.strategy import load_all_strategies

            screening_rules = load_all_strategies(ScreeningConfig().strategies_dir)
            screening_preset = next(p for p in presets if p["purpose"] == "candidate_screening")
            configurations = list(presets)
            research_preset = next(p for p in presets if p["purpose"] == "research_report")
            for market, label in (("hk", "港股"), ("us", "美股")):
                configurations.append({
                    **research_preset,
                    "configurationName": f"单股研究 · {label}配置",
                    "configurationDescription": f"使用现有单股研究内核分析{label}，核验行情、趋势、新闻与基本面；不可用的数据明确标注，不产生订单。",
                    "configurationPolicy": {"strategy": "single_stock_research", "market": market, "maxCandidates": 1},
                    "configurationObjective": f"研究运行时指定的{label}股票，使用该市场真实数据形成研究结论、风险和失效条件；不套用 A 股特有数据或交易制度。",
                })
            for label, skill_ids in (
                ("成长质量研究", ["growth_quality"]),
                ("事件驱动研究", ["event_driven"]),
                ("趋势量价研究", ["bull_trend", "volume_breakout", "shrink_pullback"]),
                ("预期重估研究", ["expectation_repricing"]),
            ):
                configurations.append({
                    **research_preset,
                    "configurationName": f"{label} · A股配置",
                    "configurationDescription": f"使用 {label} 方法准备分析并生成正式报告，明确证据、反例与失效条件。",
                    "configurationParameters": {"skills": skill_ids},
                })
            for rule in screening_rules.values():
                if rule.name == "dual_low" or not rule.screening.enabled or "cn" not in rule.screening.market_scope:
                    continue
                configurations.append({
                    **screening_preset,
                    "configurationName": f"{rule.display_name} · A股配置",
                    "configurationDescription": rule.description,
                    "configurationPolicy": {
                        "strategy": rule.name, "market": "cn",
                        "maxCandidates": rule.screening.max_output,
                    },
                })
            for preset in configurations:
                kernel_strategy = session.execute(select(SimulationStrategyRecord).where(
                    SimulationStrategyRecord.name == preset["name"],
                    SimulationStrategyRecord.archived_at.is_(None),
                )).scalar_one_or_none()
                kernel_version = session.get(
                    SimulationStrategyVersionRecord,
                    kernel_strategy.current_published_version_id if kernel_strategy else None,
                )
                if not kernel_strategy or not kernel_version:
                    continue
                configuration_name = preset.get("configurationName") or configuration_names[preset["name"]]
                configured_strategy = session.execute(select(SimulationStrategyRecord).where(
                    SimulationStrategyRecord.name == configuration_name,
                )).scalar_one_or_none()
                if configured_strategy and configured_strategy.archived_at is not None:
                    continue
                configured_current = (
                    session.get(SimulationStrategyVersionRecord, configured_strategy.current_published_version_id)
                    if configured_strategy and configured_strategy.current_published_version_id
                    else None
                )
                configured_current_config = self._load(configured_current.config_json) if configured_current else {}
                # Never take ownership of a same-named strategy created by the
                # user before this bootstrap marker existed. Early system
                # configurations predate the marker, so accept only the
                # server-authored audit event as durable proof of ownership.
                system_owned_configuration = bool(
                    configured_current_config.get("systemPresetConfiguration")
                ) or bool(
                    configured_strategy
                    and session.execute(select(SimulationAuditEventRecord.id).where(
                        SimulationAuditEventRecord.strategy_id == configured_strategy.id,
                        SimulationAuditEventRecord.action == "STRATEGY_SYSTEM_CONFIGURATION_PUBLISHED",
                        SimulationAuditEventRecord.request_id == "system-starter-configuration-bootstrap",
                    ).limit(1)).scalar_one_or_none()
                )
                if configured_strategy and not system_owned_configuration:
                    continue
                kernel_package = self._load(kernel_version.config_json).get("strategyPackage")
                configured_package = configured_current_config.get("strategyPackage")
                starter_symbols = self._starter_backtest_symbols(session) if preset["purpose"] == "trading_decision" else []
                desired_backtest_profile = self.STARTER_BACKTEST_PROFILE if starter_symbols else None
                needs_backtest_profile_upgrade = bool(
                    desired_backtest_profile
                    and configured_current_config.get("systemPresetConfigurationProfile") != desired_backtest_profile
                )
                if (
                    isinstance(kernel_package, dict)
                    and isinstance(configured_package, dict)
                    and kernel_package.get("sha256") == configured_package.get("sha256")
                    and not needs_backtest_profile_upgrade
                ):
                    continue
                configured_market_scope = self._load(kernel_version.market_scope_json)
                configured_screening_policy = self._load(kernel_version.screening_policy_json)
                configured_decision_policy = self._load(kernel_version.decision_policy_json)
                configured_risk_policy = self._load(kernel_version.risk_policy_json)
                configured_objective = kernel_version.objective
                configured_description = f"基于“{preset['name']}”内核的 A 股运行配置。"
                if preset.get("configurationParameters"):
                    configured_decision_policy = {
                        **configured_decision_policy,
                        "packageParameters": preset["configurationParameters"],
                    }
                    configured_description = preset["configurationDescription"]
                    configured_objective = f"{configured_description}。{kernel_version.objective}"
                if preset.get("configurationPolicy"):
                    configured_screening_policy = preset["configurationPolicy"]
                    configured_description = preset["configurationDescription"]
                    configured_objective = f"{configured_description}。{kernel_version.objective}"
                if preset.get("configurationObjective"):
                    configured_objective = preset["configurationObjective"]
                if starter_symbols:
                    configured_market_scope = {
                        "universeMode": "fixed",
                        "market": "cn",
                        "symbols": starter_symbols,
                        "source": "local_stock_daily",
                    }
                    configured_screening_policy = {
                        "strategy": "low_volatility_quality",
                        "market": "cn",
                        "maxCandidates": min(3, len(starter_symbols)),
                    }
                    configured_decision_policy = {
                        **configured_decision_policy,
                        "candidateSource": "fixed_strategy_universe",
                    }
                    configured_risk_policy = {
                        **configured_risk_policy,
                        "max_position_pct": 20,
                    }
                    configured_objective = (
                        "在版本冻结的 A 股股票池内，使用仅依赖历史 OHLCV 的低波动质量规则形成候选，"
                        "并输出结构化 DecisionProposal；该配置可直接进行观察性历史回放，不执行订单，"
                        "也不代表已经验证有效。"
                    )
                    configured_description = (
                        f"基于“{preset['name']}”内核的 A 股固定股票池配置；"
                        "股票来自本地真实日线库，可直接进入观察性历史回放。"
                    )
                if configured_strategy is None:
                    configured_strategy = SimulationStrategyRecord(
                        name=configuration_name,
                        description=configured_description,
                        lifecycle_status="published",
                        revision=1,
                    )
                    session.add(configured_strategy)
                    session.flush()
                else:
                    configured_strategy.description = configured_description
                    configured_strategy.lifecycle_status = "published"
                    configured_strategy.revision += 1
                    configured_strategy.updated_at = utc_naive_now()
                next_version = (session.execute(select(func.max(SimulationStrategyVersionRecord.version)).where(
                    SimulationStrategyVersionRecord.strategy_id == configured_strategy.id,
                )).scalar() or 0) + 1
                next_number = (session.execute(select(func.max(SimulationStrategyVersionRecord.version_number)).where(
                    SimulationStrategyVersionRecord.strategy_id == configured_strategy.id,
                )).scalar() or 0) + 1
                now = utc_naive_now()
                configured_version = SimulationStrategyVersionRecord(
                    strategy_id=configured_strategy.id,
                    version=int(next_version),
                    version_number=int(next_number),
                    config_json=self._dump({
                        "productRole": "configured",
                        "kernelSourceVersionId": kernel_version.id,
                        "strategyPackage": kernel_package,
                        "systemPresetConfiguration": True,
                        "systemPresetConfigurationProfile": desired_backtest_profile,
                    }),
                    status="PUBLISHED",
                    immutable=True,
                    revision=1,
                    based_on_version_id=configured_current.id if configured_current else None,
                    strategy_purpose=kernel_version.strategy_purpose,
                    agent_workflow_version_id=kernel_version.agent_workflow_version_id,
                    objective=configured_objective,
                    market_scope_json=self._dump(configured_market_scope),
                    time_horizon=kernel_version.time_horizon,
                    decision_policy_json=self._dump(configured_decision_policy),
                    risk_policy_json=self._dump(configured_risk_policy),
                    memory_policy_json=kernel_version.memory_policy_json,
                    data_permission_snapshot_json=kernel_version.data_permission_snapshot_json,
                    screening_policy_json=self._dump(configured_screening_policy),
                    change_log=(
                        "冻结本地真实股票池与 OHLCV 可复现规则，使默认交易配置可直接进行正式回放"
                        if starter_symbols
                        else "同步当前 Python 内核并冻结一套可直接使用的 A 股运行配置"
                    ),
                    published_at=now,
                    last_validated_at=now,
                )
                session.add(configured_version)
                session.flush()
                agents, connections = AgentCenterService(self.db).workflow_snapshot(
                    session, int(kernel_version.agent_workflow_version_id)
                )
                self._replace_graph(session, configured_version, agents, connections)
                self._snapshot(session, configured_version)
                validation = self._validate_session(session, configured_version)
                if not validation["valid"]:
                    raise StrategyDefinitionError(
                        "DEFAULT_CONFIGURATION_INVALID",
                        f"初始完整策略“{configuration_name}”未通过校验。",
                        500,
                        {"errors": validation["errors"]},
                    )
                configured_strategy.current_published_version_id = configured_version.id
                configured_strategy.active_draft_version_id = None
                self._audit(
                    session,
                    "STRATEGY_SYSTEM_CONFIGURATION_PUBLISHED",
                    "StrategyVersion",
                    configured_version.id,
                    configured_strategy.id,
                    configured_version.id,
                    None,
                    {"kernelVersionId": kernel_version.id, "versionNumber": int(next_number)},
                    "system-starter-configuration-bootstrap",
                )
            rows = session.execute(select(SimulationStrategyRecord).where(
                SimulationStrategyRecord.name.in_((
                    self.DAILY_RESEARCH_STRATEGY_NAME,
                    self.DAILY_SCREENING_STRATEGY_NAME,
                    self.DAILY_TRADING_STRATEGY_NAME,
                )),
                SimulationStrategyRecord.archived_at.is_(None),
            ).order_by(SimulationStrategyRecord.name)).scalars().all()
            return [self._strategy_summary(session, row) for row in rows]

    @staticmethod
    def _starter_backtest_symbols(session, limit: int = 5) -> list[str]:
        """Return a deterministic, real local A-share universe for the starter replay.

        The bootstrap never invents symbols and never runs a live screener as a
        side effect of listing strategies.  A code is eligible only when the
        local OHLCV store already contains the minimum 22 usable bars required
        by the validation engine.  Once published, the selected list is frozen
        in the immutable StrategyVersion.
        """
        rows = session.execute(
            select(
                StockDaily.code,
                func.count(StockDaily.id).label("bar_count"),
                func.max(StockDaily.date).label("latest_date"),
            )
            .where(StockDaily.open.is_not(None), StockDaily.close.is_not(None))
            .group_by(StockDaily.code)
            .having(func.count(StockDaily.id) >= 22)
            .order_by(desc("latest_date"), desc("bar_count"), StockDaily.code)
        ).all()
        return [
            code
            for raw_code, _bar_count, _latest_date in rows
            if re.fullmatch(r"\d{6}", code := str(raw_code).strip().upper())
        ][:limit]

    @staticmethod
    def _builtin_data_source_config(package: dict[str, Any]) -> dict[str, Any]:
        """Default only the data kinds the trusted kernel actually declares.

        Optional dependencies start enabled so the starter strategies can use
        the mature Daily evidence chain out of the box. Users may disable them
        in a configured StrategyVersion; undeclared sources are never enabled
        merely to make the dependency list look more complete.
        """
        requirements = [
            item for item in package.get("dataRequirements") or []
            if isinstance(item, dict)
        ]
        kinds = {str(item.get("kind") or "") for item in requirements}
        config: dict[str, Any] = {
            "schemaVersion": 3,
            "other": {"enabled": False, "sourceIds": []},
        }
        if "kline" in kinds:
            config["kline"] = {
                "enabled": True,
                "connection": "system_market_data",
                "timeframe": "1d",
            }
        if "news" in kinds:
            config["news"] = {"enabled": True, "connection": "system_news"}
        if "fundamentals" in kinds:
            config["fundamentals"] = {
                "enabled": True,
                "connection": "system_fundamentals",
            }
        other_source_ids = list(dict.fromkeys(
            str(source_id)
            for item in requirements
            if item.get("kind") == "other"
            for source_id in item.get("sourceIds") or []
            if str(source_id)
        ))
        if other_source_ids:
            config["other"] = {"enabled": True, "sourceIds": other_source_ids}
        return config

    def list_agent_templates(self, agent_type: Optional[str] = None, query: Optional[str] = None) -> list[dict[str, Any]]:
        """Return database-backed templates only; seed the official starter set once."""
        with self.db.session_scope() as session:
            self._seed_agent_templates(session)
            statement = select(SimulationAgentTemplateRecord).where(SimulationAgentTemplateRecord.archived_at.is_(None))
            if agent_type:
                statement = statement.where(SimulationAgentTemplateRecord.agent_type == agent_type.upper())
            else:
                # INPUT is retained as a legacy template so immutable historical
                # versions remain readable. New strategy graphs receive data
                # through StrategyVersion configuration instead.
                statement = statement.where(SimulationAgentTemplateRecord.agent_type != "INPUT")
            if query:
                statement = statement.where(SimulationAgentTemplateRecord.name.contains(query.strip()))
            rows = session.execute(statement.order_by(SimulationAgentTemplateRecord.name)).scalars().all()
            return [self._template_summary(session, row) for row in rows]

    # --- Data-source catalog ---------------------------------------------------------
    def list_data_sources(self) -> list[dict[str, Any]]:
        builtins = [
            {
                **item,
                **self.DATA_SOURCE_SETUP[item["sourceId"]],
                "builtIn": True,
                "selectable": bool(item.get("selectable", True)),
                "availability": "system_managed",
            }
            for item in self.BUILTIN_DATA_SOURCES
        ]
        providers = self._provider_data_sources()
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationDataSourceRecord)
                .where(SimulationDataSourceRecord.archived_at.is_(None))
                .order_by(SimulationDataSourceRecord.name)
            ).scalars().all()
            return builtins + providers + [self._data_source_item(row) for row in rows]

    @classmethod
    def _provider_data_sources(cls) -> list[dict[str, Any]]:
        """Expose provider choices without exposing credentials.

        ``configured`` means the local process has enough configuration to try
        the provider. It deliberately does not claim that a remote endpoint is
        healthy; connectivity is still checked and evidenced at run time.
        """
        from src.config import get_config

        config = get_config()
        configured = {
            "always": True,
            "tushare": bool(getattr(config, "tushare_token", None)),
            "hithink_finance": bool(
                getattr(config, "hithink_finance_api_key", "").strip()
                if isinstance(getattr(config, "hithink_finance_api_key", None), str)
                else ""
            ),
            "fred": bool(str(getattr(config, "fred_api_key", None) or "").strip()),
            "searxng": bool(getattr(config, "searxng_base_urls", None)) or bool(getattr(config, "searxng_public_instances_enabled", False)),
            "bocha": bool(getattr(config, "bocha_api_keys", None)),
            "tavily": bool(getattr(config, "tavily_api_keys", None)),
            "brave": bool(getattr(config, "brave_api_keys", None)),
            "serpapi": bool(getattr(config, "serpapi_api_keys", None)),
            "minimax": bool(getattr(config, "minimax_api_keys", None)),
            "anspire": bool(getattr(config, "anspire_api_keys", None)),
            "fundamentals": bool(getattr(config, "enable_fundamental_pipeline", False)),
        }
        return [
            {
                **{key: value for key, value in item.items() if key != "availabilityKey"},
                **cls.DATA_SOURCE_SETUP[item["sourceId"]],
                "required": False,
                "builtIn": True,
                "selectionMode": "provider",
                "selectable": configured.get(str(item["availabilityKey"]), False),
                "availability": "configured" if configured.get(str(item["availabilityKey"]), False) else "unconfigured",
            }
            for item in cls.PROVIDER_DATA_SOURCES
        ]

    def create_data_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._required(payload.get("name"), "DATA_SOURCE_NAME_REQUIRED", "数据源名称不能为空。", 120)
        description = self._text(payload.get("description"), 1000)
        connection_key = self._required(payload.get("connectionKey"), "DATA_SOURCE_CONNECTION_REQUIRED", "请输入系统中已配置的连接标识。", 160)
        setup_url = self._setup_url(payload.get("setupUrl"))
        access_mode = str(payload.get("accessMode") or "custom").strip().lower()
        if access_mode not in {"no_credential", "api_key", "token", "base_url", "account", "custom"}:
            raise StrategyDefinitionError("DATA_SOURCE_ACCESS_MODE_INVALID", "请选择正确的数据源接入方式。")
        source_kind = str(payload.get("kind") or "").strip().lower()
        if source_kind not in {"kline", "news", "fundamentals", "macro", "other"}:
            raise StrategyDefinitionError("DATA_SOURCE_KIND_INVALID", "请选择 K 线、新闻、基本面、宏观或其他数据类型。")
        raw_markets = payload.get("markets") if isinstance(payload.get("markets"), list) else []
        markets = list(dict.fromkeys(str(item).strip().lower() for item in raw_markets if str(item).strip()))
        if not markets or any(item not in {"cn", "hk", "us"} for item in markets):
            raise StrategyDefinitionError("DATA_SOURCE_MARKETS_INVALID", "请至少选择 A 股、港股或美股中的一个适用市场。")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{1,159}", connection_key):
            raise StrategyDefinitionError("DATA_SOURCE_CONNECTION_INVALID", "连接标识只能包含字母、数字、点、下划线、冒号和短横线；请勿在这里填写密钥或 URL。")
        system_catalog = [*self.BUILTIN_DATA_SOURCES, *self._provider_data_sources()]
        if any(item["name"] == name or item["connectionKey"] == connection_key for item in system_catalog):
            raise StrategyDefinitionError("DATA_SOURCE_NAME_CONFLICT", "该名称或连接标识已被系统数据源使用。", 409)
        with self.db.session_scope() as session:
            existing = session.execute(select(SimulationDataSourceRecord.id).where(
                (SimulationDataSourceRecord.name == name) | (SimulationDataSourceRecord.connection_key == connection_key),
                SimulationDataSourceRecord.archived_at.is_(None),
            )).scalar_one_or_none()
            if existing:
                raise StrategyDefinitionError("DATA_SOURCE_NAME_CONFLICT", "数据源名称或连接标识已存在。", 409)
            row = SimulationDataSourceRecord(
                source_key=f"custom:{uuid.uuid4().hex}",
                name=name,
                source_kind=source_kind,
                markets_json=self._dump(markets),
                description=description,
                connection_key=connection_key,
                setup_url=setup_url,
                access_mode=access_mode,
            )
            session.add(row)
            session.flush()
            return self._data_source_item(row)

    def archive_data_source(self, source_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(SimulationDataSourceRecord, source_id)
            if not row or row.archived_at is not None:
                raise StrategyDefinitionError("DATA_SOURCE_NOT_FOUND", "自定义数据源不存在。", 404)
            row.archived_at = utc_naive_now()
            return {**self._data_source_item(row), "archived": True}

    def get_agent_template(self, template_id: int, version: Optional[int] = None) -> dict[str, Any]:
        with self.db.get_session() as session:
            template = session.get(SimulationAgentTemplateRecord, template_id)
            if not template:
                raise StrategyDefinitionError("AGENT_TEMPLATE_NOT_FOUND", "Agent 模板不存在。", 404)
            number = version or template.current_version
            row = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == template.id,
                SimulationAgentTemplateVersionRecord.version == number,
            )).scalar_one_or_none()
            if not row:
                raise StrategyDefinitionError("AGENT_TEMPLATE_VERSION_NOT_FOUND", "Agent 模板版本不存在。", 404)
            return self._template_detail(template, row)

    def get_strategy(self, strategy_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            return self._strategy_detail(session, self._strategy(session, strategy_id))

    def get_version(self, version_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            return self._version_detail(session, self._version(session, version_id))

    def archive_strategy(self, strategy_id: int, request_id: Optional[str] = None) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = self._strategy(session, strategy_id)
            if not row.archived_at:
                row.archived_at = utc_naive_now(); row.lifecycle_status = "archived"; row.revision += 1
                self._audit(session, "STRATEGY_ARCHIVED", "Strategy", row.id, row.id, None, None, {"archived": True}, request_id)
            return self._strategy_summary(session, row)

    def get_deletion_impact(self, strategy_id: int) -> dict[str, Any]:
        """Describe the server-authoritative confirmation and runtime impact."""
        with self.db.get_session() as session:
            strategy = self._strategy(session, strategy_id)
            return self._deletion_impact(session, strategy)

    def delete_strategy(
        self,
        strategy_id: int,
        *,
        confirmed: bool = False,
        request_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Soft-delete one strategy while cooperatively stopping active research.

        Published definitions and their validation/audit history remain intact.
        This avoids breaking reproducibility while removing the strategy from
        every active selection surface.
        """
        control_ids: list[int] = []
        with self.db.session_scope() as session:
            strategy = self._strategy(session, strategy_id)
            impact = self._deletion_impact(session, strategy)
            if impact["requiresConfirmation"] and not confirmed:
                raise StrategyDefinitionError(
                    "STRATEGY_DELETE_CONFIRMATION_REQUIRED",
                    "已发布或正在运行的策略必须确认影响后才能删除。",
                    409,
                    impact,
                )
            if strategy.archived_at:
                return {
                    "strategyId": strategy.id,
                    "deleted": True,
                    "deletedAt": self._iso(strategy.archived_at),
                    "wasPublished": impact["hasPublishedVersion"],
                    "terminatedContinuousRuns": 0,
                    "cancelledResearchRuns": 0,
                    "historyRetained": True,
                }

            version_ids = session.execute(
                select(SimulationStrategyVersionRecord.id).where(
                    SimulationStrategyVersionRecord.strategy_id == strategy.id
                )
            ).scalars().all()
            now = utc_naive_now()
            controls = session.execute(
                select(SimulationStrategyRunControlRecord).where(
                    SimulationStrategyRunControlRecord.strategy_version_id.in_(version_ids),
                    SimulationStrategyRunControlRecord.status != "terminated",
                )
            ).scalars().all() if version_ids else []
            for control in controls:
                control.status = "terminated"
                control.next_run_at = None
                control.error_message = "策略已删除，持续研究运行已终止。"
                control_ids.append(control.id)

            batches = session.execute(
                select(SimulationStrategyRunBatchRecord).where(
                    SimulationStrategyRunBatchRecord.strategy_version_id.in_(version_ids),
                    SimulationStrategyRunBatchRecord.status.in_(("queued", "running")),
                )
            ).scalars().all() if version_ids else []
            for batch in batches:
                batch.status = "cancelled"
                batch.completed_at = now
                batch.error_message = "策略已删除，本次研究批次已终止。"

            runs = session.execute(
                select(SimulationRunRecord).where(
                    SimulationRunRecord.strategy_version_id.in_(version_ids),
                    SimulationRunRecord.status.in_(("queued", "running")),
                )
            ).scalars().all() if version_ids else []
            for run in runs:
                run.status = "cancelled"
                run.completed_at = now
                run.error_message = "策略已删除，本次 Agent 研究运行已终止。"

            strategy.archived_at = now
            strategy.lifecycle_status = "deleted"
            strategy.enabled = False
            strategy.revision += 1
            after = {
                "deleted": True,
                "historyRetained": True,
                "terminatedContinuousRuns": len(controls),
                "cancelledResearchRuns": len(batches) + len(runs),
            }
            self._audit(
                session, "STRATEGY_DELETED", "Strategy", strategy.id, strategy.id, None,
                impact, after, request_id,
            )
            result = {
                "strategyId": strategy.id,
                "deleted": True,
                "deletedAt": self._iso(now),
                "wasPublished": impact["hasPublishedVersion"],
                **after,
            }

        if control_ids:
            # Wake the registered singleton workers so they observe the durable
            # terminated state immediately instead of waiting until next_run_at.
            from src.services.strategy_continuous_run_service import StrategyContinuousRunService
            StrategyContinuousRunService.wake_registered_controls(control_ids)
        return result

    def _deletion_impact(self, session, strategy: SimulationStrategyRecord) -> dict[str, Any]:
        version_ids = session.execute(
            select(SimulationStrategyVersionRecord.id).where(
                SimulationStrategyVersionRecord.strategy_id == strategy.id
            )
        ).scalars().all()
        if not version_ids:
            return {
                "strategyId": strategy.id, "strategyName": strategy.name,
                "hasPublishedVersion": False, "publishedVersionCount": 0,
                "isRunning": False, "activeContinuousRunCount": 0,
                "activeResearchRunCount": 0, "requiresConfirmation": False,
            }
        published_count = session.execute(select(func.count(SimulationStrategyVersionRecord.id)).where(
            SimulationStrategyVersionRecord.id.in_(version_ids),
            SimulationStrategyVersionRecord.status == "PUBLISHED",
        )).scalar() or 0
        active_controls = session.execute(select(func.count(SimulationStrategyRunControlRecord.id)).where(
            SimulationStrategyRunControlRecord.strategy_version_id.in_(version_ids),
            SimulationStrategyRunControlRecord.status == "running",
        )).scalar() or 0
        active_batches = session.execute(select(func.count(SimulationStrategyRunBatchRecord.id)).where(
            SimulationStrategyRunBatchRecord.strategy_version_id.in_(version_ids),
            SimulationStrategyRunBatchRecord.status.in_(("queued", "running")),
        )).scalar() or 0
        active_runs = session.execute(select(func.count(SimulationRunRecord.id)).where(
            SimulationRunRecord.strategy_version_id.in_(version_ids),
            SimulationRunRecord.status.in_(("queued", "running")),
        )).scalar() or 0
        active_research = int(active_batches) + int(active_runs)
        is_running = bool(active_controls or active_research)
        return {
            "strategyId": strategy.id,
            "strategyName": strategy.name,
            "hasPublishedVersion": bool(published_count),
            "publishedVersionCount": int(published_count),
            "isRunning": is_running,
            "activeContinuousRunCount": int(active_controls),
            "activeResearchRunCount": active_research,
            "requiresConfirmation": bool(published_count or is_running),
        }

    def save_draft(self, draft_id: int, payload: dict[str, Any], request_id: Optional[str] = None) -> dict[str, Any]:
        with self.db.session_scope() as session:
            draft = self._editable_draft(session, draft_id)
            revision = payload.get("revision")
            if revision != draft.revision:
                raise StrategyDefinitionError("VERSION_CONFLICT", "该策略草稿已在其他位置被修改，请刷新后比较差异。", 409, {
                    "clientRevision": revision, "serverRevision": draft.revision, "serverUpdatedAt": self._iso(draft.updated_at),
                })
            strategy = self._strategy(session, draft.strategy_id)
            strategy_data, version_data = payload.get("strategy") or {}, payload.get("version") or {}
            if "name" in strategy_data:
                name = self._required(strategy_data.get("name"), "STRATEGY_NAME_REQUIRED", "策略名称不能为空。", 120)
                duplicate = session.execute(select(SimulationStrategyRecord.id).where(SimulationStrategyRecord.name == name, SimulationStrategyRecord.id != strategy.id)).scalar_one_or_none()
                if duplicate:
                    raise StrategyDefinitionError("DATABASE_CONFLICT", "策略名称已存在。", 409)
                strategy.name = name
            if "description" in strategy_data: strategy.description = self._text(strategy_data.get("description"), 4000)
            self._assign_version(draft, version_data)
            agents = payload.get("agents")
            connections = payload.get("connections")
            if not isinstance(agents, list) or not isinstance(connections, list):
                raise StrategyDefinitionError("VALIDATION_SCHEMA_ERROR", "agents 和 connections 必须是数组。")
            if "agentWorkflowVersionId" in version_data:
                draft.agent_workflow_version_id = self._integer(version_data.get("agentWorkflowVersionId"))
            if draft.agent_workflow_version_id:
                # A published workflow is authoritative on every save. Ignore
                # client-supplied nodes so the frozen graph cannot drift away
                # from the immutable version referenced by StrategyVersion.
                from src.services.agent_center_service import AgentCenterService
                agents, connections = AgentCenterService(self.db).workflow_snapshot(
                    session,
                    draft.agent_workflow_version_id,
                )
            self._replace_graph(session, draft, agents, connections)
            draft.revision += 1; draft.updated_at = utc_naive_now()
            strategy.revision += 1; strategy.updated_at = utc_naive_now()
            session.flush()
            self._snapshot(session, draft)
            validation = self._validate_session(session, draft)
            self._audit(session, "DRAFT_SAVED", "StrategyVersion", draft.id, strategy.id, draft.id, {"revision": revision}, {"revision": draft.revision}, request_id)
            session.flush()
            return {"draftId": draft.id, "revision": draft.revision, "savedAt": self._iso(draft.updated_at), "validationSummary": {"errorCount": len(validation["errors"]), "warningCount": len(validation["warnings"])}, "draft": self._version_detail(session, draft)}

    def validate(self, version_id: int, request_id: Optional[str] = None) -> dict[str, Any]:
        with self.db.session_scope() as session:
            version = self._version(session, version_id)
            validation = self._validate_session(session, version)
            version.last_validated_at = utc_naive_now()
            self._audit(session, "STRATEGY_VALIDATED", "StrategyVersion", version.id, version.strategy_id, version.id, None, {"valid": validation["valid"]}, request_id)
            validation.update({"versionId": version.id, "revision": version.revision, "validatedAt": self._iso(version.last_validated_at)})
            return validation

    def publish(self, draft_id: int, payload: dict[str, Any], request_id: Optional[str] = None) -> dict[str, Any]:
        key = self._required(payload.get("idempotencyKey"), "PUBLISH_IDEMPOTENCY_CONFLICT", "发布需要 idempotencyKey。", 128)
        validation_experiment_id = payload.get("validationExperimentId")
        if validation_experiment_id is not None:
            from src.services.strategy_validation_service import StrategyValidationError, StrategyValidationService

            try:
                validation_experiment = StrategyValidationService(self.db).require_completed_for_publish(
                    draft_id, validation_experiment_id
                )
                validation_experiment_id = validation_experiment["id"]
            except StrategyValidationError as exc:
                raise StrategyDefinitionError(exc.code, exc.message, exc.status_code) from exc
        request_hash = self._hash({"revision": payload.get("revision"), "changeLog": payload.get("changeLog"), "warnings": sorted(payload.get("acknowledgedWarningCodes") or []), "validationExperimentId": validation_experiment_id})
        with self.db.session_scope() as session:
            existing = session.execute(select(SimulationPublishRequestRecord).where(SimulationPublishRequestRecord.draft_id == draft_id, SimulationPublishRequestRecord.idempotency_key == key)).scalar_one_or_none()
            if existing:
                if existing.request_hash != request_hash:
                    raise StrategyDefinitionError("PUBLISH_IDEMPOTENCY_CONFLICT", "同一幂等键对应不同发布请求。", 409)
                published = self._version(session, existing.published_version_id) if existing.published_version_id else self._version(session, draft_id)
                return self._publish_response(published)
            draft = self._editable_draft(session, draft_id)
            strategy_package = self._load(draft.config_json).get("strategyPackage")
            if isinstance(strategy_package, dict) and strategy_package.get("executionStatus") != "ready":
                raise StrategyDefinitionError(
                    "STRATEGY_PACKAGE_EXECUTOR_UNAVAILABLE",
                    "策略内核尚未通过当前受限执行器的可调用检查，请按最新指南重新生成并上传。",
                    409,
                )
            if payload.get("revision") != draft.revision:
                raise StrategyDefinitionError("VERSION_CONFLICT", "策略草稿已被更新。", 409, {"clientRevision": payload.get("revision"), "serverRevision": draft.revision})
            change_log = self._required(payload.get("changeLog"), "PUBLISH_CHANGELOG_REQUIRED", "发布必须填写版本变更说明。", 4000)
            validation = self._validate_session(session, draft)
            if validation["errors"]:
                raise StrategyDefinitionError("PUBLISH_VALIDATION_FAILED", "策略图校验未通过。", 409, {"errors": validation["errors"]})
            acknowledged = set(payload.get("acknowledgedWarningCodes") or [])
            missing = [issue["code"] for issue in validation["warnings"] if issue["code"] not in acknowledged]
            if missing:
                raise StrategyDefinitionError("PUBLISH_WARNING_ACK_REQUIRED", "请确认所有发布警告。", 409, {"warningCodes": missing})
            strategy = self._strategy(session, draft.strategy_id)
            next_number = (session.execute(select(func.max(SimulationStrategyVersionRecord.version_number)).where(SimulationStrategyVersionRecord.strategy_id == strategy.id)).scalar() or 0) + 1
            draft.data_permission_snapshot_json = self._dump(self._effective_data_source_config(self._load(draft.data_permission_snapshot_json)))
            draft.version_number = int(next_number); draft.status = "PUBLISHED"; draft.immutable = True; draft.change_log = change_log; draft.published_at = utc_naive_now(); draft.revision += 1
            self._snapshot(session, draft)
            strategy.current_published_version_id = draft.id; strategy.active_draft_version_id = None; strategy.lifecycle_status = "published"; strategy.revision += 1; strategy.updated_at = utc_naive_now()
            record = SimulationPublishRequestRecord(draft_id=draft.id, idempotency_key=key, request_hash=request_hash, published_version_id=draft.id)
            session.add(record)
            self._audit(session, "VERSION_PUBLISHED", "StrategyVersion", draft.id, strategy.id, draft.id, None, {"versionNumber": draft.version_number, "validationExperimentId": validation_experiment_id}, request_id)
            session.flush()
            return self._publish_response(draft)

    def create_draft(self, strategy_id: int, based_on_version_id: int, request_id: Optional[str] = None) -> dict[str, Any]:
        with self.db.session_scope() as session:
            strategy = self._strategy(session, strategy_id)
            if strategy.active_draft_version_id:
                raise StrategyDefinitionError("ACTIVE_DRAFT_EXISTS", "该策略已有可编辑草稿。", 409, {"activeDraftId": strategy.active_draft_version_id})
            source = self._version(session, based_on_version_id)
            if source.strategy_id != strategy_id or source.status not in {"PUBLISHED", "DEPRECATED"}:
                raise StrategyDefinitionError("CREATE_DRAFT_REQUIRED", "只能从当前策略的正式版本创建草稿。", 409)
            source_data_config = self._effective_data_source_config(self._load(source.data_permission_snapshot_json))
            old_agents = session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == source.id)).scalars().all()
            legacy_input_ids = {item.id for item in old_agents if item.agent_type == "INPUT"}
            version = SimulationStrategyVersionRecord(
                strategy_id=strategy.id, version=(session.execute(select(func.max(SimulationStrategyVersionRecord.version)).where(SimulationStrategyVersionRecord.strategy_id == strategy.id)).scalar() or 0) + 1,
                config_json=source.config_json, status="DRAFT", immutable=False, objective=source.objective, market_scope_json=source.market_scope_json,
                strategy_purpose=source.strategy_purpose or "trading_decision",
                time_horizon=source.time_horizon, decision_policy_json=source.decision_policy_json, risk_policy_json=source.risk_policy_json,
                memory_policy_json=source.memory_policy_json, data_permission_snapshot_json=self._dump(source_data_config), based_on_version_id=source.id, revision=1,
                screening_policy_json=source.screening_policy_json,
                agent_workflow_version_id=source.agent_workflow_version_id,
            )
            session.add(version); session.flush()
            mapping: dict[int, int] = {}
            for old in old_agents:
                if old.id in legacy_input_ids:
                    continue
                clone = self._clone_agent(old, version.id, old.lineage_id or uuid.uuid4().hex)
                session.add(clone); session.flush(); mapping[old.id] = clone.id
            for old in session.execute(select(SimulationAgentConnectionRecord).where(SimulationAgentConnectionRecord.strategy_version_id == source.id)).scalars().all():
                if old.source_agent_id not in mapping or old.target_agent_id not in mapping:
                    continue
                session.add(SimulationAgentConnectionRecord(strategy_version_id=version.id, source_agent_id=mapping[old.source_agent_id], target_agent_id=mapping[old.target_agent_id], connection_type=old.connection_type, condition=old.condition, field_mapping_json=old.field_mapping_json))
            strategy.active_draft_version_id = version.id; strategy.lifecycle_status = "draft"; strategy.revision += 1; strategy.updated_at = utc_naive_now()
            self._snapshot(session, version)
            self._audit(session, "DRAFT_CREATED_FROM_VERSION", "StrategyVersion", version.id, strategy.id, version.id, None, {"basedOnVersionId": source.id, "migratedLegacyInputAgents": len(legacy_input_ids)}, request_id)
            session.flush()
            return self._version_detail(session, version)

    # --- Published-version manual runs ------------------------------------------------
    # The legacy /simulation/runs API remains compatible with old preview data.  These
    # definition routes are deliberately stricter: only an immutable, published
    # strategy version can enter the user-facing run centre.
    def list_runnable_versions(self) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationStrategyVersionRecord, SimulationStrategyRecord)
                .join(SimulationStrategyRecord, SimulationStrategyRecord.id == SimulationStrategyVersionRecord.strategy_id)
                .where(
                    SimulationStrategyVersionRecord.status == "PUBLISHED",
                    SimulationStrategyVersionRecord.immutable.is_(True),
                    SimulationStrategyVersionRecord.strategy_purpose == "trading_decision",
                    SimulationStrategyRecord.archived_at.is_(None),
                )
                .order_by(desc(SimulationStrategyVersionRecord.published_at), desc(SimulationStrategyVersionRecord.id))
            ).all()
            rows = [
                (version, strategy)
                for version, strategy in rows
                if not self._is_kernel_version(session, version, strategy)
            ]
            items = []
            for version, strategy in rows:
                raw_package = self._load(version.config_json).get("strategyPackage")
                package = raw_package if isinstance(raw_package, dict) else {}
                items.append({
                    "strategyId": strategy.id,
                    "strategyName": strategy.name,
                    "strategyDescription": strategy.description,
                    "versionId": version.id,
                    "versionNumber": version.version_number,
                    "publishedAt": self._iso(version.published_at),
                    # Kept for API compatibility with historical clients. The
                    # run centre treats the complete strategy as one black box.
                    "agentCount": session.execute(select(func.count(SimulationAgentInstanceRecord.id)).where(SimulationAgentInstanceRecord.strategy_version_id == version.id)).scalar() or 0,
                    "connectionCount": session.execute(select(func.count(SimulationAgentConnectionRecord.id)).where(SimulationAgentConnectionRecord.strategy_version_id == version.id)).scalar() or 0,
                    "strategyPurpose": version.strategy_purpose or "trading_decision",
                    "outputContract": package.get("outputContract") or "DecisionProposal",
                    "kernelRuntime": package.get("runtime"),
                    "kernelEntrypoint": package.get("entrypoint"),
                    "kernelExecutionStatus": package.get("executionStatus"),
                    "market": self._screening_policy(version).get("market"),
                    "timeHorizon": version.time_horizon,
                })
        from src.services.strategy_validation_service import StrategyValidationService

        validation_service = StrategyValidationService(self.db)
        for item in items:
            validation = validation_service.version_status(item["versionId"])
            item["validationStatus"] = validation["status"]
            item["latestValidationExperimentId"] = validation["latestCompletedExperimentId"]
            item["validatedAt"] = validation["validatedAt"]
        return items

    def create_published_run(self, payload: dict[str, Any], request_id: Optional[str] = None) -> dict[str, Any]:
        version_id = self._integer(payload.get("strategyVersionId"))
        if not version_id:
            raise StrategyDefinitionError("RUN_VERSION_REQUIRED", "请选择一个正式发布的策略版本。")
        input_snapshot = payload.get("inputSnapshot") or {}
        if not isinstance(input_snapshot, dict):
            raise StrategyDefinitionError("RUN_INPUT_INVALID", "运行输入必须是对象。")
        stock_code = self._text(input_snapshot.get("stockCode") or input_snapshot.get("stock_code"), 32)
        if not stock_code:
            raise StrategyDefinitionError("RUN_STOCK_CODE_REQUIRED", "手动运行需要填写股票代码。")
        clean_input = {"stock_code": stock_code, "requested_at": utc_naive_now().isoformat()}
        with self.db.session_scope() as session:
            version = self._version(session, version_id)
            if version.status != "PUBLISHED" or not version.immutable:
                raise StrategyDefinitionError("RUN_PUBLISHED_VERSION_REQUIRED", "只能运行不可修改的正式发布版本。", 409)
            if self._is_kernel_version(session, version):
                raise StrategyDefinitionError("RUN_CONFIGURATION_REQUIRED", "策略内核不能直接运行；请先在策略中心创建并发布运行配置。", 409)
            if (version.strategy_purpose or "trading_decision") != "trading_decision":
                raise StrategyDefinitionError("RUN_STRATEGY_PURPOSE_UNSUPPORTED", "当前运行中心只执行交易决策类策略；研究报告与选股策略请从对应工具页启动。", 409)
            run = SimulationRunRecord(
                strategy_version_id=version.id,
                status="queued",
                execution_mode="preview",
                input_snapshot_json=self._dump(clean_input),
            )
            session.add(run); session.flush()
            self._audit(session, "RUN_QUEUED", "SimulationRun", run.id, version.strategy_id, version.id, None,
                        {"stockCode": stock_code, "executionMode": "preview"}, request_id)
            return self._run_detail(session, run)

    def list_published_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationRunRecord)
                .join(SimulationStrategyVersionRecord, SimulationStrategyVersionRecord.id == SimulationRunRecord.strategy_version_id)
                .where(SimulationStrategyVersionRecord.status == "PUBLISHED")
                .order_by(desc(SimulationRunRecord.created_at), desc(SimulationRunRecord.id))
                .limit(max(1, min(int(limit), 100)))
            ).scalars().all()
            return [self._run_detail(session, row) for row in rows]

    def get_published_run(self, run_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run:
                raise StrategyDefinitionError("RUN_NOT_FOUND", "运行记录不存在。", 404)
            version = self._version(session, run.strategy_version_id)
            if version.status != "PUBLISHED":
                raise StrategyDefinitionError("RUN_NOT_FOUND", "运行记录不存在。", 404)
            return self._run_detail(session, run)

    def execute_published_run(self, run_id: int, request_id: Optional[str] = None) -> dict[str, Any]:
        # Execute the immutable kernel referenced by this complete strategy.
        # Built-in research-decision kernels delegate to the mature frozen
        # graph; uploaded kernels run in the restricted subprocess boundary.
        detail = self.get_published_run(run_id)
        version_detail = self.get_version(detail["strategyVersionId"])
        try:
            if isinstance(version_detail.get("strategyPackage"), dict):
                from src.services.strategy_kernel_executor_service import StrategyKernelExecutorService

                StrategyKernelExecutorService(self).execute_published_run(run_id)
            else:
                StrategyGraphRuntimeService(self.db).execute(run_id)
        except (StrategyGraphRunError, StrategyDefinitionError) as exc:
            if isinstance(exc, StrategyDefinitionError):
                raise
            raise StrategyDefinitionError("RUN_NOT_EXECUTABLE", str(exc), 409) from exc
        with self.db.session_scope() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run:
                raise StrategyDefinitionError("RUN_NOT_FOUND", "运行记录不存在。", 404)
            version = self._version(session, run.strategy_version_id)
            self._audit(session, "RUN_COMPLETED" if run.status == "completed" else "RUN_FAILED", "SimulationRun", run.id,
                        version.strategy_id, version.id, None, {"status": run.status}, request_id)
            return self._run_detail(session, run)

    # --- Published-version automatic screening research ------------------------------
    def create_automatic_run_batch(
        self,
        payload: dict[str, Any],
        request_id: Optional[str] = None,
        *,
        enqueue: bool = True,
    ) -> dict[str, Any]:
        version_id = self._integer(payload.get("strategyVersionId"))
        if not version_id:
            raise StrategyDefinitionError("RUN_VERSION_REQUIRED", "请选择一个正式发布的策略版本。")
        with self.db.session_scope() as session:
            version = self._version(session, version_id)
            if version.status != "PUBLISHED" or not version.immutable:
                raise StrategyDefinitionError("RUN_PUBLISHED_VERSION_REQUIRED", "只能运行不可修改的正式发布版本。", 409)
            if self._is_kernel_version(session, version):
                raise StrategyDefinitionError("RUN_CONFIGURATION_REQUIRED", "策略内核不能直接运行；请先在策略中心创建并发布运行配置。", 409)
            if (version.strategy_purpose or "trading_decision") != "trading_decision":
                raise StrategyDefinitionError("RUN_STRATEGY_PURPOSE_UNSUPPORTED", "当前运行中心只执行交易决策类策略；研究报告与选股策略请从对应工具页启动。", 409)
            policy = self._screening_policy(version)
            market_scope = self._load(version.market_scope_json)
            data_source_config = self._load(version.data_permission_snapshot_json)
            batch = SimulationStrategyRunBatchRecord(
                strategy_version_id=version.id,
                status="queued",
                input_snapshot_json=self._dump({"screeningPolicy": policy, "marketScope": market_scope, "dataSourceConfig": data_source_config, "requestedAt": utc_naive_now().isoformat()}),
            )
            session.add(batch)
            session.flush()
            self._audit(session, "AUTO_RUN_QUEUED", "SimulationStrategyRunBatch", batch.id, version.strategy_id, version.id, None,
                        {"screeningPolicy": policy, "marketScope": market_scope, "dataSourceConfig": data_source_config}, request_id)
            result = self._run_batch_detail(session, batch)
            batch_id = batch.id
        if not enqueue:
            return result
        # The request only enqueues persisted work.  It does not wait on
        # K-line sources or an LLM response and therefore cannot leave a
        # half-created UI-only run behind.
        from src.services.task_queue import get_task_queue
        get_task_queue().submit_background_task(
            lambda: self.execute_automatic_run_batch(batch_id, request_id),
            stock_code=f"strategy_auto_batch_{batch_id}",
            stock_name=f"strategy-version-{version_id}",
            report_type="strategy_auto_screening",
            message="自动选股研究已提交",
            task_id=f"strategy-auto-batch-{batch_id}",
            trace_id=f"strategy-auto-batch-{batch_id}",
        )
        return result

    def execute_automatic_run_batch(self, batch_id: int, request_id: Optional[str] = None) -> dict[str, Any]:
        try:
            StrategyScreeningRuntimeService(self.db).execute(batch_id)
        except StrategyScreeningRunError as exc:
            raise StrategyDefinitionError("AUTO_RUN_NOT_EXECUTABLE", str(exc), 409) from exc
        with self.db.session_scope() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch:
                raise StrategyDefinitionError("AUTO_RUN_NOT_FOUND", "自动选股运行不存在。", 404)
            version = self._version(session, batch.strategy_version_id)
            self._audit(session, "AUTO_RUN_COMPLETED" if batch.status == "completed" else "AUTO_RUN_FAILED", "SimulationStrategyRunBatch", batch.id,
                        version.strategy_id, version.id, None, {"status": batch.status}, request_id)
            return self._run_batch_detail(session, batch)

    def list_automatic_run_batches(self, limit: int = 30) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationStrategyRunBatchRecord)
                .join(SimulationStrategyVersionRecord, SimulationStrategyVersionRecord.id == SimulationStrategyRunBatchRecord.strategy_version_id)
                .join(SimulationStrategyRecord, SimulationStrategyRecord.id == SimulationStrategyVersionRecord.strategy_id)
                .where(
                    SimulationStrategyVersionRecord.status == "PUBLISHED",
                    SimulationStrategyRecord.archived_at.is_(None),
                )
                .order_by(desc(SimulationStrategyRunBatchRecord.created_at), desc(SimulationStrategyRunBatchRecord.id))
                .limit(max(1, min(int(limit), 100)))
            ).scalars().all()
            return [self._run_batch_detail(session, row) for row in rows]

    def get_automatic_run_batch(self, batch_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch:
                raise StrategyDefinitionError("AUTO_RUN_NOT_FOUND", "自动选股运行不存在。", 404)
            return self._run_batch_detail(session, batch)

    def reconcile_interrupted_automatic_runs(self) -> int:
        """Mark one-shot batches abandoned by a process restart as retryable failures.

        Automatic research uses an in-process background task.  Unlike durable
        continuous controls, that task cannot survive a server restart.  A
        persisted ``queued`` or ``running`` row at the next startup therefore
        must not be displayed as a live run forever.
        """
        message = "服务重启导致本次自动选股研究中断；请重新运行一次。"
        with self.db.session_scope() as session:
            rows = session.execute(select(SimulationStrategyRunBatchRecord).where(
                SimulationStrategyRunBatchRecord.status.in_(("queued", "running")),
            )).scalars().all()
            for batch in rows:
                partial = self._load(batch.result_snapshot_json)
                partial["phase"] = "interrupted"
                partial["interruptedReason"] = "server_restart"
                batch.status = "failed"
                batch.completed_at = utc_naive_now()
                batch.error_message = message
                batch.result_snapshot_json = self._dump(partial)
            return len(rows)

    # --- Versions, diff and audit -----------------------------------------------------
    def list_versions(self, strategy_id: int) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            self._strategy(session, strategy_id)
            rows = session.execute(select(SimulationStrategyVersionRecord).where(SimulationStrategyVersionRecord.strategy_id == strategy_id).order_by(desc(SimulationStrategyVersionRecord.created_at))).scalars().all()
            return [self._version_summary(session, row) for row in rows]

    def diff(self, version_id: int, against_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            to_version, from_version = self._version(session, version_id), self._version(session, against_id)
            if to_version.strategy_id != from_version.strategy_id: raise StrategyDefinitionError("VERSION_NOT_FOUND", "只能比较同一策略的版本。", 404)
            return self._diff(session, from_version, to_version)

    def diff_preview(self, version_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        """Compare an unsaved browser draft without persisting it or logging its prompt."""
        with self.db.get_session() as session:
            server = self._version(session, version_id)
            preview = payload.get("localDraft") or {}
            return self._preview_diff(session, server, preview)

    def fork_local(self, conflicted_draft_id: int, payload: dict[str, Any], request_id: Optional[str] = None) -> dict[str, Any]:
        """Create an isolated strategy from unsaved conflict-local content.

        This intentionally does not mutate the conflicted draft and does not
        preserve agent lineage across strategy boundaries.
        """
        key = self._required(payload.get("idempotencyKey"), "PUBLISH_IDEMPOTENCY_CONFLICT", "创建副本需要 idempotencyKey。", 128)
        local = payload.get("localDraft") or {}
        if not isinstance(local, dict) or not isinstance(local.get("agents"), list) or not isinstance(local.get("connections"), list):
            raise StrategyDefinitionError("VALIDATION_SCHEMA_ERROR", "localDraft 必须包含 agents 和 connections 数组。")
        name = self._required(payload.get("newStrategyName"), "STRATEGY_NAME_REQUIRED", "新策略名称不能为空。", 120)
        description = self._text(payload.get("newStrategyDescription"), 4000)
        request_hash = self._hash({"name": name, "description": description, "localDraft": local})
        with self.db.session_scope() as session:
            source = self._version(session, conflicted_draft_id)
            existing = session.execute(select(SimulationStrategyForkRequestRecord).where(
                SimulationStrategyForkRequestRecord.source_draft_id == source.id,
                SimulationStrategyForkRequestRecord.idempotency_key == key,
            )).scalar_one_or_none()
            if existing:
                if existing.request_hash != request_hash:
                    raise StrategyDefinitionError("PUBLISH_IDEMPOTENCY_CONFLICT", "同一幂等键对应不同本地副本请求。", 409)
                return {"newStrategyId": existing.strategy_id, "newDraftVersionId": existing.draft_version_id, "idempotent": True}
            if session.execute(select(SimulationStrategyRecord.id).where(SimulationStrategyRecord.name == name)).scalar_one_or_none():
                raise StrategyDefinitionError("DATABASE_CONFLICT", "策略名称已存在。", 409)
            strategy = SimulationStrategyRecord(name=name, description=description, lifecycle_status="draft", revision=1)
            session.add(strategy); session.flush()
            version_data = local.get("version") or local
            draft = SimulationStrategyVersionRecord(
                strategy_id=strategy.id, version=1, config_json="{}", status="DRAFT", immutable=False, revision=1,
                strategy_purpose=str(version_data.get("strategyPurpose") or "trading_decision"),
                objective=self._text(version_data.get("objective"), 4000),
                market_scope_json=self._dump(version_data.get("marketScope") or {}),
                time_horizon=self._text(version_data.get("timeHorizon"), 64),
                decision_policy_json=self._dump(version_data.get("decisionPolicy") or {}),
                risk_policy_json=self._dump(version_data.get("riskPolicy") or {}),
                memory_policy_json=self._dump(version_data.get("memoryPolicy") or {}),
                data_permission_snapshot_json=self._dump(version_data.get("dataPermissionSnapshot") or {}),
                screening_policy_json=self._dump(version_data.get("screeningPolicy") or {}),
                agent_workflow_version_id=self._integer(version_data.get("agentWorkflowVersionId")),
            )
            session.add(draft); session.flush()
            agents = []
            for item in local["agents"]:
                if not isinstance(item, dict):
                    raise StrategyDefinitionError("VALIDATION_SCHEMA_ERROR", "Agent 配置无效。")
                copied = dict(item)
                copied["id"] = f"fork-{uuid.uuid4().hex}"
                copied["lineageId"] = uuid.uuid4().hex
                agents.append(copied)
            id_by_old = {str(old.get("id")): new["id"] for old, new in zip(local["agents"], agents) if isinstance(old, dict)}
            connections = []
            for item in local["connections"]:
                if not isinstance(item, dict):
                    raise StrategyDefinitionError("VALIDATION_SCHEMA_ERROR", "Connection 配置无效。")
                source_id, target_id = id_by_old.get(str(item.get("sourceAgentId"))), id_by_old.get(str(item.get("targetAgentId")))
                if not source_id or not target_id:
                    raise StrategyDefinitionError("CONNECTION_CROSS_VERSION", "Connection 引用了不存在的本地 Agent。")
                copied = dict(item); copied["id"] = f"fork-edge-{uuid.uuid4().hex}"; copied["sourceAgentId"] = source_id; copied["targetAgentId"] = target_id
                connections.append(copied)
            self._replace_graph(session, draft, agents, connections)
            strategy.active_draft_version_id = draft.id
            self._snapshot(session, draft)
            self._audit(session, "STRATEGY_CREATED_FROM_CONFLICTED_LOCAL_DRAFT", "Strategy", strategy.id, strategy.id, draft.id, None,
                        {"sourceStrategyId": source.strategy_id, "sourceDraftVersionId": source.id, "baseRevision": payload.get("baseRevision"), "agentCount": len(agents), "connectionCount": len(connections), "configurationHash": self._hash(local)}, request_id)
            session.add(SimulationStrategyForkRequestRecord(source_draft_id=source.id, idempotency_key=key, request_hash=request_hash, strategy_id=strategy.id, draft_version_id=draft.id))
            session.flush()
            return {"newStrategyId": strategy.id, "newDraftVersionId": draft.id, "initialRevision": draft.revision, "idempotent": False}

    def list_audit(self, strategy_id: int) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            self._strategy(session, strategy_id)
            rows = session.execute(select(SimulationAuditEventRecord).where(SimulationAuditEventRecord.strategy_id == strategy_id).order_by(desc(SimulationAuditEventRecord.created_at)).limit(100)).scalars().all()
            return [{"id": r.id, "action": r.action, "objectType": r.object_type, "objectId": r.object_id, "strategyId": r.strategy_id, "strategyVersionId": r.strategy_version_id, "beforeSummary": self._load(r.before_summary_json), "afterSummary": self._load(r.after_summary_json), "reason": r.reason, "requestId": r.request_id, "createdAt": self._iso(r.created_at)} for r in rows]

    # --- Persistence helpers ----------------------------------------------------------
    def _replace_graph(self, session, draft, agents: list[dict[str, Any]], connections: list[dict[str, Any]]) -> None:
        old = {str(item.id): item for item in session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == draft.id)).scalars().all()}
        seen: set[str] = set(); id_map: dict[str, int] = {}; lineage_seen: set[str] = set()
        for item in agents:
            client_id = str(item.get("id") or "")
            if client_id and client_id in seen: raise StrategyDefinitionError("AGENT_CONFIG_INVALID", "Agent ID 重复。")
            seen.add(client_id)
            lineage = str(item.get("lineageId") or uuid.uuid4().hex)
            if lineage in lineage_seen: raise StrategyDefinitionError("AGENT_LINEAGE_CONFLICT", "同一草稿中的 Agent lineage 重复。")
            lineage_seen.add(lineage)
            record = old.pop(client_id, None) if client_id else None
            if record is None:
                record = SimulationAgentInstanceRecord(strategy_version_id=draft.id, lineage_id=lineage, agent_type=str(item.get("agentType") or ""))
                session.add(record)
            elif record.lineage_id != lineage:
                raise StrategyDefinitionError("AGENT_LINEAGE_CONFLICT", "已存在 Agent 的 lineage 不可修改。", 409)
            self._assign_agent(record, item); session.flush(); id_map[client_id or str(record.id)] = record.id
        # Delete connections first.  A full graph save is atomic and makes deleted nodes unambiguous.
        session.query(SimulationAgentConnectionRecord).filter(SimulationAgentConnectionRecord.strategy_version_id == draft.id).delete(synchronize_session=False)
        for record in old.values(): session.delete(record)
        pairs: set[tuple[int, int, str]] = set()
        for item in connections:
            source, target = str(item.get("sourceAgentId") or ""), str(item.get("targetAgentId") or "")
            if source not in id_map or target not in id_map: raise StrategyDefinitionError("CONNECTION_CROSS_VERSION", "连接必须引用当前草稿中的 Agent。")
            kind = str(item.get("connectionType") or "DATA_FLOW").upper(); pair = (id_map[source], id_map[target], kind)
            if pair in pairs: raise StrategyDefinitionError("CONNECTION_DUPLICATE", "不允许重复连接。", 409)
            pairs.add(pair)
            session.add(SimulationAgentConnectionRecord(strategy_version_id=draft.id, source_agent_id=pair[0], target_agent_id=pair[1], connection_type=kind, condition=self._text(item.get("condition"), 4000), field_mapping_json=self._dump(item.get("fieldMapping") or {})))
        # DatabaseManager intentionally disables autoflush.  Callers validate
        # and snapshot the graph immediately, so connections must be visible
        # before those read queries run.
        session.flush()

    def _seed_agent_templates(self, session) -> None:
        starter = [
            ("system:input", "行情输入 Agent", "INPUT", "读取已授权行情并整理为带截止时间的证据包。", "整理已授权数据，不输出交易结论。", "DETERMINISTIC", "仅整理本次冻结的候选标的和已授权数据。输出必须保留证券代码与数据截止时间；不推断、不给出买卖建议。"),
            ("system:screening", "候选筛选 Agent", "SCREENING", "在策略允许的市场和股票范围内，对候选标的进行研究排序。", "依据已授权输入筛选研究候选，不扩大策略股票范围。", "LLM", "你是选股 Agent。只允许在策略输入提供的候选范围内排序，输出结构化 JSON：candidates（symbol、score、reason）与 rejected（symbol、reason）。不得补造候选、不得下单。"),
            ("system:analysis-news", "新闻分析 Agent", "ANALYSIS", "从已授权行情和新闻证据中提取驱动、风险与失效条件。", "基于证据形成可审计研究摘要，不直接下单。", "LLM", "你是证券研究分析 Agent。仅依据已冻结输入与上游输出，生成结构化 JSON：symbol、summary、score(0-100)、positiveFactors、riskFactors、invalidation。证据不足时明确写 unknown；不得编造行情、不得下单。"),
            ("system:decision", "综合决策 Agent", "DECISION", "汇总分析意见，形成可审计的决策提案。", "仅生成决策提案，不能下单。", "LLM", "你是决策 Agent。仅依据上游研究输出，生成结构化 JSON：symbol、action（WATCH/BUY_CANDIDATE/AVOID）、confidence(0-100)、rationale、risks、invalidation、nextCheck。action 只是研究提案，不是订单、不得声称已经交易或收益。"),
            ("system:reflection", "复盘 Agent", "REFLECTION", "在本次决策完成后审阅其依据、遗漏与下一次改进点。", "复盘只产生候选经验，不能修改当前策略或下单。", "LLM", "你是复盘 Agent。只在本次决策完成后阅读决策提案与研究轨迹，输出结构化 JSON：symbol、lesson、missingEvidence、followUp。不得改写当前决策、不得下单。"),
        ]
        schemas = {
            "INPUT": (
                '{"type":"object","properties":{}}',
                '{"type":"object","required":["symbol"],"properties":{"symbol":{"type":"string","description":"证券代码"},"as_of":{"type":"string","description":"数据截止时间"},"candidate":{"type":"object","description":"选股候选快照"}}}',
            ),
            "ANALYSIS": (
                '{"type":"object","required":["symbol"],"properties":{"symbol":{"type":"string","description":"证券代码"},"as_of":{"type":"string","description":"数据截止时间"}}}',
                '{"type":"object","required":["symbol","summary","score"],"properties":{"symbol":{"type":"string","description":"证券代码"},"summary":{"type":"string","description":"分析摘要"},"score":{"type":"number","description":"分析评分"},"positiveFactors":{"type":"array","items":{"type":"string"}},"riskFactors":{"type":"array","items":{"type":"string"}},"invalidation":{"type":"string"}}}',
            ),
            "SCREENING": (
                '{"type":"object","properties":{"candidates":{"type":"array","items":{"type":"object"}}}}',
                '{"type":"object","required":["candidates"],"properties":{"candidates":{"type":"array","items":{"type":"object","required":["symbol","score"],"properties":{"symbol":{"type":"string"},"score":{"type":"number"},"reason":{"type":"string"}}}},"rejected":{"type":"array","items":{"type":"object"}}}}',
            ),
            "DECISION": (
                '{"type":"object","required":["symbol"],"properties":{"symbol":{"type":"string","description":"证券代码"},"summary":{"type":"string","description":"分析摘要"},"score":{"type":"number","description":"分析评分"}}}',
                '{"type":"object","required":["symbol","action","confidence"],"properties":{"symbol":{"type":"string","description":"证券代码"},"action":{"type":"string","enum":["WATCH","BUY_CANDIDATE","AVOID"],"description":"研究决策提案"},"confidence":{"type":"number","description":"提案置信度"},"rationale":{"type":"string"},"risks":{"type":"array","items":{"type":"string"}},"invalidation":{"type":"string"},"nextCheck":{"type":"string"}}}',
            ),
            "REFLECTION": (
                '{"type":"object","properties":{"symbol":{"type":"string","description":"证券代码"},"action":{"type":"string","description":"本次决策提案"},"rationale":{"type":"string","description":"决策依据"}}}',
                '{"type":"object","properties":{"symbol":{"type":"string"},"lesson":{"type":"string","description":"候选经验"},"missingEvidence":{"type":"array","items":{"type":"string"}},"followUp":{"type":"string"}}}',
            ),
        }
        for template_key, name, kind, description, role, _mode, prompt in starter:
            template = session.execute(select(SimulationAgentTemplateRecord).where(SimulationAgentTemplateRecord.template_key == template_key)).scalar_one_or_none()
            if not template:
                template = session.execute(select(SimulationAgentTemplateRecord).where(SimulationAgentTemplateRecord.name == name)).scalar_one_or_none()
            if not template:
                template = SimulationAgentTemplateRecord(template_key=template_key, name=name, agent_type=kind, description=description, current_version=1)
                session.add(template); session.flush()
            elif not template.template_key:
                template.template_key = template_key
            input_schema, output_schema = schemas[kind]
            current = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == template.id,
                SimulationAgentTemplateVersionRecord.version == 2,
            )).scalar_one_or_none()
            if not current:
                session.add(SimulationAgentTemplateVersionRecord(template_id=template.id, version=2, default_role=role,
                    default_system_prompt=prompt, default_prompt_template="",
                    input_schema_json=input_schema, output_schema_json=output_schema,
                    supported_tools_json='[]', supported_data_types_json='[]', published_at=utc_naive_now()))
            if template.current_version <= 2:
                template.description = description
                template.current_version = 2
        session.flush()

    def _assign_version(self, draft, data: dict[str, Any]) -> None:
        mapping = {"objective": "objective", "timeHorizon": "time_horizon"}
        for key, attr in mapping.items():
            if key in data: setattr(draft, attr, self._text(data[key], 4000))
        if "strategyPurpose" in data:
            purpose = str(data.get("strategyPurpose") or "").strip().lower()
            if purpose not in {"research_report", "candidate_screening", "trading_decision"}:
                raise StrategyDefinitionError("STRATEGY_PURPOSE_INVALID", "策略产出目标无效。")
            draft.strategy_purpose = purpose
        for key, attr in (("marketScope", "market_scope_json"), ("decisionPolicy", "decision_policy_json"), ("riskPolicy", "risk_policy_json"), ("memoryPolicy", "memory_policy_json"), ("dataPermissionSnapshot", "data_permission_snapshot_json"), ("screeningPolicy", "screening_policy_json")):
            if key in data:
                value = self._effective_data_source_config(data[key] or {}) if key == "dataPermissionSnapshot" else data[key] or {}
                setattr(draft, attr, self._dump(value))

    def _assign_agent(self, record, item: dict[str, Any]) -> None:
        kind = str(item.get("agentType") or "").upper()
        if kind not in {"INPUT", "SCREENING", "ANALYSIS", "DECISION", "REFLECTION"}: raise StrategyDefinitionError("AGENT_CONFIG_INVALID", "Agent 类型无效。")
        record.agent_type = kind; record.name = self._required(item.get("name"), "AGENT_CONFIG_INVALID", "Agent 名称不能为空。", 120); record.role = self._required(item.get("role"), "AGENT_CONFIG_INVALID", "Agent 职责不能为空。", 4000)
        record.template_id = self._integer(item.get("agentTemplateId")); record.template_version = self._integer(item.get("agentTemplateVersion")); record.system_prompt = self._text(item.get("systemPrompt"), 30000) or ""; record.prompt_template = self._text(item.get("promptTemplate"), 30000) or ""
        record.model_profile_id = self._text(item.get("modelProfileId"), 128); record.fallback_model_profile_id = self._text(item.get("fallbackModelProfileId"), 128); record.execution_mode = str(item.get("executionMode") or "LLM").upper()
        record.tool_permissions_json = self._dump(item.get("toolPermissions") or []); record.data_permissions_json = self._dump(item.get("dataPermissions") or []); record.input_schema_json = self._dump(item.get("inputSchema") or {}); record.output_schema_json = self._dump(item.get("outputSchema") or {})
        record.timeout_seconds = int(item.get("timeoutSeconds") or 0); record.max_retries = int(item.get("maxRetries") or 0); record.required = bool(item.get("required", True)); record.failure_policy = str(item.get("failurePolicy") or "").upper(); record.cost_limit = Decimal(str(item.get("costLimit") or "0")); record.position_x = int(item.get("positionX") or 0); record.position_y = int(item.get("positionY") or 0); record.config_snapshot_json = self._dump(item.get("configSnapshot") or {})

    def _clone_agent(self, old, version_id: int, lineage_id: str):
        return SimulationAgentInstanceRecord(strategy_version_id=version_id, lineage_id=lineage_id, template_id=old.template_id, template_version=old.template_version, agent_type=old.agent_type, name=old.name, role=old.role, system_prompt=old.system_prompt, prompt_template=old.prompt_template, model_profile_id=old.model_profile_id, fallback_model_profile_id=old.fallback_model_profile_id, execution_mode=old.execution_mode, tool_permissions_json=old.tool_permissions_json, data_permissions_json=old.data_permissions_json, input_schema_json=old.input_schema_json, output_schema_json=old.output_schema_json, timeout_seconds=old.timeout_seconds, max_retries=old.max_retries, required=old.required, failure_policy=old.failure_policy, cost_limit=old.cost_limit, position_x=old.position_x, position_y=old.position_y, config_snapshot_json=old.config_snapshot_json)

    def _editable_draft(self, session, version_id: int):
        version = self._version(session, version_id)
        if version.status != "DRAFT" or version.immutable: raise StrategyDefinitionError("VERSION_IMMUTABLE", "已发布策略版本不可直接修改，请基于该版本创建新草稿。", 409)
        return version

    def _validate_session(self, session, version) -> dict[str, Any]:
        agents = session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == version.id)).scalars().all()
        connections = session.execute(select(SimulationAgentConnectionRecord).where(SimulationAgentConnectionRecord.strategy_version_id == version.id)).scalars().all()
        market_scope = self._load(version.market_scope_json)
        data_sources = self._effective_data_source_config(self._load(version.data_permission_snapshot_json))
        config = {"strategy_purpose": version.strategy_purpose or "trading_decision", "workflow_reference_required": version.status == "DRAFT", "agent_workflow_version_id": version.agent_workflow_version_id, "market_scope": market_scope, "data_sources": data_sources, "risk_policy": self._load(version.risk_policy_json), "decision_policy": self._load(version.decision_policy_json), "agents": [self._agent_config(a) for a in agents], "connections": [{"id": str(c.id), "source_agent_id": str(c.source_agent_id), "target_agent_id": str(c.target_agent_id), "connection_type": c.connection_type, "field_mapping": self._load(c.field_mapping_json)} for c in connections]}
        strategy_package = self._load(version.config_json).get("strategyPackage")
        if isinstance(strategy_package, dict) and strategy_package.get("kind") == "uploaded_package":
            validation = self._validate_strategy_package_config(version, strategy_package, config)
        else:
            validation = self.validator.validate(config).as_dict()
        screening_market = str(self._load(version.screening_policy_json).get("market") or "cn").lower()
        custom_sources = session.execute(
            select(SimulationDataSourceRecord).where(SimulationDataSourceRecord.archived_at.is_(None))
        ).scalars().all()
        catalog_items = [
            *self.BUILTIN_DATA_SOURCES,
            *self._provider_data_sources(),
            *(self._data_source_item(item) for item in custom_sources),
        ]
        source_catalog = {item["connectionKey"]: item for item in catalog_items}
        for kind in ("kline", "news", "fundamentals"):
            selected = data_sources.get(kind)
            if not isinstance(selected, dict) or selected.get("enabled") is False:
                continue
            connection = str(selected.get("connection") or "")
            catalog_item = source_catalog.get(connection)
            if not catalog_item:
                continue
            if catalog_item.get("selectable") is False:
                validation["errors"].append({
                    "code": "DATA_SOURCE_PROVIDER_UNCONFIGURED",
                    "message": f"{catalog_item['name']} 尚未在系统设置中配置，当前策略不能使用该来源。",
                    "agent_ids": [],
                    "connection_ids": [],
                    "field_path": f"dataPermissionSnapshot.{kind}.connection",
                    "suggestion": "先在设置中配置该提供方，或改回系统自动选择。",
                })
                validation["valid"] = False
            markets = catalog_item.get("markets") or []
            if markets and screening_market not in markets:
                validation["errors"].append({
                    "code": "DATA_SOURCE_MARKET_UNSUPPORTED",
                    "message": f"{catalog_item['name']} 不支持当前策略市场 {screening_market.upper()}。",
                    "agent_ids": [],
                    "connection_ids": [],
                    "field_path": f"dataPermissionSnapshot.{kind}.connection",
                    "suggestion": "选择支持该市场的提供方，或使用系统自动选择。",
                })
                validation["valid"] = False
        source_id_catalog = {item["sourceId"]: item for item in catalog_items}
        other = data_sources.get("other")
        other_source_ids = other.get("sourceIds") if isinstance(other, dict) and isinstance(other.get("sourceIds"), list) else []
        for source_id in other_source_ids:
            catalog_item = source_id_catalog.get(str(source_id))
            markets = catalog_item.get("markets") if catalog_item else []
            if catalog_item and markets and screening_market not in markets:
                validation["errors"].append({
                    "code": "DATA_SOURCE_MARKET_UNSUPPORTED",
                    "message": f"{catalog_item['name']} 不支持当前策略市场 {screening_market.upper()}。",
                    "agent_ids": [],
                    "connection_ids": [],
                    "field_path": "dataPermissionSnapshot.other.sourceIds",
                    "suggestion": "移除该来源，或选择标注为当前市场的数据源。",
                })
                validation["valid"] = False
        if str(market_scope.get("universeMode") or "").lower() == "fixed":
            requested = [str(item).strip().upper() for item in market_scope.get("symbols", []) if str(item).strip()]
            available = {str(code).strip().upper() for code in session.execute(select(StockDaily.code).distinct()).scalars().all()}
            missing = [code for code in requested if code not in available]
            if missing:
                validation["errors"].append({
                    "code": "FIXED_UNIVERSE_INPUT_DATA_MISSING",
                    "message": f"固定股票池中的 {', '.join(missing[:10])} 不在当前 K 线输入数据中。请先补充这些股票的数据，或从策略股票池移除。",
                    "agent_ids": [],
                    "connection_ids": [],
                    "field_path": "marketScope.symbols",
                    "suggestion": "在数据中心补充对应股票 K 线后重新检查策略。",
                })
                validation["valid"] = False
        return validation

    @staticmethod
    def _template_data_source_config(template: dict[str, Any]) -> dict[str, Any]:
        return {
            "schemaVersion": 2,
            "kline": {"enabled": True, "connection": "system_market_data", "timeframe": "1d"},
            "news": {"enabled": True, "connection": "system_news"},
            "fundamentals": {"enabled": True, "connection": "system_fundamentals"},
            "other": {"enabled": False, "sourceIds": []},
        }

    @classmethod
    def _effective_data_source_config(cls, value: Any) -> dict[str, Any]:
        current = value if isinstance(value, dict) else {}
        defaults = cls._template_data_source_config({})
        result = {**current, "schemaVersion": 2}
        for kind in ("kline", "news", "fundamentals"):
            configured = current.get(kind) if isinstance(current.get(kind), dict) else {}
            result[kind] = {**defaults[kind], **configured}
        other = current.get("other") if isinstance(current.get("other"), dict) else {}
        source_ids = [str(item) for item in other.get("sourceIds", []) if str(item).strip()] if isinstance(other.get("sourceIds"), list) else []
        legacy_sentiment = current.get("sentiment") if isinstance(current.get("sentiment"), dict) else {}
        if legacy_sentiment.get("enabled") is True and "system_sentiment" not in source_ids:
            source_ids.append("system_sentiment")
        result.pop("sentiment", None)
        result["other"] = {**other, "enabled": bool(source_ids), "sourceIds": list(dict.fromkeys(source_ids))}
        return result

    def _snapshot(self, session, version) -> None:
        agents = session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == version.id)).scalars().all()
        connections = session.execute(select(SimulationAgentConnectionRecord).where(SimulationAgentConnectionRecord.strategy_version_id == version.id)).scalars().all()
        current = self._load(version.config_json)
        snapshot = {"agents": [self._agent_config(a) for a in agents], "connections": [{"id": str(c.id), "source_agent_id": str(c.source_agent_id), "target_agent_id": str(c.target_agent_id), "connection_type": c.connection_type, "condition": c.condition, "field_mapping": self._load(c.field_mapping_json)} for c in connections]}
        if isinstance(current.get("strategyPackage"), dict):
            snapshot["strategyPackage"] = current["strategyPackage"]
        if current.get("productRole") in {"kernel", "configured"}:
            snapshot["productRole"] = current["productRole"]
        if self._integer(current.get("kernelSourceVersionId")):
            snapshot["kernelSourceVersionId"] = self._integer(current.get("kernelSourceVersionId"))
        for key in ("systemPresetConfiguration", "systemPresetConfigurationProfile"):
            if key in current:
                snapshot[key] = current[key]
        version.config_json = self._dump(snapshot)

    def _validate_strategy_package_config(self, version, package: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        configurable = package.get("configurable") if isinstance(package.get("configurable"), dict) else {}
        market = str(self._load(version.screening_policy_json).get("market") or "").lower()
        allowed_markets = configurable.get("markets") if isinstance(configurable.get("markets"), list) else []
        if market not in allowed_markets:
            errors.append({"code": "STRATEGY_PACKAGE_MARKET_UNSUPPORTED", "message": f"上传的策略内核未声明支持市场 {market.upper()}。", "agent_ids": [], "connection_ids": [], "field_path": "screeningPolicy.market", "suggestion": "选择策略包 configurable.markets 中声明的市场。"})
        timeframes = configurable.get("timeframes") if isinstance(configurable.get("timeframes"), list) else []
        if timeframes and version.time_horizon not in timeframes:
            errors.append({"code": "STRATEGY_PACKAGE_TIMEFRAME_UNSUPPORTED", "message": "当前观察周期不在策略包允许范围内。", "agent_ids": [], "connection_ids": [], "field_path": "timeHorizon", "suggestion": "选择策略包声明的 timeframes。"})
        policy = config.get("decision_policy") if isinstance(config.get("decision_policy"), dict) else {}
        intervals = configurable.get("runIntervals") if isinstance(configurable.get("runIntervals"), list) else []
        if intervals and policy.get("runInterval") not in intervals:
            errors.append({"code": "STRATEGY_PACKAGE_INTERVAL_UNSUPPORTED", "message": "当前运行频率不在策略包允许范围内。", "agent_ids": [], "connection_ids": [], "field_path": "decisionPolicy.runInterval", "suggestion": "选择策略包声明的 runIntervals。"})
        if (version.strategy_purpose or "trading_decision") == "trading_decision" and not (config.get("risk_policy") or {}).get("decision_validity"):
            errors.append({"code": "DECISION_VALIDITY_RULE_MISSING", "message": "交易决策策略必须配置决策有效期。", "agent_ids": [], "connection_ids": [], "field_path": "riskPolicy.decisionValidity", "suggestion": "在决策边界中填写决策有效期。"})
        if str((config.get("market_scope") or {}).get("universeMode") or "").lower() == "fixed" and not (config.get("market_scope") or {}).get("symbols"):
            errors.append({"code": "FIXED_UNIVERSE_SYMBOLS_MISSING", "message": "策略选择了固定股票池，但尚未填写股票代码。", "agent_ids": [], "connection_ids": [], "field_path": "marketScope.symbols", "suggestion": "填写至少一个股票代码。"})
        if package.get("executionStatus") != "ready":
            errors.append({"code": "STRATEGY_PACKAGE_NOT_EXECUTABLE", "message": "策略内核尚未通过当前受限执行器的可调用检查。", "agent_ids": [], "connection_ids": [], "field_path": "strategyPackage.executionStatus", "suggestion": "重新上传符合当前策略包协议的 Python 内核。"})
        return {"valid": not errors, "errors": errors, "warnings": warnings}

    # --- Serialization / diff ---------------------------------------------------------
    def _strategy(self, session, strategy_id: int):
        row = session.get(SimulationStrategyRecord, strategy_id)
        if not row: raise StrategyDefinitionError("STRATEGY_NOT_FOUND", "策略不存在。", 404)
        return row

    def _version(self, session, version_id: int):
        row = session.get(SimulationStrategyVersionRecord, version_id)
        if not row: raise StrategyDefinitionError("VERSION_NOT_FOUND", "策略版本不存在。", 404)
        return row

    def _is_kernel_version(self, session, version, strategy=None) -> bool:
        strategy = strategy or session.get(SimulationStrategyRecord, version.strategy_id)
        if strategy and strategy.name in {
            self.DAILY_RESEARCH_STRATEGY_NAME,
            self.DAILY_SCREENING_STRATEGY_NAME,
            self.DAILY_TRADING_STRATEGY_NAME,
        }:
            return True
        return self._load(version.config_json).get("productRole") == "kernel"

    def _strategy_summary(self, session, row):
        current = session.get(SimulationStrategyVersionRecord, row.current_published_version_id) if row.current_published_version_id else None
        draft = session.get(SimulationStrategyVersionRecord, row.active_draft_version_id) if row.active_draft_version_id else None
        representative = current or draft
        purpose = (representative.strategy_purpose or "trading_decision") if representative else None
        output_contract = {"research_report": "ResearchReport", "candidate_screening": "CandidateList", "trading_decision": "DecisionProposal"}.get(purpose) if purpose else None
        built_in_names = {
            self.DAILY_RESEARCH_STRATEGY_NAME,
            self.DAILY_SCREENING_STRATEGY_NAME,
            self.DAILY_TRADING_STRATEGY_NAME,
        }
        is_built_in = row.name in built_in_names
        config = self._load(representative.config_json) if representative else {}
        product_role = "kernel" if is_built_in or config.get("productRole") == "kernel" else "configured"
        package = config.get("strategyPackage") if isinstance(config.get("strategyPackage"), dict) else None
        backtest_readiness = self._backtest_readiness(representative, product_role)
        return {"id": row.id, "name": row.name, "description": row.description, "lifecycleStatus": row.lifecycle_status, "revision": row.revision, "activeDraftVersionId": row.active_draft_version_id, "currentPublishedVersionId": row.current_published_version_id, "currentPublishedVersionNumber": current.version_number if current else None, "currentStrategyPurpose": purpose, "currentOutputContract": output_contract, "currentObjective": representative.objective if representative else None, "productRole": product_role, "kernelVersionId": representative.id if product_role == "kernel" and representative else self._integer(config.get("kernelSourceVersionId")), "kernelRuntime": package.get("runtime") if package else None, "kernelEntrypoint": package.get("entrypoint") if package else None, "kernelExecutionStatus": package.get("executionStatus") if package else None, "kernelDataRequirements": package.get("dataRequirements") if package else [], "backtestReadiness": backtest_readiness, "isBuiltIn": is_built_in, "sourceSystem": "daily_stock_analysis" if is_built_in else "user", "createdAt": self._iso(row.created_at), "updatedAt": self._iso(row.updated_at), "archivedAt": self._iso(row.archived_at)}

    def _backtest_readiness(self, version, product_role: str) -> dict[str, Any]:
        if version is None:
            return {"ready": False, "code": "version_missing", "message": "尚无可回测版本。"}
        if (version.strategy_purpose or "trading_decision") != "trading_decision":
            return {"ready": False, "code": "purpose_unsupported", "message": "此类策略使用对应研究工具，不进入交易回测。"}
        if product_role == "kernel":
            return {"ready": False, "code": "configuration_required", "message": "策略内核需先创建运行配置。"}
        market_scope = self._load(version.market_scope_json)
        symbols = [
            str(item).strip().upper()
            for item in market_scope.get("symbols", [])
            if str(item).strip()
        ] if isinstance(market_scope.get("symbols"), list) else []
        if str(market_scope.get("universeMode") or "").lower() == "fixed" and symbols:
            return {
                "ready": True,
                "code": "fixed_universe_ready",
                "message": f"已冻结 {len(symbols)} 只股票，可直接运行正式回放。",
                "symbolCount": len(symbols),
            }
        return {
            "ready": False,
            "code": "point_in_time_universe_required",
            "message": "动态选股版本需先接入历史时点股票池，当前仅可做指定股票诊断。",
        }

    def _data_source_item(self, row: SimulationDataSourceRecord) -> dict[str, Any]:
        return {
            "id": row.id,
            "sourceId": row.source_key,
            "name": row.name,
            "kind": row.source_kind,
            "description": row.description,
            "connectionKey": row.connection_key,
            "setupUrl": row.setup_url,
            "accessMode": row.access_mode or "custom",
            "configurationKeys": [],
            "markets": self._load(row.markets_json),
            "required": False,
            "builtIn": False,
            "selectable": True,
            "availability": "registered",
            "selectionMode": "provider",
            "createdAt": self._iso(row.created_at),
            "updatedAt": self._iso(row.updated_at),
        }

    @staticmethod
    def _setup_url(value: Any) -> Optional[str]:
        if value is None or not str(value).strip():
            return None
        url = str(value).strip()
        if len(url) > 2048:
            raise StrategyDefinitionError("DATA_SOURCE_SETUP_URL_INVALID", "接入说明链接不能超过 2048 个字符。")
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise StrategyDefinitionError(
                "DATA_SOURCE_SETUP_URL_INVALID",
                "接入说明链接必须是安全的 HTTP(S) 地址，且不能包含账号、Token 或密钥。",
            )
        return url

    def _strategy_detail(self, session, row):
        result = self._strategy_summary(session, row); result["versions"] = self.list_versions(row.id); return result

    def _version_summary(self, session, row):
        agent_count = session.execute(select(func.count(SimulationAgentInstanceRecord.id)).where(SimulationAgentInstanceRecord.strategy_version_id == row.id)).scalar() or 0
        connection_count = session.execute(select(func.count(SimulationAgentConnectionRecord.id)).where(SimulationAgentConnectionRecord.strategy_version_id == row.id)).scalar() or 0
        purpose = row.strategy_purpose or "trading_decision"
        output_contract = {"research_report": "ResearchReport", "candidate_screening": "CandidateList", "trading_decision": "DecisionProposal"}.get(purpose, "UnknownOutput")
        config = self._load(row.config_json)
        strategy = session.get(SimulationStrategyRecord, row.strategy_id)
        built_in = bool(strategy and strategy.name in {self.DAILY_RESEARCH_STRATEGY_NAME, self.DAILY_SCREENING_STRATEGY_NAME, self.DAILY_TRADING_STRATEGY_NAME})
        product_role = "kernel" if built_in or config.get("productRole") == "kernel" else "configured"
        return {"id": row.id, "strategyId": row.strategy_id, "status": row.status, "versionNumber": row.version_number, "basedOnVersionId": row.based_on_version_id, "changeLog": row.change_log, "agentWorkflowVersionId": row.agent_workflow_version_id, "strategyPurpose": purpose, "outputContract": output_contract, "productRole": product_role, "kernelVersionId": row.id if product_role == "kernel" else self._integer(config.get("kernelSourceVersionId")), "agentCount": agent_count, "connectionCount": connection_count, "immutable": row.immutable, "revision": row.revision, "createdAt": self._iso(row.created_at), "updatedAt": self._iso(row.updated_at), "publishedAt": self._iso(row.published_at)}

    def _version_detail(self, session, row):
        result = self._version_summary(session, row)
        data_sources = self._load(row.data_permission_snapshot_json)
        if row.status == "DRAFT":
            data_sources = self._effective_data_source_config(data_sources)
        strategy_package = self._load(row.config_json).get("strategyPackage")
        result.update({"objective": row.objective, "marketScope": self._load(row.market_scope_json), "timeHorizon": row.time_horizon, "decisionPolicy": self._load(row.decision_policy_json), "riskPolicy": self._load(row.risk_policy_json), "memoryPolicy": self._load(row.memory_policy_json), "dataPermissionSnapshot": data_sources, "screeningPolicy": self._screening_policy(row), "strategyPackage": strategy_package if isinstance(strategy_package, dict) else None, "agents": [self._agent_detail(item) for item in session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == row.id).order_by(SimulationAgentInstanceRecord.id)).scalars().all()], "connections": [self._connection_detail(item) for item in session.execute(select(SimulationAgentConnectionRecord).where(SimulationAgentConnectionRecord.strategy_version_id == row.id)).scalars().all()]})
        return result

    def _agent_config(self, a):
        return {"id": str(a.id), "lineage_id": a.lineage_id, "type": a.agent_type, "name": a.name, "role": a.role, "model_profile_id": a.model_profile_id, "execution_mode": a.execution_mode, "deterministic": a.execution_mode == "DETERMINISTIC", "tool_permissions": self._load(a.tool_permissions_json), "data_permissions": self._load(a.data_permissions_json), "input_schema": self._load(a.input_schema_json), "output_schema": self._load(a.output_schema_json), "timeout_seconds": a.timeout_seconds, "max_retries": a.max_retries, "required": a.required, "failure_policy": a.failure_policy, "cost_limit": float(a.cost_limit or 0)}

    def _agent_detail(self, a):
        config = self._agent_config(a); config.update({"id": str(a.id), "lineageId": a.lineage_id, "agentTemplateId": a.template_id, "agentTemplateVersion": a.template_version, "agentType": a.agent_type, "systemPrompt": a.system_prompt, "promptTemplate": a.prompt_template, "modelProfileId": a.model_profile_id, "fallbackModelProfileId": a.fallback_model_profile_id, "executionMode": a.execution_mode, "toolPermissions": self._load(a.tool_permissions_json), "dataPermissions": self._load(a.data_permissions_json), "inputSchema": self._load(a.input_schema_json), "outputSchema": self._load(a.output_schema_json), "timeoutSeconds": a.timeout_seconds, "maxRetries": a.max_retries, "failurePolicy": a.failure_policy, "costLimit": str(a.cost_limit), "positionX": a.position_x, "positionY": a.position_y}); return config

    def _connection_detail(self, c):
        return {"id": str(c.id), "sourceAgentId": str(c.source_agent_id), "targetAgentId": str(c.target_agent_id), "connectionType": c.connection_type, "condition": c.condition, "fieldMapping": self._load(c.field_mapping_json)}

    def _run_detail(self, session, run):
        version = self._version(session, run.strategy_version_id)
        strategy = self._strategy(session, version.strategy_id)
        package = self._load(version.config_json).get("strategyPackage") or {}
        return {
            "id": run.id,
            "strategyId": strategy.id,
            "strategyName": strategy.name,
            "strategyVersionId": version.id,
            "versionNumber": version.version_number,
            "status": run.status,
            "executionMode": run.execution_mode,
            "inputSnapshot": self._load(run.input_snapshot_json),
            "resultSnapshot": self._load(run.result_snapshot_json) if run.result_snapshot_json else None,
            "errorMessage": run.error_message,
            "startedAt": self._iso(run.started_at),
            "completedAt": self._iso(run.completed_at),
            "createdAt": self._iso(run.created_at),
            "updatedAt": self._iso(run.updated_at),
            "outputContract": package.get("outputContract") if isinstance(package, dict) else "DecisionProposal",
            "kernelRuntime": package.get("runtime") if isinstance(package, dict) else None,
        }

    def _run_batch_detail(self, session, batch):
        version = self._version(session, batch.strategy_version_id)
        strategy = self._strategy(session, version.strategy_id)
        package = self._load(version.config_json).get("strategyPackage") or {}
        result = self._load(batch.result_snapshot_json) if batch.result_snapshot_json else {}
        candidates = result.get("candidates") if isinstance(result.get("candidates"), list) else []
        enriched_candidates: list[dict[str, Any]] = []
        for candidate in candidates:
            item = dict(candidate) if isinstance(candidate, dict) else {}
            run_id = self._integer(item.get("runId"))
            child = session.get(SimulationRunRecord, run_id) if run_id else None
            if child:
                item["status"] = child.status
                # Internal implementation traces from historical graph runs
                # deliberately stay behind the complete-strategy boundary.
                # Product clients receive only the child status and standard
                # strategy output through the run detail endpoint.
            enriched_candidates.append(item)
        return {
            "id": batch.id, "strategyId": strategy.id, "strategyName": strategy.name,
            "strategyVersionId": version.id, "versionNumber": version.version_number,
            "status": batch.status, "screeningPolicy": self._load(batch.input_snapshot_json).get("screeningPolicy", self._screening_policy(version)),
            "screeningRunId": batch.screening_run_id, "candidateCount": result.get("candidateCount", len(candidates)),
            "candidates": enriched_candidates, "screening": result.get("screening", {}), "errorMessage": batch.error_message,
            "startedAt": self._iso(batch.started_at), "completedAt": self._iso(batch.completed_at),
            "createdAt": self._iso(batch.created_at), "updatedAt": self._iso(batch.updated_at),
            "outputContract": package.get("outputContract") if isinstance(package, dict) else "DecisionProposal",
            "kernelRuntime": package.get("runtime") if isinstance(package, dict) else None,
        }

    def _screening_policy(self, version) -> dict[str, Any]:
        policy = self._load(version.screening_policy_json)
        return {
            "strategy": self._text(policy.get("strategy") or policy.get("screeningStrategy") or "dual_low", 64) or "dual_low",
            "market": self._text(policy.get("market") or "cn", 16).lower() or "cn",
            "maxCandidates": max(1, min(self._integer(policy.get("maxCandidates") or policy.get("max_candidates")) or 3, 10)),
        }

    @staticmethod
    def _template_screening_policy(template: dict[str, Any]) -> dict[str, Any]:
        return {
            "strategy": str(template.get("screening_strategy_id") or "dual_low"),
            "market": "cn",
            "maxCandidates": 3,
        }

    def _template_summary(self, session, template):
        version = session.execute(select(SimulationAgentTemplateVersionRecord).where(
            SimulationAgentTemplateVersionRecord.template_id == template.id,
            SimulationAgentTemplateVersionRecord.version == template.current_version,
        )).scalar_one()
        return {"templateId": template.id, "name": template.name, "description": template.description,
                "agentType": template.agent_type, "currentVersion": template.current_version,
                "supportedTools": self._load(version.supported_tools_json),
                "supportedDataTypes": self._load(version.supported_data_types_json),
                "archived": bool(template.archived_at), "updatedAt": self._iso(template.updated_at)}

    def _template_detail(self, template, version):
        result = {"templateId": template.id, "name": template.name, "description": template.description,
                  "agentType": template.agent_type, "templateVersion": version.version,
                  "defaultRole": version.default_role, "defaultSystemPrompt": version.default_system_prompt,
                  "defaultPromptTemplate": version.default_prompt_template,
                  "inputSchema": self._load(version.input_schema_json), "outputSchema": self._load(version.output_schema_json),
                  "supportedTools": self._load(version.supported_tools_json), "supportedDataTypes": self._load(version.supported_data_types_json),
                  "archived": bool(template.archived_at), "publishedAt": self._iso(version.published_at)}
        return result

    def _preview_diff(self, session, server, preview):
        """Readable, ephemeral diff for the revision-conflict dialog."""
        server_agents = {a.lineage_id: self._agent_detail(a) for a in session.execute(select(SimulationAgentInstanceRecord).where(
            SimulationAgentInstanceRecord.strategy_version_id == server.id)).scalars().all()}
        local_agents = {str(a.get("lineageId")): a for a in preview.get("agents", []) if a.get("lineageId")}
        changes = []
        for lineage in local_agents.keys() - server_agents.keys():
            changes.append({"category": "AGENT_ADDED", "agentLineageId": lineage, "agentName": local_agents[lineage].get("name"), "sensitive": False})
        for lineage in server_agents.keys() - local_agents.keys():
            changes.append({"category": "AGENT_REMOVED", "agentLineageId": lineage, "agentName": server_agents[lineage].get("name"), "sensitive": False})
        for lineage in local_agents.keys() & server_agents.keys():
            for field, label in (("name", "AGENT_NAME_CHANGED"), ("role", "AGENT_ROLE_CHANGED"), ("modelProfileId", "AGENT_MODEL_CHANGED"), ("systemPrompt", "AGENT_SYSTEM_PROMPT_CHANGED"), ("promptTemplate", "AGENT_PROMPT_TEMPLATE_CHANGED")):
                before, after = server_agents[lineage].get(field), local_agents[lineage].get(field)
                if before != after:
                    sensitive = field in {"systemPrompt", "promptTemplate"}
                    changes.append({"category": label, "agentLineageId": lineage, "agentName": local_agents[lineage].get("name"), "field": field,
                                    "before": self._hash(before) if sensitive else str(before), "after": self._hash(after) if sensitive else str(after), "sensitive": sensitive})
        preview_version = preview.get("version") if isinstance(preview.get("version"), dict) else preview
        local_purpose = str(preview_version.get("strategyPurpose") or "trading_decision")
        server_purpose = server.strategy_purpose or "trading_decision"
        if local_purpose != server_purpose:
            changes.append({"category": "STRATEGY_PURPOSE_CHANGED", "field": "strategyPurpose", "before": server_purpose, "after": local_purpose, "sensitive": False})
        return {"fromVersionId": server.id, "toVersionId": server.id, "preview": True,
                "summary": {"agentsAdded": len(local_agents.keys() - server_agents.keys()), "agentsRemoved": len(server_agents.keys() - local_agents.keys()), "agentsModified": len({c.get("agentLineageId") for c in changes if c["category"] not in {"AGENT_ADDED", "AGENT_REMOVED"}})},
                "changes": changes}

    def _diff(self, session, old, new):
        old_agents = {a.lineage_id: a for a in session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == old.id)).scalars().all()}; new_agents = {a.lineage_id: a for a in session.execute(select(SimulationAgentInstanceRecord).where(SimulationAgentInstanceRecord.strategy_version_id == new.id)).scalars().all()}
        changes=[]
        for lineage in new_agents.keys() - old_agents.keys(): changes.append({"category":"AGENT_ADDED","agentLineageId":lineage,"agentName":new_agents[lineage].name,"sensitive":False})
        for lineage in old_agents.keys() - new_agents.keys(): changes.append({"category":"AGENT_REMOVED","agentLineageId":lineage,"agentName":old_agents[lineage].name,"sensitive":False})
        fields = [("name","AGENT_NAME_CHANGED"),("role","AGENT_ROLE_CHANGED"),("model_profile_id","AGENT_MODEL_CHANGED"),("system_prompt","AGENT_SYSTEM_PROMPT_CHANGED"),("prompt_template","AGENT_PROMPT_TEMPLATE_CHANGED"),("data_permissions_json","AGENT_DATA_PERMISSIONS_CHANGED"),("tool_permissions_json","AGENT_TOOL_PERMISSIONS_CHANGED"),("input_schema_json","AGENT_INPUT_SCHEMA_CHANGED"),("output_schema_json","AGENT_OUTPUT_SCHEMA_CHANGED"),("timeout_seconds","AGENT_TIMEOUT_CHANGED"),("max_retries","AGENT_RETRY_CHANGED"),("failure_policy","AGENT_FAILURE_POLICY_CHANGED"),("cost_limit","AGENT_COST_LIMIT_CHANGED")]
        for lineage in old_agents.keys() & new_agents.keys():
            before, after = old_agents[lineage], new_agents[lineage]
            for field, category in fields:
                if getattr(before, field) != getattr(after, field):
                    sensitive = field in {"system_prompt","prompt_template"}; changes.append({"category":category,"agentLineageId":lineage,"agentName":after.name,"field":field,"before": self._hash(getattr(before, field)) if sensitive else str(getattr(before, field)),"after":self._hash(getattr(after, field)) if sensitive else str(getattr(after, field)),"sensitive":sensitive})
        def edges(version, agents):
            lookup={a.id:a.lineage_id for a in agents.values()}
            return {(lookup[c.source_agent_id], lookup[c.target_agent_id], c.connection_type): c for c in session.execute(select(SimulationAgentConnectionRecord).where(SimulationAgentConnectionRecord.strategy_version_id == version.id)).scalars().all()}
        old_edges, new_edges = edges(old, old_agents), edges(new, new_agents)
        for key in new_edges.keys()-old_edges.keys(): changes.append({"category":"CONNECTION_ADDED","before":None,"after":key,"sensitive":False})
        for key in old_edges.keys()-new_edges.keys(): changes.append({"category":"CONNECTION_REMOVED","before":key,"after":None,"sensitive":False})
        for key in old_edges.keys() & new_edges.keys():
            before_edge, after_edge = old_edges[key], new_edges[key]
            if (before_edge.condition or "") != (after_edge.condition or ""):
                changes.append({"category":"CONNECTION_CONDITION_CHANGED","field":"condition","before":before_edge.condition,"after":after_edge.condition,"sensitive":False})
            before_mapping, after_mapping = self._load(before_edge.field_mapping_json), self._load(after_edge.field_mapping_json)
            if before_mapping != after_mapping:
                changes.append({"category":"CONNECTION_FIELD_MAPPING_CHANGED","field":"fieldMapping","before":before_mapping,"after":after_mapping,"sensitive":False})
        if (old.strategy_purpose or "trading_decision") != (new.strategy_purpose or "trading_decision"):
            changes.append({"category":"STRATEGY_PURPOSE_CHANGED","field":"strategyPurpose","before":old.strategy_purpose or "trading_decision","after":new.strategy_purpose or "trading_decision","sensitive":False})
        policy_changes = {"strategyPurposeChanged": (old.strategy_purpose or "trading_decision") != (new.strategy_purpose or "trading_decision"), "agentWorkflowVersionChanged": old.agent_workflow_version_id != new.agent_workflow_version_id, "marketScopeChanged": old.market_scope_json != new.market_scope_json, "dataSourcesChanged": old.data_permission_snapshot_json != new.data_permission_snapshot_json, "decisionPolicyChanged": old.decision_policy_json != new.decision_policy_json, "riskPolicyChanged": old.risk_policy_json != new.risk_policy_json, "memoryPolicyChanged": old.memory_policy_json != new.memory_policy_json, "screeningPolicyChanged": old.screening_policy_json != new.screening_policy_json}
        return {"fromVersionId":old.id,"toVersionId":new.id,"summary":{"agentsAdded":len(new_agents.keys()-old_agents.keys()),"agentsRemoved":len(old_agents.keys()-new_agents.keys()),"agentsModified":len({c.get("agentLineageId") for c in changes if c["category"] not in {"AGENT_ADDED","AGENT_REMOVED"}}),"connectionsAdded":len(new_edges.keys()-old_edges.keys()),"connectionsRemoved":len(old_edges.keys()-new_edges.keys()),"connectionsModified":sum(1 for c in changes if c["category"] in {"CONNECTION_CONDITION_CHANGED","CONNECTION_FIELD_MAPPING_CHANGED"}),**policy_changes},"changes":changes}

    def _publish_response(self, draft): return {"strategyId": draft.strategy_id, "publishedVersionId": draft.id, "versionNumber": draft.version_number, "publishedAt": self._iso(draft.published_at), "immutable": True}
    def _audit(self, session, action, object_type, object_id, strategy_id, version_id, before, after, request_id): session.add(SimulationAuditEventRecord(actor_id=self.actor_id, action=action, object_type=object_type, object_id=object_id, strategy_id=strategy_id, strategy_version_id=version_id, before_summary_json=self._dump(before) if before else None, after_summary_json=self._dump(after) if after else None, request_id=request_id))
    @staticmethod
    def _dump(value): return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    @staticmethod
    def _load(value):
        try: return json.loads(value or "{}")
        except (TypeError, ValueError): return {}
    @staticmethod
    def _text(value, limit):
        text = str(value).strip() if value is not None else ""
        return text[:limit]
    def _required(self, value, code, message, limit):
        text = self._text(value, limit)
        if not text: raise StrategyDefinitionError(code, message)
        return text
    @staticmethod
    def _integer(value):
        try: return int(value) if value is not None else None
        except (TypeError, ValueError): return None
    @staticmethod
    def _hash(value): return hashlib.sha256(str(value or "").encode()).hexdigest()
    @staticmethod
    def _iso(value): return value.isoformat() if isinstance(value, datetime) else None
