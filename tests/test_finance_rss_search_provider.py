# -*- coding: utf-8 -*-
"""Deterministic coverage for the keyless curated finance RSS provider."""

import sys
import unittest
from unittest.mock import MagicMock, patch

if "newspaper" not in sys.modules:
    newspaper = MagicMock()
    newspaper.Article = MagicMock()
    newspaper.Config = MagicMock()
    sys.modules["newspaper"] = newspaper

from src.search_service import FinanceRssSearchProvider, SearchService


RSS_FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>Apple raises guidance - Reuters</title>
      <link>https://news.google.com/rss/articles/apple-guidance</link>
      <pubDate>Tue, 18 Aug 2026 03:30:00 GMT</pubDate>
      <description><![CDATA[<a href="https://example.com">Apple</a> raised its outlook.]]></description>
      <source url="https://www.reuters.com">Reuters</source>
    </item>
    <item>
      <title>Missing date must be ignored</title>
      <link>https://news.google.com/rss/articles/no-date</link>
    </item>
  </channel>
</rss>
"""


class FinanceRssSearchProviderTestCase(unittest.TestCase):
    def test_provider_parses_attributed_google_news_rss_without_credentials(self) -> None:
        response = MagicMock(status_code=200, content=RSS_FIXTURE)
        provider = FinanceRssSearchProvider()

        with patch("src.search_service.requests.get", return_value=response) as request_get:
            result = provider.search("Apple AAPL stock latest news", max_results=5, days=3)

        self.assertTrue(provider.is_available)
        self.assertTrue(result.success)
        self.assertEqual(result.provider, "FinanceRSS")
        self.assertEqual(len(result.results), 1)
        self.assertEqual(result.results[0].source, "Reuters")
        self.assertEqual(result.results[0].published_date, "2026-08-18")
        self.assertEqual(result.results[0].snippet, "Apple raised its outlook.")
        kwargs = request_get.call_args.kwargs
        self.assertIn("site:reuters.com", kwargs["params"]["q"])
        self.assertIn("site:sec.gov", kwargs["params"]["q"])
        self.assertEqual(kwargs["params"]["hl"], "en-US")
        self.assertIn("AI-Stock", kwargs["headers"]["User-Agent"])

    def test_provider_uses_chinese_google_news_locale_for_chinese_query(self) -> None:
        response = MagicMock(status_code=200, content=RSS_FIXTURE)
        provider = FinanceRssSearchProvider()

        with patch("src.search_service.requests.get", return_value=response) as request_get:
            provider.search("贵州茅台 600519 股票 最新消息", max_results=2, days=3)

        params = request_get.call_args.kwargs["params"]
        self.assertEqual(params["hl"], "zh-CN")
        self.assertEqual(params["gl"], "CN")
        self.assertEqual(params["ceid"], "CN:zh-Hans")

    def test_search_service_has_a_real_keyless_news_default(self) -> None:
        service = SearchService(searxng_public_instances_enabled=False)

        self.assertTrue(service.is_available)
        self.assertEqual(service._providers[0].name, "FinanceRSS")

    def test_configured_provider_keeps_auto_priority_while_rss_remains_selectable(self) -> None:
        service = SearchService(
            bocha_keys=["configured-key"],
            searxng_public_instances_enabled=False,
        )
        finance_rss = next(provider for provider in service._providers if provider.name == "FinanceRSS")

        self.assertEqual(service._providers[0].name, "Bocha")
        self.assertFalse(service._provider_enabled_for_request(finance_rss))
        self.assertTrue(service._provider_enabled_for_request(finance_rss, "FinanceRSS"))


if __name__ == "__main__":
    unittest.main()
