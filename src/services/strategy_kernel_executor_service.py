"""Uniform execution boundary for trusted and uploaded Python kernels."""

from __future__ import annotations

import importlib
import json
import os
import resource
import subprocess
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jsonschema import ValidationError, validate as validate_json_schema
from sqlalchemy import desc, select

from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.storage import StockDaily


class StrategyKernelExecutionError(StrategyDefinitionError):
    pass


class StrategyKernelExecutorService:
    """Call one immutable kernel through its declared ``run(context)`` entrypoint."""

    TIMEOUT_SECONDS = 12
    MEMORY_LIMIT_BYTES = 256 * 1024 * 1024
    OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024

    def __init__(self, definition_service: StrategyDefinitionService | None = None):
        self.definition = definition_service or StrategyDefinitionService()

    def execute(self, version_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        version = self.definition.get_version(version_id)
        package = version.get("strategyPackage")
        if not isinstance(package, dict) or package.get("executionStatus") != "ready":
            raise StrategyKernelExecutionError(
                "STRATEGY_KERNEL_NOT_EXECUTABLE",
                "这个策略版本没有可调用的 Python 内核。",
                409,
            )
        inputs = payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {}
        supplied_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        self._validate_schema(package.get("inputSchema"), inputs, "STRATEGY_KERNEL_INPUT_INVALID", "输入不符合策略 Schema")
        coverage, warnings, missing = self._resolve_coverage(package, version, supplied_data)
        if missing:
            return {
                "status": "failed",
                "contract": package.get("outputContract"),
                "reasonCode": "REQUIRED_DATA_MISSING",
                "message": f"缺少策略必需数据：{', '.join(missing)}。",
                "missingInputs": missing,
                "dataCoverage": coverage,
                "warnings": warnings,
            }
        context = self._context(version, payload, coverage, warnings)
        if package.get("kind") == "builtin_python":
            result = self._execute_builtin(package, context)
        elif package.get("kind") == "uploaded_package":
            context["data"] = supplied_data
            result = self._execute_uploaded(package, context)
        else:
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_KIND_UNSUPPORTED", "未知的策略内核类型。", 409)
        if not isinstance(result, dict):
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_OUTPUT_INVALID", "策略函数必须返回 JSON 对象。", 422)
        if result.get("contract") != package.get("outputContract"):
            raise StrategyKernelExecutionError(
                "STRATEGY_KERNEL_OUTPUT_CONTRACT_MISMATCH",
                f"策略函数必须返回 {package.get('outputContract')} 契约。",
                422,
            )
        self._validate_schema(package.get("outputSchema"), result, "STRATEGY_KERNEL_OUTPUT_INVALID", "输出不符合策略 Schema")
        return result

    def execute_product(self, version_id: int, inputs: dict[str, Any], *, mode: str = "research") -> dict[str, Any]:
        """Execute a published complete strategy selected by a product page."""
        version = self.definition.get_version(version_id)
        if version.get("status") != "PUBLISHED" or not version.get("immutable"):
            raise StrategyKernelExecutionError("STRATEGY_PRODUCT_VERSION_REQUIRED", "只能调用正式发布的完整策略版本。", 409)
        if version.get("productRole") == "kernel":
            raise StrategyKernelExecutionError("RUN_CONFIGURATION_REQUIRED", "请先从策略内核创建并发布运行配置。", 409)
        package = version.get("strategyPackage")
        if not isinstance(package, dict):
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_NOT_EXECUTABLE", "完整策略没有绑定统一 Python 内核。", 409)
        data = {} if package.get("kind") == "builtin_python" else self._prepare_platform_data(version, package, inputs)
        return self.execute(version_id, {"inputs": inputs, "data": data, "mode": mode})

    def execute_published_run(self, run_id: int) -> dict[str, Any]:
        detail = self.definition.get_published_run(run_id)
        version = self.definition.get_version(detail["strategyVersionId"])
        package = version.get("strategyPackage")
        if not isinstance(package, dict) or package.get("executionStatus") != "ready":
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_NOT_EXECUTABLE", "完整策略没有可调用内核。", 409)
        context = self._context(
            version,
            {"inputs": detail.get("inputSnapshot") or {}, "mode": detail.get("executionMode") or "preview"},
            {},
            [],
        )
        if package.get("kind") == "builtin_python" and package.get("entrypoint", "").endswith("research_decision:run"):
            context["_runtime"] = {"publishedRunId": run_id, "database": self.definition.db}
            result = self._execute_builtin(package, context)
            self._persist_run_result(run_id, result)
            return result
        inputs = detail.get("inputSnapshot") or {}
        platform_data = self._prepare_platform_data(version, package, inputs)
        result = self.execute(version["id"], {"inputs": inputs, "data": platform_data})
        self._persist_run_result(run_id, result)
        return result

    def _context(self, version: dict[str, Any], payload: dict[str, Any], coverage: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
        policy = version.get("decisionPolicy") if isinstance(version.get("decisionPolicy"), dict) else {}
        screening = version.get("screeningPolicy") if isinstance(version.get("screeningPolicy"), dict) else {}
        return {
            "runId": str(payload.get("runId") or uuid.uuid4().hex),
            "strategyId": version.get("strategyId"),
            "strategyVersion": version.get("versionNumber") or version.get("id"),
            "mode": str(payload.get("mode") or "preview"),
            "asOf": str(payload.get("asOf") or datetime.now(timezone.utc).isoformat()),
            "inputs": payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {},
            "parameters": policy.get("packageParameters") if isinstance(policy.get("packageParameters"), dict) else {},
            "configuration": {
                "market": screening.get("market") or "cn",
                "universe": version.get("marketScope") or {},
                "timeframe": version.get("timeHorizon"),
                "dataSources": version.get("dataPermissionSnapshot") or {},
                "risk": version.get("riskPolicy") or {},
                "screeningPolicy": version.get("screeningPolicy") or {},
            },
            "dataCoverage": coverage,
            "warnings": warnings,
        }

    def _resolve_coverage(self, package: dict[str, Any], version: dict[str, Any], supplied_data: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
        configuration = version.get("dataPermissionSnapshot") if isinstance(version.get("dataPermissionSnapshot"), dict) else {}
        coverage: dict[str, Any] = {}
        warnings: list[str] = []
        missing: list[str] = []
        trusted = package.get("kind") == "builtin_python"
        for requirement in package.get("dataRequirements") or []:
            if not isinstance(requirement, dict):
                continue
            identifier = str(requirement.get("id") or requirement.get("kind") or "data")
            kind = str(requirement.get("kind") or "")
            configured = self._kind_enabled(configuration, kind)
            supplied = any(key in supplied_data for key in [identifier, kind, *(requirement.get("sourceIds") or [])])
            available = configured and (trusted or supplied)
            coverage[identifier] = {
                "available": available,
                "required": bool(requirement.get("required", True)),
                "sourceIds": requirement.get("sourceIds") or [],
                "mode": "platform_resolved" if trusted and configured else "supplied" if supplied else "missing",
            }
            if not available and requirement.get("required", True):
                missing.append(identifier)
            elif not available:
                warnings.append(f"可选数据 {identifier} 不可用，策略将按声明降级。")
        return coverage, warnings, missing

    @staticmethod
    def _kind_enabled(configuration: dict[str, Any], kind: str) -> bool:
        value = configuration.get(kind)
        if not isinstance(value, dict) or value.get("enabled") is False:
            return False
        if kind == "other":
            return bool(value.get("sourceIds"))
        return bool(value.get("connection"))

    def _prepare_platform_data(self, version: dict[str, Any], package: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
        """Resolve deterministic local snapshots for uploaded kernels.

        The restricted worker cannot open the database or network.  The parent
        grants only explicitly declared data.  This first executor supports
        stored OHLCV; required unsupported kinds fail through the normal
        dependency contract instead of being fabricated.
        """
        scope = version.get("marketScope") if isinstance(version.get("marketScope"), dict) else {}
        symbols = [str(inputs.get("stockCode") or inputs.get("stock_code") or inputs.get("symbol") or "").strip()]
        symbols.extend(str(item).strip() for item in scope.get("symbols", []) if str(item).strip())
        symbols = list(dict.fromkeys(symbol for symbol in symbols if symbol))
        result: dict[str, Any] = {}
        if not symbols:
            return result
        for requirement in package.get("dataRequirements") or []:
            if not isinstance(requirement, dict) or requirement.get("kind") != "kline":
                continue
            lookback_value = requirement.get("lookback")
            lookback = int(lookback_value) if isinstance(lookback_value, int) else 120
            rows: list[dict[str, Any]] = []
            with self.definition.db.get_session() as session:
                for symbol in symbols:
                    bars = session.execute(
                        select(StockDaily)
                        .where(StockDaily.code == symbol)
                        .order_by(desc(StockDaily.date))
                        .limit(max(1, min(lookback, 2000)))
                    ).scalars().all()
                    serialized = []
                    for bar in bars:
                        item = bar.to_dict()
                        if hasattr(item.get("date"), "isoformat"):
                            item["date"] = item["date"].isoformat()
                        serialized.append(item)
                    rows.extend(reversed(serialized))
            if rows:
                result[str(requirement.get("id") or "kline")] = rows
                for source_id in requirement.get("sourceIds") or []:
                    result[str(source_id)] = rows
        return result

    @staticmethod
    def _execute_builtin(package: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        module_name, function_name = str(package.get("entrypoint") or "").partition(":")[::2]
        if not module_name.startswith("src.strategy_kernels.") or function_name != "run":
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_ENTRYPOINT_INVALID", "内置内核入口不受信任。", 409)
        function = getattr(importlib.import_module(module_name), function_name, None)
        if not callable(function):
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_ENTRYPOINT_INVALID", "内置内核入口不存在。", 500)
        return function(context)

    def _execute_uploaded(self, package: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        from src.services.member_service import current_member
        if current_member():
            raise StrategyKernelExecutionError('ADMIN_REQUIRED', 'Uploaded executable packages require administrator access.', 403)
        archive_path = self._archive_path(str(package.get("sha256") or ""))
        if not archive_path.exists():
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_ARCHIVE_MISSING", "策略内核归档不存在。", 409)
        with tempfile.TemporaryDirectory(prefix="strategy-kernel-") as temporary:
            target = Path(temporary).resolve()
            with zipfile.ZipFile(archive_path) as archive:
                self._safe_extract(archive, target)
            package_dir = self._package_root(target)
            command = [str(Path(sys.executable).resolve()), "-I", str(Path(__file__).with_name("strategy_kernel_worker.py")), str(package_dir)]
            try:
                completed = subprocess.run(
                    command,
                    input=json.dumps(context, ensure_ascii=False, allow_nan=False),
                    text=True,
                    capture_output=True,
                    timeout=self.TIMEOUT_SECONDS,
                    env={"PATH": os.environ.get("PATH", "")},
                    cwd=package_dir,
                    preexec_fn=self._limits if os.name == "posix" else None,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise StrategyKernelExecutionError("STRATEGY_KERNEL_TIMEOUT", "策略函数执行超时。", 408) from exc
            if completed.returncode != 0:
                diagnostic = (completed.stderr or completed.stdout or "").strip().splitlines()
                message = diagnostic[-1][:500] if diagnostic else f"策略函数执行失败（退出码 {completed.returncode}）。"
                raise StrategyKernelExecutionError("STRATEGY_KERNEL_EXECUTION_FAILED", message, 422)
            if len(completed.stdout.encode("utf-8")) > self.OUTPUT_LIMIT_BYTES:
                raise StrategyKernelExecutionError("STRATEGY_KERNEL_OUTPUT_TOO_LARGE", "策略函数输出超过 2 MB。", 422)
            try:
                return json.loads(completed.stdout)
            except json.JSONDecodeError as exc:
                raise StrategyKernelExecutionError("STRATEGY_KERNEL_OUTPUT_INVALID", "策略函数没有返回有效 JSON。", 422) from exc

    def _limits(self) -> None:
        limits = [
            (resource.RLIMIT_CPU, self.TIMEOUT_SECONDS),
            (resource.RLIMIT_FSIZE, self.OUTPUT_LIMIT_BYTES),
            (resource.RLIMIT_NOFILE, 32),
        ]
        if hasattr(resource, "RLIMIT_NPROC"):
            limits.append((resource.RLIMIT_NPROC, 1))
        # RLIMIT_AS includes the interpreter's mapped runtime on macOS and can
        # kill Python before user code starts. The restricted subprocess,
        # static source policy and remaining rlimits still apply on macOS;
        # Linux additionally keeps the address-space ceiling.
        if sys.platform != "darwin":
            limits.append((resource.RLIMIT_AS, self.MEMORY_LIMIT_BYTES))
        for limit, requested in limits:
            try:
                _soft, hard = resource.getrlimit(limit)
                value = requested if hard == resource.RLIM_INFINITY else min(requested, hard)
                resource.setrlimit(limit, (value, value))
            except (OSError, ValueError):
                # Some macOS/Python combinations expose a resource constant but
                # refuse to change it in preexec. Wall timeout and the remaining
                # accepted limits still apply.
                continue

    @staticmethod
    def _safe_extract(archive: zipfile.ZipFile, target: Path) -> None:
        for item in archive.infolist():
            destination = (target / item.filename).resolve()
            if target not in destination.parents and destination != target:
                raise StrategyKernelExecutionError("STRATEGY_PACKAGE_PATH_INVALID", "策略包包含不安全路径。", 422)
        archive.extractall(target)

    @staticmethod
    def _package_root(target: Path) -> Path:
        if (target / "strategy.py").exists():
            return target
        roots = [item for item in target.iterdir() if item.is_dir() and (item / "strategy.py").exists()]
        if len(roots) != 1:
            raise StrategyKernelExecutionError("STRATEGY_KERNEL_ARCHIVE_INVALID", "策略包中找不到唯一 strategy.py。", 422)
        return roots[0]

    @staticmethod
    def _archive_path(digest: str) -> Path:
        default_dir = Path(__file__).resolve().parents[2] / "data" / "strategy_packages"
        target_dir = Path(os.getenv("STRATEGY_PACKAGE_DIR", str(default_dir))).resolve()
        return target_dir / f"{digest}.zip"

    @staticmethod
    def _validate_schema(schema: Any, value: Any, code: str, label: str) -> None:
        if not isinstance(schema, dict):
            return
        try:
            validate_json_schema(value, schema)
        except ValidationError as exc:
            raise StrategyKernelExecutionError(code, f"{label}：{exc.message}", 422) from exc

    def _persist_run_result(self, run_id: int, result: dict[str, Any]) -> None:
        """Persist only the declared black-box output for a complete strategy."""
        from src.storage import SimulationRunRecord, utc_naive_now

        with self.definition.db.session_scope() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run:
                raise StrategyKernelExecutionError("RUN_NOT_FOUND", "运行记录不存在。", 404)
            run.status = "completed" if result.get("status") == "success" else "failed"
            run.result_snapshot_json = json.dumps(result, ensure_ascii=False, sort_keys=True)
            run.error_message = None if run.status == "completed" else str(result.get("message") or "策略函数返回失败")[:1000]
            run.completed_at = utc_naive_now()
