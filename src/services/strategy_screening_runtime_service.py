"""Automatic candidate preparation for immutable complete strategies.

This service is intentionally a *research* runner. It freezes the selected
universe, invokes the complete strategy once per candidate and persists only
the strategy-level result. It never creates broker orders, fills, positions,
or P&L.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from sqlalchemy import select

from src.config import get_config
from src.services.screening_service import ScreeningService
from src.services.strategy_graph_runtime_service import StrategyGraphRuntimeService
from src.storage import (
    DatabaseManager,
    SimulationRunRecord,
    SimulationStrategyRunBatchRecord,
    SimulationStrategyVersionRecord,
    StockDaily,
    utc_naive_now,
)


class StrategyScreeningRunError(ValueError):
    pass


class StrategyScreeningRuntimeService:
    """Run a persisted screening batch and its child research graph runs."""

    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        screener_factory: Optional[Callable[[], ScreeningService]] = None,
        graph_factory: Optional[Callable[[DatabaseManager], StrategyGraphRuntimeService]] = None,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self._screener_factory = screener_factory or (lambda: ScreeningService(config=get_config(), db_manager=self.db))
        self._graph_factory = graph_factory or (lambda db: StrategyGraphRuntimeService(db))

    def execute(self, batch_id: int) -> dict[str, Any]:
        batch, policy = self._start(batch_id)
        try:
            screener = self._screener_factory()
            if policy["universeMode"] == "fixed":
                screening = self._fixed_universe_screening(policy)
                enrich = getattr(screener, "enrich_candidates", None)
                if callable(enrich):
                    screening["candidates"], screening["dsa_enrichment"] = enrich(
                        screening["candidates"], data_source_config=policy["dataSourceConfig"]
                    )
            else:
                screening = screener.screen(
                    strategy=policy["strategy"], market=policy["market"], max_results=policy["maxCandidates"],
                    selection_seed="",
                    data_source_config=policy["dataSourceConfig"],
                )
            self._ensure_active(batch_id)
            candidates = self._candidates(screening, policy["maxCandidates"])
            child_ids = self._create_children(batch_id, batch.strategy_version_id, candidates)
            results: list[dict[str, Any]] = [
                {"runId": run_id, "code": candidate["code"], "name": candidate.get("name"),
                 "screenScore": candidate.get("screenScore"), "status": "queued"}
                for candidate, run_id in zip(candidates, child_ids)
            ]
            self._checkpoint(batch_id, {
                "screeningRunId": screening.get("run_id") or screening.get("runId"),
                "candidateCount": len(candidates), "screening": self._screening_summary(screening),
                "candidates": results, "phase": "strategy_execution",
            })
            graph = self._graph_factory(self.db)
            for index, (candidate, run_id) in enumerate(zip(candidates, child_ids)):
                self._ensure_active(batch_id)
                if isinstance(policy.get("strategyPackage"), dict):
                    from src.services.strategy_definition_service import StrategyDefinitionService
                    from src.services.strategy_kernel_executor_service import StrategyKernelExecutorService

                    definition = StrategyDefinitionService(self.db)
                    StrategyKernelExecutorService(definition).execute_published_run(run_id)
                    run_result = definition.get_published_run(run_id)
                else:
                    run_result = graph.execute(run_id)
                results[index]["status"] = run_result["status"]
                self._checkpoint(batch_id, {
                    "screeningRunId": screening.get("run_id") or screening.get("runId"),
                    "candidateCount": len(candidates), "screening": self._screening_summary(screening),
                    "candidates": results, "phase": "strategy_execution",
                })
            completed = sum(item["status"] == "completed" for item in results)
            status = "completed" if completed == len(results) else "completed_with_failures"
            result = {
                "screeningRunId": screening.get("run_id") or screening.get("runId"),
                "candidateCount": len(candidates),
                "screening": self._screening_summary(screening),
                "candidates": results,
            }
            return self._finish(batch_id, status, result, None)
        except Exception as exc:
            return self._finish(batch_id, "failed", {}, str(exc)[:2000])

    def _start(self, batch_id: int) -> tuple[SimulationStrategyRunBatchRecord, dict[str, Any]]:
        with self.db.session_scope() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch:
                raise StrategyScreeningRunError("自动扫描运行不存在。")
            if batch.status not in {"queued", "failed"}:
                raise StrategyScreeningRunError("只有等待或失败的自动扫描可以启动。")
            version = session.get(SimulationStrategyVersionRecord, batch.strategy_version_id)
            if not version or version.status != "PUBLISHED" or not version.immutable:
                raise StrategyScreeningRunError("只能扫描不可修改的正式策略版本。")
            policy = self._normalize_policy(self._load(version.screening_policy_json))
            policy["dataSourceConfig"] = self._load(version.data_permission_snapshot_json)
            policy["strategyPackage"] = self._load(version.config_json).get("strategyPackage")
            market_scope = self._load(version.market_scope_json)
            fixed_symbols = [str(item).strip().upper() for item in market_scope.get("symbols", []) if str(item).strip()]
            policy["universeMode"] = "fixed" if str(market_scope.get("universeMode") or "").lower() == "fixed" else "screening"
            policy["fixedSymbols"] = list(dict.fromkeys(fixed_symbols)) if policy["universeMode"] == "fixed" else []
            batch.status = "running"
            batch.started_at = utc_naive_now()
            batch.error_message = None
            session.flush()
            session.expunge(batch)
            return batch, policy

    def _create_children(self, batch_id: int, version_id: int, candidates: list[dict[str, Any]]) -> list[int]:
        ids: list[int] = []
        with self.db.session_scope() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch or batch.status != "running":
                raise StrategyScreeningRunError("这次自动扫描已终止。")
            for candidate in candidates:
                snapshot = {
                    "stock_code": candidate["code"],
                    "requested_at": utc_naive_now().isoformat(),
                    "run_mode": "automatic_screening_research",
                    "strategyRunBatchId": batch_id,
                    "screeningCandidate": candidate,
                }
                row = SimulationRunRecord(
                    strategy_version_id=version_id,
                    status="queued",
                    execution_mode="preview",
                    input_snapshot_json=json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
                )
                session.add(row)
                session.flush()
                ids.append(row.id)
        return ids

    def _fixed_universe_screening(self, policy: dict[str, Any]) -> dict[str, Any]:
        symbols = list(policy.get("fixedSymbols") or [])
        if not symbols:
            raise StrategyScreeningRunError("策略配置了固定股票池，但没有可运行的股票代码。")
        with self.db.get_session() as session:
            available = {str(code).strip().upper() for code in session.execute(
                select(StockDaily.code).where(StockDaily.code.in_(symbols)).distinct()
            ).scalars().all()}
        missing = [code for code in symbols if code not in available]
        if missing:
            raise StrategyScreeningRunError(
                f"固定股票池中的 {', '.join(missing[:10])} 不在当前 K 线输入数据中，研究运行已停止。"
            )
        selected = symbols[:policy["maxCandidates"]]
        return {
            "run_id": f"fixed-universe-{utc_naive_now().isoformat()}",
            "strategy": policy["strategy"],
            "market": policy["market"],
            "universe_mode": "fixed_strategy_universe",
            "snapshot_count": len(symbols),
            "candidate_count": len(selected),
            "candidates": [
                {"code": code, "rank": index + 1, "reason": "StrategyVersion 固定股票池"}
                for index, code in enumerate(selected)
            ],
        }

    def _finish(self, batch_id: int, status: str, result: dict[str, Any], error: Optional[str]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch:
                raise StrategyScreeningRunError("自动扫描运行不存在。")
            if batch.status == "cancelled":
                return {"id": batch.id, "status": batch.status}
            batch.status = status
            batch.completed_at = utc_naive_now()
            batch.error_message = error
            batch.screening_run_id = str(result.get("screeningRunId") or "") or None
            batch.result_snapshot_json = json.dumps(result, ensure_ascii=False, sort_keys=True, default=str)
            return {"id": batch.id, "status": batch.status}

    def _ensure_active(self, batch_id: int) -> None:
        with self.db.get_session() as session:
            status = session.execute(
                select(SimulationStrategyRunBatchRecord.status).where(
                    SimulationStrategyRunBatchRecord.id == batch_id
                )
            ).scalar_one_or_none()
        if status != "running":
            raise StrategyScreeningRunError("这次自动扫描已终止。")

    def _checkpoint(self, batch_id: int, result: dict[str, Any]) -> None:
        """Expose screening and child-run progress before the batch completes."""
        with self.db.session_scope() as session:
            batch = session.get(SimulationStrategyRunBatchRecord, batch_id)
            if not batch or batch.status != "running":
                return
            batch.result_snapshot_json = json.dumps(result, ensure_ascii=False, sort_keys=True, default=str)

    @staticmethod
    def _normalize_policy(value: dict[str, Any]) -> dict[str, Any]:
        strategy = str(value.get("strategy") or value.get("screeningStrategy") or "dual_low").strip()
        market = str(value.get("market") or "cn").strip().lower()
        try:
            count = int(value.get("maxCandidates") or value.get("max_candidates") or 3)
        except (TypeError, ValueError):
            count = 3
        return {"strategy": strategy[:64] or "dual_low", "market": market[:16] or "cn", "maxCandidates": max(1, min(count, 10))}

    @staticmethod
    def _candidates(screening: dict[str, Any], maximum: int) -> list[dict[str, Any]]:
        rows = screening.get("candidates") if isinstance(screening, dict) else []
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in rows if isinstance(rows, list) else []:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or "").strip()
            if not code or code in seen:
                continue
            seen.add(code)
            result.append({
                "code": code[:32],
                "name": str(item.get("name") or "")[:120],
                "rank": item.get("rank"),
                "screenScore": item.get("screen_score", item.get("score")),
                "reason": str(item.get("reason") or "")[:1000],
                "riskLevel": item.get("risk_level"),
                **{key: item[key] for key in ("dsa_context", "dsa_news", "dsa_events", "dsa_fundamentals") if key in item},
            })
            if len(result) >= maximum:
                break
        if not result:
            raise StrategyScreeningRunError("选股没有返回可研究的候选股票。")
        return result

    @staticmethod
    def _screening_summary(screening: dict[str, Any]) -> dict[str, Any]:
        return {
            key: screening.get(key)
            for key in ("strategy", "market", "universe_mode", "snapshot_count", "after_filter_count", "candidate_count", "warnings", "source_errors")
            if key in screening
        }

    @staticmethod
    def _load(value: str | None) -> dict[str, Any]:
        try:
            decoded = json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}
        return decoded if isinstance(decoded, dict) else {}
