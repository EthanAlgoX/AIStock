"""Context-only uses the real collection branch but never the report/Agent branch."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from tests.test_pipeline_market_phase_context import _make_pipeline, _phase_payload
from src.core.pipeline import StockAnalysisPipeline
from src.services.daily_market_context import DailyMarketContext
from src.services.analysis_context_builder import PipelineAnalysisArtifacts


@pytest.mark.parametrize("agent_mode,skills", [(False, []), (True, []), (False, ["bull_trend"])])
def test_context_only_collects_without_agent_report_or_notification(agent_mode, skills):
    pipeline = _make_pipeline(agent_mode=agent_mode)
    pipeline.context_only = True
    pipeline.config.agent_skills = skills
    pipeline._load_daily_market_context = MagicMock(return_value=DailyMarketContext(
        trade_date=date(2026, 3, 26), region="cn", summary="高风险", risk_tags=["high_risk"], source="test"))
    pipeline._load_persisted_intelligence_context = MagicMock(return_value="Existing news evidence")
    pipeline._build_market_structure_context = MagicMock(return_value={"regime": "range"})
    pipeline._analyze_with_agent = MagicMock(side_effect=AssertionError("Agent must not run"))
    pipeline._send_single_stock_notification = MagicMock(side_effect=AssertionError("No notification"))
    pipeline.fetch_and_save_stock_data = MagicMock(return_value=(True, None))
    phase = SimpleNamespace(to_dict=lambda: _phase_payload())
    with patch("src.core.pipeline.build_market_phase_context", return_value=phase), patch.object(
        pipeline, "_resolve_resume_target_date", return_value=date(2026, 3, 26)
    ):
        result = pipeline.process_single_stock(
            "600519", single_stock_notify=True,
            current_time=datetime(2026, 3, 27, 2, tzinfo=timezone.utc),
        )
    assert isinstance(result, PipelineAnalysisArtifacts)
    assert result.code == "600519"
    assert result.news_context == "Existing news evidence"
    assert result.enhanced_context["market_structure_context"] == {"regime": "range"}
    pipeline.fetcher_manager.get_fundamental_context.assert_called_once()
    pipeline.fetcher_manager.get_chip_distribution.assert_called_once()
    pipeline.analyzer.analyze.assert_not_called()
    pipeline._analyze_with_agent.assert_not_called()
    pipeline.db.save_analysis_history.assert_not_called()
    pipeline._send_single_stock_notification.assert_not_called()


def test_context_only_rejects_report_batch_api():
    pipeline = StockAnalysisPipeline.__new__(StockAnalysisPipeline)
    pipeline.context_only = True
    with pytest.raises(ValueError, match="process_single_stock"):
        pipeline.run()
