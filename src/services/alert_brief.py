"""Deterministic price-alert reports. No model calls or trading instructions."""

import math
from datetime import datetime


def render_price_alert_brief(rule, result, language="zh"):
    en = language == "en"
    def label(zh, english):
        return english if en else zh

    def number(value):
        try:
            value = float(value)
            return f"{value:,.4f}".rstrip("0").rstrip(".") if math.isfinite(value) else "—"
        except (TypeError, ValueError):
            return "—"

    above = getattr(rule.rule, "direction", "") == "above"
    lines = [
        f"## {label('持仓与价格告警简报', 'Holding & price alert brief')}",
        f"**{rule.effective_target or rule.rule.stock_code}** · {label('上限触发', 'Upper threshold reached') if above else label('下限触发', 'Lower threshold reached')}",
        f"- {label('观察价格', 'Observed price')}: {number(result.get('observed_value'))}",
        f"- {label('设定阈值', 'Configured threshold')}: {number(result.get('threshold'))}",
        f"- {label('行情来源', 'Data source')}: {result.get('data_source') or '—'}",
        f"- {label('行情时间', 'Quote timestamp')}: {result.get('data_timestamp') or label('来源未提供，请核实行情时效', 'Not supplied; verify quote freshness')}",
        f"- {label('简报生成时间（服务器本地）', 'Generated (server local time)')}: {datetime.now().isoformat(timespec='seconds')}",
    ]
    context = result.get("holding_context") or {}
    for position in context.get("positions", []):
        cost = position.get("avg_cost")
        lines.append(f"- {label('持仓成本', 'Holding cost')} ({position.get('currency', '')}): {number(cost)}")
        if cost and cost > 0 and result.get("observed_value") is not None:
            pnl = (float(result["observed_value"]) / cost - 1) * 100
            lines.append(f"- {label('相对成本变化（未计费用）', 'Change vs cost (before fees)')}: {pnl:+.2f}%")
    lines += ["", label(
        "这是规则触发的事实简报，不是新的 AI 研究报告。请复核行情时效、消息与持仓风险；触线不代表必须买卖，不会自动下单。",
        "This is a rule-triggered factual brief, not a new AI research report. Verify quote freshness, news and exposure. A threshold is not a buy/sell instruction; no orders are placed.",
    )]
    return "\n".join(lines)
