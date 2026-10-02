from __future__ import annotations

import io
import builtins
import importlib.util
import json
import os
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import yaml

from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.services.strategy_package_service import StrategyPackageService
from src.services.strategy_kernel_executor_service import StrategyKernelExecutionError, StrategyKernelExecutorService
from src.strategy_kernels import research_decision
from src.storage import DatabaseManager


def package_bytes(name: str = "均值回归策略", source: str | None = None) -> bytes:
    manifest = {
        "strategyId": "mean-reversion",
        "name": name,
        "version": "1.0.0",
        "purpose": "trading_decision",
        "runtime": "python",
        "entrypoint": "strategy:run",
        "markets": ["cn", "hk"],
        "configurable": {"markets": ["cn", "hk"], "timeframes": ["1d", "1w"], "runIntervals": ["1d"]},
        "inputs": {"schema": "schemas/input.json"},
        "outputs": {"contract": "DecisionProposal", "schema": "schemas/output.json"},
        "documentation": {"file": "STRATEGY.md"},
        "dataRequirements": [{
            "id": "primary_ohlcv",
            "type": "market.ohlcv",
            "kind": "kline",
            "sourceIds": ["system_market_data"],
            "markets": ["cn", "hk"],
            "frequency": "1d",
            "lookback": 120,
            "required": True,
            "usage": "计算均线与信号",
            "onMissing": "fail",
        }],
        "parameters": [{"name": "lookback_days", "type": "integer", "default": 20, "minimum": 5, "maximum": 120, "description": "均线窗口"}],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("strategy.yaml", yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False))
        archive.writestr("strategy.py", source or "def run(context):\n    return {'status': 'success', 'contract': 'DecisionProposal', 'result': {'action': 'WATCH'}, 'dataCoverage': context.get('dataCoverage', {}), 'warnings': context.get('warnings', [])}\n")
        archive.writestr("STRATEGY.md", "# 均值回归策略\n\n使用历史 K 线计算均值偏离并产生研究决策提案。\n\n| primary_ohlcv | system_market_data | 必需 | 缺失时停止 |\n")
        archive.writestr("README.md", "# Development\n")
        archive.writestr("schemas/input.json", json.dumps({"type": "object", "properties": {}}))
        archive.writestr("schemas/output.json", json.dumps({"type": "object", "required": ["status", "contract", "dataCoverage", "warnings"], "properties": {"status": {"type": "string"}, "contract": {"const": "DecisionProposal"}, "dataCoverage": {"type": "object"}, "warnings": {"type": "array"}}}))
        archive.writestr("tests/test_strategy.py", "def test_placeholder():\n    assert True\n")
        archive.writestr("requirements.lock", "# no third-party dependencies\n")
    return buffer.getvalue()


class StrategyPackageServiceTest(unittest.TestCase):
    def setUp(self):
        self.database_path = tempfile.mktemp(suffix=".sqlite")
        self.package_dir = tempfile.mkdtemp()
        DatabaseManager.reset_instance()
        definition = StrategyDefinitionService(DatabaseManager(f"sqlite:///{self.database_path}"))
        self.service = StrategyPackageService(definition)
        self.environment = patch.dict(os.environ, {"STRATEGY_PACKAGE_DIR": self.package_dir})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        DatabaseManager.reset_instance()
        if os.path.exists(self.database_path):
            os.unlink(self.database_path)
        for filename in os.listdir(self.package_dir):
            os.unlink(os.path.join(self.package_dir, filename))
        os.rmdir(self.package_dir)

    def test_intake_creates_a_reusable_kernel_then_an_independent_configuration_draft(self):
        result = self.service.intake("mean-reversion.zip", package_bytes())

        self.assertEqual(result["draft"]["strategyPurpose"], "trading_decision")
        self.assertEqual(result["draft"]["productRole"], "kernel")
        self.assertEqual(result["draft"]["outputContract"], "DecisionProposal")
        self.assertEqual(result["package"]["kind"], "uploaded_package")
        self.assertEqual(result["package"]["executionStatus"], "ready")
        self.assertEqual(result["draft"]["timeHorizon"], "1d")
        self.assertEqual(result["draft"]["decisionPolicy"]["packageParameters"]["lookback_days"], 20)
        self.assertEqual(result["draft"]["dataPermissionSnapshot"]["kline"]["connection"], "system_market_data")
        self.assertEqual(len(os.listdir(self.package_dir)), 1)

        configured = self.service.definition.create_strategy({
            "name": "均值回归 · A股日线配置",
            "description": "独立运行配置",
            "kernelVersionId": result["draft"]["id"],
        })
        draft = configured["draft"]
        self.assertEqual(draft["productRole"], "configured")
        self.assertEqual(draft["kernelVersionId"], result["draft"]["id"])
        self.assertEqual(draft["strategyPackage"]["sha256"], result["package"]["sha256"])
        saved = self.service.definition.save_draft(draft["id"], {
            "revision": draft["revision"],
            "strategy": {"name": configured["strategy"]["name"]},
            "version": {
                "objective": draft["objective"],
                "strategyPurpose": draft["strategyPurpose"],
                "marketScope": draft["marketScope"],
                "timeHorizon": draft["timeHorizon"],
                "decisionPolicy": draft["decisionPolicy"],
                "riskPolicy": {"decision_validity": {"max": "1d"}},
                "memoryPolicy": draft["memoryPolicy"],
                "dataPermissionSnapshot": draft["dataPermissionSnapshot"],
                "screeningPolicy": draft["screeningPolicy"],
            },
            "agents": [],
            "connections": [],
        })
        check = self.service.definition.validate(saved["draftId"])
        self.assertTrue(check["valid"])
        self.assertNotIn("STRATEGY_PACKAGE_EXECUTOR_PENDING", [item["code"] for item in check["warnings"]])
        self.assertEqual(saved["draft"]["strategyPackage"]["sha256"], result["package"]["sha256"])

        executed = StrategyKernelExecutorService(self.service.definition).execute(result["draft"]["id"], {
            "inputs": {},
            "data": {"primary_ohlcv": [{"date": "2026-01-01", "close": 10.0}]},
        })
        self.assertEqual(executed["status"], "success")
        self.assertEqual(executed["contract"], "DecisionProposal")

    def test_frozen_uploaded_execution_reports_runtime_boundary_without_spawning(self):
        result = self.service.intake("mean-reversion.zip", package_bytes())
        with patch.object(sys, "frozen", True, create=True), patch("subprocess.run") as spawn:
            with self.assertRaises(StrategyKernelExecutionError) as rejected:
                StrategyKernelExecutorService(self.service.definition).execute(result["draft"]["id"], {
                    "inputs": {},
                    "data": {"primary_ohlcv": [{"date": "2026-01-01", "close": 10.0}]},
                })
        self.assertEqual(rejected.exception.code, "STRATEGY_KERNEL_RUNTIME_UNSUPPORTED")
        spawn.assert_not_called()

    def test_executor_module_loads_without_posix_resource_module(self):
        from src.services import strategy_kernel_executor_service

        import_module = builtins.__import__

        def no_resource(name, *args, **kwargs):
            if name == "resource":
                raise ModuleNotFoundError("No module named 'resource'")
            return import_module(name, *args, **kwargs)

        spec = importlib.util.spec_from_file_location(
            "executor_without_posix_resource", strategy_kernel_executor_service.__file__,
        )
        module = importlib.util.module_from_spec(spec)
        with patch("builtins.__import__", side_effect=no_resource):
            spec.loader.exec_module(module)
        self.assertTrue(callable(module.StrategyKernelExecutorService.execute))

    def test_intake_rejects_path_traversal(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../strategy.yaml", "name: unsafe")
        with self.assertRaises(StrategyDefinitionError) as rejected:
            self.service.intake("unsafe.zip", buffer.getvalue())
        self.assertEqual(rejected.exception.code, "STRATEGY_PACKAGE_PATH_INVALID")

    def test_intake_rejects_python_that_can_escape_the_context_boundary(self):
        with self.assertRaises(StrategyDefinitionError) as rejected:
            self.service.intake(
                "unsafe.zip",
                package_bytes(source="import os\ndef run(context):\n    return {'status': 'success'}\n"),
            )
        self.assertEqual(rejected.exception.code, "STRATEGY_PACKAGE_IMPORT_UNSUPPORTED")

    def test_intake_rejects_top_level_execution_and_runtime_reflection(self):
        unsafe_sources = [
            "print('side effect')\ndef run(context):\n    return {}\n",
            "def run(context):\n    return getattr(context, '__class__')\n",
        ]
        for source in unsafe_sources:
            with self.subTest(source=source.splitlines()[0]):
                with self.assertRaises(StrategyDefinitionError) as rejected:
                    self.service.intake("unsafe.zip", package_bytes(source=source))
                self.assertEqual(rejected.exception.code, "STRATEGY_PACKAGE_PYTHON_UNSAFE")

    def test_builtin_research_decision_exposes_only_the_strategy_contract(self):
        historical_snapshot = {
            "agentRuns": [
                {"agentName": "analysis", "output": {"summary": "internal analysis"}},
                {"agentName": "decision", "output": {"action": "WATCH", "confidence": 72}},
            ],
        }
        with patch("src.services.strategy_graph_runtime_service.StrategyGraphRuntimeService.execute"), patch(
            "src.services.strategy_definition_service.StrategyDefinitionService.get_published_run",
            return_value={"status": "completed", "resultSnapshot": historical_snapshot},
        ):
            result = research_decision.run({
                "strategyId": 7,
                "strategyVersion": 3,
                "_runtime": {"publishedRunId": 44, "database": self.service.definition.db},
            })

        self.assertEqual(result["contract"], "DecisionProposal")
        self.assertEqual(result["result"], {"action": "WATCH", "confidence": 72})
        self.assertNotIn("agentRuns", json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
