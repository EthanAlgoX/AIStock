# Crypto as an integrated market

Crypto is a market option inside the existing modules. There is no separate crypto workspace or Stocks/Crypto page split. Supported assets are Binance Spot USDT pairs such as `BTCUSDT` and `ETHUSDT`. No exchange orders are sent.

## Existing module entry points

- **Market radar:** select Crypto in the existing market selector. Spot pairs show rolling 24-hour changes and turnover, not equity indices or completed daily bars. Unavailable macro, breadth or sector data remains explicitly missing.
- **Research and investment assistant:** select Crypto and enter a complete pair symbol. Use the existing research tasks, published workflows, reports and run history. Report generation may still call an LLM. Equity earnings, valuation multiples and trading rules do not apply.
- **Screening:** select Crypto and its volume/price configuration. Results use the existing candidate list and research flow. The universe is the current top 20 USDT pairs by rolling 24-hour Binance turnover plus core pairs, not the entire market or a historical point-in-time universe.
- **Trading simulation:** select Configure strategy, choose Crypto, edit pairs, preview, select a rule and save. Use the same historical backtest, paper account, daily scheduler, pause, edit and delete controls as stocks. Filter the strategy list by market.
- **Holdings and watchlist:** select Crypto in the original forms, enter a pair, fractional quantity and USDT cost. Records use the persistent ledger and research plans. User holdings remain separate from each strategy's simulated holdings, which are shown in its run details; simulations never silently create user positions.

Legacy `/crypto` links redirect to Crypto in Market radar.

## Shared ledger and daily protocol

All three built-in rules use the existing strategy versions, accounts, orders, fills, positions, equity snapshots, run history and scheduler. Their trading decisions call neither LLM nor JEV:

| Rule | Behavior |
| --- | --- |
| High-volume, high-volatility rotation | Rank a fixed universe by USDT turnover over the last N completed UTC days, shortlist K pairs, then select the highest daily-return standard deviation. On rebalance dates, retain the position if the selected pair is unchanged. |
| Equal-weight rebalance | Sort candidates by symbol, take up to the position limit, divide the configured allocation equally and rebalance at the configured interval. |
| Half-allocation Bitcoin | Signal BTCUSDT on the first day, simulate a buy at the next daily open, then hold. Default allocation is 50%, subject to the per-asset weight cap. |

Defaults are a 30-day lookback, 7-day rebalance interval, 50% allocation and turnover shortlist of 3. Lookback and shortlist apply to rotation; the interval applies to rotation and equal weight. Parameters, universe and rule version are frozen when saved. A fixed universe has up to 12 pairs; backtests do not use today's market-wide ranking to rebuild historical universes. User-selected universes can still have survivorship bias.

- Days include weekends and start at 00:00 UTC. Only completed daily candles are used. The first day creates a signal; fills can start at the next open. Final-day signals do not invent fills outside the requested interval.
- Shared cash, long-only, no leverage, fractional quantities. The minimum simulated quantity is ledger rounding precision, not exchange-specific minimum quantity or notional validation.
- Configured fees and slippage apply; stock sales tax does not. The benchmark is BTC/USDT price return for the same interval. Annualization uses 365 days, requiring at least 20 recorded days; stocks retain 252.
- Strategies and backtests persist in the database across refreshes. Each invocation advances up to 20 days and can resume from the last completed date without duplicating fills. Pause before editing; prior backtests retain their original configuration.
- Missing, duplicate, incomplete or unreachable data fails explicitly. No equity, perpetual-futures or fabricated data substitutes for spot candles. Newly listed pairs may lack sufficient warm-up history.
- USDT remains a distinct currency. No assumed USD/CNY peg is used; missing FX observations remain valuation gaps in cross-currency totals.

## API compatibility and deployment

Pages use the existing `/api/v1/simulation/portfolios` definition, preview and execution interfaces with market `CRYPTO`. Research workspaces use `CRYPTO`; holdings and radar use `crypto`. Rule parameters are `cryptoLookbackDays`, `cryptoRebalanceDays`, `cryptoAllocation` and `cryptoTopN`. No new environment variables are required.

The existing `/api/v1/crypto/market` and asset data endpoints remain available. Legacy hourly `/api/v1/crypto/screen` and `/api/v1/crypto/backtest` remain for compatibility; the website no longer uses their simplified backtest or in-memory positions. Hourly results and the new daily ledger are different evaluation protocols.

Existing SQLite quantity columns can retain fractional values; new tables declare Float. No ledger reset is required. Back up the database before deployment. Before rolling back to older code, pause new crypto simulations so the old scheduler does not encounter an unsupported market.

## Parameter research and deployment-private strategies

Completed fixed-universe rule backtests with at least 100 recorded days expose parameter research in the existing trading detail page. The same framework also supports the equity volume/volatility rule.

Research replays saved daily snapshots without fetching new data or calling LLM/JEV. Chronological splits are 60% training, 20% validation and 20% final check, each with fresh initial capital and its own rebalance clock. Up to 16 single-field candidates (12 in the UI) keep universe, costs, capital and execution rules fixed. Lookback mutations cannot exceed stored history. Split returns cannot be combined into a continuous account return.

Selection requires positive cost-adjusted validation Sharpe improving by more than 0.05, the configured drawdown limit, training Sharpe degradation no worse than 0.10 and acceptable training drawdown. Only the selected candidate enters the final check; failure does not trigger selection of another candidate. Passing candidates can be saved separately for existing backtest/paper workflows. Running strategies are never replaced automatically.

Experiments persist in the scoped database; identical requests reuse records. Historical data is already visible, so repeated research is not independent blind testing. Future forward observations remain necessary. Drawdown uses the full account high-water mark even when the displayed window is shortened.

External verified configurations, provenance and ledgers can live only in the server database; Git stores the generic framework and synthetic tests. Daily adaptations must be retested and must not inherit hourly source performance. This remains daily paper accounting, not tick execution or arbitrary self-modifying strategy code.

Scoped endpoints: `GET/POST /api/v1/simulation/portfolios/{id}/research` (`budget`, `maxDrawdown`), and idempotent `POST /api/v1/simulation/portfolios/research/{id}/adopt`. The additive `simulation_portfolio_research` table may remain on rollback; existing strategy records are unchanged.
