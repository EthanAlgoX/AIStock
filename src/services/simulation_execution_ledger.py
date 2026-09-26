"""Normalize a runtime's confirmed simulation executions, not arbitrary model signals.

The caller must select the source's persisted execution records. HOLD/ALLOW/PAUSE
are never fills. Absent per-fill fees stay unknown even if account totals exist.
"""
import math


def normalize_executions(records):
    result = []
    for index, record in enumerate(records):
        action = record.get('action', record.get('side', '')).upper()
        quantity = record.get('qty')
        price = record.get('close', record.get('price'))
        if (action not in {'BUY', 'SELL'} or not record.get('timestamp') or not record.get('symbol')
                or not isinstance(quantity, (int, float)) or not math.isfinite(quantity) or quantity <= 0
                or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0):
            continue
        fee = record.get('fee')
        if not isinstance(fee, (int, float)) or not math.isfinite(fee) or fee < 0:
            fee = None
        result.append(dict(id=str(index), timestamp=record['timestamp'], code=record['symbol'],
                           side=action.lower(), quantity=quantity, price=price, fee=fee,
                           reason=record.get('reason', ''), status='filled'))
    return result
