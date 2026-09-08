"""Holdings research uses the existing ledger, research runs and durable scheduler.

No broker orders are placed. Rules are review triggers, never executable signals.
"""
from __future__ import annotations

from datetime import datetime, timezone
from contextvars import ContextVar
import math
import threading

from sqlalchemy import select
from data_provider.base import normalize_stock_code

from src.core.trading_calendar import get_market_for_stock, get_effective_trading_date
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.portfolio_service import PortfolioService
from src.storage import WorkspaceRunRecord

_PLAN_LOCK = threading.RLock()
ACTIVE_HOLDING_CONTEXT = ContextVar("active_holding_context", default=None)
MARKETS = {"cn": ("Asia/Shanghai", "16:30"), "hk": ("Asia/Hong_Kong", "17:30"),
           "us": ("America/New_York", "17:00")}
DEFAULT_RULES = {"lossPct": 10.0, "profitPct": 20.0, "dailyMovePct": 5.0}


def research_symbol(symbol):
    normalized = normalize_stock_code(symbol).upper()
    if normalized.isdigit() and len(normalized) <= 5:
        return "HK" + normalized.zfill(5)
    return normalized


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def _brief_text(value):
    """Never turn unknown objects or raw JSON into report prose."""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if text.startswith(("{", "[", "```")):
        return ""
    return text[:400] + ("…" if len(text) > 400 else "")


def matching_context(portfolio, symbol, account_id=None, market=None):
    """Read ledger/cache only; never introduce network I/O into task submission."""
    target = research_symbol(symbol)
    market = (market or get_market_for_stock(symbol) or "").lower()
    snapshot = portfolio.get_portfolio_snapshot(account_id=account_id, include_realtime=False)
    positions = []
    for account in snapshot.get("accounts", []):
        for position in account.get("positions", []):
            if (research_symbol(position["symbol"]) == target
                    and position["market"].lower() == market and position["quantity"] > 0):
                positions.append({"account_id": account["account_id"], **position})
    if not positions:
        return None
    # Distinct accounts retain their own cost bases; do not average currencies.
    return {**(positions[0] if len(positions) == 1 else {}), "symbol": target, "market": market, "positions": positions, "cost_method": "fifo",
            "price_available": all(p.get("price_available") for p in positions),
            "price_stale": any(p.get("price_stale") for p in positions)}


def portfolio_alerts(position, rules, change_pct=None):
    if not position.get("price_available") or position.get("price_stale"):
        return ["price_unverified"]
    alerts = []
    pnl = _number(position.get("unrealized_pnl_pct"))
    if pnl is not None:
        if pnl <= -rules["lossPct"]:
            alerts.append("loss_review")
        elif pnl >= rules["profitPct"]:
            alerts.append("profit_review")
    change = _number(change_pct)
    if change is not None and abs(change) >= rules["dailyMovePct"]:
        alerts.append("sharp_rise" if change > 0 else "sharp_fall")
    return alerts


class PortfolioResearchService:
    def __init__(self, workspace):
        self.workspace = workspace
        self.portfolio = PortfolioService(PortfolioRepository(workspace.db))

    def _position(self, account_id, symbol):
        from src.services.workspace_service import WorkspaceError
        try:
            context = matching_context(self.portfolio, symbol, account_id)
        except ValueError as exc:
            raise WorkspaceError("holding_account_invalid", "持仓账户不存在或已停用，请检查账户。", 404) from exc
        if not context:
            raise WorkspaceError("holding_not_found", "未找到该账户的有效持仓，请先录入或检查是否已清仓。", 404)
        if context["market"] not in MARKETS:
            raise WorkspaceError("holding_market_unsupported", "每日研究暂支持 A 股、港股、美股；其他市场可记账但不能自动研究。", 422)
        return context

    def _task(self, account_id, symbol):
        target = research_symbol(symbol)
        return next((task for task in self.workspace.list_tasks("research")
                     if task["config"].get("portfolioHolding") == {"accountId": account_id, "symbol": target}), None)

    def plan(self, account_id, symbol):
        from src.services.workspace_defaults import default_task_plan
        context = self._position(account_id, symbol)
        saved = self._task(account_id, symbol)
        if saved:
            task = saved
        else:
            task = default_task_plan(self.workspace, "research", context["market"].upper(), symbol)["task"]
            task["capabilities"]["expertIds"] = []
            task["capabilities"]["expertTeamIds"] = []
            task["name"] = f"{symbol} · 持仓跟踪"
            task["objective"] = ("基于正式个股研究与实际持仓，检查趋势、量价、基本面、新闻和成本风险。"
                                 "给出简短持有/观察/考虑减仓/考虑增持观点及触发、失效条件。"
                                 "上涨不等于卖出，下跌不等于清仓；不摊平成本式盲目加仓。"
                                 "数据过期或证据不足只提示核查，不给确定性交易指令。禁止下单。")
            task["config"]["portfolioHolding"] = {"accountId": account_id, "symbol": context["symbol"]}
            task["config"]["portfolioRules"] = dict(DEFAULT_RULES)
        schedule = next((s for s in self.workspace.list_schedules() if s["taskId"] == task.get("id")), None)
        tz, run_at = MARKETS[context["market"]]
        return {"task": task, "schedule": schedule, "timezone": tz, "runAt": run_at}

    def configure(self, account_id, symbol, payload):
        from src.services.workspace_service import WorkspaceError
        from src.services.strategy_definition_service import StrategyDefinitionService, StrategyDefinitionError
        with _PLAN_LOCK:
            plan = self.plan(account_id, symbol)
            task = plan["task"]
            bindings = payload.get("capabilities") or task["capabilities"]
            version_id = payload.get("strategyVersionId") or task["config"]["strategyVersionId"]
            try:
                version = StrategyDefinitionService(self.workspace.db).get_version(version_id)
            except StrategyDefinitionError as exc:
                raise WorkspaceError("holding_strategy_invalid", "研究策略不存在，请重新选择。", 422) from exc
            if len(bindings.get("expertIds", [])) > 3 or bindings.get("expertTeamIds"):
                raise WorkspaceError("holding_expert_limit", "持仓研究最多选择三位补充专家，不绑定专家小组。", 422)
            if (version.get("status") != "PUBLISHED" or version.get("strategyPurpose") != "research_report"
                    or str(version.get("screeningPolicy", {}).get("market", "")).upper() != task["market"]):
                raise WorkspaceError("holding_strategy_invalid", "请选择同市场已发布的单股研究策略。", 422)
            fixed = version.get("decisionPolicy", {}).get("packageParameters", {}).get("skills") or []
            if fixed and bindings.get("skillIds"):
                raise WorkspaceError("holding_skill_conflict", "正式策略已定义 Skill；自选 Skill 请改用综合研究策略。", 422)
            rules = payload.get("rules") or task["config"]["portfolioRules"]
            if set(rules) != set(DEFAULT_RULES) or any(_number(v) is None or not 0.1 <= v <= 100 for v in rules.values()):
                raise WorkspaceError("holding_rules_invalid", "提醒阈值必须在 0.1% 至 100% 之间。", 422)
            config = {**task["config"], "strategyVersionId": version_id, "portfolioRules": rules}
            update = {"config": config, "capabilities": bindings}
            # Validate scheduling before writing the task.
            run_at = payload.get("runAt") or (plan["schedule"] or {}).get("runAt") or plan["runAt"]
            interval_days = payload.get("intervalDays")
            if interval_days is None:
                interval_days = (plan["schedule"] or {}).get("intervalDays", 1)
            interval_days = self.workspace._validate_interval_days(interval_days)
            self.workspace._next_run("daily", run_at, None, plan["timezone"], datetime.now(timezone.utc).replace(tzinfo=None))
            task = (self.workspace.update_task(task["id"], update) if task.get("id")
                    else self.workspace.create_task({**task, **update}))
            schedule_data = {"intervalDays": interval_days, "runAt": run_at, "enabled": payload.get("dailyEnabled", False)}
            if plan["schedule"]:
                self.workspace.update_schedule(plan["schedule"]["id"], schedule_data)
            else:
                self.workspace.create_schedule({"taskId": task["id"], "name": task["name"], "scheduleMode": "daily",
                                                "timezone": plan["timezone"], **schedule_data})
            return self.plan(account_id, symbol)

    def run(self, account_id, symbol):
        with _PLAN_LOCK:
            self._position(account_id, symbol)
            task = self._task(account_id, symbol)
            if not task:
                task = self.configure(account_id, symbol, {})["task"]
            return self.workspace.create_run(task["id"], trigger_type="manual")

    def prepare_run(self, task, trigger_type):
        """Re-read inventory each day; closed positions must never keep consuming LLM calls."""
        from src.services.workspace_service import WorkspaceError
        binding = task["config"].get("portfolioHolding")
        symbol = str(task.get("subject", {}).get("stock") or task.get("subject", {}).get("stockCode") or "")
        context = matching_context(self.portfolio, symbol, binding["accountId"] if binding else None, task["market"])
        if binding and not context:
            for schedule in self.workspace.list_schedules():
                if schedule["taskId"] == task["id"] and schedule["enabled"]:
                    self.workspace.update_schedule(schedule["id"], {"enabled": False})
            raise WorkspaceError("holding_closed", "该持仓已清仓，自动研究已暂停。", 409)
        if binding:
            # Dedupe both manual double-clicks and scheduler overlap, including
            # completed-session reuse on weekends/holidays. Failed runs may retry.
            with self.workspace.db.get_session() as session:
                rows = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.task_id == task["id"])
                                       .order_by(WorkspaceRunRecord.created_at.desc()).limit(30)).scalars().all()
                effective = str(get_effective_trading_date(task["market"].lower()))
                import json
                for row in rows:
                    if row.status in {"queued", "running"}:
                        return context, row.id
                    if (trigger_type == "schedule" and row.status == "completed"
                            and json.loads(row.task_snapshot_json).get("portfolioSession") == effective):
                        return context, row.id
                task["portfolioSession"] = effective
        return context, None

    def dashboard(self, refresh=False):
        snapshot = self.portfolio.get_portfolio_snapshot(include_realtime=refresh)
        tasks = self.workspace.list_tasks("research")
        schedules = self.workspace.list_schedules()
        result = []
        for account in snapshot["accounts"]:
            for position in account["positions"]:
                binding = {"accountId": account["account_id"], "symbol": research_symbol(position["symbol"])}
                task = next((t for t in tasks if t["config"].get("portfolioHolding") == binding), None)
                latest = None
                if task:
                    with self.workspace.db.get_session() as session:
                        row = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.task_id == task["id"])
                                              .order_by(WorkspaceRunRecord.created_at.desc()).limit(1)).scalar_one_or_none()
                        run_id = row.id if row else None
                    if run_id:
                        latest = self.workspace.get_run(run_id)
                report = None
                if latest:
                    artifact = next((a for a in latest["artifacts"] if a["type"] == "ResearchReport"
                                     and isinstance(a.get("content"), dict) and isinstance(a["content"].get("result"), dict)), None)
                    report = artifact["content"]["result"] if artifact else None
                raw_summary, raw_meta = (report or {}).get("summary"), (report or {}).get("meta")
                summary = raw_summary if isinstance(raw_summary, dict) else {}
                meta = raw_meta if isinstance(raw_meta, dict) else {}
                interpretation = ""
                if latest:
                    for artifact in latest["artifacts"]:
                        if not isinstance(artifact.get("content"), dict):
                            continue
                        if artifact["type"] == "ResearchInterpretation":
                            interpretation = _brief_text(artifact.get("content", {}).get("conclusion")) or interpretation
                        elif artifact["type"] == "ExpertReview":
                            conclusion = artifact.get("content", {}).get("structuredConclusion") or {}
                            if isinstance(conclusion, dict):
                                interpretation = _brief_text(conclusion.get("conclusion")) or interpretation
                rules = task["config"].get("portfolioRules", DEFAULT_RULES) if task else DEFAULT_RULES
                # Daily movement belongs to the research quote, not today's cached price.
                report_current = bool(latest and latest["taskSnapshot"].get("portfolioSession") == str(get_effective_trading_date(position["market"])))
                alerts = portfolio_alerts(position, rules, meta.get("change_pct") if report_current else None)
                result.append({"accountId": account["account_id"], "accountName": account["account_name"],
                               "position": position, "taskId": task["id"] if task else None,
                               "schedule": next((s for s in schedules if task and s["taskId"] == task["id"]), None),
                               "alerts": alerts, "supported": position["market"] in MARKETS,
                               "run": ({"id": latest["id"], "status": latest["status"], "createdAt": latest["createdAt"],
                                        "error": latest.get("errorMessage"), "currentSession": report_current} if latest else None),
                               "brief": ({"name": meta.get("stock_name"), "summary": interpretation or _brief_text(summary.get("analysis_summary")),
                                          "action": "" if interpretation else _brief_text(summary.get("action")),
                                          "advice": "" if interpretation else _brief_text(summary.get("operation_advice")),
                                          "trend": _brief_text(summary.get("trend_prediction")), "changePct": meta.get("change_pct"),
                                          "strategy": report.get("strategy"), "diagnostics": report.get("diagnostic_summary")}
                                         if report else None)})
        return {"asOf": snapshot["as_of"], "items": result, "rules": DEFAULT_RULES}
