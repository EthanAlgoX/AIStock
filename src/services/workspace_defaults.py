"""Deterministic, inspectable starter plans; never run a model while planning."""
from __future__ import annotations

from data_provider.base import normalize_stock_code
from src.config import get_config
from src.core.trading_calendar import get_market_for_stock
from src.data.stock_index_loader import get_index_stock_name, resolve_index_stock_code
from src.services.strategy_definition_service import StrategyDefinitionService
from src.services.workspace_service import WorkspaceError, WorkspaceService


# Curated demonstration subjects, not recommendations or performance rankings.
# Prefer the user's existing watchlist; these provide a reproducible empty-install trial.
DEMO_STOCKS = {"CN": "600519", "HK": "HK00700", "US": "AAPL"}
POLICY_VERSION = "starter-v1"


def default_task_plan(workspace: WorkspaceService, kind: str, market: str = "CN", stock: str | None = None) -> dict:
    if kind not in {"research", "screening", "trading"} or market not in DEMO_STOCKS:
        raise WorkspaceError("default_plan_invalid", "不支持的默认任务或市场。", 422)
    catalog = workspace.capability_catalog()
    bindings = workspace.default_bindings(kind, catalog)
    bindings["skillIds"] = []
    reasons, warnings = [], []
    subject, config = {}, {"defaultPolicyVersion": POLICY_VERSION}
    symbol, name = "", ""
    if kind != "screening":
        if stock:
            symbol = resolve_index_stock_code(stock) or stock.strip().upper()
            reasons.append("使用当前选择的股票，不替换为其他标的。")
        else:
            watchlist_stock = next((code for code in get_config().stock_list if get_market_for_stock(code) == market.lower()), None)
            symbol = watchlist_stock or DEMO_STOCKS[market]
            reasons.append("采用已有自选股中当前市场的首只股票，尊重你的关注顺序。" if watchlist_stock else "当前市场没有已配置的自选股，采用固定演示标的以便复现试用；这不是实时优选或投资推荐。")
        if get_market_for_stock(symbol) != market.lower():
            raise WorkspaceError("default_stock_market_mismatch", "默认方案的股票与市场不一致，请重新选择股票或市场。", 422)
        symbol = resolve_index_stock_code(symbol) or normalize_stock_code(symbol)
        name = get_index_stock_name(symbol) or symbol
        subject = {"stock": symbol, "stockName": name}

    growth = market == "CN" and normalize_stock_code(symbol).startswith(("688", "300", "301"))
    enabled_skills = {item["id"] for item in catalog["skills"] if item.get("enabled")}
    strategy_name = "趋势确认与风险复核"
    if kind in {"research", "screening"}:
        definitions = StrategyDefinitionService(workspace.db)
        definitions.ensure_daily_product_strategies()
        purpose = "research_report" if kind == "research" else "candidate_screening"
        choices = []
        for item in definitions.list_strategies():
            if item.get("productRole") != "configured" or item.get("kernelExecutionStatus") != "ready" or not item.get("currentPublishedVersionId"):
                continue
            version = definitions.get_version(item["currentPublishedVersionId"])
            expected_module = "single_stock_research" if kind == "research" else "stock_screening"
            if (version.get("strategyPackage") or {}).get("entrypoint") != f"src.strategy_kernels.{expected_module}:run":
                continue
            if version.get("status") != "PUBLISHED" or version.get("strategyPurpose") != purpose or (version.get("screeningPolicy") or {}).get("market", "").upper() != market:
                continue
            skills = (version.get("decisionPolicy", {}).get("packageParameters") or {}).get("skills") or []
            if not set(skills).issubset(enabled_skills):
                continue
            if kind == "research":
                rank = 0 if growth and skills == ["growth_quality"] else 1 if not skills else 9
            else:
                rule = (version.get("screeningPolicy") or {}).get("strategy")
                rank = {"balanced_alpha": 0, "quality_value": 1, "dual_low": 2}.get(rule, 9)
            if rank < 9:
                choices.append((rank, item["id"], item, version, skills))
        if not choices:
            raise WorkspaceError("default_strategy_unavailable", "当前市场没有可用的默认正式策略，请在策略中心检查已发布配置，或切换市场。", 422)
        _, _, selected, version, applied_skills = min(choices, key=lambda entry: entry[:2])
        config["strategyVersionId"] = version["id"]
        strategy_name = selected["name"]
        required_tool = "run_stock_research" if kind == "research" else "run_stock_screening"
        if required_tool not in bindings["toolIds"]:
            raise WorkspaceError("default_tool_disabled", f"默认方案需要启用 {required_tool}，不会绕过工具白名单。", 422)
        if kind == "research":
            reasons.append("科创板/创业板优先使用成长质量方法，审查增长、现金流与估值反例；其他股票采用综合研究。板块只是研究起点，不代表成长性已获验证。")
            if growth and applied_skills != ["growth_quality"]:
                warnings.append("成长质量配置或 Skill 不可用，已明确回退到综合研究。")
            objective = f"研究 {name}（{symbol}）的商业质量、增长持续性、现金流、估值与风险；区分事实和假设，给出观察条件与反例，不因缺数据编造结论。"
        else:
            config["deepResearchCount"] = 0
            reasons.append("优先采用均衡多因子规则，兼顾质量、估值、趋势与风险；数量使用正式版本配置，默认不追加逐股深研以控制成本。")
            objective = "解释正式筛选结果的因子依据、组合风险、候选差异和需要进一步核实的条件；不把候选名单当成买入指令。"
    else:
        if "get_daily_history" not in bindings["toolIds"]:
            raise WorkspaceError("default_tool_disabled", "默认交易研究需要日线历史工具，请先检查工具白名单。", 422)
        applied_skills = [key for key in ("bull_trend", "shrink_pullback") if key in enabled_skills]
        if not applied_skills:
            raise WorkspaceError("default_trading_skill_unavailable", "默认交易研究 Skill 未启用，请在能力中心启用趋势或缩量回踩 Skill。", 422)
        bindings["skillIds"] = applied_skills
        subject["universeMode"] = "watchlist"
        config.update({"executionMode": "paper", "cadence": "1d", "evaluationWindow": "30d", "initialCapital": 1000000,
                       "riskPolicy": {"maxPositions": 1, "maxPositionPercent": 10, "maxDailyLossPercent": 1, "requireApproval": True}})
        objective = f"仅研究 {name}（{symbol}）的模拟交易提案：核验趋势、回踩、量价和失效条件，不追高；证据不足则 HOLD 或空提案。没有实际持仓证据不建议卖出，不编造价格或成交。"
        reasons.append("单只明确标的、日级趋势与回踩研究，10% 仓位上限和人工确认；只生成模拟提案，不下单或承诺收益。")

    team_key = "innovation-value-debate" if kind == "research" and growth else "long-term-value"
    enabled_experts = {item["id"] for item in catalog["experts"] if item.get("enabled")}
    team = next((item for item in catalog["expertTeams"] if item.get("key") == team_key and item.get("enabled")
                 and item.get("memberIds") and set(item["memberIds"]).issubset(enabled_experts)), None)
    if team:
        bindings["expertTeamIds"] = [team["id"]]
        reasons.append(f"由{team['name']}独立审查假设与风险，保留分歧；不重复选择同组专家。")
    else:
        warnings.append("匹配的专家团不可用或成员被停用，本次仅由主 Agent 解读，不自动启用专家。")
    bindings["mcpIds"] = []
    reasons.append("工具与数据源只取当前已启用的任务默认白名单；不自动挂载额外 MCP 或新增权限。")
    task = {"kind": kind, "name": f"{name + ' · ' if name else ''}{strategy_name} · 默认试用", "market": market,
            "objective": objective, "subject": subject, "config": config, "capabilities": bindings}
    workspace.validate_bindings(bindings)
    workspace._validate_task_contract(kind, subject, config, bindings)
    names = {item["id"]: item["name"] for item in catalog["skills"]}
    return {"policyVersion": POLICY_VERSION, "task": task, "strategyName": strategy_name,
            "skillNames": [names.get(key, key) for key in applied_skills], "teamName": team["name"] if team else "主 Agent 独立解读",
            "expertCount": len(team["memberIds"]) if team else 0, "reasons": reasons, "warnings": warnings,
            "notice": "将调用真实数据与模型，专家评审会增加调用成本。数据或模型不可用时会明确报错，不保证必然产出报告；默认方案不是收益最优或投资推荐。"}
