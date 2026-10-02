"""Context-only uses the real collection branch but never the report/Agent branch."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from tests.test_pipeline_market_phase_context import _make_pipeline, _phase_payload
from src.core.pipeline import StockAnalysisPipeline
from src.enums import ReportType
from src.services.daily_market_context import DailyMarketContext
from src.services.analysis_context_builder import PipelineAnalysisArtifacts
from src.services.analysis_context_builder import AnalysisContextBuilder
from src.search_service import SearchResponse, SearchResult, SearchService


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


@pytest.mark.parametrize("search_success,local_news,expected", [
    (True, None, "missing"),
    (False, None, "fetch_failed"),
    (True, "Local announcement with source", "available"),
    (False, "Local announcement with source", "partial"),
])
def test_collection_keeps_news_and_social_quality_separate(search_success, local_news, expected):
    pipeline = _make_pipeline()
    pipeline.context_only = True
    pipeline._load_persisted_intelligence_context = MagicMock(return_value=local_news)
    pipeline._load_daily_market_context = MagicMock(return_value=None)
    pipeline._build_market_structure_context = MagicMock(return_value=None)
    pipeline.search_service = SearchService.__new__(SearchService)
    pipeline.search_service.news_window_days = 3
    responses = {"latest_news": SearchResponse(
        query="AAPL", results=[], provider="test", success=search_success,
        error_message=None if search_success else "timeout",
    )}
    with patch.object(SearchService, "is_available", property(lambda _self: True)), patch.object(
        pipeline.search_service, "search_comprehensive_intel", return_value=responses,
    ):
        pipeline.social_sentiment_service = SimpleNamespace(
            is_available=True, get_social_context=lambda _code: "Unverified social activity",
        )
        with patch("src.core.pipeline.build_market_phase_context", return_value=SimpleNamespace(to_dict=_phase_payload)):
            artifacts = pipeline.analyze_stock("AAPL", ReportType.SIMPLE, "q-evidence")
    assert isinstance(artifacts, PipelineAnalysisArtifacts)
    assert "Unverified social activity" in artifacts.news_context
    assert artifacts.news_evidence_context == local_news
    assert artifacts.social_context == "Unverified social activity"
    pack = AnalysisContextBuilder.build(artifacts)
    assert pack.blocks["news"].status.value == expected
    assert pack.blocks["social"].status.value == "available"
    assert artifacts.news_result_count == 0
    pipeline.analyzer.analyze.assert_not_called()


def test_collected_news_count_uses_independent_urls_and_keeps_both_source_channels():
    pipeline = _make_pipeline()
    pipeline.context_only = True
    pipeline._load_persisted_intelligence_context = MagicMock(return_value="Local news")
    pipeline._load_daily_market_context = MagicMock(return_value=None)
    pipeline._build_market_structure_context = MagicMock(return_value=None)
    pipeline.search_service = SearchService.__new__(SearchService)
    pipeline.search_service.news_window_days = 3
    responses = {key: SearchResponse(
        query="600519", provider="test", results=[SearchResult(
            title="Company news", snippet="Evidence", source="publisher",
            url=f"https://example.com/news?utm_source={key}",
        )],
    ) for key in ("latest_news", "risk_check")}
    with patch.object(SearchService, "is_available", property(lambda _self: True)), patch.object(
        pipeline.search_service, "search_comprehensive_intel", return_value=responses,
    ), patch("src.core.pipeline.build_market_phase_context", return_value=SimpleNamespace(to_dict=_phase_payload)):
        artifacts = pipeline.analyze_stock("600519", ReportType.SIMPLE, "q-unique")
    assert isinstance(artifacts, PipelineAnalysisArtifacts)
    assert artifacts.news_result_count == 1
    assert artifacts.metadata["news_sources"] == "news_search/local_intelligence"
    assert "Local news" in artifacts.news_evidence_context


@pytest.mark.parametrize("local_news", [None, "Local announcement with source"])
def test_report_news_disclosure_uses_collected_evidence_including_local_news(local_news):
    pipeline = _make_pipeline()
    pipeline._load_persisted_intelligence_context = MagicMock(return_value=local_news)
    pipeline._load_daily_market_context = MagicMock(return_value=None)
    pipeline._build_market_structure_context = MagicMock(return_value=None)
    model_result = pipeline.analyzer.analyze.return_value
    model_result.dashboard = {"intelligence": {"latest_news": "Model news summary"}}
    model_result.news_summary = "Model news summary"
    with patch("src.core.pipeline.build_market_phase_context", return_value=SimpleNamespace(to_dict=_phase_payload)):
        result = pipeline.analyze_stock("600519", ReportType.SIMPLE, "q-news-disclosure")
    assert result is model_result
    if local_news:
        assert result.news_summary == "Model news summary"
        assert result.analysis_context_pack_overview["blocks"][-1]["status"] == "available"
    else:
        assert "未获取到可核实的新闻" in result.news_summary
