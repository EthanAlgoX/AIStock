"""Versioned spot rules using the same persisted next-open portfolio ledger."""
from datetime import date
import hashlib
import statistics

RULES = {
    'crypto_rotation': ('高量高波动轮换', 'crypto_rotation:daily:v1'),
    'crypto_equal_weight': ('等权再平衡', 'crypto_equal_weight:daily:v1'),
    'crypto_btc_hold': ('半仓比特币', 'crypto_btc_hold:daily:v1'),
}
_TEXT = {
    'zh': ('固定候选池；UTC 已收盘日线；次日开盘模拟成交。', '等待调仓', '目标仓位'),
    'en': ('Fixed universe; completed UTC days; simulated fills at the next open.', 'Hold until rebalance', 'Target weight'),
    'ko': ('고정 후보군, 마감된 UTC 일봉, 다음 시가 모의 체결.', '재조정까지 보유', '목표 비중'),
    'ja': ('固定候補、確定済みUTC日足、翌日始値で模擬約定。', 'リバランスまで保有', '目標比率'),
    'zh-TW': ('固定候選池；UTC 已收盤日線；次日開盤模擬成交。', '等待調倉', '目標倉位'),
}


def skill_snapshot(skill_id):
    name, version = RULES[skill_id]
    instructions = f'{version}: completed UTC daily signals, next-open spot fills, shared USDT cash; no leverage.'
    return dict(id=skill_id, name=name, version=version, instructions=instructions,
                digest=hashlib.sha256(instructions.encode()).hexdigest())


def opinions(config, state, day, histories, candidates):
    skill = config['skillSnapshot']['id']
    labels = _TEXT.get(config.get('reportLanguage'), _TEXT['en'])
    elapsed = (date.fromisoformat(day) - date.fromisoformat(config['startDate'])).days
    due = elapsed % config.get('cryptoRebalanceDays', 7) == 0
    allocation = config.get('cryptoAllocation', .5)
    weights = {}
    hold = not due or (skill == 'crypto_btc_hold' and elapsed > 0)
    if not hold:
        if skill == 'crypto_equal_weight':
            chosen = sorted(candidates)[:config['maxPositions']]
            weights = {code: min(allocation / len(chosen), config['maxWeight']) for code in chosen}
        elif skill == 'crypto_btc_hold':
            weights = {'BTCUSDT': min(allocation, config['maxWeight'])}
        else:
            lookback = config.get('cryptoLookbackDays', 30)
            ranked = []
            for code in candidates:
                rows = histories[code][-lookback:]
                if len(rows) != lookback:
                    raise ValueError(f'{code}: insufficient completed UTC days')
                closes = [r['close'] for r in rows]
                ranked.append((code, sum(r['amount'] for r in rows),
                               statistics.stdev(b / a - 1 for a, b in zip(closes, closes[1:]))))
            ranked.sort(key=lambda r: (-r[1], r[0]))
            chosen = min(ranked[:config.get('cryptoTopN', 3)], key=lambda r: (-r[2], r[0]))[0]
            hold = set(state['positions']) == {chosen}
            weights = {chosen: min(allocation, config['maxWeight'])}
    result = []
    for code, rows in histories.items():
        current = state['positions'].get(code, {}).get('quantity', 0) * rows[-1]['close'] / state['equity']
        target = current if hold else weights.get(code, 0)
        result.append(dict(code=code, targetWeight=target, held=code in state['positions'],
            decision='hold' if hold else 'buy' if target > current else 'sell' if target < current else 'hold',
            stance='bullish' if target > current else 'bearish' if target < current else 'neutral',
            reason=f'{labels[0]} {labels[1] if hold else labels[2]} {target:.2%}', decisionBackend='rules'))
    return result
