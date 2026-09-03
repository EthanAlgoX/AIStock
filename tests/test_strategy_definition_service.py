from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from api.v1.schemas.simulation import StrategyPublishRequest
from src.storage import DatabaseManager, LLMUsage, SimulationStrategyRecord, SimulationStrategyVersionRecord, StockDaily
from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.services.agent_center_service import AgentCenterService
from src.services.strategy_graph_runtime_service import StrategyGraphRuntimeService
from src.services.strategy_screening_runtime_service import StrategyScreeningRuntimeService
from src.services.strategy_continuous_run_service import StrategyContinuousRunService
from src.services.simulation_strategy_service import SimulationStrategyService
from src.services.strategy_validation_service import StrategyValidationError, StrategyValidationService


def agent(identifier: str, kind: str, lineage: str) -> dict:
    return {"id": identifier, "lineageId": lineage, "agentType": kind, "name": identifier,
            "role": "structured role", "systemPrompt": "safe prompt", "promptTemplate": "",
            "modelProfileId": None if kind == "INPUT" else "test-model",
            "executionMode": "DETERMINISTIC" if kind == "INPUT" else "LLM",
            "toolPermissions": [], "dataPermissions": [], "inputSchema": {"type": "object", "properties": {"input": {"type": "string"}}},
            "outputSchema": {"type": "object", "properties": {"output": {"type": "string"}}}, "timeoutSeconds": 30, "maxRetries": 0,
            "required": True, "failurePolicy": "STOP_RUN", "costLimit": "0.100000", "positionX": 0, "positionY": 0}


class StrategyDefinitionServiceTest(unittest.TestCase):
    def setUp(self):
        self.path = tempfile.mktemp(suffix=".sqlite")
        DatabaseManager.reset_instance()
        self.service = StrategyDefinitionService(DatabaseManager(f"sqlite:///{self.path}"))
        self.validation = StrategyValidationService(self.service.db)
        self.agent_center = AgentCenterService(self.service.db)
        self.agent_center.list_workflows()
        self.trading_workflow_version_id = self._publish_workflow(
            "测试交易决策工作流",
            [agent("analysis", "ANALYSIS", "workflow-analysis"), agent("decision", "DECISION", "workflow-decision")],
            [{"sourceAgentId": "analysis", "targetAgentId": "decision", "connectionType": "DATA_FLOW"}],
        )
        with self.service.db.session_scope() as session:
            for offset in range(65):
                current = date(2024, 1, 1) + timedelta(days=offset)
                for code, base, slope in (("600519", 10.0, 0.05), ("000001", 15.0, 0.03)):
                    close = base + slope * offset
                    session.add(StockDaily(code=code, date=current, open=close - 0.01, high=close + 0.1,
                                           low=close - 0.1, close=close, volume=1_000_000,
                                           amount=close * 1_000_000, data_source="strategy-definition-test"))

    def tearDown(self):
        DatabaseManager.reset_instance()
        if os.path.exists(self.path): os.unlink(self.path)

    def _publish_workflow(self, name: str, agents: list[dict], connections: list[dict]) -> int:
        created = self.agent_center.create_workflow({"name": name})
        saved = self.agent_center.save_workflow_draft(created["draft"]["id"], {
            "revision": created["draft"]["revision"],
            "workflow": {"name": name},
            "agents": agents,
            "connections": connections,
        })
        published = self.agent_center.publish_workflow(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "测试冻结工作流",
            "idempotencyKey": f"publish-{name}",
        })
        return published["id"]

    def _save_valid(self, with_historical_validation: bool = True):
        created = self.service.create_strategy({"name": "策略 A"}); draft = created["draft"]
        payload = {"revision": draft["revision"], "strategy": {"name": "策略 A"},
                   "version": {"agentWorkflowVersionId": self.trading_workflow_version_id, "marketScope": {"universeMode": "fixed", "symbols": ["600519", "000001"]}, "riskPolicy": {"decision_validity": {"max": "1d"}}, "dataPermissionSnapshot": {"schemaVersion": 1, "kline": {"enabled": True, "connection": "local_stock_daily", "timeframe": "1d"}}},
                   "agents": [agent("analysis", "ANALYSIS", "lineage-analysis"), agent("decision", "DECISION", "lineage-decision")],
                   "connections": [{"sourceAgentId": "analysis", "targetAgentId": "decision", "connectionType": "DATA_FLOW"}]}
        saved = self.service.save_draft(draft["id"], payload)
        if with_historical_validation:
            saved["validationExperimentId"] = self._historically_validate(saved["draftId"])
        return created, saved

    def _historically_validate(self, version_id: int) -> int:
        experiment = self.validation.create_experiment({
            "strategyVersionId": version_id,
            "idempotencyKey": f"definition-validation-{version_id}",
            "config": {"startDate": "2024-01-22", "endDate": "2024-03-01", "market": "cn",
                       "universeMode": "strategy", "experimentPurpose": "validation", "symbols": [], "rebalanceFrequency": "weekly"},
        })
        return self.validation.execute_experiment(experiment["id"])["id"]

    def test_create_save_validate_publish_copy_and_diff(self):
        created, saved = self._save_valid()
        check = self.service.validate(saved["draftId"])
        self.assertTrue(check["valid"])
        with self.assertRaises(StrategyDefinitionError) as conflict:
            self.service.save_draft(saved["draftId"], {"revision": 1, "agents": [], "connections": []})
        self.assertEqual(conflict.exception.code, "VERSION_CONFLICT")
        published = self.service.publish(saved["draftId"], {"revision": saved["revision"], "changeLog": "initial", "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "test-key-123", "validationExperimentId": saved["validationExperimentId"]})
        self.assertEqual(published["versionNumber"], 1)
        again = self.service.publish(saved["draftId"], {"revision": saved["revision"], "changeLog": "initial", "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "test-key-123", "validationExperimentId": saved["validationExperimentId"]})
        self.assertEqual(again["publishedVersionId"], published["publishedVersionId"])
        with self.assertRaises(StrategyDefinitionError) as immutable:
            self.service.save_draft(saved["draftId"], {"revision": saved["revision"], "agents": [], "connections": []})
        self.assertEqual(immutable.exception.code, "VERSION_IMMUTABLE")
        draft = self.service.create_draft(created["strategy"]["id"], published["publishedVersionId"])
        self.assertNotEqual(draft["agents"][0]["id"], saved["draft"]["agents"][0]["id"])
        self.assertEqual(draft["agents"][0]["lineageId"], saved["draft"]["agents"][0]["lineageId"])
        self.assertEqual(self.service.diff(draft["id"], published["publishedVersionId"])["summary"]["agentsAdded"], 0)
        self.assertGreaterEqual(len(self.service.list_audit(created["strategy"]["id"])), 4)

    def test_publish_allows_historical_validation_to_be_skipped(self):
        request = StrategyPublishRequest(
            revision=2,
            changeLog="publish without optional backtest",
            acknowledgedWarningCodes=["NO_REFLECTION_AGENT"],
            idempotencyKey="optional-backtest-publish",
        )
        self.assertIsNone(request.validationExperimentId)
        created, saved = self._save_valid(with_historical_validation=False)

        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "publish without optional backtest",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"],
            "idempotencyKey": "optional-backtest-publish",
        })

        self.assertEqual(published["versionNumber"], 1)
        detail = self.service.get_strategy(created["strategy"]["id"])
        self.assertEqual(detail["lifecycleStatus"], "published")

    def test_research_report_strategy_persists_its_output_contract_and_stays_out_of_trading_runtime(self):
        report_workflow_version_id = self._publish_workflow(
            "测试单股研究报告工作流",
            [agent("analysis", "ANALYSIS", "research-analysis")],
            [],
        )
        created = self.service.create_strategy({"name": "单股研究报告策略"})
        draft = created["draft"]
        saved = self.service.save_draft(draft["id"], {
            "revision": draft["revision"],
            "strategy": {"name": "单股研究报告策略"},
            "version": {
                "strategyPurpose": "research_report",
                "agentWorkflowVersionId": report_workflow_version_id,
                "marketScope": {"universeMode": "runtime_symbol"},
                "dataPermissionSnapshot": {"kline": {"enabled": True, "connection": "system_market_data"}},
            },
            "agents": [agent("analysis", "ANALYSIS", "research-analysis")],
            "connections": [],
        })
        self.assertEqual(saved["draft"]["strategyPurpose"], "research_report")
        self.assertEqual(saved["draft"]["outputContract"], "ResearchReport")
        self.assertTrue(self.service.validate(saved["draftId"])["valid"])
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "发布报告策略",
            "acknowledgedWarningCodes": [],
            "idempotencyKey": "publish-research-report",
        })
        self.assertEqual(published["publishedVersionId"], saved["draftId"])
        summary = self.service.get_strategy(created["strategy"]["id"])
        self.assertEqual(summary["currentStrategyPurpose"], "research_report")
        self.assertEqual(summary["currentOutputContract"], "ResearchReport")
        self.assertNotIn(saved["draftId"], {item["versionId"] for item in self.service.list_runnable_versions()})
        with self.assertRaises(StrategyDefinitionError) as unsupported:
            self.service.create_automatic_run_batch({"strategyVersionId": saved["draftId"]}, enqueue=False)
        self.assertEqual(unsupported.exception.code, "RUN_STRATEGY_PURPOSE_UNSUPPORTED")
        with self.assertRaises(StrategyValidationError) as invalid_backtest:
            self.validation.create_experiment({
                "strategyVersionId": saved["draftId"],
                "idempotencyKey": "research-report-backtest",
                "config": {"startDate": "2024-01-22", "endDate": "2024-03-01", "market": "cn"},
            })
        self.assertEqual(invalid_backtest.exception.code, "VALIDATION_STRATEGY_PURPOSE_UNSUPPORTED")

    def test_daily_product_presets_are_published_workflow_bound_and_idempotent(self):
        first = self.service.ensure_daily_product_strategies()
        second = self.service.ensure_daily_product_strategies()

        self.assertEqual(len(first), 3)
        self.assertEqual({item["id"] for item in first}, {item["id"] for item in second})
        self.assertEqual(
            {
                "单股研究策略": ("research_report", "ResearchReport"),
                "多因子选股策略": ("candidate_screening", "CandidateList"),
                "研究决策基线": ("trading_decision", "DecisionProposal"),
            },
            {
                item["name"]: (item["currentStrategyPurpose"], item["currentOutputContract"])
                for item in first
            },
        )

        explanations = {item["name"]: item["currentObjective"] for item in first}
        self.assertIn("综合研究报告", explanations["单股研究策略"])
        self.assertIn("候选清单", explanations["多因子选股策略"])
        self.assertIn("DecisionProposal", explanations["研究决策基线"])

        by_name = {item["name"]: item for item in first}
        research = self.service.get_version(by_name["单股研究策略"]["currentPublishedVersionId"])
        screening = self.service.get_version(by_name["多因子选股策略"]["currentPublishedVersionId"])
        trading = self.service.get_version(by_name["研究决策基线"]["currentPublishedVersionId"])

        self.assertEqual(research["status"], "PUBLISHED")
        self.assertTrue(research["immutable"])
        self.assertEqual(research["marketScope"]["universeMode"], "runtime_symbol")
        self.assertEqual(research["decisionPolicy"]["executorProfile"], "daily_stock_analysis")
        self.assertIn("technical_trend", research["decisionPolicy"]["evidenceModules"])
        self.assertEqual(research["strategyPackage"]["kind"], "builtin_python")
        self.assertEqual(research["strategyPackage"]["executionStatus"], "ready")
        self.assertEqual(research["strategyPackage"]["entrypoint"], "src.strategy_kernels.single_stock_research:run")
        self.assertTrue(all(not item["required"] for item in research["strategyPackage"]["dataRequirements"]))
        self.assertEqual(
            {item["id"] for item in research["strategyPackage"]["dataRequirements"]},
            {"historical_ohlcv", "fundamentals", "news"},
        )
        self.assertIn("system_market_data", research["strategyPackage"]["documentation"])
        self.assertEqual([item["executionMode"] for item in research["agents"]], ["DETERMINISTIC", "LLM"])
        self.assertTrue(self.service.validate(research["id"])["valid"])

        self.assertEqual(screening["status"], "PUBLISHED")
        self.assertTrue(screening["immutable"])
        self.assertEqual(screening["marketScope"]["universeMode"], "screening")
        self.assertEqual(screening["screeningPolicy"], {"strategy": "dual_low", "market": "cn", "maxCandidates": 3})
        self.assertEqual(screening["decisionPolicy"]["llmFailureFallback"], "screen_score")
        self.assertEqual(screening["agents"][0]["executionMode"], "HYBRID")
        self.assertEqual(screening["strategyPackage"]["entrypoint"], "src.strategy_kernels.stock_screening:run")
        screening_requirements = {
            item["id"]: item for item in screening["strategyPackage"]["dataRequirements"]
        }
        self.assertTrue(screening_requirements["market_snapshot"]["required"])
        self.assertFalse(screening_requirements["daily_ohlcv"]["required"])
        self.assertNotIn("sentiment", screening_requirements)
        self.assertTrue(self.service.validate(screening["id"])["valid"])

        self.assertEqual(trading["status"], "PUBLISHED")
        self.assertTrue(trading["immutable"])
        self.assertEqual(trading["screeningPolicy"]["strategy"], "dual_low")
        self.assertEqual(trading["decisionPolicy"]["executionBoundary"], "research_only")
        self.assertEqual(trading["riskPolicy"]["decision_validity"]["max"], "1d")
        self.assertEqual(trading["strategyPackage"]["entrypoint"], "src.strategy_kernels.research_decision:run")
        trading_requirements = {
            item["id"]: item for item in trading["strategyPackage"]["dataRequirements"]
        }
        self.assertTrue(trading_requirements["candidate_market_data"]["required"])
        self.assertNotIn("historical_ohlcv", trading_requirements)
        self.assertNotIn("sentiment", trading_requirements)
        self.assertEqual(trading["dataPermissionSnapshot"]["other"], {"enabled": False, "sourceIds": []})
        self.assertTrue(self.service.validate(trading["id"])["valid"])
        self.assertTrue(all(item["isBuiltIn"] for item in first))
        self.assertTrue(all(item["sourceSystem"] == "daily_stock_analysis" for item in first))
        self.assertTrue(all(item["productRole"] == "kernel" for item in first))
        self.assertEqual(
            {item["kernelVersionId"] for item in first},
            {item["currentPublishedVersionId"] for item in first},
        )
        with self.assertRaisesRegex(ValueError, "策略内核不能直接持续运行"):
            StrategyContinuousRunService(self.service.db).start(research["id"], 300)

        self.assertNotEqual(research["agentWorkflowVersionId"], screening["agentWorkflowVersionId"])
        self.assertEqual(
            {item["name"] for item in self.service.list_strategies()},
            {
                "单股研究策略", "多因子选股策略", "研究决策基线",
                "单股研究 · A股配置", "多因子选股 · A股配置", "研究决策 · A股日线配置",
            },
        )
        complete = {
            item["name"]: item for item in self.service.list_strategies()
            if item["productRole"] == "configured"
        }
        self.assertEqual(set(complete), {"单股研究 · A股配置", "多因子选股 · A股配置", "研究决策 · A股日线配置"})
        self.assertTrue(all(item["lifecycleStatus"] == "published" for item in complete.values()))
        self.assertTrue(all(item["kernelExecutionStatus"] == "ready" for item in complete.values()))

        configured_trading = complete["研究决策 · A股日线配置"]
        self.assertTrue(configured_trading["backtestReadiness"]["ready"])
        self.assertEqual(configured_trading["backtestReadiness"]["symbolCount"], 2)
        configured_trading_version = self.service.get_version(
            configured_trading["currentPublishedVersionId"]
        )
        self.assertEqual(configured_trading_version["marketScope"]["universeMode"], "fixed")
        self.assertEqual(
            set(configured_trading_version["marketScope"]["symbols"]),
            {"600519", "000001"},
        )
        self.assertEqual(
            configured_trading_version["screeningPolicy"]["strategy"],
            "low_volatility_quality",
        )
        self.assertEqual(configured_trading_version["riskPolicy"]["max_position_pct"], 20)

        experiment = self.validation.create_experiment({
            "strategyVersionId": configured_trading_version["id"],
            "idempotencyKey": "starter-config-replay",
            "config": {
                "startDate": "2024-01-22",
                "endDate": "2024-03-01",
                "market": "cn",
                "universeMode": "strategy",
                "experimentPurpose": "validation",
                "symbols": [],
                "rebalanceFrequency": "weekly",
            },
        })
        self.assertEqual(experiment["status"], "queued")
        self.assertEqual(experiment["config"]["resolvedUniverseMode"], "strategy_fixed")
        self.assertEqual(set(experiment["config"]["symbols"]), {"600519", "000001"})

        before_refresh_version_id = configured_trading["currentPublishedVersionId"]
        self.service.ensure_daily_product_strategies()
        after_refresh = next(
            item for item in self.service.list_strategies()
            if item["name"] == "研究决策 · A股日线配置"
        )
        self.assertEqual(after_refresh["currentPublishedVersionId"], before_refresh_version_id)

    def test_kernel_creates_a_separate_configured_strategy_without_mutating_kernel(self):
        presets = self.service.ensure_daily_product_strategies()
        source_summary = next(item for item in presets if item["name"] == "研究决策基线")
        source_id = source_summary["currentPublishedVersionId"]
        source_before = self.service.get_version(source_id)

        created = self.service.create_strategy({
            "name": "研究决策 · 港股日线配置",
            "description": "独立运行配置",
            "kernelVersionId": source_id,
        })

        draft = created["draft"]
        self.assertEqual(draft["productRole"], "configured")
        self.assertEqual(draft["kernelVersionId"], source_id)
        self.assertEqual(draft["agentWorkflowVersionId"], source_before["agentWorkflowVersionId"])
        self.assertEqual(draft["strategyPurpose"], source_before["strategyPurpose"])
        self.assertEqual(self.service.get_version(source_id), source_before)

    def test_markerless_system_configuration_migrates_only_with_audit_proof(self):
        self.service.ensure_daily_product_strategies()
        configured = next(
            item for item in self.service.list_strategies()
            if item["name"] == "多因子选股 · A股配置"
        )
        old_version_id = configured["currentPublishedVersionId"]
        with self.service.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, old_version_id)
            config = self.service._load(version.config_json)
            config.pop("systemPresetConfiguration", None)
            config["strategyPackage"]["sha256"] = "legacy-system-package"
            version.config_json = self.service._dump(config)

        self.service.ensure_daily_product_strategies()

        migrated = next(
            item for item in self.service.list_strategies()
            if item["name"] == "多因子选股 · A股配置"
        )
        self.assertNotEqual(migrated["currentPublishedVersionId"], old_version_id)
        current = self.service.get_version(migrated["currentPublishedVersionId"])
        requirements = {item["id"]: item for item in current["strategyPackage"]["dataRequirements"]}
        self.assertFalse(requirements["daily_ohlcv"]["required"])
        self.assertEqual(current["kernelVersionId"], next(
            item["currentPublishedVersionId"]
            for item in self.service.list_strategies()
            if item["name"] == "多因子选股策略"
        ))

    def test_existing_dynamic_starter_trading_configuration_is_upgraded_to_fixed_replay_universe(self):
        self.service.ensure_daily_product_strategies()
        configured = next(
            item for item in self.service.list_strategies()
            if item["name"] == "研究决策 · A股日线配置"
        )
        old_version_id = configured["currentPublishedVersionId"]
        with self.service.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, old_version_id)
            config = self.service._load(version.config_json)
            config.pop("systemPresetConfigurationProfile", None)
            version.config_json = self.service._dump(config)
            version.market_scope_json = self.service._dump({"universeMode": "screening", "symbols": []})
            version.screening_policy_json = self.service._dump({"strategy": "dual_low", "market": "cn", "maxCandidates": 3})

        self.service.ensure_daily_product_strategies()

        upgraded = next(
            item for item in self.service.list_strategies()
            if item["name"] == "研究决策 · A股日线配置"
        )
        self.assertNotEqual(upgraded["currentPublishedVersionId"], old_version_id)
        self.assertTrue(upgraded["backtestReadiness"]["ready"])
        current = self.service.get_version(upgraded["currentPublishedVersionId"])
        self.assertEqual(current["marketScope"]["universeMode"], "fixed")
        self.assertEqual(set(current["marketScope"]["symbols"]), {"600519", "000001"})

    def test_same_named_user_configuration_is_not_claimed_without_system_audit(self):
        user_strategy = self.service.create_strategy({
            "name": "多因子选股 · A股配置",
            "description": "用户在系统预置前创建的同名策略",
        })

        self.service.ensure_daily_product_strategies()

        preserved = self.service.get_strategy(user_strategy["strategy"]["id"])
        self.assertEqual(preserved["lifecycleStatus"], "draft")
        self.assertIsNone(preserved["currentPublishedVersionId"])
        self.assertEqual(preserved["description"], "用户在系统预置前创建的同名策略")

    def test_published_strategy_can_be_copied_to_an_independent_draft(self):
        presets = self.service.ensure_daily_product_strategies()
        research = next(item for item in presets if item["name"] == "单股研究策略")
        source = self.service.get_version(research["currentPublishedVersionId"])

        copied = self.service.create_strategy({
            "name": "我的 Daily 单股研究",
            "description": "从系统默认策略复制",
            "basedOnVersionId": source["id"],
        })

        draft = copied["draft"]
        self.assertEqual(draft["status"], "DRAFT")
        self.assertEqual(draft["strategyPurpose"], "research_report")
        self.assertEqual(draft["outputContract"], "ResearchReport")
        self.assertEqual(draft["basedOnVersionId"], source["id"])
        self.assertEqual(draft["agentWorkflowVersionId"], source["agentWorkflowVersionId"])
        self.assertNotEqual(draft["agents"][0]["id"], source["agents"][0]["id"])
        self.assertTrue(self.service.validate(draft["id"])["valid"])
        self.assertFalse(copied["strategy"]["isBuiltIn"])

    def test_legacy_daily_strategy_names_are_migrated_without_creating_duplicates(self):
        presets = self.service.ensure_daily_product_strategies()
        research = next(item for item in presets if item["name"] == "单股研究策略")
        with self.service.db.session_scope() as session:
            strategy = session.get(SimulationStrategyRecord, research["id"])
            strategy.name = "Daily · 单股研究策略"

        migrated = self.service.ensure_daily_product_strategies()

        self.assertEqual(len(migrated), 3)
        self.assertIn("单股研究策略", {item["name"] for item in migrated})
        self.assertNotIn("Daily · 单股研究策略", {item["name"] for item in self.service.list_strategies()})

    def test_fixed_universe_check_requires_every_symbol_in_kline_input(self):
        _created, saved = self._save_valid(with_historical_validation=False)
        with self.service.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, saved["draftId"])
            version.market_scope_json = '{"universeMode":"fixed","symbols":["600519","300999"]}'
        checked = self.service.validate(saved["draftId"])
        self.assertFalse(checked["valid"])
        issue = next(item for item in checked["errors"] if item["code"] == "FIXED_UNIVERSE_INPUT_DATA_MISSING")
        self.assertIn("300999", issue["message"])
        self.assertNotIn("600519 不在", issue["message"])

    def test_unpublished_draft_can_be_deleted_without_confirmation(self):
        created = self.service.create_strategy({"name": "可直接删除的草稿"})
        strategy_id = created["strategy"]["id"]
        impact = self.service.get_deletion_impact(strategy_id)
        self.assertFalse(impact["hasPublishedVersion"])
        self.assertFalse(impact["isRunning"])
        self.assertFalse(impact["requiresConfirmation"])

        deleted = self.service.delete_strategy(strategy_id)
        self.assertTrue(deleted["deleted"])
        self.assertFalse(deleted["wasPublished"])
        self.assertTrue(deleted["historyRetained"])
        self.assertEqual(self.service.list_strategies(), [])
        archived = self.service.list_strategies(include_archived=True)
        self.assertEqual(archived[0]["lifecycleStatus"], "deleted")

    def test_published_strategy_requires_explicit_delete_confirmation(self):
        created, saved = self._save_valid()
        self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "publish before delete",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"],
            "idempotencyKey": "published-delete-confirmation",
            "validationExperimentId": saved["validationExperimentId"],
        })
        strategy_id = created["strategy"]["id"]
        impact = self.service.get_deletion_impact(strategy_id)
        self.assertTrue(impact["hasPublishedVersion"])
        self.assertTrue(impact["requiresConfirmation"])
        with self.assertRaises(StrategyDefinitionError) as required:
            self.service.delete_strategy(strategy_id)
        self.assertEqual(required.exception.code, "STRATEGY_DELETE_CONFIRMATION_REQUIRED")
        self.assertIsNone(self.service.get_strategy(strategy_id)["archivedAt"])

        deleted = self.service.delete_strategy(strategy_id, confirmed=True)
        self.assertTrue(deleted["wasPublished"])
        self.assertEqual(self.service.list_strategies(), [])

    def test_deleting_running_strategy_terminates_controls_and_cancels_active_research(self):
        created, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "running before delete",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"],
            "idempotencyKey": "running-delete-confirmation",
            "validationExperimentId": saved["validationExperimentId"],
        })
        version_id = published["publishedVersionId"]
        controller = StrategyContinuousRunService(self.service.db)
        with patch.object(controller, "_ensure_worker"):
            control = controller.start(version_id, 300)
        batch = self.service.create_automatic_run_batch({"strategyVersionId": version_id}, enqueue=False)
        run = self.service.create_published_run({
            "strategyVersionId": version_id, "inputSnapshot": {"stockCode": "600519"},
        })

        impact = self.service.get_deletion_impact(created["strategy"]["id"])
        self.assertTrue(impact["isRunning"])
        self.assertEqual(impact["activeContinuousRunCount"], 1)
        self.assertEqual(impact["activeResearchRunCount"], 2)
        deleted = self.service.delete_strategy(created["strategy"]["id"], confirmed=True)
        self.assertEqual(deleted["terminatedContinuousRuns"], 1)
        self.assertEqual(deleted["cancelledResearchRuns"], 2)
        self.assertEqual(controller.list_controls()[0]["status"], "terminated")
        self.assertEqual(self.service.get_automatic_run_batch(batch["id"])["status"], "cancelled")
        self.assertEqual(self.service.get_published_run(run["id"])["status"], "cancelled")

    def test_database_templates_and_conflict_preview(self):
        templates = self.service.list_agent_templates()
        self.assertGreaterEqual(len(templates), 3)
        self.assertNotIn("INPUT", {item["agentType"] for item in templates})
        detail = self.service.get_agent_template(templates[0]["templateId"])
        self.assertEqual(detail["templateVersion"], 2)
        created, saved = self._save_valid()
        preview = self.service.diff_preview(saved["draftId"], {"localDraft": {"agents": [
            {**saved["draft"]["agents"][0], "name": "changed locally"},
            *saved["draft"]["agents"][1:],
        ]}})
        self.assertTrue(any(item["category"] == "AGENT_NAME_CHANGED" for item in preview["changes"]))
        from_template = self.service.create_strategy({"name": "模板复制", "templateId": "trend-breakout"})
        self.assertEqual(len(from_template["draft"]["agents"]), 4)
        self.assertEqual(len(from_template["draft"]["connections"]), 3)
        self.assertNotIn("INPUT", {item["agentType"] for item in from_template["draft"]["agents"]})
        self.assertTrue(from_template["draft"]["dataPermissionSnapshot"]["kline"]["enabled"])
        self.assertTrue(from_template["draft"]["dataPermissionSnapshot"]["news"]["enabled"])
        self.assertTrue(from_template["draft"]["dataPermissionSnapshot"]["fundamentals"]["enabled"])
        self.assertEqual(from_template["draft"]["dataPermissionSnapshot"]["other"]["sourceIds"], [])
        reflection = next(item for item in from_template["draft"]["agents"] if item["agentType"] == "REFLECTION")
        reflection_edge = next(item for item in from_template["draft"]["connections"] if item["targetAgentId"] == reflection["id"])
        self.assertEqual(reflection_edge["connectionType"], "POST_RUN_CONTEXT")

    def test_data_source_catalog_combines_system_defaults_and_persisted_custom_entries(self):
        defaults = self.service.list_data_sources()
        self.assertTrue({"system_market_data", "system_news", "system_fundamentals", "system_macro_data"}.issubset({item["sourceId"] for item in defaults}))
        provider_ids = {item["sourceId"] for item in defaults if item.get("selectionMode") == "provider"}
        self.assertTrue({"kline:akshare", "kline:yfinance", "news:finance_rss", "news:searxng", "fundamentals:akshare"}.issubset(provider_ids))
        self.assertIn("kline:hithink_finance", provider_ids)
        self.assertTrue({"macro:fred", "macro:apocdata", "macro:yfinance"}.issubset(provider_ids))
        akshare = next(item for item in defaults if item["sourceId"] == "kline:akshare")
        self.assertTrue(akshare["selectable"])
        self.assertEqual(akshare["accessMode"], "no_credential")
        self.assertTrue(akshare["setupUrl"].startswith("https://"))
        tushare = next(item for item in defaults if item["sourceId"] == "kline:tushare")
        self.assertEqual(tushare["accessMode"], "token")
        self.assertEqual(tushare["configurationKeys"], ["TUSHARE_TOKEN"])
        searxng = next(item for item in defaults if item["sourceId"] == "news:searxng")
        self.assertEqual(searxng["accessMode"], "base_url")
        self.assertEqual(searxng["configurationKeys"], ["SEARXNG_BASE_URLS"])
        finance_rss = next(item for item in defaults if item["sourceId"] == "news:finance_rss")
        self.assertTrue(finance_rss["selectable"])
        self.assertEqual(finance_rss["providerName"], "FinanceRSS")
        included_sources = finance_rss["includedSources"]
        self.assertEqual(len(included_sources), 13)
        self.assertEqual(len({item["id"] for item in included_sources}), 13)
        self.assertTrue({"Reuters Business", "CNBC", "SEC", "Federal Reserve", "金十数据"}.issubset(
            {item["name"] for item in included_sources}
        ))
        self.assertTrue(all(str(item["websiteUrl"]).startswith("https://") for item in included_sources))
        self.assertEqual(next(item for item in defaults if item["sourceId"] == "system_market_data")["selectionMode"], "automatic")
        self.assertFalse(next(item for item in defaults if item["sourceId"] == "system_sentiment")["selectable"])
        created = self.service.create_data_source({
            "name": "行业景气度", "description": "行业周期输入", "connectionKey": "industry_cycle_v1",
            "setupUrl": "https://data.example.com/developers", "accessMode": "api_key",
            "kind": "other", "markets": ["cn", "hk"],
        })
        self.assertEqual(created["kind"], "other")
        self.assertEqual(created["markets"], ["cn", "hk"])
        self.assertEqual(created["availability"], "registered")
        self.assertEqual(created["setupUrl"], "https://data.example.com/developers")
        self.assertEqual(created["accessMode"], "api_key")
        self.assertIn(created["sourceId"], {item["sourceId"] for item in self.service.list_data_sources()})
        archived = self.service.archive_data_source(created["id"])
        self.assertTrue(archived["archived"])
        self.assertNotIn(created["sourceId"], {item["sourceId"] for item in self.service.list_data_sources()})

    def test_data_source_registration_requires_a_supported_market(self):
        with self.assertRaises(StrategyDefinitionError) as missing:
            self.service.create_data_source({
                "name": "未标注行情", "connectionKey": "unmarked_market_data", "kind": "kline", "markets": [],
            })
        self.assertEqual(missing.exception.code, "DATA_SOURCE_MARKETS_INVALID")
        with self.assertRaises(StrategyDefinitionError) as unknown:
            self.service.create_data_source({
                "name": "未知市场行情", "connectionKey": "unknown_market_data", "kind": "kline", "markets": ["eu"],
            })
        self.assertEqual(unknown.exception.code, "DATA_SOURCE_MARKETS_INVALID")

    def test_strategy_check_rejects_a_custom_source_from_another_market(self):
        custom = self.service.create_data_source({
            "name": "港股专用日线", "connectionKey": "hk_daily_custom", "kind": "kline", "markets": ["hk"],
        })
        _created, saved = self._save_valid(with_historical_validation=False)
        draft = self.service.get_version(saved["draftId"])
        updated = self.service.save_draft(draft["id"], {
            "revision": draft["revision"],
            "version": {
                "dataPermissionSnapshot": {
                    "schemaVersion": 2,
                    "kline": {"enabled": True, "connection": custom["connectionKey"], "timeframe": "1d"},
                    "news": {"enabled": False, "connection": "system_news"},
                    "fundamentals": {"enabled": False, "connection": "system_fundamentals"},
                },
                "screeningPolicy": {"strategy": "dual_low", "market": "cn", "maxCandidates": 3},
            },
            "agents": draft["agents"],
            "connections": draft["connections"],
        })
        checked = self.service.validate(updated["draftId"])
        self.assertFalse(checked["valid"])
        self.assertIn("DATA_SOURCE_MARKET_UNSUPPORTED", {item["code"] for item in checked["errors"]})

    def test_strategy_check_rejects_a_provider_that_does_not_support_the_selected_market(self):
        _created, saved = self._save_valid(with_historical_validation=False)
        draft = self.service.get_version(saved["draftId"])
        updated = self.service.save_draft(draft["id"], {
            "revision": draft["revision"],
            "version": {
                "dataPermissionSnapshot": {
                    "schemaVersion": 2,
                    "kline": {"enabled": True, "connection": "kline:yfinance", "timeframe": "1d"},
                    "news": {"enabled": False, "connection": "system_news"},
                    "fundamentals": {"enabled": True, "connection": "fundamentals:akshare"},
                },
                "screeningPolicy": {"strategy": "dual_low", "market": "us", "maxCandidates": 3},
            },
            "agents": draft["agents"],
            "connections": draft["connections"],
        })
        checked = self.service.validate(updated["draftId"])
        self.assertFalse(checked["valid"])
        self.assertIn("DATA_SOURCE_MARKET_UNSUPPORTED", {item["code"] for item in checked["errors"]})

    def test_custom_data_source_rejects_urls_and_secrets(self):
        with self.assertRaises(StrategyDefinitionError) as invalid:
            self.service.create_data_source({
                "name": "不安全连接", "connectionKey": "https://user:secret@example.com",
                "kind": "kline", "markets": ["cn"],
            })
        self.assertEqual(invalid.exception.code, "DATA_SOURCE_CONNECTION_INVALID")
        with self.assertRaises(StrategyDefinitionError) as unsafe_setup:
            self.service.create_data_source({
                "name": "含凭据链接", "connectionKey": "private_docs_link",
                "setupUrl": "https://user:secret@example.com/docs", "accessMode": "api_key",
                "kind": "kline", "markets": ["cn"],
            })
        self.assertEqual(unsafe_setup.exception.code, "DATA_SOURCE_SETUP_URL_INVALID")
        with self.assertRaises(StrategyDefinitionError) as invalid_mode:
            self.service.create_data_source({
                "name": "错误认证形式", "connectionKey": "invalid_auth_mode",
                "setupUrl": "https://example.com/docs", "accessMode": "oauth_magic",
                "kind": "kline", "markets": ["cn"],
            })
        self.assertEqual(invalid_mode.exception.code, "DATA_SOURCE_ACCESS_MODE_INVALID")

    def test_every_official_strategy_template_creates_a_valid_draft(self):
        templates = SimulationStrategyService().list_templates()
        self.assertGreater(len(templates), 0)

        for index, template in enumerate(templates):
            with self.subTest(template_id=template["id"]):
                created = self.service.create_strategy({
                    "name": f"官方模板检查 {index}",
                    "templateId": template["id"],
                })
                draft = created["draft"]
                self.assertEqual(draft["riskPolicy"]["decision_validity"]["max"], "1d")
                validation = self.service.validate(draft["id"])
                self.assertTrue(validation["valid"], validation["errors"])

    def test_new_draft_migrates_legacy_input_agent_into_data_configuration(self):
        created = self.service.create_strategy({"name": "旧版输入节点策略"})
        draft = created["draft"]
        saved = self.service.save_draft(draft["id"], {
            "revision": draft["revision"],
            "strategy": {"name": "旧版输入节点策略"},
            "version": {"riskPolicy": {"decision_validity": {"max": "1d"}}},
            "agents": [
                agent("legacy-input", "INPUT", "legacy-input-lineage"),
                agent("analysis", "ANALYSIS", "legacy-analysis-lineage"),
                agent("decision", "DECISION", "legacy-decision-lineage"),
            ],
            "connections": [
                {"sourceAgentId": "legacy-input", "targetAgentId": "analysis", "connectionType": "DATA_FLOW"},
                {"sourceAgentId": "analysis", "targetAgentId": "decision", "connectionType": "DATA_FLOW"},
            ],
        })
        self.assertIn("AGENT_WORKFLOW_VERSION_REQUIRED", {
            item["code"] for item in self.service.validate(saved["draftId"])["errors"]
        })
        with self.service.db.session_scope() as session:
            legacy = session.get(SimulationStrategyVersionRecord, saved["draftId"])
            legacy.status = "PUBLISHED"
            legacy.immutable = True
            legacy.version_number = 1
            strategy = session.get(SimulationStrategyRecord, created["strategy"]["id"])
            strategy.active_draft_version_id = None
            strategy.current_published_version_id = legacy.id
            strategy.lifecycle_status = "published"

        migrated = self.service.create_draft(created["strategy"]["id"], saved["draftId"])

        self.assertNotIn("INPUT", {item["agentType"] for item in migrated["agents"]})
        self.assertEqual(len(migrated["connections"]), 1)
        self.assertTrue(migrated["dataPermissionSnapshot"]["kline"]["enabled"])
        rebound = self.service.save_draft(migrated["id"], {
            "revision": migrated["revision"],
            "strategy": {"name": "旧版输入节点策略"},
            "version": {"agentWorkflowVersionId": self.trading_workflow_version_id},
            "agents": migrated["agents"],
            "connections": migrated["connections"],
        })
        self.assertTrue(self.service.validate(rebound["draftId"])["valid"])

    def test_conflict_local_fork_rebuilds_agent_ids_and_lineage(self):
        created, saved = self._save_valid()
        local = saved["draft"]
        fork = self.service.fork_local(saved["draftId"], {
            "baseRevision": saved["revision"],
            "newStrategyName": "策略 A 本地副本",
            "newStrategyDescription": "conflict copy",
            "localDraft": local,
            "idempotencyKey": "fork-local-key-123",
        })
        copied = self.service.get_version(fork["newDraftVersionId"])
        self.assertNotEqual(fork["newStrategyId"], created["strategy"]["id"])
        self.assertEqual(len(copied["agents"]), len(local["agents"]))
        self.assertEqual(len(copied["connections"]), len(local["connections"]))
        self.assertTrue({agent["id"] for agent in copied["agents"]}.isdisjoint({agent["id"] for agent in local["agents"]}))
        self.assertTrue({agent["lineageId"] for agent in copied["agents"]}.isdisjoint({agent["lineageId"] for agent in local["agents"]}))
        again = self.service.fork_local(saved["draftId"], {
            "baseRevision": saved["revision"], "newStrategyName": "策略 A 本地副本", "newStrategyDescription": "conflict copy",
            "localDraft": local, "idempotencyKey": "fork-local-key-123",
        })
        self.assertTrue(again["idempotent"])

    def test_bound_workflow_prevents_field_mapping_drift(self):
        created, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {"revision": saved["revision"], "changeLog": "initial", "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "mapping-publish-123", "validationExperimentId": saved["validationExperimentId"]})
        draft = self.service.create_draft(created["strategy"]["id"], published["publishedVersionId"])
        payload = {"revision": draft["revision"], "strategy": {"name": "策略 A"}, "version": {"marketScope": draft["marketScope"], "riskPolicy": {"decision_validity": {"max": "1d"}}, "dataPermissionSnapshot": draft["dataPermissionSnapshot"]}, "agents": draft["agents"], "connections": [{**draft["connections"][0], "fieldMapping": {"summary": "summary"}}]}
        updated = self.service.save_draft(draft["id"], payload)
        diff = self.service.diff(updated["draftId"], published["publishedVersionId"])
        self.assertFalse(any(change["category"] == "CONNECTION_FIELD_MAPPING_CHANGED" for change in diff["changes"]))

    def test_only_published_versions_enter_run_center_and_runs_are_audited(self):
        created, saved = self._save_valid()
        with self.assertRaises(StrategyDefinitionError) as draft_error:
            self.service.create_published_run({"strategyVersionId": saved["draftId"], "inputSnapshot": {"stockCode": "600519"}})
        self.assertEqual(draft_error.exception.code, "RUN_PUBLISHED_VERSION_REQUIRED")

        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "initial",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "runtime-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })
        candidates = self.service.list_runnable_versions()
        self.assertEqual(candidates[0]["versionId"], published["publishedVersionId"])
        run = self.service.create_published_run({"strategyVersionId": published["publishedVersionId"], "inputSnapshot": {"stockCode": "600519"}})
        self.assertEqual(run["status"], "queued")
        self.assertEqual(run["inputSnapshot"]["stock_code"], "600519")

        with patch("src.services.strategy_definition_service.StrategyGraphRuntimeService.execute", return_value={"id": run["id"], "status": "completed"}):
            completed = self.service.execute_published_run(run["id"])
        self.assertEqual(completed["status"], "queued")
        audit_actions = [event["action"] for event in self.service.list_audit(created["strategy"]["id"])]
        self.assertIn("RUN_QUEUED", audit_actions)

    def test_published_run_executes_the_saved_agent_graph(self):
        _, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "initial",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "graph-runtime-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })
        run = self.service.create_published_run({"strategyVersionId": published["publishedVersionId"], "inputSnapshot": {"stockCode": "600519"}})

        class FakeResponse:
            provider = "test-provider"
            model = "test-model"
            content = "structured research output"
            usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}

        class FakeAdapter:
            def call_text(self, *_args, **_kwargs):
                return FakeResponse()

        StrategyGraphRuntimeService(self.service.db, adapter_factory=FakeAdapter).execute(run["id"])
        completed = self.service.get_published_run(run["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(completed["resultSnapshot"]["agentRuns"]), 2)
        self.assertEqual(completed["resultSnapshot"]["agentRuns"][0]["agentName"], "analysis")
        with self.service.db.get_session() as session:
            usage_rows = session.query(LLMUsage).filter(LLMUsage.strategy_run_id == run["id"]).all()
        self.assertTrue(usage_rows)
        self.assertTrue(all(row.strategy_version_id == published["publishedVersionId"] for row in usage_rows))
        self.assertTrue(all(row.usage_scope == "research_run" for row in usage_rows))

    def test_published_run_persists_agent_lifecycle_while_model_call_is_in_progress(self):
        _, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "progress checkpoints",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "graph-progress-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })
        run = self.service.create_published_run({"strategyVersionId": published["publishedVersionId"], "inputSnapshot": {"stockCode": "600519"}})
        observed: list[list[str]] = []

        class FakeResponse:
            provider = "test-provider"; model = "test-model"; content = "structured research output"

        class InspectingAdapter:
            def call_text(self, *_args, **_kwargs):
                partial = self_service.get_published_run(run["id"])
                observed.append([item["status"] for item in partial["resultSnapshot"]["agentRuns"]])
                return FakeResponse()

        self_service = self.service
        StrategyGraphRuntimeService(self.service.db, adapter_factory=InspectingAdapter).execute(run["id"])
        self.assertEqual(observed[0], ["running", "queued"])
        self.assertEqual(self.service.get_published_run(run["id"])["status"], "completed")

    def test_reflection_runs_after_the_decision_phase(self):
        created = self.service.create_strategy({"name": "三 Agent 模板", "templateId": "trend-breakout"})
        draft = created["draft"]
        saved = self.service.save_draft(draft["id"], {
            "revision": draft["revision"], "strategy": {"name": "三 Agent 模板"},
            "version": {
                "marketScope": {"universeMode": "fixed", "symbols": ["600519", "000001"]},
                "riskPolicy": {"decision_validity": {"max": "1d"}},
            },
            "agents": draft["agents"], "connections": draft["connections"],
        })
        validation_experiment_id = self._historically_validate(saved["draftId"])
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "four agent runtime",
            "acknowledgedWarningCodes": [], "idempotencyKey": "four-agent-runtime-key", "validationExperimentId": validation_experiment_id,
        })
        run = self.service.create_published_run({"strategyVersionId": published["publishedVersionId"], "inputSnapshot": {"stockCode": "600519"}})

        class FakeResponse:
            provider = "test-provider"; model = "test-model"; content = "structured research output"

        class FakeAdapter:
            def call_text(self, *_args, **_kwargs): return FakeResponse()

        StrategyGraphRuntimeService(self.service.db, adapter_factory=FakeAdapter).execute(run["id"])
        result = self.service.get_published_run(run["id"])["resultSnapshot"]["agentRuns"]
        self.assertEqual([item["agentType"] for item in result], ["SCREENING", "ANALYSIS", "DECISION", "REFLECTION"])

    def test_continuous_research_control_only_accepts_published_versions_and_persists_pause_terminate(self):
        created, saved = self._save_valid()
        controller = StrategyContinuousRunService(self.service.db)
        with self.assertRaises(ValueError):
            controller.start(saved["draftId"], 300)
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "initial",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "continuous-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })
        with patch.object(controller, "_ensure_worker"):
            control = controller.start(published["publishedVersionId"], 300)
        self.assertEqual(control["status"], "running")
        self.assertEqual(control["intervalSeconds"], 300)
        self.assertEqual(controller.pause(control["id"])["status"], "paused")
        self.assertEqual(controller.terminate(control["id"])["status"], "terminated")
        self.assertEqual(controller.list_controls()[0]["strategyVersionId"], published["publishedVersionId"])

    def test_published_strategy_can_screen_candidates_and_run_the_frozen_graph(self):
        created, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "automatic screening",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "auto-screen-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })

        class FakeQueue:
            def submit_background_task(self, *_args, **_kwargs):
                return None

        with patch("src.services.task_queue.get_task_queue", return_value=FakeQueue()):
            batch = self.service.create_automatic_run_batch({"strategyVersionId": published["publishedVersionId"]})
        self.assertEqual(batch["status"], "queued")
        self.assertEqual(batch["screeningPolicy"]["strategy"], "dual_low")

        class FakeScreener:
            called = False

            def screen(self, **_kwargs):
                self.called = True
                raise AssertionError("固定股票池不应调用全市场选股器")

        class FakeResponse:
            provider = "test-provider"; model = "test-model"; content = "research conclusion"

        class FakeAdapter:
            def call_text(self, *_args, **_kwargs): return FakeResponse()

        fake_screener = FakeScreener()
        runtime = StrategyScreeningRuntimeService(
            self.service.db,
            screener_factory=lambda: fake_screener,
            graph_factory=lambda db: StrategyGraphRuntimeService(db, adapter_factory=FakeAdapter),
        )
        runtime.execute(batch["id"])
        completed = self.service.get_automatic_run_batch(batch["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["candidateCount"], 2)
        self.assertFalse(fake_screener.called)
        self.assertEqual(completed["screening"]["universe_mode"], "fixed_strategy_universe")
        self.assertEqual({candidate["code"] for candidate in completed["candidates"]}, {"600519", "000001"})
        self.assertTrue(all(candidate["status"] == "completed" for candidate in completed["candidates"]))
        child = self.service.get_published_run(completed["candidates"][0]["runId"])
        self.assertEqual(child["inputSnapshot"]["run_mode"], "automatic_screening_research")
        self.assertEqual(child["inputSnapshot"]["strategyRunBatchId"], batch["id"])
        audit_actions = [event["action"] for event in self.service.list_audit(created["strategy"]["id"])]
        self.assertIn("AUTO_RUN_QUEUED", audit_actions)
        self.service.archive_strategy(created["strategy"]["id"])
        self.assertEqual(self.service.list_automatic_run_batches(), [])

    def test_interrupted_one_shot_batch_is_not_left_running_after_restart(self):
        created, saved = self._save_valid()
        published = self.service.publish(saved["draftId"], {
            "revision": saved["revision"], "changeLog": "reconcile interrupted batch",
            "acknowledgedWarningCodes": ["NO_REFLECTION_AGENT"], "idempotencyKey": "reconcile-batch-publish-key", "validationExperimentId": saved["validationExperimentId"],
        })
        batch = self.service.create_automatic_run_batch({"strategyVersionId": published["publishedVersionId"]}, enqueue=False)
        self.assertEqual(batch["status"], "queued")
        self.assertEqual(self.service.reconcile_interrupted_automatic_runs(), 1)
        recovered = self.service.get_automatic_run_batch(batch["id"])
        self.assertEqual(recovered["status"], "failed")
        self.assertIn("服务重启", recovered["errorMessage"])
