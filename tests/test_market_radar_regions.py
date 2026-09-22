"""Radar routing must not substitute A-share data for an overseas market."""
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.endpoints.analysis import router
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.services.market_snapshot_service import get_current_market_snapshot
from src.utils.market_review_region import MARKET_SNAPSHOT_REGIONS


@pytest.mark.parametrize("region", sorted(MARKET_SNAPSHOT_REGIONS))
def test_snapshot_api_accepts_every_radar_market(region):
    app = FastAPI()
    app.include_router(router)
    payload = {"region": region, "market_scope": region.upper(), "generated_at": "2026-09-22T00:00:00Z", "date": "2026-09-22", "indices": [], "macro_indicators": [], "data_quality": "unavailable"}
    with patch("src.services.market_snapshot_service.get_current_market_snapshot", return_value=payload) as fetch:
        response = TestClient(app).get("/market-snapshot", params={"region": region})
    assert response.status_code == 200, response.text
    assert response.json()["region"] == region
    assert fetch.call_args.args[0] == region


@pytest.mark.parametrize("region,symbol", [("tw", "^TWII"), ("jp", "^N225"), ("kr", "^KS11"), ("gb", "^FTSE"), ("ca", "^GSPTSE"), ("au", "^AXJO"), ("in", "^NSEI"), ("de", "^GDAXI"), ("fr", "^FCHI")])
def test_snapshot_routes_real_provider_and_keeps_region(region, symbol):
    frame = pd.DataFrame({"Open": [100, 101], "High": [103, 104], "Low": [99, 100], "Close": [101, 103], "Volume": [1000, 1200]})
    fetcher = YfinanceFetcher()
    symbols = []
    def ticker(code):
        symbols.append(code)
        return SimpleNamespace(history=lambda **kwargs: frame)
    from data_provider.base import DataFetcherManager
    manager = DataFetcherManager.__new__(DataFetcherManager)
    manager._fetchers = [fetcher]
    with patch("yfinance.Ticker", side_effect=ticker), patch("data_provider.DataFetcherManager", return_value=manager), patch("src.market_analyzer.DataFetcherManager", return_value=manager), patch.object(manager, "get_macro_indicators", return_value=[]):
        payload = get_current_market_snapshot(region, config=SimpleNamespace(report_language="en"), force_refresh=True)
    assert payload["region"] == region
    assert symbol in symbols
    assert all(not code.endswith((".SS", ".SZ")) for code in symbols)
    assert payload["indices"][0]["current"] == 103
    assert payload["indices"][0]["change_pct"] == pytest.approx(2 / 101 * 100)
    assert "breadth" not in payload
    assert payload["data_quality"] == "partial"


def test_unknown_region_does_not_fall_back_to_china():
    with pytest.raises(ValueError):
        get_current_market_snapshot("unknown")
    assert YfinanceFetcher().get_main_indices("unknown") is None


def test_missing_overseas_data_remains_unavailable_and_cache_is_isolated():
    from unittest.mock import Mock
    manager = Mock()
    manager.get_main_indices.return_value = []
    manager.get_macro_indicators.return_value = []
    with patch('src.market_analyzer.DataFetcherManager', return_value=manager):
        payload = get_current_market_snapshot('fr', force_refresh=True)
        assert payload['data_quality'] == 'unavailable'
        assert payload['indices'] == []
        assert payload['analysis_skills'] == ['global-macro-review']
        payload['indices'].append({'code': 'wrong'})
        cached = get_current_market_snapshot('fr')
        assert cached['indices'] == []
        manager.get_main_indices.assert_called_once_with(region='fr')


@pytest.mark.parametrize('region', sorted(MARKET_SNAPSHOT_REGIONS))
def test_news_source_accepts_radar_market(region):
    from src.services.intelligence_service import IntelligenceService
    service = IntelligenceService.__new__(IntelligenceService)
    fields = service._normalize_source_fields({'name': 'Market news', 'url': 'https://example.com/feed', 'market': region})
    assert fields['market'] == region


@pytest.mark.parametrize('region', ['tw', 'gb', 'ca', 'au', 'in', 'de', 'fr'])
@pytest.mark.parametrize('language', ['zh', 'en', 'ja', 'ko', 'zh-TW'])
def test_new_market_full_review_and_localized_fallback(region, language):
    from unittest.mock import Mock
    from src.core.market_review import run_market_review
    from src.core.market_review_locale import review_heading, REVIEW_COPY
    from src.core.market_profile import INTERNATIONAL_MARKET_DETAILS
    from src.market_analyzer import MarketAnalyzer
    manager = Mock()
    code = INTERNATIONAL_MARKET_DETAILS[region][1]
    manager.get_main_indices.return_value = [{'code': code, 'name': code, 'current': 103., 'change': 2., 'change_pct': 2., 'open': 101., 'high': 104., 'low': 100., 'prev_close': 101., 'volume': 1200., 'amount': 0., 'amplitude': 4.}]
    manager.get_macro_indicators.return_value = []
    config = SimpleNamespace(report_language=language, market_review_region=region)
    notifier = Mock()
    expected_heading = review_heading(region, language)
    report = f'## 2026-09-22 {expected_heading}\n\n### {REVIEW_COPY[language]["indices"]}\n{code}: 103'
    class Model:
        def is_available(self):
            return True
        def generate_text(self, prompt, **kwargs):
            assert code in prompt or INTERNATIONAL_MARKET_DETAILS[region][3] in prompt
            assert 'SSE, SZSE, ChiNext' not in prompt
            assert 'A-share Market Recap' not in prompt
            return report
    with patch('src.market_analyzer.DataFetcherManager', return_value=manager), patch.object(MarketAnalyzer, '_get_macro_skill_prompt_block', return_value=''), patch.object(MarketAnalyzer, '_merge_persisted_market_intelligence', side_effect=lambda news: news):
        result = run_market_review(notifier, analyzer=Model(), config=config, send_notification=False, return_structured=True, save_report_file=False, persist_history=False)
        assert result is not None
        assert result.market_review_payload['region'] == region
        assert result.market_review_payload['language'] == language
        assert expected_heading in result.report
        assert 'breadth' not in result.market_review_payload
        analyzer = MarketAnalyzer(region=region, config=config)
        fallback = analyzer._generate_template_review(analyzer.get_market_overview(), [])
        assert REVIEW_COPY[language]['fallback'] in fallback
        assert expected_heading in fallback
        manager.get_market_stats.assert_not_called()
        manager.get_sector_rankings.assert_not_called()
        notifier.send.assert_not_called()


def test_region_config_and_calendar_keep_legacy_both_and_support_new_subsets():
    from api.v1.schemas.analysis import MarketReviewRequest
    from src.core.trading_calendar import compute_effective_region
    from src.utils.market_review_region import normalize_market_review_region_lenient
    assert MarketReviewRequest(region=' FR,tw,GB,TW ').region == 'tw,gb,fr'
    assert normalize_market_review_region_lenient('both') == 'cn,hk,us,jp,kr'
    assert compute_effective_region('both', set(MARKET_SNAPSHOT_REGIONS)) == 'cn,hk,us,jp,kr'
    assert compute_effective_region('tw,gb,fr', {'tw', 'fr'}) == 'tw,fr'
    assert compute_effective_region('fr', {'cn'}) == ''
    with pytest.raises(ValueError):
        MarketReviewRequest(region='fr,unknown')


@pytest.mark.parametrize('language', ['ja', 'ko', 'zh-TW'])
def test_existing_markets_fallback_is_localized_and_injection_cannot_add_foreign_prose(language):
    from src.core.market_review_locale import REVIEW_COPY, review_heading
    from src.market_analyzer import MarketAnalyzer, MarketOverview
    with patch('src.market_analyzer.DataFetcherManager'):
        analyzer = MarketAnalyzer(region='cn', config=SimpleNamespace(report_language=language))
    overview = MarketOverview(date='2026-09-22')
    report = analyzer._generate_template_review(overview, [])
    assert REVIEW_COPY[language]['fallback'] in report
    assert review_heading('cn', language) in report
    with patch.object(analyzer, '_build_sector_block', return_value='中文行业名称') as block:
        assert analyzer._inject_data_into_review(report, overview, []) == report
        block.assert_not_called()


@pytest.mark.parametrize('language', ['zh', 'en', 'ja', 'ko', 'zh-TW'])
def test_multi_market_export_uses_new_market_labels_and_language(language):
    from src.core.market_review_locale import review_heading, REVIEW_COPY
    from src.share_image import _market_segments, _market_region_for_segment, build_share_image_html, _POSTER_TEXT, _POSTER_LABELS
    report = f'# {REVIEW_COPY[language]["root"]}\n\n# {review_heading("tw", language)}\n\nTWII: 100\n\n# {review_heading("gb", language)}\n\nFTSE: 200'
    segments = _market_segments(report)
    assert [_market_region_for_segment(segment) for segment in segments] == ['tw', 'gb']
    html = build_share_image_html(report, structured_payload={'language': language, 'kind': 'market_review', 'markets': {'tw': {}, 'gb': {}}})
    assert f'lang="{language if language != "zh" else "zh-CN"}"' in html
    assert _POSTER_TEXT[language]['market_subtitle'] in html or _POSTER_TEXT[language]['multi_subtitle'] in html
    assert set(_POSTER_TEXT[language]) == set(_POSTER_TEXT['en'])
    if language != 'zh':
        assert set(_POSTER_LABELS[language]) == set(_POSTER_LABELS['en'])


@pytest.mark.parametrize('language', ['ja', 'ko', 'zh-TW'])
def test_report_rendering_keeps_localized_prose_without_appending_raw_sector_labels(language):
    from src.core.market_review import _render_market_review_payload_markdown, _build_market_review_context_overview
    from src.core.market_review_locale import REVIEW_COPY
    payload = {'region': 'cn', 'language': language, 'markdown_report': f'## {REVIEW_COPY[language]["root"]}', 'sectors': {'top': [{'name': '中文行业名称', 'change_pct': 1}]}}
    rendered = _render_market_review_payload_markdown(payload)
    assert '中文行业名称' not in rendered
    assert REVIEW_COPY[language]['root'] in rendered
    overview = _build_market_review_context_overview(region='cn', report_language=language, diagnostic_snapshot=None)
    assert overview['subject']['stock_name'] == REVIEW_COPY[language]['root']
