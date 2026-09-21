"""Regression cases taken from contradictory model-generated research plans."""
from types import SimpleNamespace

import pytest

from src.report_quality import disclose_missing_news
from src.utils.sniper_points import extract_sniper_points, normalize_trade_plan, parse_sniper_value


def report(entry=85.4, stop=85.4, target=88.74, language="zh"):
    return SimpleNamespace(
        report_language=language, risk_warning="", operation_advice="买入",
        action="buy", dashboard={"battle_plan": {"sniper_points": {
            "ideal_buy": entry, "stop_loss": stop, "take_profit": target,
        }}}, raw_response={"sniper_points": {"ideal_buy": 85.4, "stop_loss": 85.4}},
    )


@pytest.mark.parametrize("language", ["zh", "zh-TW", "en", "ja", "ko"])
def test_equal_entry_stop_rejected_without_raw_response_resurrection(language):
    result = report(language=language)
    normalize_trade_plan(result)
    plan = result.dashboard["battle_plan"]
    assert plan["price_validation"]["status"] == "invalid"
    assert plan["price_validation"]["risk_reward_ratio"] is None
    assert all(v is None for v in extract_sniper_points(result).values())
    assert result.action == "watch"
    assert result.risk_warning
    warning = result.risk_warning
    normalize_trade_plan(result)
    assert result.risk_warning == warning


def test_known_bad_narrative_and_ratio_are_removed():
    result = report(entry="理想入场位：85.40元附近（收复86.92后确认）",
                    stop="止损位：85.40元", target="目标位：88.74元，风险回报比约1:2.2")
    normalize_trade_plan(result)
    assert result.dashboard["battle_plan"]["price_validation"]["status"] == "invalid"
    assert "1:2.2" not in str(result.dashboard)


def test_consistent_plan_ratio_is_computed_and_model_ratio_removed():
    result = report(entry=100, stop=95, target="目标：110元，风险回报比1:99")
    normalize_trade_plan(result)
    plan = result.dashboard["battle_plan"]
    assert plan["price_validation"]["risk_reward_ratio"] == 2
    assert plan["sniper_points"]["take_profit"] == 110
    assert plan["price_validation"]["execution_authorized"] is False


def test_no_entry_does_not_extract_future_ma_trigger_as_buy_price():
    result = report(entry="暂无理想买入位；需先放量站上MA5 86.92元", stop=85.43)
    normalize_trade_plan(result)
    assert extract_sniper_points(result)["ideal_buy"] is None
    assert result.dashboard["battle_plan"]["price_validation"]["status"] == "incomplete"


@pytest.mark.parametrize("value", [float("inf"), float("nan"), True, -1, "-1元"])
def test_non_price_values_rejected(value):
    assert parse_sniper_value(value) is None


def test_partial_data_keeps_valid_independent_stop_without_fabricated_entry():
    result = report(entry=None, stop=95, target=None)
    normalize_trade_plan(result)
    assert extract_sniper_points(result)["stop_loss"] == 95
    assert result.dashboard["battle_plan"]["price_validation"]["risk_reward_ratio"] is None


@pytest.mark.parametrize("language", ["zh", "zh-TW", "en", "ja", "ko"])
def test_zero_news_is_unknown_not_no_adverse_news(language):
    result = report(language=language)
    result.dashboard["intelligence"] = {"latest_news": "no adverse news"}
    disclose_missing_news(result, 0)
    assert result.dashboard["intelligence"]["latest_news"] != "no adverse news"
    assert result.news_summary == result.risk_warning


def test_unknown_news_count_does_not_erase_verified_content():
    result = report()
    result.dashboard["intelligence"] = {"latest_news": "verified announcement"}
    disclose_missing_news(result, None)
    assert result.dashboard["intelligence"]["latest_news"] == "verified announcement"


def test_watch_level_explicitly_not_a_buy_point_stays_unavailable():
    result = report(entry=None, stop=1250.8, target=1274.59)
    result.dashboard["battle_plan"]["sniper_points"]["secondary_buy"] = (
        "若均线转多后回踩MA10 1274.59元不破，可作为二次确认点（当前为压力位，非买点）"
    )
    normalize_trade_plan(result)
    assert result.dashboard["battle_plan"]["price_validation"]["status"] == "incomplete"
    assert extract_sniper_points(result)["secondary_buy"] is None


@pytest.mark.parametrize("entry", [
    "暫無理想買點，等待86.92元確認", "No ideal buy point; watch 86.92",
    "매수 가격 없음, 86.92 확인 대기", "エントリー未定、86.92を確認",
])
def test_localized_no_entry_is_not_a_price(entry):
    result = report(entry=entry, stop=85, target=90)
    normalize_trade_plan(result)
    assert extract_sniper_points(result)["ideal_buy"] is None


@pytest.mark.parametrize("text, expected", [
    ("目标88.74元，风险回报比1:2.2", 88.74),
    ("Target 110; risk/reward 1:99", 110),
    ("Target 110 (R/R 1:99)", 110),
    ("stop -1", None),
    ("102.10-103.00元", 103),
])
def test_ratio_text_never_overrides_target_and_negative_prices_stay_invalid(text, expected):
    assert parse_sniper_value(text) == expected


def test_secondary_breakout_without_own_target_does_not_destroy_primary_plan():
    result = report(entry=1304.5, stop=1298, target=1323)
    result.dashboard["battle_plan"]["sniper_points"]["secondary_buy"] = 1323
    normalize_trade_plan(result)
    assert result.dashboard["battle_plan"]["price_validation"]["status"] == "consistent"
    assert extract_sniper_points(result)["ideal_buy"] == 1304.5
    assert extract_sniper_points(result)["secondary_buy"] is None
    assert result.dashboard["battle_plan"]["validation_warning"]
    normalize_trade_plan(result)
    assert result.dashboard["battle_plan"]["price_validation"]["secondary_entry_status"] == "requires_separate_plan"


def test_later_action_recalibration_cannot_reactivate_a_rejected_plan():
    result = report()
    normalize_trade_plan(result)
    result.action = "buy"
    result.operation_advice = "买入"
    normalize_trade_plan(result)
    assert result.action == "watch"
    assert all(price is None for price in extract_sniper_points(result).values())
