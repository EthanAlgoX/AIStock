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
    "TW": ("0050.TW", "Taiwan 50 ETF", "TWD"),
    "JP": ("1306.T", "TOPIX ETF", "JPY"),
    "KR": ("069500.KS", "KOSPI 200 ETF", "KRW"),
    "US": ("SPY", "标普500 ETF（价格代理）", "USD"),
    "HK": ("02800", "恒生指数 ETF（价格代理）", "HKD"),
}
GRID_RULE_VERSION = "high_volume_volatility_grid:v1"

_GRID_TEXT = {
    "zh": ("量比", "区间波动", "档位", "目标仓位", "未达量价门槛", "持仓或资金上限", "不在当日候选范围", "日线不足或无效，未生成规则决策"),
    "zh-TW": ("量比", "區間波動", "檔位", "目標倉位", "未達量價門檻", "持倉或資金上限", "不在當日候選範圍", "日線不足或無效，未產生規則決策"),
    "en": ("Volume ratio", "Range", "Grid level", "Target weight", "Below volume/range thresholds", "Position or cash cap", "Outside today's candidate universe", "Insufficient or invalid bars; no rule decision"),
    "ja": ("出来高倍率", "値幅", "グリッド段階", "目標比率", "出来高・値幅の条件未達", "保有銘柄数または資金の上限", "当日の候補銘柄外", "日足データが不足または無効のため、ルール判定なし"),
    "ko": ("거래량 배수", "가격 변동폭", "그리드 단계", "목표 비중", "거래량·변동폭 기준 미달", "보유 종목 수 또는 자금 한도", "당일 후보군 제외", "일봉 데이터가 부족하거나 유효하지 않아 규칙 판단 없음"),
}
_REJECTED_ORDER_TEXT = {
    "zh": "资金或整手限制，未成交。",
    "zh-TW": "資金或整手限制，未成交。",
    "en": "Insufficient cash or lot-size limit; order not filled. ",
    "ja": "資金不足または売買単位の制約により未約定。",
    "ko": "자금 또는 거래 단위 제한으로 미체결. ",
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


def grid_rule_opinions(config, state, day, histories, candidates):
    """Closed-bar grid signals; the shared ledger fills targets at the next open."""
    labels = _GRID_TEXT.get(config.get("reportLanguage"), _GRID_TEXT["en"])
    lookback = config.get("gridLookbackDays", 5)
    min_volume = config.get("gridMinVolumeRatio", 1.3)
    min_range = config.get("gridMinRange", 0.05)
    levels = config.get("gridLevels", 5)
    allowed = set(candidates)
    evidence, ranked = {}, []
    for code, rows in histories.items():
        if code not in allowed:
            evidence[code] = None
            continue
        if len(rows) < lookback or rows[-1]["date"] != day:
            raise ValueError(f"{day} {code}: {labels[7]}")
        recent = rows[-lookback:]
        if any(any(type(bar.get(key)) not in {int, float} or not math.isfinite(bar[key])
                   for key in ("low", "high", "close", "volume")) or
               bar["low"] <= 0 or not bar["low"] <= bar["close"] <= bar["high"] or bar["volume"] < 0
               for bar in recent):
            raise ValueError(f"{day} {code}: {labels[7]}")
        low, high = min(bar["low"] for bar in recent), max(bar["high"] for bar in recent)
        previous_volume = sum(bar["volume"] for bar in recent[:-1]) / (lookback - 1)
        volume_ratio = recent[-1]["volume"] / previous_volume if previous_volume > 0 else 0.0
        range_ratio = (high - low) / low
        qualified = previous_volume > 0 and volume_ratio >= min_volume and range_ratio >= min_range
        distance = (high - recent[-1]["close"]) / (high - low) if qualified else 0.0
        level = min(levels, max(0, math.floor(distance * levels + 0.5)))
        raw_weight = config["maxWeight"] * level / levels
        evidence[code] = (volume_ratio, range_ratio, level, raw_weight, qualified)
        if raw_weight > 0:
            ranked.append((code, level, volume_ratio * range_ratio))

    # The same deterministic ordering resolves portfolio limits on every replay.
    ranked.sort(key=lambda item: (-item[1], -item[2], item[0]))
    weights, remaining = {}, 1.0
    for code, _, _ in ranked[:config["maxPositions"]]:
        weights[code] = min(evidence[code][3], remaining)
        remaining -= weights[code]

    opinions = []
    for code in histories:
        held = code in state["positions"]
        target = weights.get(code, 0.0)
        facts = evidence[code]
        if facts is None:
            reason = labels[6]
        else:
            volume_ratio, range_ratio, level, raw_weight, qualified = facts
            reason = (f"{labels[0]} {volume_ratio:.2f}/{min_volume:.2f}; "
                      f"{labels[1]} {range_ratio:.2%}/{min_range:.2%}; "
                      f"{labels[2]} {level}/{levels}; {labels[3]} {target:.2%}")
            if not qualified:
                reason += f"; {labels[4]}"
            elif target < raw_weight:
                reason += f"; {labels[5]}"
        opinions.append(dict(code=code, targetWeight=target, reason=reason,
                             stance="bullish" if target > 0 else "bearish" if held else "neutral",
                             held=held, decisionBackend="rules"))
    return opinions


def step(config, state, day, history, benchmark_close):
    """Execute yesterday's intent at today's open, then form today's close opinions."""
    cash = state["cash"]
    positions = {k: dict(v) for k, v in state.get("positions", {}).items()}
    trades, pending = [], state.get("pending")
    rejected_prefix = (_REJECTED_ORDER_TEXT.get(config.get("reportLanguage"), _REJECTED_ORDER_TEXT["en"])
                       if config.get("decisionBackend") == "rules" else "资金或整手限制，未成交。")
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
        # Direction-only decisions must never rebalance a hold or reverse a side
        # just because prices moved between the signal close and the next open.
        for code, direction in pending.get('directions', {}).items():
            held = positions.get(code, {}).get('quantity', 0)
            target = targets.get(code, 0)
            targets[code] = (held if direction == 'hold' else max(held, target)
                             if direction == 'buy' else min(held, target))
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
                    gross=0, slippage=0, reason=rejected_prefix + pending['reasons'][code],
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
                        reason=rejected_prefix + pending["reasons"][code],
                        signalDate=pending["date"],
                        status="rejected",
                    )
                )
    ranked, opinions = [], []
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
