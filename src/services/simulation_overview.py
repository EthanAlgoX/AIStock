"""Small, account-scoped forward curves; never mix historical backtests into live returns."""
import math


def summarize(portfolio, days):
    initial = portfolio['config']['initialCash']
    points = []
    peak, drawdown = initial, 0.0
    for day in days:
        equity = day.get('equity')
        if not isinstance(equity, (int, float)) or not math.isfinite(equity) or initial <= 0:
            continue
        peak = max(peak, equity)
        drawdown = max(drawdown, 1 - equity / peak) if peak > 0 else drawdown
        # A daily signal date is not a midnight account observation. Paper
        # snapshots carry the actual booking timestamp; use it on the shared
        # intraday axis, while leaving the ledger's trading date untouched.
        observed_at = day['date']
        if portfolio.get('mode') == 'paper' and len(observed_at) == 10:
            observed_at = day.get('recordedAt') or observed_at
        points.append(dict(time=observed_at, value=equity / initial - 1,
                           benchmark=day.get('benchmarkReturn')))
    # Preserve endpoints and local extrema instead of smoothing away drawdowns.
    selected = {0, len(points) - 1} if points else set()
    width = max(1, math.ceil(len(points) / 128))
    for start in range(0, len(points), width):
        indices = range(start, min(len(points), start + width))
        selected.update((min(indices, key=lambda i: points[i]['value']),
                         max(indices, key=lambda i: points[i]['value'])))
    return dict(id=portfolio['id'], definitionId=portfolio.get('definitionId'), name=portfolio['name'],
                market=portfolio['market'], status=portfolio['status'], error=bool(portfolio.get('error')),
                currency=portfolio.get('currency'), initialCash=initial, timing=portfolio.get('timing'),
                cumulativeReturn=points[-1]['value'] if points else None,
                maxDrawdown=drawdown if points else None,
                lastDate=points[-1]['time'] if points else None,
                observations=len(points), curve=[points[i] for i in sorted(selected)],
                externalRuntime=bool(portfolio['config'].get('externalRuntime')))
