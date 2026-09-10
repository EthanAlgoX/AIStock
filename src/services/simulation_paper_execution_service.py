# -*- coding: utf-8 -*-
"""Fail-closed paper execution foundation, isolated from real portfolios."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Optional

from sqlalchemy import select

from src.storage import (
    DatabaseManager, SimulationAccountRecord, SimulationEquitySnapshotRecord,
    SimulationOrderRecord, SimulationRunRecord, utc_naive_now,
)


class SimulationPaperExecutionError(ValueError):
    pass


class SimulationPaperExecutionService:
    """Creates only rejection-safe paper order intents; no broker integration."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create_account(self, name: str, initial_cash: Any, currency: str = "CNY") -> Dict[str, Any]:
        cash = self._money(initial_cash)
        if cash <= 0:
            raise SimulationPaperExecutionError("initial_cash must be positive")
        with self.db.session_scope() as session:
            row = SimulationAccountRecord(name=str(name).strip(), currency=currency, initial_cash=float(cash), cash_balance=float(cash))
            session.add(row); session.flush()
            session.add(SimulationEquitySnapshotRecord(account_id=row.id, cash_balance=float(cash), market_value=0, equity=float(cash)))
            return self._account(row)

    def list_accounts(self) -> list[Dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(select(SimulationAccountRecord).order_by(SimulationAccountRecord.created_at.desc())).scalars().all()
            return [self._account(row) for row in rows]

    def list_orders(self, account_id: int) -> list[Dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(select(SimulationOrderRecord).where(SimulationOrderRecord.account_id == account_id).order_by(SimulationOrderRecord.created_at.desc())).scalars().all()
            return [{"id": row.id, "simulation_run_id": row.simulation_run_id, "strategy_version_id": row.strategy_version_id, "stock_code": row.stock_code, "side": row.side, "quantity": row.quantity, "status": row.status, "reject_reason": row.reject_reason, "created_at": row.created_at} for row in rows]

    def prepare_execution(self, account_id: int, run_id: int) -> Dict[str, Any]:
        """Idempotently persist a rejected intent unless P4 supplies executable evidence."""
        with self.db.session_scope() as session:
            account = session.get(SimulationAccountRecord, account_id)
            run = session.get(SimulationRunRecord, run_id)
            if account is None or run is None:
                raise SimulationPaperExecutionError("paper account or simulation run not found")
            if run.execution_mode == 'portfolio_day':
                raise SimulationPaperExecutionError('每日策略已通过独立账本记账，不能重复提交旧版执行接口。')
            existing = session.execute(select(SimulationOrderRecord).where(SimulationOrderRecord.account_id == account_id, SimulationOrderRecord.simulation_run_id == run_id)).scalar_one_or_none()
            if existing is not None:
                return {"order_id": existing.id, "status": existing.status, "idempotent": True, "reason": existing.reject_reason}
            if run.status != "completed":
                raise SimulationPaperExecutionError("only completed simulation runs may enter paper execution")
            # P4 currently stores textual research output, not a trusted order schema.
            # Reject instead of inferring price/quantity from prose or UI samples.
            input_snapshot = self._load(run.input_snapshot_json)
            code = str(input_snapshot.get("stock_code") or "").strip()
            if not code:
                raise SimulationPaperExecutionError("completed run has no stock_code evidence")
            order = SimulationOrderRecord(account_id=account_id, simulation_run_id=run_id, strategy_version_id=run.strategy_version_id, stock_code=code, side="buy", quantity=0, status="rejected", reject_reason="P4 result has no structured executable decision with quantity and market price evidence.")
            session.add(order); session.flush()
            return {"order_id": order.id, "status": order.status, "idempotent": False, "reason": order.reject_reason}

    @staticmethod
    def _money(value: Any) -> Decimal:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    def _load(value: str) -> Dict[str, Any]:
        import json
        try: value = json.loads(value or "{}")
        except (TypeError, ValueError): return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _account(row: SimulationAccountRecord) -> Dict[str, Any]:
        return {"id": row.id, "name": row.name, "currency": row.currency, "initial_cash": row.initial_cash, "cash_balance": row.cash_balance, "status": row.status, "created_at": row.created_at}
