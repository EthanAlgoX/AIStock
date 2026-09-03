"""Regression tests for the market-review macro monitoring contract."""

from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from data_provider.base import DataFetcherManager
from data_provider.apocdata_macro_fetcher import ApocDataMacroFetcher
from data_provider.fred_macro_fetcher import FredMacroFetcher
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.agent.factory import get_skill_manager
from src.agent.tools.market_tools import _handle_get_macro_indicators
from src.market_analyzer import MarketAnalyzer, MarketIndex, MarketOverview
from src.services.market_snapshot_service import get_current_market_snapshot


class _FakeTicker:
    def __init__(self, symbol: str):
        self.symbol = symbol

    def history(self, **kwargs):
        assert kwargs == {"period": "5d", "timeout": 8}
        if self.symbol == "JPY=X":
            return pd.DataFrame()
        return pd.DataFrame(
            {"Close": [100.0, 102.0]},
            index=pd.to_datetime(["2026-09-02", "2026-09-03"]),
        )


def test_yfinance_macro_indicators_only_return_real_observations():
    fake_module = SimpleNamespace(Ticker=_FakeTicker)
    with patch.dict("sys.modules", {"yfinance": fake_module}):
        rows = YfinanceFetcher().get_macro_indicators()

    assert rows is not None
    by_key = {row["key"]: row for row in rows}
    assert "usd_jpy" not in by_key
    assert by_key["us_10y"]["current"] == 102.0
    assert by_key["us_10y"]["change_pct"] == 2.0
    assert by_key["us_10y"]["source"] == "Yahoo Finance"
    assert by_key["brent"]["unit"] == "美元/桶"


def test_macro_indicator_manager_merges_missing_series_without_overwrite():
    first = SimpleNamespace(
        name="First",
        priority=1,
        get_macro_indicators=lambda: [{"key": "dxy", "current": 100.0}],
    )
    second = SimpleNamespace(
        name="Second",
        priority=2,
        get_macro_indicators=lambda: [
            {"key": "dxy", "current": 999.0},
            {"key": "vix", "current": 18.0},
        ],
    )

    rows = DataFetcherManager(fetchers=[first, second]).get_macro_indicators()

    assert rows == [
        {"key": "dxy", "current": 100.0},
        {"key": "vix", "current": 18.0},
    ]


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_fred_macro_fetcher_uses_official_series_and_skips_missing_values():
    def fake_get(url, *, params, timeout):
        assert url.endswith("/fred/series/observations")
        assert params["api_key"] == "test-key"
        assert timeout == 3
        return _FakeResponse({"observations": [
            {"date": "2026-09-03", "value": "."},
            {"date": "2026-09-02", "value": "4.10"},
            {"date": "2026-09-01", "value": "4.00"},
        ]})

    with patch("data_provider.fred_macro_fetcher.requests.get", side_effect=fake_get):
        rows = FredMacroFetcher("test-key", timeout=3).get_macro_indicators()

    assert rows is not None
    assert rows[0]["key"] == "us_2y"
    assert rows[0]["current"] == 4.1
    assert rows[0]["previous"] == 4.0
    assert rows[0]["source"] == "FRED (DGS2)"
    assert all(row["change_label"] == "较前值" for row in rows)


def test_apocdata_macro_fetcher_normalizes_public_release_contract():
    def fake_get(url, *, params, timeout):
        assert url.endswith("/data/macro")
        assert params["limit"] == 2
        field = "value" if params["type"] == "PMI" else "yoy_growth"
        return _FakeResponse({"data": [
            {"period": "2026-08", field: 50.1},
            {"period": "2026-07", field: 49.9},
        ]})

    with patch("data_provider.apocdata_macro_fetcher.requests.get", side_effect=fake_get):
        rows = ApocDataMacroFetcher(timeout=2).get_macro_indicators()

    assert rows is not None
    by_key = {row["key"]: row for row in rows}
    assert by_key["china_pmi"]["current"] == 50.1
    assert by_key["china_cpi_yoy"]["unit"] == "%"
    assert by_key["china_gdp_yoy"]["frequency"] == "quarterly"


def test_macro_manager_honors_region_and_source_pin():
    china = SimpleNamespace(
        name="ChinaOnly",
        priority=1,
        macro_regions={"cn", "hk"},
        get_macro_indicators=lambda: [{"key": "china_pmi", "current": 50}],
    )
    global_source = SimpleNamespace(
        name="Global",
        priority=2,
        macro_regions={"global", "cn", "hk", "us"},
        get_macro_indicators=lambda: [{"key": "vix", "current": 18}],
    )
    manager = DataFetcherManager(fetchers=[china, global_source])
    assert manager.get_macro_indicators(region="us") == [{"key": "vix", "current": 18}]
    assert manager.get_macro_indicators(region="cn", preferred_fetcher="ChinaOnly") == [
        {"key": "china_pmi", "current": 50}
    ]


def test_market_macro_skills_are_registered_with_the_read_only_tool():
    manager = get_skill_manager()
    for skill_id in ("global-macro-review", "a-share-macro-review", "hk-macro-review", "us-macro-review"):
        skill = manager.get(skill_id)
        assert skill is not None
        assert skill.required_tools == ["get_macro_indicators"]
        assert skill.allowed_tools == ["get_macro_indicators"]


def test_macro_agent_tool_returns_explicit_empty_contract():
    with patch("src.agent.tools.market_tools._get_fetcher_manager") as factory:
        factory.return_value.get_macro_indicators.return_value = []
        result = _handle_get_macro_indicators("us")
    assert result == {
        "region": "us",
        "indicators_count": 0,
        "indicators": [],
        "warning": "No connected macro observations",
    }


def test_market_review_persists_and_prompts_with_macro_snapshot():
    analyzer = MarketAnalyzer(
        region="hk",
        config=SimpleNamespace(report_language="zh", market_review_color_scheme="green_up"),
    )
    overview = MarketOverview(
        date="2026-09-03",
        macro_indicators=[
            {
                "key": "usd_cnh",
                "name": "USD/CNH",
                "current": 7.1234,
                "change_pct": -0.25,
                "unit": "人民币",
                "as_of": "2026-09-03T16:00:00+08:00",
                "source": "Yahoo Finance",
            }
        ],
    )

    prompt = analyzer._build_review_prompt(overview, [])
    payload = analyzer.build_market_review_payload(overview, [], "港股复盘")

    assert "## 全球宏观高频指标" in prompt
    assert "USD/CNH: 7.123 人民币 (日变动 -0.25%)" in prompt
    assert "Agent 宏观分析 Skill" in prompt
    assert payload["analysis_skills"] == ["global-macro-review", "hk-macro-review"]
    assert payload["macro_indicators"][0]["key"] == "usd_cnh"
    assert payload["macro_indicators"][0]["source"] == "Yahoo Finance"


def test_live_market_snapshot_exposes_hk_data_and_skills_without_llm_review():
    overview = MarketOverview(
        date="2026-09-04",
        indices=[MarketIndex(code="HSI", name="恒生指数", current=25123.4, change_pct=0.8)],
        macro_indicators=[
            {
                "key": "usd_cnh",
                "name": "USD/CNH",
                "current": 7.12,
                "change_pct": -0.1,
                "source": "Yahoo Finance",
            }
        ],
    )
    analyzer = SimpleNamespace(
        region="hk",
        get_market_overview=lambda: overview,
        _get_macro_skill_ids=lambda: ["global-macro-review", "hk-macro-review"],
        _get_turnover_unit_label=lambda: "十亿港元",
    )

    with patch("src.services.market_snapshot_service.MarketAnalyzer", return_value=analyzer):
        payload = get_current_market_snapshot("hk", config=SimpleNamespace(), force_refresh=True)

    assert payload["kind"] == "market_snapshot"
    assert payload["region"] == "hk"
    assert payload["indices"][0]["name"] == "恒生指数"
    assert payload["macro_indicators"][0]["key"] == "usd_cnh"
    assert payload["analysis_skills"] == ["global-macro-review", "hk-macro-review"]
    assert payload["data_quality"] == "ok"
