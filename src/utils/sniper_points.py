# -*- coding: utf-8 -*-
"""Helpers for parsing report sniper-point price values."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any, Dict, Optional


SNIPER_KEYS = ("ideal_buy", "secondary_buy", "stop_loss", "take_profit")
_RATIO_CLAUSE = re.compile(
    r"盈亏比|盈虧比|风险回报|風險回報|reward.?risk|risk.?reward|r/r|손익비|損益比", re.I
)


def parse_sniper_value(value: Any) -> Optional[float]:
    """Parse a sniper point value from report text into a positive price."""

    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) and parsed > 0 else None

    text = str(value).replace(",", "").replace("，", "").strip()
    if not text or text in {"-", "—", "N/A"}:
        return None

    try:
        parsed = float(text)
        return parsed if math.isfinite(parsed) and parsed > 0 else None
    except ValueError:
        pass

    # Ignore explanatory parentheses and later reward/risk ratios. Otherwise
    # a trailing "1:2.2" can replace the actual target price.
    text = _RATIO_CLAUSE.split(text, maxsplit=1)[0]
    text = re.split(r"[（(]", text, maxsplit=1)[0].strip() or text
    # A range separator is not a unary minus; standalone negative prices are.
    text = re.sub(r"(?<=\d)\s*[-–~～]\s*(?=\d)", " ", text)
    colon_positions = [pos for char in ("：", ":") if (pos := text.find(char)) >= 0]
    colon_pos = min(colon_positions, default=-1)
    yuan_pos = text.find("元", colon_pos + 1 if colon_pos != -1 else 0)
    if yuan_pos != -1:
        segment_start = colon_pos + 1 if colon_pos != -1 else 0
        segment = text[segment_start:yuan_pos]
        valid_numbers = []
        for match in re.finditer(r"-?\d+(?:\.\d+)?", segment):
            start_idx = match.start()
            if start_idx >= 2 and segment[start_idx - 2:start_idx].upper() == "MA":
                continue
            valid_numbers.append(match.group())
        if valid_numbers:
            try:
                parsed = float(valid_numbers[-1])
                return parsed if math.isfinite(parsed) and parsed > 0 else None
            except ValueError:
                pass

    paren_pos = len(text)
    for paren_char in ("(", "（"):
        pos = text.find(paren_char)
        if pos != -1:
            paren_pos = min(paren_pos, pos)
    search_text = text[:paren_pos].strip() or text

    valid_numbers = []
    for match in re.finditer(r"-?\d+(?:\.\d+)?", search_text):
        start_idx = match.start()
        if start_idx >= 2 and search_text[start_idx - 2:start_idx].upper() == "MA":
            continue
        valid_numbers.append(match.group())
    if valid_numbers:
        try:
            parsed = float(valid_numbers[-1])
            return parsed if math.isfinite(parsed) and parsed > 0 else None
        except ValueError:
            pass
    return None


def extract_sniper_points(result: Any) -> Dict[str, Optional[float]]:
    """Extract normalized sniper-point prices from a completed analysis result."""

    dashboard = getattr(result, "dashboard", None)
    if isinstance(dashboard, Mapping):
        battle = dashboard.get("battle_plan")
        validation = battle.get("price_validation") if isinstance(battle, Mapping) else None
        if isinstance(validation, Mapping) and validation.get("status") == "invalid":
            return dict.fromkeys(SNIPER_KEYS)
    raw_points: Mapping[str, Any] = {}

    if hasattr(result, "get_sniper_points"):
        candidate = result.get_sniper_points() or {}
        if isinstance(candidate, Mapping):
            raw_points = candidate

    if not _has_any_sniper_value(raw_points):
        dashboard = getattr(result, "dashboard", None)
        if isinstance(dashboard, Mapping):
            raw_points = find_sniper_points(dashboard) or raw_points

    if not _has_any_sniper_value(raw_points):
        raw_response = getattr(result, "raw_response", None)
        if isinstance(raw_response, Mapping):
            raw_points = find_sniper_points(raw_response) or raw_points

    points = {key: parse_sniper_value(raw_points.get(key)) for key in SNIPER_KEYS}
    for key in ("ideal_buy", "secondary_buy"):
        if _entry_unavailable(raw_points.get(key)):
            points[key] = None
    if _invalid_long_plan(points):
        # Consumers (history/backtests/signals) must not recover unsafe prices
        # from the raw model response when display fields were rejected.
        return dict.fromkeys(SNIPER_KEYS)
    if _invalid_entry(points.get("secondary_buy"), points.get("stop_loss"), points.get("take_profit")):
        points["secondary_buy"] = None
    return points


def _has_any_sniper_value(points: Mapping[str, Any]) -> bool:
    return any(points.get(key) not in (None, "") for key in SNIPER_KEYS)


def find_sniper_points(data: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    if not isinstance(data, Mapping):
        return None

    if any(key in data for key in SNIPER_KEYS):
        return data

    sniper_points = data.get("sniper_points")
    if isinstance(sniper_points, Mapping) and sniper_points:
        return sniper_points

    battle_plan = data.get("battle_plan")
    if isinstance(battle_plan, Mapping):
        sniper_points = battle_plan.get("sniper_points")
        if isinstance(sniper_points, Mapping) and sniper_points:
            return sniper_points

    inner_dashboard = data.get("dashboard")
    if isinstance(inner_dashboard, Mapping):
        found = find_sniper_points(inner_dashboard)
        if found:
            return found

    return None


_NO_ENTRY = re.compile(
    r"暂不|暂无|不设|暫不|暫無|不設|不設定|无法|無法|非买点|非買點|当前不满足|當前不滿足|not (?:a buy|an entry)|no (?:valid |ideal |new )?(?:entry|buy)|"
    r"not (?:yet )?(?:available|confirmed)|매수.*(?:없|미정)|진입.*(?:없|미정)|"
    r"買い.*(?:未定|なし)|エントリー.*(?:未定|なし)", re.IGNORECASE,
)


def _entry_unavailable(value: Any) -> bool:
    return isinstance(value, str) and bool(_NO_ENTRY.search(value))


def _invalid_entry(entry, stop, target) -> bool:
    return entry is not None and (
        (stop is not None and stop >= entry)
        or (target is not None and target <= entry)
    )


def _invalid_long_plan(points: Mapping[str, Optional[float]]) -> bool:
    # A secondary breakout entry may need its own target. Do not invalidate a
    # consistent primary scenario merely because that alternate target is absent.
    entry = points.get("ideal_buy")
    if entry is None:
        entry = points.get("secondary_buy")
    return _invalid_entry(entry, points.get("stop_loss"), points.get("take_profit"))


def normalize_trade_plan(result: Any) -> None:
    """Reject contradictory long plans before display or persistence.

    Validation describes a price scenario, never an executable order. Missing
    prices stay missing; we do not manufacture a stop or infer one from spot.
    """
    dashboard = getattr(result, "dashboard", None)
    if not isinstance(dashboard, dict):
        return
    battle = dashboard.get("battle_plan")
    if not isinstance(battle, dict):
        return
    raw = battle.get("sniper_points")
    if not isinstance(raw, dict):
        return
    previously_invalid = (
        isinstance(battle.get("price_validation"), dict)
        and battle["price_validation"].get("status") == "invalid"
        and all(raw.get(key) is None for key in SNIPER_KEYS)
    )
    points = {key: parse_sniper_value(raw.get(key)) for key in SNIPER_KEYS}
    for key in ("ideal_buy", "secondary_buy"):
        if _entry_unavailable(raw.get(key)):
            points[key] = None
    invalid = previously_invalid or _invalid_long_plan(points)
    secondary_rejected = not invalid and _invalid_entry(
        points.get("secondary_buy"), points.get("stop_loss"), points.get("take_profit")
    )
    if secondary_rejected:
        raw["secondary_buy"] = None
    complete = all(points.get(key) is not None for key in ("ideal_buy", "stop_loss", "take_profit"))
    ratio = None
    if complete and not invalid:
        ratio = round((points["take_profit"] - points["ideal_buy"]) /
                      (points["ideal_buy"] - points["stop_loss"]), 4)
    battle["price_validation"] = {
        "status": "invalid" if invalid else "consistent" if complete else "incomplete",
        "risk_reward_ratio": ratio,
        "entry_basis": "ideal_buy",
        "execution_authorized": False,
        "secondary_entry_status": "requires_separate_plan" if secondary_rejected else (
            battle.get("price_validation", {}).get("secondary_entry_status", "not_rejected")
            if isinstance(battle.get("price_validation"), dict) else "not_rejected"
        ),
    }
    if not invalid:
        if secondary_rejected:
            messages = {
                "zh": "替代入场价未匹配同一计划的有效止损和目标，已撤下；主计划保留。",
                "zh-TW": "替代進場價未匹配同一計畫的有效停損和目標，已撤下；主計畫保留。",
                "en": "The alternate entry has no consistent stop/target in this scenario and was removed; the primary plan is retained.",
                "ja": "代替エントリーは同じ計画の損切り・目標価格と整合しないため削除しました。主計画は保持します。",
                "ko": "대체 진입가가 같은 계획의 손절가·목표가와 일치하지 않아 제거했습니다. 기본 계획은 유지합니다.",
            }
            message = messages.get(getattr(result, "report_language", "zh"), messages["en"])
            battle["validation_warning"] = message
            warning = getattr(result, "risk_warning", "") or ""
            if message not in warning:
                result.risk_warning = (warning + "\n" + message).strip()
        # Remove model-authored ratios from the target field; the authoritative
        # ratio lives in price_validation, with its entry basis explicitly stated.
        target_text = str(raw.get("take_profit") or "")
        if _RATIO_CLAUSE.search(target_text):
            raw["take_profit"] = points.get("take_profit")
        return
    messages = {
        "zh": "交易价位未通过校验：需满足止损价 < 入场价 < 目标价。相关价位和盈亏比不可用，请重新分析。",
        "zh-TW": "交易價位未通過校驗：需滿足停損價 < 進場價 < 目標價。相關價位和盈虧比不可用，請重新分析。",
        "en": "Trade prices failed validation: stop < entry < target is required. Prices and reward/risk are unavailable; rerun the analysis.",
        "ja": "取引価格の検証に失敗しました。損切り価格 < エントリー価格 < 目標価格が必要です。価格と損益比は利用できません。再分析してください。",
        "ko": "거래 가격 검증에 실패했습니다. 손절가 < 진입가 < 목표가 조건이 필요합니다. 가격과 손익비를 사용할 수 없습니다. 다시 분석하세요.",
    }
    language = getattr(result, "report_language", "zh")
    message = messages.get(language, messages["en"])
    battle["sniper_points"] = {key: None for key in SNIPER_KEYS}
    # Remove a conflicting execution narrative, not merely its numeric label.
    battle["position_strategy"] = {"entry_plan": message, "risk_control": message}
    battle["validation_warning"] = message
    from src.schemas.decision_action import normalize_decision_action
    action = (normalize_decision_action(getattr(result, "action", None))
              or normalize_decision_action(getattr(result, "operation_advice", None)))
    if action in {"buy", "add"}:
        from src.report_language import localize_operation_advice
        result.operation_advice = localize_operation_advice("观望", language)
        result.action = "watch"
        result.action_label = result.operation_advice
        result.decision_type = "hold"
        calibration = dashboard.setdefault("decision_score_calibration", {})
        if isinstance(calibration, dict):
            calibration["guardrail_reason"] = "invalid_trade_prices"
            calibration["final_action"] = "watch"
        conclusion = dashboard.get("core_conclusion")
        if isinstance(conclusion, dict):
            conclusion["one_sentence"] = message
            conclusion["signal_type"] = result.operation_advice
    warning = getattr(result, "risk_warning", "") or ""
    if message not in warning:
        result.risk_warning = (warning + "\n" + message).strip()
