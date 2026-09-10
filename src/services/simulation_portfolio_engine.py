"""Deterministic daily portfolio accounting shared by historical and forward runs."""

from __future__ import annotations
import math
import statistics
from src.services.strategy_validation_service import StrategyValidationService

TEMPLATES = [
    {
        "id": "volume_breakout",
        "name": "量价突破",
        "description": "突破过去 20 日收盘高点、成交量达到均量 1.3 倍且站上均线。",
    },
    {
        "id": "shrink_pullback",
        "name": "趋势回踩",
        "description": "价格在 20 日均线上方附近、量能不过热，按动量和波动排序。",
    },
    {
        "id": "low_volatility_quality",
        "name": "低波动动量",
        "description": "在固定股票池中按价格动量、波动和成交额排序；不使用基本面质量指标。",
    },
]
BENCHMARKS = {
    "CN": ("510300", "沪深300 ETF（价格代理）", "CNY"),
    "US": ("SPY", "标普500 ETF（价格代理）", "USD"),
    "HK": ("02800", "恒生指数 ETF（价格代理）", "HKD"),
}


def metrics(days, initial, risk_free=0.0):
    if not days:
        return {
            k: None
            for k in (
                "cumulativeReturn",
                "dailyReturn",
                "annualizedReturn",
                "maxDrawdown",
                "annualizedVolatility",
                "turnover",
                "sharpe",
                "calmar",
            )
        }
    values = [initial] + [d["equity"] for d in days]
    returns = [values[i] / values[i - 1] - 1 for i in range(1, len(values))]
    peak, drawdown = initial, 0.0
    for value in values:
        peak = max(peak, value)
        drawdown = max(drawdown, 1 - value / peak)
    total = values[-1] / initial - 1
    # Short samples are shown as cumulative/daily observations, not annualized claims.
    exponent = math.log(values[-1] / initial) * 252 / len(days) if len(days) >= 20 and values[-1] > 0 else None
    annual = math.expm1(exponent) if exponent is not None and exponent < 700 else None
    sigma = statistics.stdev(returns) if len(returns) >= 20 else None
    excess = statistics.fmean(returns) - ((1 + risk_free) ** (1 / 252) - 1)
    result = dict(
        cumulativeReturn=total,
        dailyReturn=returns[-1],
        annualizedReturn=annual,
        maxDrawdown=drawdown,
        annualizedVolatility=sigma * math.sqrt(252) if sigma is not None else None,
        turnover=sum(d["tradedValue"] for d in days) / 2 / statistics.fmean(values[1:]),
        sharpe=excess / sigma * math.sqrt(252) if sigma else None,
        calmar=annual / drawdown if annual is not None and drawdown > 0 else None,
    )
    return {k: v if v is None or math.isfinite(v) else None for k, v in result.items()}


def step(config, state, day, history, benchmark_close):
    """Execute yesterday's intent at today's open, then form today's close opinions."""
    cash = state["cash"]
    positions = {k: dict(v) for k, v in state.get("positions", {}).items()}
    trades, pending = [], state.get("pending")
    prices = {}
    for code in config["symbols"]:
        rows = history[code]
        if not rows or rows[-1]["date"] != day:
            raise ValueError(f"{day} 缺少 {code} 行情，整日未记账，请补齐数据后重试。")
        bar = rows[-1]
        if any(
            not isinstance(bar.get(k), (float, int)) or not math.isfinite(bar[k]) or bar[k] <= 0
            for k in ("open", "close")
        ):
            raise ValueError(f"{code} 行情价格无效")
        prices[code] = bar

    def trade(code, side, quantity, reason):
        nonlocal cash
        raw = prices[code]["open"]
        fill = raw * (1 + config["slippageRate"] * (1 if side == "buy" else -1))
        gross = quantity * fill
        fee = gross * config["commissionRate"] + (gross * config["sellTaxRate"] if side == "sell" else 0)
        if side == "buy":
            cash -= gross + fee
            positions[code] = dict(quantity=quantity, averageCost=(gross + fee) / quantity)
        else:
            cash += gross - fee
            del positions[code]
        trades.append(
            dict(
                code=code,
                side=side,
                quantity=quantity,
                price=fill,
                rawPrice=raw,
                fee=fee,
                slippage=abs(fill - raw) * quantity,
                gross=gross,
                reason=reason,
                signalDate=pending["date"],
                status="filled",
            )
        )

    if pending and pending["date"] < day:
        selected = pending["selected"]
        for code in list(positions):
            if code not in selected:
                trade(code, "sell", positions[code]["quantity"], pending["reasons"][code])
        new = [code for code in selected if code not in positions]
        equity_open = cash + sum(p["quantity"] * prices[c]["open"] for c, p in positions.items())
        budget = min(cash / max(1, len(new)), equity_open * config["maxWeight"])
        for code in new:
            fill = prices[code]["open"] * (1 + config["slippageRate"])
            lot = config["lotSize"]
            quantity = math.floor(min(budget, cash) / (fill * (1 + config["commissionRate"])) / lot) * lot
            if quantity:
                trade(code, "buy", quantity, pending["reasons"][code])
            else:
                trades.append(
                    dict(
                        code=code,
                        side="buy",
                        quantity=0,
                        price=None,
                        rawPrice=prices[code]["open"],
                        fee=0,
                        gross=0,
                        slippage=0,
                        reason="资金或整手限制，未成交。" + pending["reasons"][code],
                        signalDate=pending["date"],
                        status="rejected",
                    )
                )
    ranked, opinions = [], []
    for code in config["symbols"]:
        rows = history[code]
        score = StrategyValidationService._score(config["template"], rows)
        momentum = rows[-1]["close"] / rows[-21]["close"] - 1 if len(rows) >= 21 else None
        reason = (
            "历史样本不足 21 个交易日，保持观察。"
            if len(rows) < 21
            else f"20 日涨跌幅 {momentum:.2%}；"
            + ("未满足模板条件。" if score is None else f"规则评分 {score:.4f}，按股票池排名决定配置。")
        )
        opinions.append(dict(code=code, stance="neutral", reason=reason, score=score))
        if score is not None:
            ranked.append((score, code))
    selected = [code for _, code in sorted(ranked, key=lambda x: (-x[0], x[1]))[: config["maxPositions"]]]
    for opinion in opinions:
        code = opinion["code"]
        opinion["stance"] = "bullish" if code in selected else "bearish" if code in positions else "neutral"
        opinion["reason"] += (
            " 下一交易日拟持有。"
            if code in selected
            else " 下一交易日拟退出。" if code in positions else " 不新增仓位。"
        )
        opinion["held"] = code in positions
    market_value = sum(p["quantity"] * prices[c]["close"] for c, p in positions.items())
    equity = cash + market_value
    if cash < -0.000001 or equity <= 0:
        raise ValueError("账户记账不平衡，未保存当日结果。")
    holdings = [
        dict(
            code=c,
            **p,
            price=prices[c]["close"],
            marketValue=p["quantity"] * prices[c]["close"],
            unrealizedPnl=p["quantity"] * (prices[c]["close"] - p["averageCost"]),
        )
        for c, p in positions.items()
    ]
    base = state.get("benchmarkBase") or benchmark_close
    output = dict(
        date=day,
        equity=equity,
        cash=cash,
        marketValue=market_value,
        holdings=holdings,
        opinions=opinions,
        trades=trades,
        tradedValue=sum(t["gross"] for t in trades),
        benchmarkReturn=benchmark_close / base - 1 if base else None,
        dailyReturn=equity / state.get("equity", config["initialCash"]) - 1,
    )
    next_state = dict(
        cash=cash,
        equity=equity,
        positions=positions,
        benchmarkBase=base,
        pending=dict(date=day, selected=selected, reasons={o["code"]: o["reason"] for o in opinions}),
    )
    return next_state, output
