"""Run and persist daily rule portfolios using existing simulation ledgers."""

from __future__ import annotations
import json
import logging
import math
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select, update, or_, delete
from src.storage import (
    DatabaseManager,
    SimulationAccountRecord,
    SimulationPortfolioDefinitionRecord,
    SimulationStrategyRecord,
    SimulationStrategyVersionRecord,
    SimulationPortfolioRunRecord,
    SimulationRunRecord,
    SimulationOrderRecord,
    SimulationFillRecord,
    SimulationPositionRecord,
    SimulationEquitySnapshotRecord,
    utc_naive_now,
)
from src.services.simulation_portfolio_engine import TEMPLATES, BENCHMARKS, metrics, step
from src.workspace_scope import ThreadPoolExecutor

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="paper-portfolio")
_LOG = logging.getLogger(__name__)


class SimulationPortfolioService:
    def __init__(self, db=None, fetcher=None):
        self.db = db or DatabaseManager.get_instance()
        self.fetcher = fetcher

    def _prepare_config(self, payload):
        market, template = payload["market"], payload["template"]
        if market not in BENCHMARKS or template not in {t["id"] for t in TEMPLATES}:
            raise ValueError("不支持的市场或规则模板")
        from src.agent.tools.execution import _normalize_tool_stock_code
        from src.market_context import detect_market

        symbols = list(dict.fromkeys(_normalize_tool_stock_code(s.strip()) for s in payload["symbols"]))
        if not 1 <= len(symbols) <= 12 or any(
            not re.fullmatch(r"(?:[0-9]{6}|HK[0-9]{5}|[A-Z]{1,5}(?:[.-][A-Z]{1,2})?)", s)
            or detect_market(s).upper() != market
            for s in symbols
        ):
            raise ValueError("请配置 1–12 个同市场股票代码；名称请先在个股研究中确认代码。")
        config = dict(
            payload,
            symbols=symbols,
            engineVersion=1,
            benchmark=BENCHMARKS[market][0],
            benchmarkName=BENCHMARKS[market][1],
        )
        if config["mode"] == "paper":
            from zoneinfo import ZoneInfo
            from src.core.trading_calendar import MARKET_TIMEZONE

            config["startDate"] = datetime.now(ZoneInfo(MARKET_TIMEZONE[market.lower()])).date().isoformat()
            config["endDate"] = None
        elif (
            not config.get("startDate")
            or not config.get("endDate")
            or not date.fromisoformat(config["startDate"]) < date.fromisoformat(config["endDate"]) <= date.today()
        ):
            raise ValueError("回测日期必须为过去的有效区间")
        if (
            config["mode"] == "backtest"
            and (date.fromisoformat(config["endDate"]) - date.fromisoformat(config["startDate"])).days > 730
        ):
            raise ValueError("单次回测最多两年")
        if market == "CN" and config["lotSize"] != 100:
            raise ValueError("第一版 A 股仅支持每手 100 股的普通股票与 ETF")
        name = config["name"].strip()
        if not name:
            raise ValueError("请输入策略名称")
        config["name"] = name
        return config

    def save_definition(self, payload):
        config = self._prepare_config(dict(payload, mode="paper"))
        for key in ("mode", "startDate", "endDate"):
            config.pop(key, None)
        with self.db.session_scope() as session:
            row = SimulationPortfolioDefinitionRecord(name=config["name"], config_json=json.dumps(config))
            session.add(row)
            session.flush()
            return dict(id=row.id, name=row.name, config=config)

    def definitions(self):
        with self.db.get_session() as session:
            rows = session.scalars(select(SimulationPortfolioDefinitionRecord).order_by(
                SimulationPortfolioDefinitionRecord.id.desc()
            )).all()
            return [dict(id=r.id, name=r.name, config=json.loads(r.config_json)) for r in rows]

    def create_validation(self, definition_id, options):
        with self.db.get_session() as session:
            definition = session.get(SimulationPortfolioDefinitionRecord, definition_id)
            if definition is None:
                raise LookupError("策略不存在")
            config = json.loads(definition.config_json)
        return self.create(dict(config, **options, definitionId=definition_id))

    def create(self, payload):
        config = self._prepare_config(payload)
        market, name = config["market"], config["name"]
        with self.db.session_scope() as session:
            strategy = SimulationStrategyRecord(
                name=f"{name} · {uuid.uuid4().hex[:8]}", description="每日价格规则组合；独立模拟账户"
            )
            session.add(strategy)
            session.flush()
            version = SimulationStrategyVersionRecord(
                strategy_id=strategy.id,
                version=1,
                config_json=json.dumps(config),
                immutable=True,
                status="PAPER",
                label="规则引擎 v1",
            )
            session.add(version)
            session.flush()
            account = SimulationAccountRecord(
                name=strategy.name,
                currency=BENCHMARKS[market][2],
                initial_cash=config["initialCash"],
                cash_balance=config["initialCash"],
            )
            session.add(account)
            session.flush()
            row = SimulationPortfolioRunRecord(
                account_id=account.id,
                strategy_version_id=version.id,
                mode=config["mode"],
                config_json=json.dumps(config),
                state_json=json.dumps({"cash": config["initialCash"]}),
            )
            session.add(row)
            session.flush()
            result_id = row.id
        return self.detail(result_id)

    def list(self):
        with self.db.get_session() as session:
            rows = session.scalars(
                select(SimulationPortfolioRunRecord).order_by(SimulationPortfolioRunRecord.id.desc())
            ).all()
            return [self._item(row) for row in rows]

    @staticmethod
    def _item(row):
        config = json.loads(row.config_json)
        return dict(
            id=row.id,
            definitionId=config.get("definitionId"),
            name=config["name"],
            mode=row.mode,
            status=row.status,
            market=config["market"],
            template=config["template"],
            lastDate=row.last_date,
            error=row.error_message,
            versionId=row.strategy_version_id,
            busy=bool(row.lease_until and row.lease_until > utc_naive_now()),
            nextCheck=row.next_check_at.isoformat(),
            config=config,
        )

    def detail(self, portfolio_id):
        with self.db.get_session() as session:
            row = session.get(SimulationPortfolioRunRecord, portfolio_id)
            if row is None:
                raise LookupError("策略账户不存在")
            result = self._item(row)
            runs = session.scalars(
                select(SimulationRunRecord)
                .where(
                    SimulationRunRecord.strategy_version_id == row.strategy_version_id,
                    SimulationRunRecord.execution_mode == "portfolio_day",
                )
                .order_by(SimulationRunRecord.id)
            ).all()
            days = [json.loads(r.result_snapshot_json) for r in runs if r.status == "completed"]
            result["days"] = days
            result["metrics"] = metrics(days, result["config"]["initialCash"], result["config"]["riskFreeRate"])
            result["currency"] = BENCHMARKS[result["market"]][2]
            signature_keys = (
                "template",
                "engineVersion",
                "market",
                "symbols",
                "initialCash",
                "maxPositions",
                "maxWeight",
                "lotSize",
                "commissionRate",
                "sellTaxRate",
                "slippageRate",
                "riskFreeRate",
            )
            signature = [result["config"][k] for k in signature_keys]
            result["comparisons"] = []
            others = session.scalars(
                select(SimulationPortfolioRunRecord)
                .where(SimulationPortfolioRunRecord.mode != row.mode)
                .order_by(SimulationPortfolioRunRecord.id.desc())
            ).all()
            for other in others:
                other_config = json.loads(other.config_json)
                if [other_config[k] for k in signature_keys] != signature:
                    continue
                snapshots = session.scalars(
                    select(SimulationRunRecord.result_snapshot_json)
                    .where(
                        SimulationRunRecord.strategy_version_id == other.strategy_version_id,
                        SimulationRunRecord.execution_mode == "portfolio_day",
                        SimulationRunRecord.status == "completed",
                    )
                    .order_by(SimulationRunRecord.id)
                ).all()
                other_days = [json.loads(value) for value in snapshots]
                result["comparisons"].append(
                    dict(
                        id=other.id,
                        name=other_config["name"],
                        mode=other.mode,
                        startDate=other_days[0]["date"] if other_days else None,
                        endDate=other.last_date,
                        samples=len(other_days),
                        metrics=metrics(other_days, other_config["initialCash"], other_config["riskFreeRate"]),
                    )
                )
                if len(result["comparisons"]) >= 10:
                    break
            return result

    def control(self, portfolio_id, action):
        with self.db.session_scope() as session:
            row = session.get(SimulationPortfolioRunRecord, portfolio_id)
            if row is None:
                raise LookupError("策略账户不存在")
            if action == "start":
                if row.mode != "paper":
                    raise ValueError("历史回测只能单次运行")
                row.status, row.next_check_at = "running", utc_naive_now()
            elif action == "pause":
                row.status = "paused"
            elif action != "run":
                raise ValueError("无效操作")
        if action in {"start", "run"}:
            self.enqueue(portfolio_id, automatic=action == "start")
        return self.detail(portfolio_id)

    def enqueue(self, portfolio_id, automatic=False):
        token, now = uuid.uuid4().hex, utc_naive_now()
        with self.db.session_scope() as session:
            query = update(SimulationPortfolioRunRecord).where(
                SimulationPortfolioRunRecord.id == portfolio_id,
                or_(SimulationPortfolioRunRecord.lease_until.is_(None), SimulationPortfolioRunRecord.lease_until < now),
            )
            if automatic:
                query = query.where(SimulationPortfolioRunRecord.status.in_(["running", "paused"]))
            changed = session.execute(
                query.values(
                    lease_token=token,
                    lease_until=now + timedelta(minutes=20),
                    next_check_at=now + timedelta(minutes=15),
                    error_message=None,
                )
            ).rowcount
        if changed:
            _POOL.submit(self.execute, portfolio_id, token, automatic)
        return bool(changed)

    def recover(self):
        """Single-process server startup: interrupted checks can be retried safely."""
        with self.db.session_scope() as session:
            session.execute(
                update(SimulationPortfolioRunRecord)
                .where(SimulationPortfolioRunRecord.lease_token.is_not(None))
                .values(
                    lease_token=None,
                    lease_until=None,
                    next_check_at=utc_naive_now(),
                    error_message="服务重启，已完成日期保留；持续账户将自动恢复，单次运行可重试。",
                )
            )

    def due(self):
        with self.db.get_session() as session:
            ids = list(
                session.scalars(
                    select(SimulationPortfolioRunRecord.id).where(
                        SimulationPortfolioRunRecord.mode == "paper",
                        SimulationPortfolioRunRecord.status.in_(["running", "paused"]),
                        SimulationPortfolioRunRecord.next_check_at <= utc_naive_now(),
                    )
                )
            )
        for portfolio_id in ids:
            with self.db.get_session() as session:
                row = session.get(SimulationPortfolioRunRecord, portfolio_id)
                config = json.loads(row.config_json)
                last = row.last_date
            try:
                closed = self._last_closed(config["market"]).isoformat()
                if (last and last >= closed) or closed < config["startDate"]:
                    continue
            except Exception:
                pass  # execute persists the calendar error and enforces the retry interval
            self.enqueue(portfolio_id, automatic=True)

    @staticmethod
    def _last_closed(market):
        import exchange_calendars as xcals
        import pandas as pd
        from src.core.trading_calendar import MARKET_EXCHANGE

        calendar = xcals.get_calendar(MARKET_EXCHANGE[market.lower()])
        now = pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=20)
        session = calendar.date_to_session(now.date(), direction="previous")
        if calendar.session_close(session) > now:
            session = calendar.previous_session(session)
        return session.date()

    def _load(self, config, last):
        from data_provider import DataFetcherManager
        import pandas as pd

        fetcher = self.fetcher or DataFetcherManager()
        start = date.fromisoformat(last or config["startDate"]) - timedelta(days=150)
        end = self._last_closed(config["market"])
        if config["endDate"]:
            import exchange_calendars as xcals
            from src.core.trading_calendar import MARKET_EXCHANGE

            requested_end = min(end, date.fromisoformat(config["endDate"]))
            end = (
                xcals.get_calendar(MARKET_EXCHANGE[config["market"].lower()])
                .date_to_session(requested_end, direction="previous")
                .date()
            )
        if (last and last >= end.isoformat()) or end < date.fromisoformat(config["startDate"]):
            return {}, {}, end
        data, sources = {}, {}
        for code in list(dict.fromkeys(config["symbols"] + [config["benchmark"]])):
            frame, source = fetcher.get_daily_data(
                code, start_date=start.isoformat(), end_date=end.isoformat(), days=(end - start).days + 1
            )
            if frame is None or frame.empty:
                raise ValueError(f"{code} 行情为空，未生成成交")
            rows = []
            for raw in frame.to_dict("records"):
                day = pd.Timestamp(raw["date"]).date()
                if start <= day <= end:
                    row = {"date": day.isoformat()}
                    for key in ("open", "close", "high", "low", "volume", "amount"):
                        value = raw.get(key)
                        row[key] = float(value) if value is not None and pd.notna(value) else 0.0
                    if any(not math.isfinite(v) or v < 0 or v > 1e15 for k, v in row.items() if k != "date"):
                        raise ValueError(f"{code} 行情包含无效数值")
                    rows.append(row)
            rows.sort(key=lambda r: r["date"])
            if not rows or rows[-1]["date"] != end.isoformat() or len({r["date"] for r in rows}) != len(rows):
                raise ValueError(f"{code} 行情未更新至 {end} 或包含重复日期，请稍后重试")
            data[code], sources[code] = rows, source
        import exchange_calendars as xcals
        from src.core.trading_calendar import MARKET_EXCHANGE

        first = max(
            date.fromisoformat(config["startDate"]),
            date.fromisoformat(last) + timedelta(days=1) if last else date.fromisoformat(config["startDate"]),
        )
        expected = {
            d.date().isoformat()
            for d in xcals.get_calendar(MARKET_EXCHANGE[config["market"].lower()]).sessions_in_range(first, end)
        }
        if expected - {r["date"] for r in data[config["benchmark"]]}:
            raise ValueError("基准交易日行情不完整，未继续记账")
        return data, sources, end

    def execute(self, portfolio_id, token, automatic=False):
        workspace, audit_id, failure = None, None, None
        processed = 0
        try:
            with self.db.get_session() as session:
                row = session.get(SimulationPortfolioRunRecord, portfolio_id)
                config, last = json.loads(row.config_json), row.last_date
            from src.services.workspace_service import WorkspaceService
            from src.services.workspace_external_runs import begin
            from src.storage import WorkspaceRunRecord

            workspace = WorkspaceService(self.db)
            audit_id = begin(
                workspace,
                "trading",
                config["name"],
                config["market"],
                {"symbols": config["symbols"]},
                {"portfolioId": portfolio_id, "mode": config["mode"]},
                trigger="schedule" if automatic else "manual",
            )
            with self.db.session_scope() as session:
                audit = session.get(WorkspaceRunRecord, audit_id)
                audit.status, audit.started_at = "running", utc_naive_now()
            from src.services.member_service import recheck_member

            recheck_member()
            data, sources, end = self._load(config, last)
            if not data:
                return
            days = [
                r["date"]
                for r in data[config["benchmark"]]
                if r["date"] >= config["startDate"] and (not last or r["date"] > last)
            ]
            for day in days:
                from src.services.member_service import recheck_member

                recheck_member()
                histories = {code: [r for r in data[code] if r["date"] <= day][-21:] for code in config["symbols"]}
                baseline = next(r["close"] for r in data[config["benchmark"]] if r["date"] == day)
                if not math.isfinite(baseline) or baseline <= 0:
                    raise ValueError("基准行情无效")
                with self.db.session_scope() as session:
                    row = session.get(SimulationPortfolioRunRecord, portfolio_id)
                    if row.lease_token != token or (automatic and row.status not in {"running", "paused"}):
                        return
                    if row.last_date and row.last_date >= day:
                        continue
                    previous = json.loads(row.state_json)
                    if automatic and row.status == "paused":
                        previous["pending"] = None
                    state, output = step(config, previous, day, histories, baseline)
                    if automatic and row.status == "paused":
                        state["pending"] = None
                        output["paused"] = True
                        for opinion in output["opinions"]:
                            opinion["reason"] += " 账户已暂停：以上仅为规则观点，不执行自动买卖。"
                    output["sources"] = sources
                    output["recordedAt"] = datetime.now(timezone.utc).isoformat()
                    output["replayed"] = row.mode == "paper" and day < end.isoformat()
                    output["workspaceRunId"] = audit_id
                    run = SimulationRunRecord(
                        strategy_version_id=row.strategy_version_id,
                        execution_mode="portfolio_day",
                        status="completed",
                        input_snapshot_json=json.dumps(
                            {"date": day, "bars": histories, "benchmarkClose": baseline, "sources": sources}
                        ),
                        result_snapshot_json=json.dumps(output),
                        started_at=utc_naive_now(),
                        completed_at=utc_naive_now(),
                    )
                    session.add(run)
                    session.flush()
                    for trade in output["trades"]:
                        order = SimulationOrderRecord(
                            account_id=row.account_id,
                            simulation_run_id=run.id,
                            strategy_version_id=row.strategy_version_id,
                            stock_code=trade["code"],
                            side=trade["side"],
                            quantity=trade["quantity"],
                            status=trade["status"],
                            reject_reason=trade["reason"],
                        )
                        session.add(order)
                        session.flush()
                        if trade["status"] == "filled":
                            session.add(
                                SimulationFillRecord(
                                    order_id=order.id,
                                    fill_price=trade["price"],
                                    quantity=trade["quantity"],
                                    commission=trade["fee"],
                                    slippage=trade["slippage"],
                                    filled_at=datetime.fromisoformat(day),
                                )
                            )
                    session.execute(
                        delete(SimulationPositionRecord).where(SimulationPositionRecord.account_id == row.account_id)
                    )
                    for holding in output["holdings"]:
                        session.add(
                            SimulationPositionRecord(
                                account_id=row.account_id,
                                stock_code=holding["code"],
                                quantity=holding["quantity"],
                                average_cost=holding["averageCost"],
                            )
                        )
                    account = session.get(SimulationAccountRecord, row.account_id)
                    account.cash_balance = state["cash"]
                    session.add(
                        SimulationEquitySnapshotRecord(
                            account_id=row.account_id,
                            simulation_run_id=run.id,
                            cash_balance=state["cash"],
                            market_value=output["marketValue"],
                            equity=output["equity"],
                            created_at=datetime.fromisoformat(day),
                        )
                    )
                    row.state_json, row.last_date = json.dumps(state), day
                    processed += 1
            with self.db.session_scope() as session:
                row = session.get(SimulationPortfolioRunRecord, portfolio_id)
                if row.lease_token == token and row.mode == "backtest":
                    row.status = "completed"
        except Exception as exc:
            failure = str(exc)[:600]
            _LOG.exception("Paper portfolio %s failed", portfolio_id)
            with self.db.session_scope() as session:
                row = session.get(SimulationPortfolioRunRecord, portfolio_id)
                if row and row.lease_token == token:
                    row.error_message = str(exc)[:600]
        finally:
            try:
                if workspace and audit_id:
                    if not failure:
                        workspace._store_artifact(
                            audit_id,
                            "PortfolioUpdate",
                            "策略账户更新",
                            {"portfolioId": portfolio_id, "processedDays": processed, "engineVersion": 1, "modelCalls": 0},
                            text=f"策略账户 #{portfolio_id} 检查完成，本次新增 {processed} 个交易日记录。请在交易推演查看净值、持仓与逐日买卖。",
                        )
                    workspace._finish_run(audit_id, "failed" if failure else "completed", error_message=failure)
            finally:
                with self.db.session_scope() as session:
                    session.execute(
                        update(SimulationPortfolioRunRecord)
                        .where(
                            SimulationPortfolioRunRecord.id == portfolio_id,
                            SimulationPortfolioRunRecord.lease_token == token,
                        )
                        .values(lease_until=None, lease_token=None)
                    )
