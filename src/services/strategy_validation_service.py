"""StrategyVersion-level historical validation with frozen local daily bars.

The engine is deliberately deterministic and long-only.  It replays the
version's screening policy against information available on each signal date,
executes at the next daily open, and persists every consumed OHLCV bar.  It
does not call an LLM, a broker, or the legacy analysis-record BacktestService.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import desc, func, select

from src.storage import (
    DatabaseManager,
    SimulationStrategyRecord,
    SimulationStrategyValidationBarRecord,
    SimulationStrategyValidationExperimentRecord,
    SimulationStrategyVersionRecord,
    StockDaily,
    utc_naive_now,
)


ENGINE_VERSION = "strategy-validation-v2"
MIN_LOOKBACK_BARS = 21
MIN_REPLAY_WEEKDAY_COVERAGE = 0.85
MAX_BOUNDARY_LAG_DAYS = 7
COMPARISON_CONFIG_FIELDS = (
    "startDate",
    "endDate",
    "initialCapital",
    "commissionRate",
    "minimumCommission",
    "slippageRate",
    "executionRule",
    "rebalanceFrequency",
    "market",
    "maxPositions",
    "maxUniverseSize",
)
COMPARISON_FIELD_LABELS = {
    "startDate": "开始日期",
    "endDate": "结束日期",
    "initialCapital": "初始资金",
    "commissionRate": "佣金率",
    "minimumCommission": "最低佣金",
    "slippageRate": "滑点率",
    "executionRule": "成交规则",
    "rebalanceFrequency": "调仓频率",
    "market": "市场",
    "maxPositions": "最大持仓数",
    "maxUniverseSize": "最大候选池",
}
COMPARISON_METRICS = (
    ("cumulativeReturn", "累计收益", "percent", "higher"),
    ("annualizedReturn", "年化收益", "percent", "higher"),
    ("maxDrawdown", "最大回撤", "percent", "higher"),
    ("annualizedVolatility", "年化波动", "percent", "lower"),
    ("sharpeRatio", "夏普比率", "number", "higher"),
    ("winRate", "胜率", "percent", "higher"),
    ("turnover", "换手", "number", "lower"),
    ("tradeCount", "交易次数", "integer", "neutral"),
    ("closedTradeCount", "平仓次数", "integer", "neutral"),
    ("finalEquity", "期末权益", "currency", "higher"),
)
KLINE_FETCHER_BY_CONNECTION = {
    "kline:tencent": "TencentFetcher",
    "kline:akshare": "AkshareFetcher",
    "kline:baostock": "BaostockFetcher",
    "kline:yfinance": "YfinanceFetcher",
    "kline:tushare": "TushareFetcher",
    "kline:hithink_finance": "HiThinkFinanceFetcher",
    "kline:efinance": "EfinanceFetcher",
    "kline:pytdx": "PytdxFetcher",
}


class StrategyValidationError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class StrategyValidationService:
    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        *,
        market_data_fetcher: Any = None,
        refresh_missing_data: bool = True,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self.market_data_fetcher = market_data_fetcher
        self.refresh_missing_data = refresh_missing_data

    def create_experiment(self, payload: dict[str, Any]) -> dict[str, Any]:
        version_id = self._positive_int(payload.get("strategyVersionId"), "STRATEGY_VERSION_REQUIRED", "必须选择策略版本。")
        idempotency_key = str(payload.get("idempotencyKey") or "").strip()
        if len(idempotency_key) < 8 or len(idempotency_key) > 128:
            raise StrategyValidationError("IDEMPOTENCY_KEY_INVALID", "幂等键长度必须为 8–128 个字符。")
        config = self._normalize_config(payload.get("config") or {})

        # The full definition is frozen before any market data is selected.
        from src.services.strategy_definition_service import StrategyDefinitionService

        with self.db.get_session() as session:
            version = session.get(SimulationStrategyVersionRecord, version_id)
            if not version:
                raise StrategyValidationError("STRATEGY_VERSION_NOT_FOUND", "策略版本不存在。", 404)
            if (version.strategy_purpose or "trading_decision") != "trading_decision":
                raise StrategyValidationError(
                    "VALIDATION_STRATEGY_PURPOSE_UNSUPPORTED",
                    "历史交易回测只接受输出 DecisionProposal 的交易决策策略；研究报告和选股策略请在对应工具中验证。",
                    409,
                )
            strategy = session.get(SimulationStrategyRecord, version.strategy_id)
            if not strategy or strategy.archived_at is not None:
                raise StrategyValidationError("STRATEGY_NOT_AVAILABLE", "策略不存在或已归档。", 404)
        version_snapshot = StrategyDefinitionService(self.db).get_version(version_id)
        if version_snapshot.get("productRole") == "kernel":
            raise StrategyValidationError(
                "VALIDATION_CONFIGURATION_REQUIRED",
                "策略内核不能直接回测；请先在策略中心创建运行配置，再对完整策略版本发起回测。",
                409,
            )
        symbols, resolved_universe_mode = self._resolve_universe(version_snapshot, config)
        config["symbols"] = self._canonical_symbols(symbols, config["market"])
        config["resolvedUniverseMode"] = resolved_universe_mode
        if len(config["symbols"]) > config["maxUniverseSize"]:
            raise StrategyValidationError(
                "VALIDATION_UNIVERSE_TOO_LARGE",
                f"显式股票池包含 {len(config['symbols'])} 个标的，超过当前最大候选池 {config['maxUniverseSize']}。",
                422,
            )
        request_hash = self._hash({"versionId": version_id, "revision": version_snapshot["revision"], "config": config})
        with self.db.get_session() as session:
            existing = session.execute(select(SimulationStrategyValidationExperimentRecord).where(
                SimulationStrategyValidationExperimentRecord.strategy_version_id == version_id,
                SimulationStrategyValidationExperimentRecord.idempotency_key == idempotency_key,
            )).scalar_one_or_none()
            if existing:
                if existing.request_hash != request_hash:
                    raise StrategyValidationError("IDEMPOTENCY_CONFLICT", "相同幂等键对应了不同的验证配置。", 409)
                return self._detail(session, existing)

        self._refresh_incomplete_history(config, version_snapshot)
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, version_id)
            strategy = session.get(SimulationStrategyRecord, version.strategy_id)
            if version.revision != version_snapshot["revision"]:
                raise StrategyValidationError(
                    "VALIDATION_VERSION_CHANGED",
                    "策略定义在准备历史行情期间发生了变化，请重新创建实验。",
                    409,
                )
            existing = session.execute(select(SimulationStrategyValidationExperimentRecord).where(
                SimulationStrategyValidationExperimentRecord.strategy_version_id == version_id,
                SimulationStrategyValidationExperimentRecord.idempotency_key == idempotency_key,
            )).scalar_one_or_none()
            if existing:
                if existing.request_hash != request_hash:
                    raise StrategyValidationError("IDEMPOTENCY_CONFLICT", "相同幂等键对应了不同的验证配置。", 409)
                return self._detail(session, existing)

            bars = self._load_source_bars(session, version_snapshot, config)
            coverage = self._coverage_report(config, bars)
            self._require_complete_coverage(coverage)
            snapshot_hash = self._bars_hash(bars)
            experiment = SimulationStrategyValidationExperimentRecord(
                strategy_version_id=version.id,
                strategy_version_revision=version.revision,
                status="queued",
                engine_version=ENGINE_VERSION,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                input_snapshot_hash=snapshot_hash,
                config_json=self._dump(config),
                version_snapshot_json=self._dump(version_snapshot),
            )
            session.add(experiment)
            session.flush()
            session.add_all([
                SimulationStrategyValidationBarRecord(
                    experiment_id=experiment.id,
                    code=item["code"], date=item["date"], open=item.get("open"), high=item.get("high"),
                    low=item.get("low"), close=item.get("close"), volume=item.get("volume"),
                    amount=item.get("amount"), data_source=item.get("dataSource"),
                    source_created_at=item.get("sourceCreatedAt"), source_updated_at=item.get("sourceUpdatedAt"),
                    adjustment_mode=item.get("adjustmentMode"),
                ) for item in bars
            ])
            return self._detail(session, experiment, bar_count=len(bars))

    def execute_experiment(self, experiment_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
            if not experiment:
                raise StrategyValidationError("VALIDATION_EXPERIMENT_NOT_FOUND", "验证实验不存在。", 404)
            if experiment.status not in {"queued", "failed"}:
                raise StrategyValidationError("VALIDATION_EXPERIMENT_NOT_RUNNABLE", "只有等待或失败的实验可以运行。", 409)
            experiment.status = "running"
            experiment.started_at = utc_naive_now()
            experiment.completed_at = None
            experiment.error_message = None

        try:
            with self.db.get_session() as session:
                experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
                config = self._load(experiment.config_json)
                version = self._load(experiment.version_snapshot_json)
                rows = session.execute(select(SimulationStrategyValidationBarRecord).where(
                    SimulationStrategyValidationBarRecord.experiment_id == experiment_id
                ).order_by(SimulationStrategyValidationBarRecord.code, SimulationStrategyValidationBarRecord.date)).scalars().all()
                bars = [self._bar_dict(row) for row in rows]
                self._require_snapshot_integrity(experiment, bars)
            result = self._run(config, version, bars)
            with self.db.session_scope() as session:
                experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
                experiment.status = "completed"
                experiment.result_json = self._dump(result)
                experiment.completed_at = utc_naive_now()
                return self._detail(session, experiment, bar_count=len(bars))
        except StrategyValidationError as exc:
            self._fail(experiment_id, exc.message)
            raise
        except Exception as exc:
            message = str(exc)[:2000] or "策略级历史验证执行失败。"
            self._fail(experiment_id, message)
            raise StrategyValidationError("VALIDATION_EXECUTION_FAILED", message, 422) from exc

    def get_experiment(self, experiment_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
            if not experiment:
                raise StrategyValidationError("VALIDATION_EXPERIMENT_NOT_FOUND", "验证实验不存在。", 404)
            return self._detail(session, experiment)

    def list_experiments(self, strategy_version_id: int, limit: int = 30) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            version = session.get(SimulationStrategyVersionRecord, strategy_version_id)
            if not version:
                raise StrategyValidationError("STRATEGY_VERSION_NOT_FOUND", "策略版本不存在。", 404)
            rows = session.execute(select(SimulationStrategyValidationExperimentRecord).where(
                SimulationStrategyValidationExperimentRecord.strategy_version_id == strategy_version_id
            ).order_by(desc(SimulationStrategyValidationExperimentRecord.created_at)).limit(max(1, min(int(limit), 100)))).scalars().all()
            return [self._detail(session, row) for row in rows]

    def list_comparison_candidates(self, strategy_id: int, limit: int = 100) -> list[dict[str, Any]]:
        """Return only completed, evidence-backed formal replays for one strategy."""
        with self.db.get_session() as session:
            strategy = session.get(SimulationStrategyRecord, strategy_id)
            if not strategy or strategy.archived_at is not None:
                raise StrategyValidationError("STRATEGY_NOT_AVAILABLE", "策略不存在或已归档。", 404)
            rows = session.execute(
                select(SimulationStrategyValidationExperimentRecord)
                .join(
                    SimulationStrategyVersionRecord,
                    SimulationStrategyVersionRecord.id
                    == SimulationStrategyValidationExperimentRecord.strategy_version_id,
                )
                .where(
                    SimulationStrategyVersionRecord.strategy_id == strategy_id,
                    SimulationStrategyValidationExperimentRecord.status == "completed",
                    SimulationStrategyValidationExperimentRecord.result_json.is_not(None),
                )
                .order_by(desc(SimulationStrategyValidationExperimentRecord.completed_at))
                .limit(max(1, min(int(limit), 100)))
            ).scalars().all()
            candidates = []
            for row in rows:
                config = self._load(row.config_json)
                result = self._load(row.result_json)
                if (
                    self._experiment_purpose(config) == "validation"
                    and self._integrity_status(session, row) == "verified"
                    and isinstance(result, dict)
                    and (result.get("dataQuality") or {}).get("complete") is True
                ):
                    candidates.append(self._detail(session, row))
            return candidates

    def compare_experiments(self, payload: dict[str, Any]) -> dict[str, Any]:
        baseline_id = self._positive_int(
            payload.get("baselineExperimentId"),
            "VALIDATION_COMPARISON_BASELINE_REQUIRED",
            "请选择基准回放记录。",
        )
        target_id = self._positive_int(
            payload.get("targetExperimentId"),
            "VALIDATION_COMPARISON_TARGET_REQUIRED",
            "请选择对比回放记录。",
        )
        if baseline_id == target_id:
            raise StrategyValidationError(
                "VALIDATION_COMPARISON_DUPLICATE",
                "基准与对比记录不能是同一次回放。",
                422,
            )

        with self.db.get_session() as session:
            baseline = self._comparison_experiment(session, baseline_id)
            target = self._comparison_experiment(session, target_id)
            baseline_version, baseline_strategy, baseline_config, baseline_result = baseline
            target_version, target_strategy, target_config, target_result = target

            if baseline_strategy.id != target_strategy.id:
                raise StrategyValidationError(
                    "VALIDATION_COMPARISON_STRATEGY_MISMATCH",
                    "版本对比只支持同一策略下的历史版本。",
                    422,
                )
            if baseline_version.id == target_version.id:
                raise StrategyValidationError(
                    "VALIDATION_COMPARISON_VERSION_DUPLICATE",
                    "请选择同一策略的两个不同版本进行比较。",
                    422,
                )

            mismatches = [
                COMPARISON_FIELD_LABELS[field]
                for field in COMPARISON_CONFIG_FIELDS
                if baseline_config.get(field) != target_config.get(field)
            ]
            baseline_record = session.get(SimulationStrategyValidationExperimentRecord, baseline_id)
            target_record = session.get(SimulationStrategyValidationExperimentRecord, target_id)
            if baseline_record.engine_version != target_record.engine_version:
                mismatches.append("回放引擎版本")
            if baseline_result.get("methodology") != target_result.get("methodology"):
                mismatches.append("回放方法")

            baseline_quality = baseline_result.get("dataQuality") or {}
            target_quality = target_result.get("dataQuality") or {}
            if (
                baseline_quality.get("actualReplayStartDate")
                != target_quality.get("actualReplayStartDate")
                or baseline_quality.get("actualReplayEndDate")
                != target_quality.get("actualReplayEndDate")
            ):
                mismatches.append("实际回放区间")
            if mismatches:
                unique = list(dict.fromkeys(mismatches))
                raise StrategyValidationError(
                    "VALIDATION_COMPARISON_ASSUMPTIONS_MISMATCH",
                    f"两次回放的比较口径不一致：{'、'.join(unique)}。请用相同配置分别运行两个版本后再比较。",
                    422,
                )

            baseline_metrics = baseline_result.get("metrics") or {}
            target_metrics = target_result.get("metrics") or {}
            metric_rows = []
            for key, label, value_format, preference in COMPARISON_METRICS:
                baseline_value = self._optional_number(baseline_metrics.get(key))
                target_value = self._optional_number(target_metrics.get(key))
                metric_rows.append({
                    "key": key,
                    "label": label,
                    "format": value_format,
                    "preference": preference,
                    "baselineValue": baseline_value,
                    "targetValue": target_value,
                    "delta": round(target_value - baseline_value, 10)
                    if baseline_value is not None and target_value is not None
                    else None,
                })

            baseline_snapshot = baseline_result.get("marketSnapshot") or {}
            target_snapshot = target_result.get("marketSnapshot") or {}
            exact_snapshot = baseline_record.input_snapshot_hash == target_record.input_snapshot_hash
            baseline_symbols = set(str(item) for item in baseline_config.get("symbols") or [])
            target_symbols = set(str(item) for item in target_config.get("symbols") or [])
            return {
                "strategyId": baseline_strategy.id,
                "strategyName": baseline_strategy.name,
                "baseline": self._comparison_side(baseline_record, baseline_version, baseline_result),
                "target": self._comparison_side(target_record, target_version, target_result),
                "metrics": metric_rows,
                "comparisonBasis": {
                    "startDate": baseline_config.get("startDate"),
                    "endDate": baseline_config.get("endDate"),
                    "actualReplayStartDate": baseline_quality.get("actualReplayStartDate"),
                    "actualReplayEndDate": baseline_quality.get("actualReplayEndDate"),
                    "market": baseline_config.get("market"),
                    "engineVersion": baseline_record.engine_version,
                    "methodology": baseline_result.get("methodology"),
                    "snapshotMode": "exact_snapshot" if exact_snapshot else "aligned_independent_snapshots",
                    "sameUniverse": baseline_symbols == target_symbols,
                    "baselineSources": baseline_snapshot.get("sources") or [],
                    "targetSources": target_snapshot.get("sources") or [],
                    "costAssumptions": {
                        field: baseline_config.get(field)
                        for field in ("initialCapital", "commissionRate", "minimumCommission", "slippageRate")
                    },
                    "executionAssumptions": {
                        field: baseline_config.get(field)
                        for field in ("executionRule", "rebalanceFrequency", "maxPositions", "maxUniverseSize")
                    },
                },
            }

    def _comparison_experiment(self, session, experiment_id: int) -> tuple[Any, Any, dict[str, Any], dict[str, Any]]:
        experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
        if not experiment:
            raise StrategyValidationError("VALIDATION_EXPERIMENT_NOT_FOUND", "验证实验不存在。", 404)
        version = session.get(SimulationStrategyVersionRecord, experiment.strategy_version_id)
        strategy = session.get(SimulationStrategyRecord, version.strategy_id) if version else None
        config = self._load(experiment.config_json)
        result = self._load(experiment.result_json) if experiment.result_json else None
        if not version or not strategy or strategy.archived_at is not None:
            raise StrategyValidationError("STRATEGY_NOT_AVAILABLE", "策略或版本不存在或已归档。", 404)
        if self._experiment_purpose(config) != "validation":
            raise StrategyValidationError(
                "VALIDATION_COMPARISON_DIAGNOSTIC_UNSUPPORTED",
                "指定股票诊断不能参与策略版本对比。",
                422,
            )
        if experiment.status != "completed" or not isinstance(result, dict):
            raise StrategyValidationError(
                "VALIDATION_COMPARISON_EXPERIMENT_INCOMPLETE",
                "版本对比只接受已经完成的正式回放。",
                422,
            )
        if self._integrity_status(session, experiment) != "verified" or (result.get("dataQuality") or {}).get("complete") is not True:
            raise StrategyValidationError(
                "VALIDATION_COMPARISON_EVIDENCE_UNTRUSTED",
                "回放缺少完整区间证据或冻结快照校验，不能参与版本对比。",
                422,
            )
        return version, strategy, config, result

    @staticmethod
    def _comparison_side(experiment: Any, version: Any, result: dict[str, Any]) -> dict[str, Any]:
        snapshot = result.get("marketSnapshot") or {}
        return {
            "experimentId": experiment.id,
            "strategyVersionId": version.id,
            "versionNumber": version.version_number,
            "versionStatus": version.status,
            "completedAt": experiment.completed_at.isoformat() if experiment.completed_at else None,
            "inputSnapshotHash": experiment.input_snapshot_hash,
            "symbolCount": int(snapshot.get("symbolCount") or 0),
            "metrics": result.get("metrics") or {},
        }

    @staticmethod
    def _optional_number(value: Any) -> Optional[float]:
        if value is None or isinstance(value, bool):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    def version_status(self, strategy_version_id: int) -> dict[str, Any]:
        from src.services.strategy_definition_service import StrategyDefinitionService

        with self.db.get_session() as session:
            if not session.get(SimulationStrategyVersionRecord, strategy_version_id):
                raise StrategyValidationError("STRATEGY_VERSION_NOT_FOUND", "策略版本不存在。", 404)
        current_snapshot = StrategyDefinitionService(self.db).get_version(strategy_version_id)
        current_fingerprint = self._definition_fingerprint(current_snapshot)
        with self.db.get_session() as session:
            version = session.get(SimulationStrategyVersionRecord, strategy_version_id)
            recent = session.execute(select(SimulationStrategyValidationExperimentRecord).where(
                SimulationStrategyValidationExperimentRecord.strategy_version_id == strategy_version_id
            ).order_by(desc(SimulationStrategyValidationExperimentRecord.created_at)).limit(100)).scalars().all()
            # Diagnostic overrides are useful research records, but they must
            # never change the validation state of the frozen StrategyVersion.
            latest = next((item for item in recent if self._experiment_purpose(self._load(item.config_json)) == "validation"), None)
            completed_candidates = session.execute(select(SimulationStrategyValidationExperimentRecord).where(
                SimulationStrategyValidationExperimentRecord.strategy_version_id == strategy_version_id,
                SimulationStrategyValidationExperimentRecord.status == "completed",
            ).order_by(desc(SimulationStrategyValidationExperimentRecord.completed_at)).limit(100)).scalars().all()
            completed = next((item for item in completed_candidates if (
                self._experiment_purpose(self._load(item.config_json)) == "validation"
                and
                self._definition_fingerprint(self._load(item.version_snapshot_json)) == current_fingerprint
                and self._integrity_status(session, item) == "verified"
                and bool(self._load(item.result_json).get("dataQuality", {}).get("complete"))
            )), None)
            completed_result = self._load(completed.result_json) if completed else {}
            passed = bool(completed_result.get("conclusion") == "passed")
            status = "validated" if passed else "completed" if completed else (latest.status if latest and latest.status in {"queued", "running", "failed"} else "not_started")
            return {
                "strategyVersionId": version.id,
                "versionRevision": version.revision,
                "status": status,
                "latestExperimentId": latest.id if latest else None,
                "latestCompletedExperimentId": completed.id if completed else None,
                "completedAt": completed.completed_at.isoformat() if completed and completed.completed_at else None,
                "validatedAt": completed.completed_at.isoformat() if passed and completed.completed_at else None,
            }

    def require_completed_for_publish(self, strategy_version_id: int, experiment_id: Any) -> dict[str, Any]:
        experiment_id = self._positive_int(
            experiment_id,
            "PUBLISH_HISTORICAL_VALIDATION_REQUIRED",
            "正式发布前必须先完成当前策略定义的历史验证。",
        )
        from src.services.strategy_definition_service import StrategyDefinitionService

        with self.db.get_session() as session:
            experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
            if not experiment or experiment.strategy_version_id != strategy_version_id:
                raise StrategyValidationError(
                    "PUBLISH_HISTORICAL_VALIDATION_REQUIRED",
                    "所选验证实验不属于当前策略版本。",
                    409,
                )
            if experiment.status != "completed":
                raise StrategyValidationError(
                    "PUBLISH_HISTORICAL_VALIDATION_REQUIRED",
                    "所选历史验证尚未成功完成。",
                    409,
                )
            if self._experiment_purpose(self._load(experiment.config_json)) != "validation":
                raise StrategyValidationError(
                    "PUBLISH_DIAGNOSTIC_EXPERIMENT_NOT_ELIGIBLE",
                    "指定股票的诊断实验改变了策略股票池，不能作为正式发布的验证依据。请运行忠实使用 StrategyVersion 股票池的正式策略回放。",
                    409,
                )
            frozen_snapshot = self._load(experiment.version_snapshot_json)
        current_snapshot = StrategyDefinitionService(self.db).get_version(strategy_version_id)
        if self._definition_fingerprint(frozen_snapshot) != self._definition_fingerprint(current_snapshot):
            raise StrategyValidationError(
                "PUBLISH_HISTORICAL_VALIDATION_STALE",
                "策略定义在历史验证后发生了变化，请重新运行验证后再发布。",
                409,
            )
        detail = self.get_experiment(experiment_id)
        if detail["integrityStatus"] != "verified" or not (detail.get("result") or {}).get("dataQuality", {}).get("complete"):
            raise StrategyValidationError(
                "PUBLISH_HISTORICAL_VALIDATION_UNTRUSTED",
                "所选历史回放缺少完整区间或冻结快照校验，请使用新版引擎重新运行。",
                409,
            )
        return detail

    def _load_source_bars(self, session, version: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
        start = date.fromisoformat(config["startDate"])
        end = date.fromisoformat(config["endDate"])
        lookback_start = start - timedelta(days=120)
        execution_end = end
        explicit = config.get("symbols") or []
        if not explicit:
            raise StrategyValidationError("VALIDATION_UNIVERSE_EMPTY", "实验没有解析出可回放的策略股票池。", 422)
        source_filter = self._stock_daily_source_filter(version)
        availability_filters = [StockDaily.date >= lookback_start, StockDaily.date <= execution_end]
        if source_filter is not None:
            availability_filters.append(source_filter)
        available_codes = session.execute(select(StockDaily.code).where(*availability_filters).distinct()).scalars().all()
        available_by_key = {
            self._market_symbol_key(str(code), config["market"]): str(code)
            for code in available_codes
            if self._matches_market(str(code), config["market"])
        }
        codes = list(dict.fromkeys(
            available_by_key[key]
            for item in explicit
            if (key := self._market_symbol_key(item, config["market"])) in available_by_key
        ))[:config["maxUniverseSize"]]
        if not codes:
            raise StrategyValidationError("VALIDATION_UNIVERSE_EMPTY", "本地历史行情中没有符合市场范围的股票。请先补充日线数据或在市场范围中指定股票代码。", 422)
        row_filters = [StockDaily.code.in_(codes), StockDaily.date >= lookback_start, StockDaily.date <= execution_end]
        if source_filter is not None:
            row_filters.append(source_filter)
        rows = session.execute(select(StockDaily).where(*row_filters).order_by(StockDaily.code, StockDaily.date)).scalars().all()
        available: dict[str, int] = defaultdict(int)
        for row in rows:
            if row.close is not None and row.open is not None:
                available[row.code] += 1
        usable = {code for code, count in available.items() if count >= 22}
        bars = [{
            "code": row.code, "date": row.date, "open": row.open, "high": row.high, "low": row.low,
            "close": row.close, "volume": row.volume, "amount": row.amount, "dataSource": row.data_source,
            "sourceCreatedAt": row.created_at, "sourceUpdatedAt": row.updated_at,
            "adjustmentMode": self._adjustment_mode(row.data_source, config["market"]),
        } for row in rows if row.code in usable]
        if not bars:
            raise StrategyValidationError("VALIDATION_HISTORY_INSUFFICIENT", "所选股票没有足够的本地日线历史（每只至少需要 22 根有效日线）。", 422)
        return bars

    def _refresh_incomplete_history(self, config: dict[str, Any], version: dict[str, Any]) -> None:
        """Fetch only explicitly requested symbols whose local coverage is incomplete."""
        with self.db.get_session() as session:
            bars = self._source_bars_for_symbols(session, config, version)
        coverage = self._coverage_report(config, bars)
        targets = [item["requestedSymbol"] for item in coverage["symbols"] if not item["complete"]]
        if not targets or not self.refresh_missing_data:
            return
        if self.market_data_fetcher is None:
            from data_provider import DataFetcherManager

            self.market_data_fetcher = DataFetcherManager()
        start = date.fromisoformat(config["startDate"]) - timedelta(days=120)
        end = date.fromisoformat(config["endDate"])
        failures: list[str] = []
        preferred_fetcher = KLINE_FETCHER_BY_CONNECTION.get(self._kline_connection(version))
        for symbol in targets:
            try:
                fetch_kwargs = {"start_date": start.isoformat(), "end_date": end.isoformat()}
                if preferred_fetcher:
                    fetch_kwargs["preferred_fetcher"] = preferred_fetcher
                frame, source = self.market_data_fetcher.get_daily_data(symbol, **fetch_kwargs)
                if frame is None or frame.empty:
                    failures.append(f"{symbol}：数据源返回空行情")
                    continue
                self.db.save_daily_data(frame, symbol, source)
            except Exception as exc:
                failures.append(f"{symbol}：{str(exc)[:240]}")
        if failures:
            raise StrategyValidationError(
                "VALIDATION_MARKET_DATA_REFRESH_FAILED",
                "无法补齐历史行情，实验未创建。" + "；".join(failures[:5]),
                422,
            )

    def _source_bars_for_symbols(self, session, config: dict[str, Any], version: dict[str, Any]) -> list[dict[str, Any]]:
        start = date.fromisoformat(config["startDate"]) - timedelta(days=120)
        end = date.fromisoformat(config["endDate"])
        source_filter = self._stock_daily_source_filter(version)
        availability_filters = [StockDaily.date >= start, StockDaily.date <= end]
        if source_filter is not None:
            availability_filters.append(source_filter)
        available_codes = session.execute(select(StockDaily.code).where(*availability_filters).distinct()).scalars().all()
        available_by_key = {
            self._market_symbol_key(str(code), config["market"]): str(code)
            for code in available_codes
            if self._matches_market(str(code), config["market"])
        }
        codes = [
            available_by_key[key]
            for symbol in config["symbols"]
            if (key := self._market_symbol_key(symbol, config["market"])) in available_by_key
        ]
        if not codes:
            return []
        row_filters = [
            StockDaily.code.in_(list(dict.fromkeys(codes))),
            StockDaily.date >= start,
            StockDaily.date <= end,
        ]
        if source_filter is not None:
            row_filters.append(source_filter)
        rows = session.execute(select(StockDaily).where(*row_filters).order_by(StockDaily.code, StockDaily.date)).scalars().all()
        return [{
            "code": row.code,
            "date": row.date,
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "volume": row.volume,
            "amount": row.amount,
            "dataSource": row.data_source,
            "sourceCreatedAt": row.created_at,
            "sourceUpdatedAt": row.updated_at,
            "adjustmentMode": self._adjustment_mode(row.data_source, config["market"]),
        } for row in rows]

    @staticmethod
    def _kline_connection(version: dict[str, Any]) -> str:
        sources = version.get("dataPermissionSnapshot")
        kline = sources.get("kline") if isinstance(sources, dict) else None
        return str(kline.get("connection") or "system_market_data") if isinstance(kline, dict) else "system_market_data"

    @classmethod
    def _stock_daily_source_filter(cls, version: dict[str, Any]):
        fetcher = KLINE_FETCHER_BY_CONNECTION.get(cls._kline_connection(version))
        if not fetcher:
            return None
        aliases = {fetcher.casefold(), fetcher.removesuffix("Fetcher").casefold()}
        return func.lower(StockDaily.data_source).in_(aliases)

    @classmethod
    def _coverage_report(cls, config: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
        start = date.fromisoformat(config["startDate"])
        end = date.fromisoformat(config["endDate"])
        expected_weekdays = sum(
            1 for offset in range((end - start).days + 1)
            if (start + timedelta(days=offset)).weekday() < 5
        )
        minimum_replay_bars = max(2, math.ceil(expected_weekdays * MIN_REPLAY_WEEKDAY_COVERAGE))
        by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for bar in bars:
            by_key[cls._market_symbol_key(str(bar["code"]), config["market"])].append(bar)
        symbols: list[dict[str, Any]] = []
        replay_dates: list[date] = []
        for requested in config["symbols"]:
            values = sorted(by_key.get(cls._market_symbol_key(requested, config["market"]), []), key=lambda item: item["date"])
            valid = [item for item in values if cls._valid_ohlcv(item)]
            lookback = [item for item in valid if item["date"] < start]
            replay = [item for item in valid if start <= item["date"] <= end]
            first = replay[0]["date"] if replay else None
            last = replay[-1]["date"] if replay else None
            replay_dates.extend(item["date"] for item in replay)
            start_covered = first is not None and first <= start + timedelta(days=MAX_BOUNDARY_LAG_DAYS)
            end_covered = last is not None and last >= end - timedelta(days=MAX_BOUNDARY_LAG_DAYS)
            complete = (
                len(lookback) >= MIN_LOOKBACK_BARS
                and len(replay) >= minimum_replay_bars
                and start_covered
                and end_covered
            )
            symbols.append({
                "requestedSymbol": requested,
                "resolvedSymbol": values[0]["code"] if values else None,
                "lookbackBars": len(lookback),
                "replayBars": len(replay),
                "minimumReplayBars": minimum_replay_bars,
                "firstReplayDate": first.isoformat() if first else None,
                "lastReplayDate": last.isoformat() if last else None,
                "startCovered": start_covered,
                "endCovered": end_covered,
                "complete": complete,
            })
        unique_replay_dates = sorted(set(replay_dates))
        return {
            "complete": bool(symbols) and all(item["complete"] for item in symbols),
            "requestedStartDate": start.isoformat(),
            "requestedEndDate": end.isoformat(),
            "actualReplayStartDate": unique_replay_dates[0].isoformat() if unique_replay_dates else None,
            "actualReplayEndDate": unique_replay_dates[-1].isoformat() if unique_replay_dates else None,
            "expectedWeekdays": expected_weekdays,
            "minimumWeekdayCoverage": MIN_REPLAY_WEEKDAY_COVERAGE,
            "symbols": symbols,
        }

    @staticmethod
    def _valid_ohlcv(bar: dict[str, Any]) -> bool:
        try:
            open_price = float(bar["open"])
            high = float(bar["high"])
            low = float(bar["low"])
            close = float(bar["close"])
        except (KeyError, TypeError, ValueError):
            return False
        return open_price > 0 and close > 0 and high >= max(open_price, close) and low <= min(open_price, close) and low > 0

    @staticmethod
    def _require_complete_coverage(coverage: dict[str, Any]) -> None:
        if coverage["complete"]:
            return
        failures = [
            f"{item['requestedSymbol']}：回放 {item['replayBars']}/{item['minimumReplayBars']} 根，"
            f"区间 {item['firstReplayDate'] or '无'} 至 {item['lastReplayDate'] or '无'}，"
            f"回看 {item['lookbackBars']}/{MIN_LOOKBACK_BARS} 根"
            for item in coverage["symbols"] if not item["complete"]
        ]
        raise StrategyValidationError(
            "VALIDATION_HISTORY_COVERAGE_INCOMPLETE",
            "历史行情没有完整覆盖请求区间，实验未创建。" + "；".join(failures[:5]),
            422,
        )

    def _run(self, config: dict[str, Any], version: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
        by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for bar in bars:
            if bar.get("open") is not None and bar.get("close") is not None:
                by_code[bar["code"]].append(bar)
        for values in by_code.values():
            values.sort(key=lambda item: item["date"])
        start, end = date.fromisoformat(config["startDate"]), date.fromisoformat(config["endDate"])
        dates = sorted({bar["date"] for values in by_code.values() for bar in values if start <= bar["date"] <= end})
        if len(dates) < 2:
            raise StrategyValidationError("VALIDATION_HISTORY_INSUFFICIENT", "回测区间内至少需要两个交易日。", 422)
        frequency = config["rebalanceFrequency"]
        step = {"daily": 1, "weekly": 5, "monthly": 20}[frequency]
        signal_dates = set(dates[::step])
        policy_config = version.get("screeningPolicy") or {}
        max_positions = min(int(config["maxPositions"]), int(policy_config.get("maxCandidates") or config["maxPositions"]))
        slippage = float(config["slippageRate"])
        lot_size = 100 if config["market"] == "cn" else 1
        policy = str(policy_config.get("strategy") or "balanced_alpha")
        risk_policy = version.get("riskPolicy") if isinstance(version.get("riskPolicy"), dict) else {}
        raw_position_limit = risk_policy.get("max_position_pct")
        max_position_fraction = min(max(float(100 if raw_position_limit is None else raw_position_limit) / 100, 0.01), 1.0)
        cash = float(config["initialCapital"])
        positions: dict[str, dict[str, float]] = {}
        trades: list[dict[str, Any]] = []
        equity_curve: list[dict[str, Any]] = []
        total_turnover = 0.0
        skipped_executions: list[dict[str, Any]] = []
        last_close_prices: dict[str, float] = {}
        universe_mode = str(config.get("resolvedUniverseMode") or "experiment_override")
        universe_copy = "StrategyVersion 冻结的固定股票池" if universe_mode == "strategy_fixed" else "本次实验的调试覆盖股票池"
        limitations = [f"本实验使用{universe_copy}做 OHLCV 价格规则回放，不调用实时数据、新闻、LLM 或 Agent 图。"]
        if universe_mode == "experiment_override":
            limitations.append("股票代码来自本次实验覆盖，不等于策略自身的完整选股范围，也不能证明选股 Agent 已被历史重放。")
        if policy in {"dual_low", "quality_value", "blue_chip_income", "momentum_quality", "balanced_alpha"}:
            limitations.append(f"{policy} 的基本面、估值或 LLM 条件无法由 OHLCV 完整复现；本实验只验证其可复现的价格、波动与流动性部分。")
        else:
            limitations.append(f"{policy} 仅回放可由冻结 OHLCV 推导的条件；正式筛选器中的换手、基本面、主题和新闻条件未被静默替代。")

        pending_rebalance: Optional[dict[str, Any]] = None
        for day_index, current_date in enumerate(dates):
            price_map = self._prices_on(by_code, current_date)
            last_close_prices.update(price_map)
            if pending_rebalance is not None:
                execution_prices = self._prices_on(by_code, current_date, field="open")
                signal_date = pending_rebalance["signalDate"]
                selected = pending_rebalance["selected"]
                # Full rebalance is explicit and reproducible: sell first, then equal-weight buys.
                for code, position in list(positions.items()):
                    raw_price = execution_prices.get(code)
                    if raw_price is None:
                        skipped_executions.append({"code": code, "side": "sell", "signalDate": signal_date.isoformat(), "executionDate": current_date.isoformat(), "reason": "missing_next_open"})
                        continue
                    fill = raw_price * (1 - slippage)
                    gross = position["quantity"] * fill
                    fees = self._transaction_fees(config, "sell", current_date, gross)
                    cash += gross - fees["total"]
                    total_turnover += gross
                    realized = (fill - position["averagePrice"]) * position["quantity"] - fees["total"] - position["entryFee"]
                    trades.append(self._trade(code, "sell", position["quantity"], signal_date, current_date, raw_price, fill, fees, abs(raw_price - fill) * position["quantity"], realized))
                    del positions[code]
                if selected:
                    allocation = min(cash / len(selected), cash * max_position_fraction)
                    for code in selected:
                        raw_price = execution_prices.get(code)
                        if raw_price is None or raw_price <= 0:
                            skipped_executions.append({"code": code, "side": "buy", "signalDate": signal_date.isoformat(), "executionDate": current_date.isoformat(), "reason": "missing_next_open"})
                            continue
                        fill = raw_price * (1 + slippage)
                        quantity = math.floor(allocation / fill / lot_size) * lot_size
                        fees = self._transaction_fees(config, "buy", current_date, quantity * fill) if quantity > 0 else self._empty_fees()
                        while quantity > 0 and quantity * fill + fees["total"] > min(allocation, cash) + 1e-8:
                            quantity -= lot_size
                            fees = self._transaction_fees(config, "buy", current_date, quantity * fill) if quantity > 0 else self._empty_fees()
                        if quantity <= 0:
                            continue
                        gross = quantity * fill
                        if gross + fees["total"] > cash + 1e-8:
                            continue
                        cash -= gross + fees["total"]
                        total_turnover += gross
                        positions[code] = {"quantity": float(quantity), "averagePrice": fill, "entryFee": fees["total"]}
                        trades.append(self._trade(code, "buy", quantity, signal_date, current_date, raw_price, fill, fees, abs(raw_price - fill) * quantity, None, allocation))
                pending_rebalance = None
            equity = cash + sum(position["quantity"] * last_close_prices.get(code, position["averagePrice"]) for code, position in positions.items())
            equity_curve.append({"date": current_date.isoformat(), "equity": round(equity, 4), "cash": round(cash, 4), "positionCount": len(positions)})
            # Signals use only information available through this close and
            # become eligible for execution on the following replay date.
            if current_date in signal_dates and day_index + 1 < len(dates):
                ranked = []
                for code, code_bars in by_code.items():
                    history = [item for item in code_bars if item["date"] <= current_date]
                    signal = self._score(policy, history)
                    if signal is not None:
                        ranked.append((signal, code))
                pending_rebalance = {
                    "signalDate": current_date,
                    "selected": [code for _, code in sorted(ranked, reverse=True)[:max_positions]],
                }

        metrics = self._metrics(equity_curve, trades, float(config["initialCapital"]), total_turnover)
        sources = sorted({str(bar.get("dataSource")) for bar in bars if bar.get("dataSource")})
        adjustment_modes = sorted({str(bar.get("adjustmentMode")) for bar in bars if bar.get("adjustmentMode")})
        source_times = [value for bar in bars for value in (bar.get("sourceCreatedAt"), bar.get("sourceUpdatedAt")) if isinstance(value, datetime)]
        coverage = self._coverage_report(config, bars)
        self._require_complete_coverage(coverage)
        return {
            "engineVersion": ENGINE_VERSION,
            "methodology": "historical_ohlcv_policy_replay",
            "conclusion": "observational",
            "metrics": metrics,
            "equityCurve": equity_curve,
            "trades": trades,
            "finalPositions": [{"code": code, **position} for code, position in sorted(positions.items())],
            "marketSnapshot": {"sha256": self._bars_hash(bars), "hashAlgorithm": "sha256", "barCount": len(bars), "symbolCount": len(by_code), "sources": sources, "adjustmentModes": adjustment_modes, "sourceRecordedFrom": min(source_times).isoformat() if source_times else None, "sourceRecordedTo": max(source_times).isoformat() if source_times else None, "firstDate": min(bar["date"] for bar in bars).isoformat(), "lastDate": max(bar["date"] for bar in bars).isoformat()},
            "dataQuality": coverage,
            "strategyReplay": {"screeningPolicy": policy, "rebalanceFrequency": frequency, "executionRule": config["executionRule"], "maxPositions": max_positions, "maxPositionPercent": round(max_position_fraction * 100, 4), "universeMode": universe_mode, "experimentPurpose": self._experiment_purpose(config), "skippedExecutions": skipped_executions},
            "strategyCoverage": {"level": "partial", "executedComponents": [universe_mode, "ohlcv_price_volume_proxy", "next_open_execution", "riskPolicy.max_position_pct", "configured_cost_model"], "omittedComponents": ["agent_graph", "llm_decisions", "historical_news", "historical_fundamentals", "point_in_time_market_universe", "decisionPolicy", "memoryPolicy", "non_ohlcv_screening_filters"]},
            "costModel": self._cost_model_description(config),
            "limitations": limitations,
        }

    @staticmethod
    def _score(policy: str, history: list[dict[str, Any]]) -> Optional[float]:
        valid = [item for item in history if item.get("close") is not None]
        if len(valid) < 21:
            return None
        closes = [float(item["close"]) for item in valid]
        volumes = [float(item.get("volume") or 0) for item in valid]
        current, prior5, prior20 = closes[-1], closes[-6], closes[-21]
        if prior5 <= 0 or prior20 <= 0:
            return None
        mom5 = current / prior5 - 1
        mom20 = current / prior20 - 1
        returns = [closes[index] / closes[index - 1] - 1 for index in range(len(closes) - 19, len(closes)) if closes[index - 1] > 0]
        volatility = statistics.pstdev(returns) if len(returns) >= 2 else 0.0
        avg_volume = statistics.fmean(volumes[-21:-1]) if any(volumes[-21:-1]) else 0.0
        volume_ratio = volumes[-1] / avg_volume if avg_volume > 0 else 1.0
        ma20 = statistics.fmean(closes[-20:])
        liquidity = math.log10(max(float(valid[-1].get("amount") or 1), 1)) / 10
        if policy == "volume_breakout":
            if current < max(closes[-21:-1]) or volume_ratio < 1.3 or current < ma20:
                return None
            return mom20 * 5 + volume_ratio * 0.2 + liquidity
        if policy == "shrink_pullback":
            if current < ma20 or not 0.98 <= current / ma20 <= 1.08 or volume_ratio > 1.5:
                return None
            return mom20 * 3 - abs(current / ma20 - 1) - volatility + liquidity
        if policy == "oversold_reversal":
            if mom5 > -0.01 or len(closes) < 2 or closes[-1] <= closes[-2]:
                return None
            return -mom5 - volatility + liquidity
        if policy == "capital_heat":
            if mom5 <= 0 or volume_ratio < 1.2:
                return None
            return mom5 * 5 + volume_ratio * 0.2 + liquidity
        if policy == "low_volatility_quality":
            return mom20 * 2 - volatility * 4 + liquidity
        if mom20 <= -0.05:
            return None
        return mom20 * 3 + mom5 - volatility * 2 + liquidity

    @staticmethod
    def _prices_on(by_code: dict[str, list[dict[str, Any]]], target: date, field: str = "close") -> dict[str, float]:
        result = {}
        for code, bars in by_code.items():
            match = next((item for item in bars if item["date"] == target and item.get(field) is not None), None)
            if match:
                result[code] = float(match[field])
        return result

    @staticmethod
    def _trade(code: str, side: str, quantity: float, signal_date: date, execution_date: date, raw_price: float, fill_price: float, fees: dict[str, float], slippage_cost: float, realized_pnl: Optional[float], position_limit_amount: Optional[float] = None) -> dict[str, Any]:
        return {"code": code, "side": side, "quantity": int(quantity), "signalDate": signal_date.isoformat(), "executionDate": execution_date.isoformat(), "rawPrice": round(raw_price, 6), "fillPrice": round(fill_price, 6), "grossAmount": round(quantity * fill_price, 4), "commission": round(fees["commission"], 4), "stampDuty": round(fees["stampDuty"], 4), "transferFee": round(fees["transferFee"], 4), "totalFees": round(fees["total"], 4), "slippageCost": round(slippage_cost, 4), "positionLimitAmount": round(position_limit_amount, 4) if position_limit_amount is not None else None, "realizedPnl": round(realized_pnl, 4) if realized_pnl is not None else None}

    @staticmethod
    def _metrics(curve: list[dict[str, Any]], trades: list[dict[str, Any]], initial: float, turnover: float) -> dict[str, Any]:
        equities = [float(item["equity"]) for item in curve]
        final = equities[-1]
        cumulative = final / initial - 1
        peak = equities[0]
        max_drawdown = 0.0
        for value in equities:
            peak = max(peak, value)
            max_drawdown = min(max_drawdown, value / peak - 1 if peak else 0.0)
        returns = [equities[index] / equities[index - 1] - 1 for index in range(1, len(equities)) if equities[index - 1] > 0]
        volatility = statistics.pstdev(returns) * math.sqrt(252) if len(returns) >= 2 else 0.0
        sharpe = statistics.fmean(returns) / statistics.pstdev(returns) * math.sqrt(252) if len(returns) >= 2 and statistics.pstdev(returns) > 0 else None
        years = max(len(equities) / 252, 1 / 252)
        annualized = (final / initial) ** (1 / years) - 1 if final > 0 and initial > 0 else None
        closes = [item for item in trades if item["side"] == "sell" and item.get("realizedPnl") is not None]
        wins = sum(float(item["realizedPnl"]) > 0 for item in closes)
        avg_equity = statistics.fmean(equities) if equities else initial
        return {"initialCapital": round(initial, 4), "finalEquity": round(final, 4), "cumulativeReturn": round(cumulative, 8), "annualizedReturn": round(annualized, 8) if annualized is not None else None, "maxDrawdown": round(max_drawdown, 8), "annualizedVolatility": round(volatility, 8), "sharpeRatio": round(sharpe, 6) if sharpe is not None else None, "tradeCount": len(trades), "closedTradeCount": len(closes), "winRate": round(wins / len(closes), 8) if closes else None, "turnover": round(turnover / avg_equity, 8) if avg_equity else None}

    @staticmethod
    def _empty_fees() -> dict[str, float]:
        return {"commission": 0.0, "stampDuty": 0.0, "transferFee": 0.0, "total": 0.0}

    @classmethod
    def _transaction_fees(cls, config: dict[str, Any], side: str, execution_date: date, gross: float) -> dict[str, float]:
        if gross <= 0:
            return cls._empty_fees()
        commission = max(gross * float(config["commissionRate"]), float(config.get("minimumCommission") or 0))
        stamp_duty = 0.0
        transfer_fee = 0.0
        if config["market"] == "cn":
            if side == "sell":
                stamp_duty = gross * (0.0005 if execution_date >= date(2023, 8, 28) else 0.001)
            transfer_fee = gross * (0.00001 if execution_date >= date(2022, 4, 29) else 0.00002)
        total = commission + stamp_duty + transfer_fee
        return {"commission": commission, "stampDuty": stamp_duty, "transferFee": transfer_fee, "total": total}

    @staticmethod
    def _cost_model_description(config: dict[str, Any]) -> dict[str, Any]:
        return {
            "commissionRate": config["commissionRate"],
            "minimumCommission": config.get("minimumCommission", 0),
            "slippageRate": config["slippageRate"],
            "cnSellStampDutySchedule": "0.10% before 2023-08-28; 0.05% from 2023-08-28",
            "cnTransferFeeSchedule": "0.002% before 2022-04-29; 0.001% from 2022-04-29",
            "appliesRegulatorySchedule": config["market"] == "cn",
        }

    def _detail(self, session, experiment: SimulationStrategyValidationExperimentRecord, bar_count: Optional[int] = None) -> dict[str, Any]:
        version = session.get(SimulationStrategyVersionRecord, experiment.strategy_version_id)
        strategy = session.get(SimulationStrategyRecord, version.strategy_id) if version else None
        if bar_count is None:
            bar_count = int(session.execute(select(func.count(SimulationStrategyValidationBarRecord.id)).where(SimulationStrategyValidationBarRecord.experiment_id == experiment.id)).scalar_one())
        integrity_status = self._integrity_status(session, experiment)
        return {"id": experiment.id, "strategyId": strategy.id if strategy else None, "strategyName": strategy.name if strategy else None, "strategyVersionId": experiment.strategy_version_id, "versionNumber": version.version_number if version else None, "versionStatus": version.status if version else None, "versionRevision": experiment.strategy_version_revision, "status": experiment.status, "engineVersion": experiment.engine_version, "config": self._load(experiment.config_json), "result": self._load(experiment.result_json) if experiment.result_json else None, "barCount": bar_count, "inputSnapshotHash": experiment.input_snapshot_hash, "integrityStatus": integrity_status, "errorMessage": experiment.error_message, "startedAt": experiment.started_at.isoformat() if experiment.started_at else None, "completedAt": experiment.completed_at.isoformat() if experiment.completed_at else None, "createdAt": experiment.created_at.isoformat() if experiment.created_at else None, "updatedAt": experiment.updated_at.isoformat() if experiment.updated_at else None}

    def _integrity_status(self, session, experiment: SimulationStrategyValidationExperimentRecord) -> str:
        if not experiment.input_snapshot_hash:
            return "legacy_unverified"
        rows = session.execute(select(SimulationStrategyValidationBarRecord).where(
            SimulationStrategyValidationBarRecord.experiment_id == experiment.id
        ).order_by(SimulationStrategyValidationBarRecord.code, SimulationStrategyValidationBarRecord.date)).scalars().all()
        return "verified" if self._bars_hash([self._bar_dict(row) for row in rows]) == experiment.input_snapshot_hash else "failed"

    def _require_snapshot_integrity(self, experiment: SimulationStrategyValidationExperimentRecord, bars: list[dict[str, Any]]) -> None:
        if not experiment.input_snapshot_hash or self._bars_hash(bars) != experiment.input_snapshot_hash:
            raise StrategyValidationError(
                "VALIDATION_SNAPSHOT_INTEGRITY_FAILED",
                "冻结行情快照完整性校验失败，实验已停止。请重新创建实验。",
                409,
            )

    def _fail(self, experiment_id: int, message: str) -> None:
        with self.db.session_scope() as session:
            experiment = session.get(SimulationStrategyValidationExperimentRecord, experiment_id)
            if experiment:
                experiment.status = "failed"; experiment.error_message = message[:2000]; experiment.completed_at = utc_naive_now()

    @staticmethod
    def _normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
        try:
            start = date.fromisoformat(str(raw.get("startDate") or ""))
            end = date.fromisoformat(str(raw.get("endDate") or ""))
        except ValueError as exc:
            raise StrategyValidationError("VALIDATION_DATE_INVALID", "回测开始和结束日期必须使用 YYYY-MM-DD。") from exc
        if start >= end:
            raise StrategyValidationError("VALIDATION_DATE_RANGE_INVALID", "回测结束日期必须晚于开始日期。")
        if (end - start).days > 366 * 5:
            raise StrategyValidationError("VALIDATION_DATE_RANGE_TOO_LARGE", "单次回测区间不能超过 5 年。")
        if end > date.today():
            raise StrategyValidationError("VALIDATION_DATE_IN_FUTURE", "历史回放结束日期不能晚于今天。")
        initial = StrategyValidationService._bounded_float(raw.get("initialCapital", 1_000_000), 10_000, 1_000_000_000, "初始资金")
        commission = StrategyValidationService._bounded_float(raw.get("commissionRate", 0.0003), 0, 0.05, "手续费率")
        slippage = StrategyValidationService._bounded_float(raw.get("slippageRate", 0.001), 0, 0.05, "滑点率")
        frequency = str(raw.get("rebalanceFrequency") or "weekly").lower()
        if frequency not in {"daily", "weekly", "monthly"}:
            raise StrategyValidationError("VALIDATION_REBALANCE_INVALID", "调仓频率只支持 daily、weekly 或 monthly。")
        execution = str(raw.get("executionRule") or "next_open").lower()
        if execution != "next_open":
            raise StrategyValidationError("VALIDATION_EXECUTION_RULE_INVALID", "当前引擎只支持下一交易日开盘成交。")
        market = str(raw.get("market") or "cn").lower()
        if market not in {"cn", "hk", "us"}:
            raise StrategyValidationError("VALIDATION_MARKET_INVALID", "市场范围只支持 cn、hk 或 us。")
        symbols = raw.get("symbols") if isinstance(raw.get("symbols"), list) else []
        requested_universe_mode = raw.get("universeMode")
        universe_mode = str(requested_universe_mode or ("override" if symbols else "strategy")).lower()
        if universe_mode not in {"strategy", "override"}:
            raise StrategyValidationError("VALIDATION_UNIVERSE_MODE_INVALID", "股票池来源只支持 strategy 或 override。")
        requested_purpose = raw.get("experimentPurpose")
        purpose = str(requested_purpose or ("diagnostic" if universe_mode == "override" or symbols else "validation")).lower()
        if purpose not in {"validation", "diagnostic"}:
            raise StrategyValidationError("VALIDATION_EXPERIMENT_PURPOSE_INVALID", "实验用途只支持 validation 或 diagnostic。")
        if purpose == "validation" and (universe_mode != "strategy" or symbols):
            raise StrategyValidationError(
                "VALIDATION_STRATEGY_UNIVERSE_REQUIRED",
                "正式策略回放必须忠实使用 StrategyVersion 的股票池，不能临时指定股票。",
                422,
            )
        if purpose == "diagnostic" and universe_mode != "override":
            raise StrategyValidationError(
                "DIAGNOSTIC_OVERRIDE_UNIVERSE_REQUIRED",
                "股票诊断实验必须明确提供临时股票池。",
                422,
            )
        minimum_commission_raw = raw.get("minimumCommission")
        minimum_commission = StrategyValidationService._bounded_float(
            5 if minimum_commission_raw is None and market == "cn" else minimum_commission_raw or 0,
            0,
            10_000,
            "最低佣金",
        )
        return {"startDate": start.isoformat(), "endDate": end.isoformat(), "initialCapital": initial, "commissionRate": commission, "minimumCommission": minimum_commission, "slippageRate": slippage, "executionRule": execution, "rebalanceFrequency": frequency, "market": market, "universeMode": universe_mode, "experimentPurpose": purpose, "maxPositions": max(1, min(int(raw.get("maxPositions") or 3), 10)), "maxUniverseSize": max(1, min(int(raw.get("maxUniverseSize") or 50), 100)), "symbols": [str(item).strip().upper() for item in symbols if str(item).strip()][:100]}

    @staticmethod
    def _experiment_purpose(config: dict[str, Any]) -> str:
        explicit = str(config.get("experimentPurpose") or "").lower()
        if explicit in {"validation", "diagnostic"}:
            return explicit
        return "diagnostic" if config.get("universeMode") == "override" or config.get("resolvedUniverseMode") == "experiment_override" else "validation"

    @staticmethod
    def _strategy_symbols(market_scope: dict[str, Any]) -> list[str]:
        for value in (market_scope.get("symbols"), market_scope.get("codes"), market_scope.get("stockCodes"), market_scope.get("universe")):
            if isinstance(value, list) and value:
                return list(dict.fromkeys(str(item).strip().upper() for item in value if str(item).strip()))
        return []

    def _resolve_universe(self, version: dict[str, Any], config: dict[str, Any]) -> tuple[list[str], str]:
        if config["universeMode"] == "override":
            symbols = list(config.get("symbols") or [])
            if not symbols:
                raise StrategyValidationError(
                    "VALIDATION_OVERRIDE_SYMBOLS_REQUIRED",
                    "你选择了“仅调试指定股票”，请填写至少一个股票代码；默认的策略选股模式不要求在回放页填写代码。",
                    422,
                )
            return symbols, "experiment_override"

        market_scope = version.get("marketScope") if isinstance(version.get("marketScope"), dict) else {}
        policy = version.get("screeningPolicy") if isinstance(version.get("screeningPolicy"), dict) else {}
        strategy_market = str(market_scope.get("market") or policy.get("market") or config["market"]).lower()
        if strategy_market in {"cn", "hk", "us"}:
            config["market"] = strategy_market
        strategy_symbols = self._strategy_symbols(market_scope)
        if strategy_symbols:
            return strategy_symbols, "strategy_fixed"
        if str(market_scope.get("universeMode") or "").lower() == "fixed":
            raise StrategyValidationError(
                "STRATEGY_FIXED_UNIVERSE_EMPTY",
                "这个策略配置为固定股票池，但版本中没有股票代码。请回到策略中心完善策略定义。",
                422,
            )

        policy_name = str(policy.get("strategy") or "策略内选股阶段")
        raise StrategyValidationError(
            "VALIDATION_POINT_IN_TIME_UNIVERSE_UNAVAILABLE",
            f"这个版本会由策略内选股阶段（{policy_name}）决定股票，而当前验证后端尚未保存所选区间的历史时点股票池和成分变更。为避免生存者偏差，实验没有创建；请先接入历史股票池快照，或选择“仅调试指定股票”做局部诊断。",
            422,
        )

    @staticmethod
    def _matches_market(code: str, market: str) -> bool:
        normalized = code.strip().upper()
        if market == "cn": return bool(re.fullmatch(r"(?:SH|SZ|BJ)?\d{6}", normalized))
        if market == "hk": return bool(re.fullmatch(r"(?:HK)?\d{5}", normalized) or normalized.endswith(".HK"))
        return bool(re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", normalized)) and not normalized.startswith(("SH", "SZ", "BJ", "HK"))

    @staticmethod
    def _market_symbol_key(code: str, market: str) -> str:
        normalized = code.strip().upper()
        if market == "cn":
            normalized = re.sub(r"^(?:SH|SZ|SS|BJ)\.?", "", normalized)
            normalized = re.sub(r"\.(?:SH|SZ|SS|BJ)$", "", normalized)
            return normalized
        if market == "hk":
            normalized = re.sub(r"^HK\.?", "", normalized)
            normalized = re.sub(r"\.HK$", "", normalized)
            return normalized.zfill(5) if normalized.isdigit() else normalized
        return normalized

    @classmethod
    def _canonical_symbols(cls, symbols: list[str], market: str) -> list[str]:
        result: list[str] = []
        for symbol in symbols:
            key = cls._market_symbol_key(symbol, market)
            valid = bool(re.fullmatch(r"\d{6}", key)) if market == "cn" else bool(re.fullmatch(r"\d{5}", key)) if market == "hk" else cls._matches_market(key, market)
            if not valid:
                raise StrategyValidationError("VALIDATION_SYMBOL_INVALID", f"股票代码 {symbol} 不属于所选市场 {market}。", 422)
            if key not in result:
                result.append(key)
        return result

    @staticmethod
    def _adjustment_mode(data_source: Optional[str], market: str) -> str:
        source = str(data_source or "")
        if market == "cn" and source in {"AkshareFetcher", "EfinanceFetcher"}:
            return "forward_adjusted"
        if source == "YfinanceFetcher":
            return "provider_auto_adjusted"
        return "provider_normalized_unknown_adjustment"

    @staticmethod
    def _positive_int(value: Any, code: str, message: str) -> int:
        try: result = int(value)
        except (TypeError, ValueError): raise StrategyValidationError(code, message)
        if result <= 0: raise StrategyValidationError(code, message)
        return result

    @staticmethod
    def _bounded_float(value: Any, minimum: float, maximum: float, label: str) -> float:
        try: result = float(value)
        except (TypeError, ValueError) as exc: raise StrategyValidationError("VALIDATION_CONFIG_INVALID", f"{label}不是有效数字。") from exc
        if not math.isfinite(result) or not minimum <= result <= maximum: raise StrategyValidationError("VALIDATION_CONFIG_INVALID", f"{label}必须在 {minimum}–{maximum} 之间。")
        return result

    @staticmethod
    def _bar_dict(row: SimulationStrategyValidationBarRecord) -> dict[str, Any]:
        return {"code": row.code, "date": row.date, "open": row.open, "high": row.high, "low": row.low, "close": row.close, "volume": row.volume, "amount": row.amount, "dataSource": row.data_source, "sourceCreatedAt": row.source_created_at, "sourceUpdatedAt": row.source_updated_at, "adjustmentMode": row.adjustment_mode}

    @classmethod
    def _bars_hash(cls, bars: list[dict[str, Any]]) -> str:
        payload = [{
            key: value.isoformat() if isinstance(value, (date, datetime)) else value
            for key, value in bar.items()
        } for bar in bars]
        return cls._hash(payload)

    @staticmethod
    def _hash(value: Any) -> str:
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")).hexdigest()

    @classmethod
    def _definition_fingerprint(cls, snapshot: dict[str, Any]) -> str:
        semantic = dict(snapshot)
        for key in (
            "status", "versionNumber", "immutable", "revision", "changeLog",
            "createdAt", "updatedAt", "publishedAt", "lastValidatedAt",
        ):
            semantic.pop(key, None)
        return cls._hash(semantic)

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))

    @staticmethod
    def _load(value: Optional[str]) -> dict[str, Any]:
        try: decoded = json.loads(value or "{}")
        except (TypeError, ValueError): return {}
        return decoded if isinstance(decoded, dict) else {}
