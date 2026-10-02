"""Regression coverage for independent, traceable intelligence evidence."""

import sys
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

if "newspaper" not in sys.modules:
    sys.modules["newspaper"] = MagicMock()

from src.search_service import SearchResponse, SearchResult, SearchService


def _result(url: str, *, title: str = "贵州茅台发布经营公告", **kwargs) -> SearchResult:
    return SearchResult(
        title=title,
        snippet=kwargs.pop("snippet", "公告披露了贵州茅台的经营数据，供投资者查阅原文核实。"),
        url=url,
        source=kwargs.pop("source", "example.com"),
        **kwargs,
    )


def _response(results, **kwargs) -> SearchResponse:
    return SearchResponse(query="test query", results=results, provider="Mock", **kwargs)


class IntelEvidenceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.service = SearchService(
            bocha_keys=["dummy_key"],
            searxng_public_instances_enabled=False,
        )

    def test_tracking_variants_count_and_render_as_one_independent_evidence(self) -> None:
        today = datetime.now().date().isoformat()
        original_url = "https://example.com/News?id=42&utm_source=search#content"
        duplicate_url = "https://example.com/News?id=42&fbclid=abc"
        intelligence = {
            "latest_news": _response([_result(original_url, published_date=today)]),
            "market_analysis": _response([
                _result(duplicate_url, snippet="重复检索摘要不得放大同一条新闻的证据权重。", published_date=today),
            ]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 1)
        self.assertIn("独立证据: 1 条", report)
        self.assertEqual(report.count("[证据 E1]"), 1)
        self.assertIn("重复命中证据 E1（不作为独立证据）", report)
        self.assertNotIn("重复检索摘要", report)
        for url in (original_url, duplicate_url):
            self.assertIn(f"URL: {url}", report)
        self.assertEqual(report.count(f"来源: example.com；发布时间: {today}"), 2)
        self.assertEqual(len(intelligence["market_analysis"].results), 1)
        self.assertEqual(intelligence["latest_news"].results[0].url, original_url)

    def test_business_url_identity_is_conservative(self) -> None:
        urls = [
            "https://example.com/Story?id=one&id=two&ref=front",
            "https://example.com/Story?id=two&id=one&ref=front",
            "https://example.com/story?id=one&id=two&ref=front",
            "https://example.com/Story?id=one&id=two&ref=other",
            "https://example.com/Story?symbol=A%2FB",
            "https://example.com/Story?symbol=A/B",
            "https://example.com/Story?id=one&id=two&ref=front&%75tm_source=rss&MC_EID=a#body",
        ]
        intelligence = {
            "latest_news": _response([_result(url) for url in urls[:4]]),
            "market_analysis": _response([_result(url) for url in urls[4:]]),
        }

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 6)
        report = self.service.format_intel_report(intelligence, "贵州茅台")
        self.assertEqual(report.count("[证据 E"), 6)
        self.assertIn("重复命中证据 E1", report)
        for url in urls:
            self.assertIn(f"URL: {url}", report)

    def test_retrieval_count_does_not_expand_the_per_dimension_render_budget(self) -> None:
        intelligence = {
            "latest_news": _response([
                _result(f"https://example.com/news/{i}", title=f"unique title {i}")
                for i in range(6)
            ]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 6)
        self.assertIn("检索独立证据: 6 条", report)
        self.assertIn("每维度最多展示4条", report)
        self.assertEqual(report.count("[证据 E"), 4)
        self.assertNotIn("unique title 4", report)
        self.assertNotIn("unique title 5", report)

    def test_hash_routes_and_their_queries_remain_distinct_evidence(self) -> None:
        first_route = "https://example.com/app?utm_source=latest#/article/1?view=details"
        second_route = "https://example.com/app?utm_source=latest#/article/2?view=details"
        same_route = "https://example.com/app?fbclid=tracking#/article/1?view=details"
        bang_route = "https://example.com/app#!/article/1?view=details"
        other_route_query = "https://example.com/app#/article/1?view=summary"
        intelligence = {
            "latest_news": _response([
                _result(first_route, snippet="Article one route carries its own independent numerical evidence."),
                _result(second_route, snippet="Article two route carries a different independent event summary."),
            ]),
            "market_analysis": _response([
                _result(same_route, snippet="Repeated route summary must not be counted as corroboration."),
                _result(bang_route, snippet="Bang route carries an independent original source summary."),
                _result(other_route_query, snippet="Distinct route query retains its own original summary."),
            ]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 4)
        self.assertEqual(report.count("[证据 E"), 4)
        self.assertIn("Article one route", report)
        self.assertIn("Article two route", report)
        self.assertIn("Bang route", report)
        self.assertIn("Distinct route query", report)
        self.assertNotIn("Repeated route summary", report)
        self.assertIn("重复命中证据 E1", report)
        for url in (first_route, second_route, same_route, bang_route, other_route_query):
            self.assertIn(f"URL: {url}", report)

    def test_missing_urls_are_not_merged_by_title_and_unknown_dates_are_explicit(self) -> None:
        intelligence = {
            "market_analysis": _response([
                _result("", source="Publisher A"),
                _result("", source="Publisher B", published_date="日期待确认"),
            ]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 2)
        self.assertEqual(report.count("[证据 E"), 2)
        self.assertIn("来源: Publisher A；发布时间未知", report)
        self.assertIn("来源: Publisher B；发布时间未知（原始值: 日期待确认）", report)
        self.assertEqual(report.count("URL: 未提供有效原文链接"), 2)

    def test_failed_search_and_successful_empty_search_are_distinguished(self) -> None:
        intelligence = {
            "risk_check": _response(
                [_result("https://example.com/partial")],
                success=False,
                error_message="provider timed out",
            ),
            "announcements": _response([]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual(self.service.count_unique_intel_results(intelligence), 0)
        self.assertIn("搜索失败: provider timed out", report)
        self.assertIn("未找到符合筛选条件的信息", report)
        self.assertNotIn("https://example.com/partial", report)
        self.assertEqual(report.count("不能据此判断没有相关事件"), 2)

    def test_report_redacts_provider_failures_and_rejects_unsafe_attribution_urls(self) -> None:
        intelligence = {
            "latest_news": _response(
                [],
                success=False,
                error_message="GET https://provider.test/search?apikey=provider-secret failed; token=private-token",
            ),
            "market_analysis": _response([
                _result("https://user:credential-secret@example.com/news"),
                _result("javascript:alert(1)"),
                _result("https://example.com/news?access_token=link-secret"),
                _result("https://example.com/news?id=42"),
            ]),
        }

        report = self.service.format_intel_report(intelligence, "贵州茅台")

        for secret in ("provider-secret", "private-token", "credential-secret", "link-secret"):
            self.assertNotIn(secret, report)
        self.assertNotIn("javascript:", report)
        self.assertEqual(report.count("URL: 未提供有效原文链接"), 2)
        self.assertIn("URL: [REDACTED_URL]", report)
        self.assertIn("URL: https://example.com/news?id=42", report)

    def test_comprehensive_search_keeps_freshness_and_provenance_before_report_deduplication(self) -> None:
        today = datetime.now().date().isoformat()
        fresh_url = "https://example.com/News?id=42&utm_source=latest"
        analysis_url = "https://example.com/News?id=42&gclid=analysis"
        provider = self.service._providers[0]
        provider.search = MagicMock(side_effect=[
            _response([
                _result(fresh_url, published_date=today),
                _result("https://example.com/undated-latest", title="贵州茅台未注明时间的新闻"),
            ]),
            _response([
                _result(analysis_url, published_date=today),
                _result("https://example.com/research", title="贵州茅台机构研究", source="Research Publisher"),
            ]),
        ])

        with patch("src.search_service.time.sleep"):
            intelligence = self.service.search_comprehensive_intel("600519", "贵州茅台", max_searches=2)
        report = self.service.format_intel_report(intelligence, "贵州茅台")

        self.assertEqual([item.url for item in intelligence["latest_news"].results], [fresh_url])
        self.assertEqual(
            [item.url for item in intelligence["market_analysis"].results],
            [analysis_url, "https://example.com/research"],
        )
        self.assertEqual(self.service.count_unique_intel_results(intelligence), 2)
        self.assertIn("重复命中证据 E1", report)
        self.assertIn("来源: Research Publisher；发布时间未知", report)
        self.assertNotIn("undated-latest", report)


if __name__ == "__main__":
    unittest.main()
