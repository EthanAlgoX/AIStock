"""Holdings research uses the existing ledger, research runs and durable scheduler.

No broker orders are placed. Rules are review triggers, never executable signals.
"""
from __future__ import annotations

from datetime import datetime, timezone
from contextvars import ContextVar
import json
import math
import threading

from sqlalchemy import select
from data_provider.base import normalize_stock_code

from src.core.trading_calendar import get_market_for_stock, get_effective_trading_date
from src.data.stock_index_loader import get_index_stock_name
from src.repositories.portfolio_repo import PortfolioRepository
from src.schemas.decision_scale import normalize_score
from src.services.portfolio_service import PortfolioService
from src.storage import WorkspaceArtifactRecord, WorkspaceRunRecord

_PLAN_LOCK = threading.RLock()
ACTIVE_HOLDING_CONTEXT = ContextVar("active_holding_context", default=None)
MARKETS = {"cn": ("Asia/Shanghai", "16:30"), "hk": ("Asia/Hong_Kong", "17:30"),
           "us": ("America/New_York", "17:00"), "crypto": ("UTC", "00:10")}
DEFAULT_RULES = {"lossPct": 10.0, "profitPct": 20.0, "dailyMovePct": 5.0}
HOLDING_RECOMMENDATIONS = {
    "increase": {"label": "考虑增持", "minimum": 80},
    "hold_positive": {"label": "持有偏多", "minimum": 60},
    "hold_watch": {"label": "持有观察", "minimum": 40},
    "reduce": {"label": "考虑减仓", "minimum": 20},
    "exit": {"label": "考虑退出", "minimum": 0},
}


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


def holding_recommendation(result):
    """Normalize one independent holding report into a comparable outcome.

    The report's 0-100 sentiment score is the source of truth.  The category is
    derived from that score only; history is assembled after runs complete and
    never becomes an input to the next day's research.
    """
    report = result.get("report") if isinstance(result, dict) else {}
    summary = report.get("summary") if isinstance(report, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    advice = _brief_text(summary.get("operation_advice"))
    score = normalize_score(summary.get("sentiment_score"))
    if score is None:
        return None
    category = next(key for key, definition in HOLDING_RECOMMENDATIONS.items()
                    if score >= definition["minimum"])
    definition = HOLDING_RECOMMENDATIONS[category]
    return {
        "category": category,
        "label": definition["label"],
        "score": score,
        "basis": advice or _brief_text(summary.get("analysis_summary")) or "本次报告未给出操作建议。",
        "source": "current_report_sentiment_score",
    }


def holding_recommendation_trend(history):
    scores = [entry.get("score") for entry in history if _number(entry.get("score")) is not None]
    if len(scores) < 2:
        return {"direction": "insufficient", "change": None, "sessions": len(scores)}
    change = round(scores[-1] - scores[0], 1)
    return {
        "direction": "rising" if change >= 10 else "falling" if change <= -10 else "stable",
        "change": change,
        "sessions": len(scores),
    }


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

    def _watch_task(self, symbol):
        target = research_symbol(symbol)
        return next((task for task in self.workspace.list_tasks("research")
                     if task["config"].get("portfolioWatch") == {"symbol": target}), None)

    def _watch_market(self, symbol, market):
        from src.services.workspace_service import WorkspaceError
        target = research_symbol(symbol)
        actual = (get_market_for_stock(target) or "").lower()
        if actual not in MARKETS or actual != str(market).lower():
            raise WorkspaceError("watch_stock_invalid", "请选择代码与市场一致的 A 股、港股或美股。", 422)
        return target, actual

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
            task["config"]["portfolioDailyNotify"] = False
        schedule = next((s for s in self.workspace.list_schedules() if s["taskId"] == task.get("id")), None)
        tz, run_at = MARKETS[context["market"]]
        return {"task": task, "schedule": schedule, "timezone": tz, "runAt": run_at}

    @staticmethod
    def validate_backend(backend):
        from src.services.workspace_service import WorkspaceError
        if backend not in {'llm', 'jev'}:
            raise WorkspaceError('portfolio_backend_invalid', 'Unsupported analysis model.', 422)
        if backend == 'jev':
            from src.services.jev_decision_service import JevDecisionService
            try:
                JevDecisionService().validate_settings()
            except ValueError as exc:
                raise WorkspaceError('jev_configuration_required', str(exc), 422) from exc
        return backend

    def set_backend(self, account_id, symbol, backend):
        """Update the analysis preference without enabling/disabling an existing schedule."""
        with _PLAN_LOCK:
            backend = self.validate_backend(backend)
            plan = self.plan(account_id, symbol)
            task = plan['task']
            update = {'config': {**task['config'], 'decisionBackend': backend}}
            if task.get('id'):
                self.workspace.update_task(task['id'], update)
            else:
                self.workspace.create_task({**task, **update})
            return self.plan(account_id, symbol)

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
            if "decisionBackend" in payload:
                config["decisionBackend"] = self.validate_backend(payload["decisionBackend"])
            if "dailyNotify" in payload:
                config["portfolioDailyNotify"] = bool(payload["dailyNotify"])
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

    def watch_plan(self, symbol):
        task = self._watch_task(symbol)
        if not task:
            from src.services.workspace_service import WorkspaceError
            raise WorkspaceError("watch_not_found", "未找到该关注股票。", 404)
        market = task["market"].lower()
        schedule = next((s for s in self.workspace.list_schedules() if s["taskId"] == task["id"]), None)
        tz, run_at = MARKETS[market]
        return {"task": task, "schedule": schedule, "timezone": tz, "runAt": run_at}

    def create_watch(self, symbol, market, decision_backend=None):
        from src.services.workspace_defaults import default_task_plan
        with _PLAN_LOCK:
            if decision_backend is not None:
                self.validate_backend(decision_backend)
            target, market = self._watch_market(symbol, market)
            saved = self._watch_task(target)
            if saved:
                if decision_backend is not None:
                    self.workspace.update_task(saved["id"], {"config": {**saved["config"], "decisionBackend": decision_backend}})
                return self.watch_plan(target)
            task = default_task_plan(self.workspace, "research", market.upper(), target)["task"]
            task["capabilities"]["expertIds"] = []
            task["capabilities"]["expertTeamIds"] = []
            task["name"] = f"{target} · 关注跟踪"
            task["objective"] = ("基于当次真实市场数据独立研究该关注股票，输出摘要、0–100 综合评分、趋势、催化、风险和失效条件。"
                                 "该标的未提供实际持仓；不得读取、推断或引用账户、成本、数量或盈亏，"
                                 "也不得输出买入、卖出、加仓、减仓、止损或持仓建议。不要引用历史研究结论。")
            task["config"]["portfolioWatch"] = {"symbol": target}
            task["config"]["decisionBackend"] = decision_backend or "llm"
            task["config"]["portfolioDailyNotify"] = False
            task = self.workspace.create_task(task)
            tz, run_at = MARKETS[market]
            return {"task": task, "schedule": None, "timezone": tz, "runAt": run_at}

    def configure_watch(self, symbol, payload):
        from src.services.workspace_service import WorkspaceError
        from src.services.strategy_definition_service import StrategyDefinitionService, StrategyDefinitionError
        with _PLAN_LOCK:
            plan = self.watch_plan(symbol)
            task = plan["task"]
            bindings = payload.get("capabilities") or task["capabilities"]
            version_id = payload.get("strategyVersionId") or task["config"]["strategyVersionId"]
            try:
                version = StrategyDefinitionService(self.workspace.db).get_version(version_id)
            except StrategyDefinitionError as exc:
                raise WorkspaceError("watch_strategy_invalid", "研究策略不存在，请重新选择。", 422) from exc
            if len(bindings.get("expertIds", [])) > 3 or bindings.get("expertTeamIds"):
                raise WorkspaceError("watch_expert_limit", "关注研究最多选择三位补充专家，不绑定专家小组。", 422)
            if (version.get("status") != "PUBLISHED" or version.get("strategyPurpose") != "research_report"
                    or str(version.get("screeningPolicy", {}).get("market", "")).upper() != task["market"]):
                raise WorkspaceError("watch_strategy_invalid", "请选择同市场已发布的单股研究策略。", 422)
            fixed = version.get("decisionPolicy", {}).get("packageParameters", {}).get("skills") or []
            if fixed and bindings.get("skillIds"):
                raise WorkspaceError("watch_skill_conflict", "正式策略已定义 Skill；自选 Skill 请改用综合研究策略。", 422)
            run_at = payload.get("runAt") or (plan["schedule"] or {}).get("runAt") or plan["runAt"]
            interval_days = self.workspace._validate_interval_days(payload.get("intervalDays") if payload.get("intervalDays") is not None else (plan["schedule"] or {}).get("intervalDays", 1))
            self.workspace._next_run("daily", run_at, None, plan["timezone"], datetime.now(timezone.utc).replace(tzinfo=None))
            config = {**task["config"], "strategyVersionId": version_id}
            if "decisionBackend" in payload:
                config["decisionBackend"] = self.validate_backend(payload["decisionBackend"])
            if "dailyNotify" in payload:
                config["portfolioDailyNotify"] = bool(payload["dailyNotify"])
            task = self.workspace.update_task(task["id"], {"config": config, "capabilities": bindings})
            schedule_data = {"intervalDays": interval_days, "runAt": run_at, "enabled": payload.get("dailyEnabled", False)}
            if plan["schedule"]:
                self.workspace.update_schedule(plan["schedule"]["id"], schedule_data)
            else:
                self.workspace.create_schedule({"taskId": task["id"], "name": task["name"], "scheduleMode": "daily", "timezone": plan["timezone"], **schedule_data})
            return self.watch_plan(symbol)

    def run_watch(self, symbol):
        with _PLAN_LOCK:
            task = self._watch_task(symbol)
            if not task:
                from src.services.workspace_service import WorkspaceError
                raise WorkspaceError("watch_not_found", "请先添加关注股票。", 404)
            return self.workspace.create_run(task["id"], trigger_type="manual")

    def remove_watch(self, symbol):
        with _PLAN_LOCK:
            task = self._watch_task(symbol)
            if not task:
                from src.services.workspace_service import WorkspaceError
                raise WorkspaceError("watch_not_found", "未找到该关注股票。", 404)
            return self.workspace.archive_task(task["id"])

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
        watch = task["config"].get("portfolioWatch")
        symbol = str(task.get("subject", {}).get("stock") or task.get("subject", {}).get("stockCode") or "")
        context = None if watch else matching_context(self.portfolio, symbol, binding["accountId"] if binding else None, task["market"])
        if binding and not context:
            for schedule in self.workspace.list_schedules():
                if schedule["taskId"] == task["id"] and schedule["enabled"]:
                    self.workspace.update_schedule(schedule["id"], {"enabled": False})
            raise WorkspaceError("holding_closed", "该持仓已清仓，自动研究已暂停。", 409)
        if binding or watch:
            # Dedupe both manual double-clicks and scheduler overlap, including
            # completed-session reuse on weekends/holidays. Failed runs may retry.
            with self.workspace.db.get_session() as session:
                rows = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.task_id == task["id"])
                                       .order_by(WorkspaceRunRecord.created_at.desc()).limit(30)).scalars().all()
                effective = self._research_session(task["market"], task["config"].get("decisionBackend", "llm"))
                import json
                for row in rows:
                    if row.status in {"queued", "running"}:
                        return context if binding else None, row.id
                    if (trigger_type == "schedule" and row.status == "completed"
                            and json.loads(row.task_snapshot_json).get("portfolioSession") == effective
                            and json.loads(row.task_snapshot_json).get("config", {}).get("decisionBackend", "llm") == task["config"].get("decisionBackend", "llm")):
                        return context if binding else None, row.id
                task["portfolioSession"] = effective
        return (None if watch else context), None

    def _watch_history(self, task_id):
        with self.workspace.db.get_session() as session:
            rows = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.task_id == task_id, WorkspaceRunRecord.status == "completed").order_by(WorkspaceRunRecord.created_at.desc()).limit(90)).scalars().all()
            artifacts = session.execute(select(WorkspaceArtifactRecord).where(WorkspaceArtifactRecord.run_id.in_([row.id for row in rows]), WorkspaceArtifactRecord.artifact_type == "ResearchReport")).scalars().all() if rows else []
        rows.reverse()
        reports = {artifact.run_id: json.loads(artifact.content_json) for artifact in artifacts}
        points = {}
        for row in rows:
            content = reports.get(row.id, {})
            report = content.get("result", {}).get("report", {}) if isinstance(content, dict) else {}
            score = normalize_score(report.get("summary", {}).get("sentiment_score")) if isinstance(report, dict) else None
            if score is None:
                continue
            created_at = row.created_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            session_key = json.loads(row.task_snapshot_json).get("portfolioSession") or created_at
            priority = 2 if row.trigger_type == "manual" else 1 if row.trigger_type == "schedule" else 0
            if session_key in points and points[session_key]["_priority"] > priority:
                continue
            points[session_key] = {"session": session_key, "createdAt": created_at, "category": "research_score", "label": "研究评分", "score": score, "_priority": priority}
        return [{key: value for key, value in point.items() if key != "_priority"}
                for point in list(points.values())[-30:]]

    def notify_scheduled_brief(self, run_id, task):
        """Deliver a completed scheduled holding/watch brief without affecting the run."""
        if not task.get("config", {}).get("portfolioDailyNotify"):
            return False
        run = self.workspace.get_run(run_id)
        if run.get("triggerType") != "schedule":
            return False
        if task.get('config', {}).get('decisionBackend') == 'jev':
            decision = self._decision(run)
            if not decision:
                return False
            from src.notification import NotificationService
            from src.services.portfolio_jev_service import decision_notification
            return bool(NotificationService().send_with_results(
                decision_notification(decision, task.get('config', {}).get('reportLanguage', 'en')),
                email_stock_codes=[decision['symbol']], route_type='report', severity='info',
                dedup_key=f'portfolio-brief:{run_id}').success)
        artifact = next((item for item in run.get("artifacts", []) if item.get("type") == "ResearchReport" and isinstance(item.get("content"), dict)), None)
        result = artifact.get("content", {}).get("result", {}) if artifact else {}
        report = result.get("report", {}) if isinstance(result, dict) else {}
        summary = report.get("summary", {}) if isinstance(report, dict) else {}
        meta = report.get("meta", {}) if isinstance(report, dict) else {}
        symbol = str(task.get("subject", {}).get("stock") or task.get("subject", {}).get("stockCode") or "")
        watch = bool(task.get("config", {}).get("portfolioWatch"))
        score = normalize_score(summary.get("sentiment_score")) if isinstance(summary, dict) else None
        title = "关注股票每日研究" if watch else "持仓每日研究"
        lines = [f"# {title}", f"**{get_index_stock_name(symbol) or meta.get('stock_name') or symbol}** · {symbol}"]
        if score is not None:
            lines.append(f"综合评分：**{score}/100**")
        if not watch:
            recommendation = holding_recommendation(result)
            if recommendation:
                lines.append(f"持仓建议：**{recommendation['label']}**")
        brief = _brief_text(summary.get("analysis_summary")) if isinstance(summary, dict) else ""
        if brief:
            lines.extend(["", brief])
        if watch:
            lines.extend(["", "该标的为关注股票，未读取持仓数据，也不提供持仓操作建议。"])
        from src.notification import NotificationService
        return bool(NotificationService().send_with_results("\n".join(lines), email_stock_codes=[symbol], route_type="report", severity="info", dedup_key=f"portfolio-brief:{run_id}").success)

    def _recommendation_history(self, task_id):
        """Read completed artifacts only; never feed this series into research."""
        with self.workspace.db.get_session() as session:
            rows = session.execute(
                select(WorkspaceRunRecord).where(
                    WorkspaceRunRecord.task_id == task_id,
                    WorkspaceRunRecord.status == "completed",
                ).order_by(WorkspaceRunRecord.created_at.desc()).limit(90)
            ).scalars().all()
            artifacts = session.execute(
                select(WorkspaceArtifactRecord).where(
                    WorkspaceArtifactRecord.run_id.in_([row.id for row in rows]),
                    WorkspaceArtifactRecord.artifact_type == "ResearchReport",
                )
            ).scalars().all() if rows else []
        rows.reverse()
        reports = {artifact.run_id: json.loads(artifact.content_json) for artifact in artifacts}
        by_session = {}
        for row in rows:
            content = reports.get(row.id, {})
            recommendation = holding_recommendation(content.get("result"))
            if not isinstance(recommendation, dict) or _number(recommendation.get("score")) is None:
                continue
            snapshot = json.loads(row.task_snapshot_json)
            created_at = row.created_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            session_key = snapshot.get("portfolioSession") or created_at
            # One point per effective trading day. Manual review is a deliberate
            # replacement for the scheduler's same-day view, even when the
            # scheduler happened to finish later.
            priority = 2 if row.trigger_type == "manual" else 1 if row.trigger_type == "schedule" else 0
            previous = by_session.get(session_key)
            if previous and previous["_priority"] > priority:
                continue
            by_session[session_key] = {
                "session": session_key,
                "createdAt": created_at,
                "category": recommendation.get("category"),
                "label": recommendation.get("label"),
                "score": recommendation.get("score"),
                "_priority": priority,
            }
        return [{key: value for key, value in entry.items() if key != "_priority"}
                for entry in list(by_session.values())[-30:]]

    @staticmethod
    def _research_session(market, backend):
        if backend == 'jev':
            from src.services.simulation_portfolio_service import SimulationPortfolioService
            return str(SimulationPortfolioService._last_closed(market.upper()))
        return str(get_effective_trading_date(market.lower()))

    def _current_session(self, run, market, backend):
        return bool(run and run['taskSnapshot'].get('config', {}).get('decisionBackend', 'llm') == backend
                    and run['taskSnapshot'].get('portfolioSession') == self._research_session(market, backend))

    @staticmethod
    def _decision(run):
        if not run or run.get('status') != 'completed':
            return None
        return next((a['content'] for a in run.get('artifacts', [])
                     if a['type'] == 'PortfolioDecision' and isinstance(a.get('content'), dict)), None)

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
                diagnostic_summary = None
                recommendation = None
                if latest:
                    artifact = next((a for a in latest["artifacts"] if a["type"] == "ResearchReport"
                                     and isinstance(a.get("content"), dict) and isinstance(a["content"].get("result"), dict)), None)
                    analysis_result = artifact["content"]["result"] if artifact else None
                    report = analysis_result.get("report") if isinstance(analysis_result, dict) else None
                    diagnostic_summary = analysis_result.get("diagnostic_summary") if isinstance(analysis_result, dict) else None
                    recommendation = holding_recommendation(analysis_result)
                raw_summary, raw_meta = (report or {}).get("summary"), (report or {}).get("meta")
                summary = raw_summary if isinstance(raw_summary, dict) else {}
                meta = raw_meta if isinstance(raw_meta, dict) else {}
                stock_name = get_index_stock_name(position["symbol"]) or meta.get("stock_name")
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
                recommendation_history = self._recommendation_history(task["id"]) if task else []
                # Daily movement belongs to the research quote, not today's cached price.
                report_current = self._current_session(latest, position["market"], task["config"].get("decisionBackend", "llm") if task else "llm")
                alerts = portfolio_alerts(position, rules, meta.get("change_pct") if report_current else None)
                backend = task['config'].get('decisionBackend', 'llm') if task else 'llm'
                decision = self._decision(latest) if backend == 'jev' else None
                if backend == 'jev':
                    report = None
                result.append({"decisionBackend": backend, "decision": decision, "accountId": account["account_id"], "accountName": account["account_name"],
                               "stockName": stock_name,
                               "position": position, "taskId": task["id"] if task else None,
                               "schedule": next((s for s in schedules if task and s["taskId"] == task["id"]), None),
                               "alerts": alerts, "supported": position["market"] in MARKETS,
                               "run": ({"id": latest["id"], "status": latest["status"], "createdAt": latest["createdAt"],
                                        "error": latest.get("errorMessage"), "currentSession": report_current} if latest else None),
                               "brief": ({"name": meta.get("stock_name"), "summary": interpretation or _brief_text(summary.get("analysis_summary")),
                                          "action": "" if interpretation else _brief_text(summary.get("action")),
                                          "advice": "" if interpretation else _brief_text(summary.get("operation_advice")),
                                          "trend": _brief_text(summary.get("trend_prediction")), "changePct": meta.get("change_pct"),
                                          "strategy": report.get("strategy"), "diagnostics": diagnostic_summary,
                                          "holdingRecommendation": recommendation,
                                          "recommendationHistory": recommendation_history,
                                          "recommendationTrend": holding_recommendation_trend(recommendation_history)}
                                         if report else None)})
        watches = []
        for task in tasks:
            binding = task["config"].get("portfolioWatch")
            if not isinstance(binding, dict):
                continue
            latest = None
            with self.workspace.db.get_session() as session:
                row = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.task_id == task["id"])
                                      .order_by(WorkspaceRunRecord.created_at.desc()).limit(1)).scalar_one_or_none()
                run_id = row.id if row else None
            if run_id:
                latest = self.workspace.get_run(run_id)
            report = None
            interpretation = ""
            if latest:
                artifact = next((a for a in latest["artifacts"] if a["type"] == "ResearchReport" and isinstance(a.get("content"), dict) and isinstance(a["content"].get("result"), dict)), None)
                report = artifact["content"]["result"].get("report") if artifact else None
                for artifact in latest["artifacts"]:
                    if artifact["type"] == "ResearchInterpretation" and isinstance(artifact.get("content"), dict):
                        interpretation = _brief_text(artifact["content"].get("conclusion")) or interpretation
            summary = report.get("summary", {}) if isinstance(report, dict) and isinstance(report.get("summary"), dict) else {}
            meta = report.get("meta", {}) if isinstance(report, dict) and isinstance(report.get("meta"), dict) else {}
            history = self._watch_history(task["id"])
            market = task["market"].lower()
            backend = task['config'].get('decisionBackend', 'llm')
            decision = self._decision(latest) if backend == 'jev' else None
            if backend == 'jev':
                report = None
            watches.append({"decisionBackend": backend, "decision": decision, "symbol": binding["symbol"], "market": market, "stockName": get_index_stock_name(binding["symbol"]) or meta.get("stock_name"),
                            "taskId": task["id"], "supported": market in MARKETS,
                            "schedule": next((s for s in schedules if s["taskId"] == task["id"]), None),
                            "run": ({"id": latest["id"], "status": latest["status"], "createdAt": latest["createdAt"], "error": latest.get("errorMessage"),
                                     "currentSession": self._current_session(latest, market, backend)} if latest else None),
                            "brief": ({"name": meta.get("stock_name"), "summary": interpretation or _brief_text(summary.get("analysis_summary")),
                                       "score": normalize_score(summary.get("sentiment_score")), "trend": _brief_text(summary.get("trend_prediction")),
                                       "strategy": report.get("strategy"), "scoreHistory": history,
                                       "scoreTrend": holding_recommendation_trend(history)} if report else None)})
        return {"asOf": snapshot["as_of"], "items": result, "watches": watches, "rules": DEFAULT_RULES}
