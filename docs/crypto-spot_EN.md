# Crypto spot research and backtesting

The `/crypto` workspace provides a USDT spot market radar, hourly asset research, turnover/volatility screening, and deterministic strategy replay with simulated positions and fills. Links appear on the market radar, stock research, screening, trading, and portfolio pages. This is a separate spot simulation workspace: stock Agents, the stock holdings ledger, and daily stock simulation do not apply to a 24/7 market. No order is sent to an exchange.

To get started, open **Crypto** in the site header, choose a pair to inspect the seven-day chart, select up to five pairs for screening, then choose a strategy and UTC date range and run a backtest. Review the equity curve, costs, ending simulated positions, and individual fills.

## Data and scope

- Public Binance Spot market data comes from `https://data-api.binance.vision/api/v3` without an API key. The radar uses `/ticker/24hr`; hourly candles use paginated `/klines`. Only **completed** UTC candles are used. Kline field 7 is USDT quote turnover, distinct from base-asset volume.
- The default universe is `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, and `XRPUSDT` for reproduction against the reference project. The radar also lists the top 20 pairs by current rolling 24-hour USDT turnover; users can combine up to five. Today's ranking is not a historically complete tradable universe. Choosing today's popular assets for an earlier backtest introduces selection bias.
- Screening uses 720 completed hourly candles. It ranks the fixed universe by USDT turnover, takes the top three, then selects the highest sample standard deviation of hourly simple returns. A decision never reads a future candle. Users can narrow the fixed universe.
- Dates are UTC; the end date is exclusive. Evaluation spans at most 90 days, with 720 warm-up hours. The returned SHA-256 fingerprint identifies the actual market sample, which may change if the provider revises history.

## Backtest protocol

Defaults: 10,000 USDT initial cash, one shared long-only cash ledger, 0.1% fee and 0.05% slippage on each side, no stock sales tax. A completed candle produces the signal; an order fills at the next hourly open with slippage. Fractional spot quantities are allowed. The final position is marked at the last close without forced liquidation. Fees and slippage are already reflected in net equity.

Three fixed strategies are available:

1. **High-turnover/high-volatility rotation:** screen every 168 hours. When selection changes, sell the old asset, then invest 50% of post-sale equity in the new one. Otherwise hold.
2. **Equal-weight rebalance:** every 168 hours, target a combined 50% allocation spread evenly across selected pairs; sell before buying.
3. **Half-capital Bitcoin:** invest 50% in BTC at the first execution hour, then hold.

Results include return, maximum drawdown, BTC period price return, fills, costs, and ending positions. The BTC comparison excludes hypothetical benchmark trading costs. Compare strategy returns only when dates, universe, costs, and sample fingerprint match. A fixed present-day universe introduces selection bias, and positive historical results do not imply future returns. These strategies call neither LLM nor JEV; the unverified QuantEvo grid/JEV rules are not reproduced.

### Executed backtest check (2026-09-25)

Using the default five pairs, 10,000 USDT, 0.1% fee, 0.05% slippage, 720 warm-up hours and 168-hour rebalance interval, the reference frozen sample for 2026-08-24 to 2026-09-23 UTC produced: rotation **6.9974% / 3 fills / 22.2456 USDT costs**; equal weight **6.2243% / 25 fills / 8.4855 USDT**; half-capital BTC **5.3679% / 1 fill / 7.4913 USDT**. These match the reference implementation. The reference files are verification inputs, not a runtime dependency.

A fresh Binance Spot download covering 2026-08-26 to 2026-09-25 UTC produced: rotation **10.4889%**, maximum drawdown **-6.2580%**; equal weight **5.9527%**, maximum drawdown **-3.7780%**; half-capital BTC **3.6572%**, maximum drawdown **-3.9283%**. All three share market-input fingerprint `706633f4afc1344aa87046ee5f827a98e101de3c8eabd625494af0e24cf65e4d`. A provider revision can change a rerun; these results are not forecasts.

## API and troubleshooting

`GET /api/v1/crypto/market`, `GET /api/v1/crypto/assets/{symbol}`, `POST /api/v1/crypto/screen`, and `POST /api/v1/crypto/backtest`. Requests accept USDT spot pair symbols; invalid or unlisted pairs return a source error. Omitted dates default to the last 30 completed UTC days. Timeout, empty data, or missing candles produce an error rather than silently substituting another market. If Binance is unreachable from your server, check network access to the data domain. Spot data never falls back to perpetual futures.

Exchange account connections, live orders, perpetuals, funding rates, and scheduled daily execution are not supported. Results live in the current page session; refresh to rerun.

Reference: [Binance Spot API](https://developers.binance.com/en/docs/products/spot/rest-api).
