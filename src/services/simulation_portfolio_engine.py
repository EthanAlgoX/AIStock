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
    {
        "id": "high_volume_volatility_grid",
        "name": "高量高波动网格",
        "description": "仅在成交放量且近期价格区间足够大时启用；按区间位置分档调整目标仓位。",
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
            old = positions.get(code, dict(quantity=0, averageCost=0))
            positions[code] = dict(quantity=old['quantity'] + quantity,
                averageCost=(old['quantity'] * old['averageCost'] + gross + fee) / (old['quantity'] + quantity))
        else:
            cash += gross - fee
            positions[code]['quantity'] -= quantity
            if positions[code]['quantity'] == 0:
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

    if pending and pending["date"] < day and 'weights' in pending:
        equity_open = cash + sum(p['quantity'] * prices[c]['open'] for c, p in positions.items())
        targets = {code: math.floor(equity_open * weight / prices[code]['open'] / config['lotSize']) * config['lotSize']
                   for code, weight in pending['weights'].items() if weight > 0}
        for code in list(positions):
            quantity = positions[code]['quantity'] - targets.get(code, 0)
            if quantity > 0:
                trade(code, 'sell', quantity, pending['reasons'][code])
        for code, target in targets.items():
            wanted = target - positions.get(code, {}).get('quantity', 0)
            price = prices[code]['open'] * (1 + config['slippageRate']) * (1 + config['commissionRate'])
            quantity = min(wanted, math.floor(cash / price / config['lotSize']) * config['lotSize'])
            if quantity > 0:
                trade(code, 'buy', quantity, pending['reasons'][code])
            elif wanted > 0:
                trades.append(dict(code=code, side='buy', quantity=0, price=None, rawPrice=prices[code]['open'], fee=0,
                    gross=0, slippage=0, reason='资金或整手限制，未成交。' + pending['reasons'][code],
                    signalDate=pending['date'], status='rejected'))
    elif pending and pending["date"] < day:
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
    ranked, opinions = [], []
    if config["template"] == "high_volume_volatility_grid":
        weights = {}
        lookback = config.get("gridLookbackDays", 5)
        min_volume_ratio = config.get("gridMinVolumeRatio", 1.3)
        min_range = config.get("gridMinRange", 0.05)
        levels = config.get("gridLevels", 5)
        for code in config["symbols"]:
            rows = history[code]
            window = rows[-lookback:]
            if len(window) < lookback:
                reason = f"历史样本不足 {lookback} 个交易日，网格保持观察。"
                opinions.append(dict(code=code, stance="neutral", reason=reason, score=None, held=code in positions))
                continue
            lows = [item["low"] for item in window]
            highs = [item["high"] for item in window]
            volumes = [item.get("volume") or 0 for item in window]
            lower, upper = min(lows), max(highs)
            price = window[-1]["close"]
            previous_average_volume = statistics.fmean(volumes[:-1]) if any(volumes[:-1]) else 0.0
            volume_ratio = volumes[-1] / previous_average_volume if previous_average_volume > 0 else 0.0
            price_range = (upper - lower) / lower if lower > 0 else 0.0
            eligible = volume_ratio >= min_volume_ratio and price_range >= min_range and upper > lower
            if not eligible:
                unmet = []
                if volume_ratio < min_volume_ratio:
                    unmet.append(f"成交量 {volume_ratio:.2f}×，低于 {min_volume_ratio:.2f}×")
                if price_range < min_range:
                    unmet.append(f"区间波动 {price_range:.2%}，低于 {min_range:.2%}")
                reason = "；".join(unmet) + "。未启用网格，下一交易日拟退出该标的。"
                opinions.append(dict(code=code, stance="bearish" if code in positions else "neutral", reason=reason,
                                     score=None, held=code in positions))
                continue
            relative = min(1.0, max(0.0, (price - lower) / (upper - lower)))
            grid_index = min(levels, int(math.floor(relative * levels)))
            target_weight = config["maxWeight"] * (levels - grid_index) / levels
            weights[code] = target_weight
            reason = (
                f"{lookback} 日区间 {lower:.2f}–{upper:.2f}，当前收盘 {price:.2f}；"
                f"成交量 {volume_ratio:.2f}×均量，区间波动 {price_range:.2%}。"
                f"位于第 {grid_index + 1}/{levels} 档，下一交易日调整至目标仓位 {target_weight:.1%}。"
            )
            opinions.append(dict(code=code, stance="bullish" if target_weight > 0 else "bearish", reason=reason,
                                 score=target_weight, held=code in positions))
        next_state = dict(
            state,
            cash=cash,
            equity=equity,
            positions=positions,
            benchmarkBase=state.get("benchmarkBase") or benchmark_close,
            pending=dict(date=day, selected=list(weights), weights=weights,
                         reasons={opinion["code"]: opinion["reason"] for opinion in opinions}),
        )
        output = dict(
            date=day, equity=equity, cash=cash, marketValue=market_value, holdings=holdings,
            opinions=opinions, trades=trades, tradedValue=sum(t["gross"] for t in trades),
            benchmarkReturn=benchmark_close / next_state["benchmarkBase"] - 1 if next_state["benchmarkBase"] else None,
            dailyReturn=equity / state.get("equity", config["initialCash"]) - 1,
        )
        return next_state, output
    for code in config["symbols"]:
        rows = history[code]
        score = None if config.get("engine") == "agent" else StrategyValidationService._score(config["template"], rows)
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
        state,
        cash=cash,
        equity=equity,
        positions=positions,
        benchmarkBase=base,
        pending=dict(date=day, selected=selected, reasons={o["code"]: o["reason"] for o in opinions}),
    )
    if config.get('engine') == 'agent':
        next_state['pending'] = None
        output['opinions'] = [dict(code=c, stance='neutral', reason='本日仅补记估值，未重建历史 Agent 决策。', held=c in positions) for c in config['symbols']]
    return next_state, output
