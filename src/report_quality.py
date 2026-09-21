"""Evidence requirements shared by single-call and Agent report generation."""

REPORT_EVIDENCE_RULES = """
## Evidence and trade-plan requirements
- No search results or a failed search means news risk is UNKNOWN, not that no
  adverse news exists. State what was and was not verified.
- Do not claim cheap/expensive relative to history or peers without dated
  historical percentiles or comparable-company data in the supplied evidence.
- Separate verified facts, conditional inferences and missing information.
  Quote data dates, sources and units; proximity to a moving average is not
  evidence that the investment itself is safe.
- Separate actions for an existing holder from actions for someone with no
  position. A watch/avoid conclusion must not imply an immediately executable buy.
- Entry, stop and target must describe the SAME scenario and execution time.
  For a long scenario require stop < entry < target. If an entry depends on an
  unconfirmed future event, explicitly say it is conditional, not an order.
- Do not invent a reward/risk ratio. Omit it from narrative fields: the application
  calculates it from validated prices. When there is no valid entry, use null
  for ideal_buy/secondary_buy, retaining conditions in entry_plan/watch_conditions.
- Use the requested output language for all user-visible explanations.
"""


def disclose_missing_news(result, result_count):
    """Replace the news conclusion only when the collector confirms zero items."""
    if result_count != 0 or isinstance(result_count, bool):
        return
    messages = {
        "zh": "未获取到可核实的新闻，消息面风险未完成排查；不能据此认定没有利空。",
        "zh-TW": "未取得可核實的新聞，消息面風險未完成排查；不能據此認定沒有利空。",
        "en": "No verifiable news was retrieved. News risk remains unassessed; this does not establish the absence of adverse news.",
        "ja": "検証可能なニュースを取得できていません。ニュースによるリスクは未評価であり、悪材料がないことを意味しません。",
        "ko": "검증 가능한 뉴스를 확보하지 못했습니다. 뉴스 위험은 미평가 상태이며 악재가 없다는 뜻이 아닙니다.",
    }
    message = messages.get(getattr(result, "report_language", "zh"), messages["en"])
    dashboard = getattr(result, "dashboard", None)
    if not isinstance(dashboard, dict):
        return
    intelligence = dashboard.setdefault("intelligence", {})
    if isinstance(intelligence, dict):
        intelligence["latest_news"] = message
    battle = dashboard.get("battle_plan")
    if isinstance(battle, dict) and isinstance(battle.get("action_checklist"), list):
        import re
        battle["action_checklist"] = [
            message if isinstance(item, str) and re.search(
                r"新闻|新聞|利空|news|뉴스|악재|ニュース|悪材料", item, re.I
            ) else item for item in battle["action_checklist"]
        ]
    result.news_summary = message
    warnings = getattr(result, "risk_warning", "") or ""
    if message not in warnings:
        result.risk_warning = (warnings + "\n" + message).strip()
