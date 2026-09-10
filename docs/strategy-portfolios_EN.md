# Strategy validation and daily simulation

`/trading` now opens persisted strategy accounts: choose a rule template, configure symbols and capital, create an account, then run once or start continuous daily simulation. Creation does not execute anything. Legacy research proposals remain at `/trading?view=reports`; existing `run` and `sourceRun` links still work. Proposals do not automatically become orders.

The initial templates are volume breakout, trend pullback and low-volatility momentum, reusing the existing historical-validation scoring rules. The latter uses price, volatility and liquidity rather than fundamental quality. Accounts accept 1–12 fixed symbols in one market (CN/CNY, US/USD, HK/HKD). CN supports 100-share lots only; users must verify HK lot sizes and configured costs.

Historical tests support up to two years. Forward accounts start on their creation date in the market timezone. Both use the same engine, but keep separate accounts and observation periods. Saved configuration is immutable; copy it to change parameters or create the other validation mode. Matching configurations can be compared in account details.

Yesterday's intent executes at today's open with configured slippage, commission and sell-side tax. The close marks positions and generates tomorrow's rule views. The first day generates views only. Retained selections are held, removed selections sold, and new selections bought within cash, lot and entry-weight limits. Entry limits are not continuous weight caps after price changes. Rejected intents retain their reasons.

The existing workspace scheduler checks completed exchange sessions with a 20-minute close buffer. No new session means no duplicate task. Older dates filled after interruption are labeled historical replay. Pausing stops automatic trades while continuing valuation; manual Run once processes available daily steps. This is daily simulation, not an intraday feed or broker execution.

## Detail and metric definitions

Details show cumulative/daily/annualized return, maximum drawdown, annualized volatility, period turnover, Sharpe and Calmar; cumulative returns versus the market benchmark; daily return bars; dated trades and stock views; latest positions. Views cover every pool member with bullish/bearish/neutral stance and rule reasons. Trades retain the preceding signal date and reason. No model opinion is fabricated.

Cumulative return is final equity / initial capital − 1. Daily return compares consecutive equity observations, starting at initial capital. Annualized return uses 252-session compounding; volatility uses sample daily-return deviation × √252. Drawdown includes initial capital in its high-water mark. Period turnover is total buy-and-sell notional / 2 / mean daily equity. Sharpe uses mean daily excess return divided by sample deviation, multiplied by √252; the configured annual risk-free rate is compounded to daily. Calmar is annualized return / maximum drawdown.

Annualized statistics require 20 recorded sessions. Zero volatility leaves Sharpe undefined; zero drawdown leaves Calmar undefined. Missing values display a dash. Benchmark proxies are 510300 (CSI300), SPY (S&P500) and 02800 (Hang Seng), using ETF price returns, not index total returns. Charts support series toggles, data tables and SVG export. Definitions reference the [QuantConnect glossary](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/glossary); the precise conventions above govern this implementation.

## Persistence and operations

API: `GET/POST /api/v1/simulation/portfolios`, `GET /templates`, `GET /{id}`, `POST /{id}/control` with `run/start/pause`. Fixed configurations only; no executable code. Existing private databases isolate members and the owner. Background jobs inherit workspace scope and recheck member enablement.

The new `simulation_portfolio_runs` table stores configuration, execution status, lease and last recorded date. Existing simulation strategy/version/account/run/order/fill/position/equity tables store the ledger. Each day commits atomically, retaining price inputs, providers, timestamps and reasons. Retries do not duplicate trades. Single-process Web startup releases interrupted leases without removing completed days; multi-process scheduling against one database is unsupported.

Checks are recorded in Tasks & Runs, including failures, and link back to the account. Missing/invalid prices or incomplete benchmark sessions halt accounting without removing earlier dates. These deterministic rules make no LLM calls and consume no model tokens. Separately requested research retains its normal metering.

Daily-bar execution does not model order books, partial fills, limit queues, dividends or split adjustments to positions. Provider adjustment conventions and fixed-universe selection bias affect comparability; performance across corporate actions has not been validated as real total return.

No new environment variables. Initialization creates the additional table; existing columns remain unchanged. Existing simulation run responses add the `portfolio_day` execution mode, while old creation inputs keep their contract. Deployments retain environment, bind mounts, private databases and SSH keys. Back up data and retain the preceding image/container. Roll back the image while retaining the new table and records; the older UI will not expose them. Switch containers only when jobs are idle. The first release uses Chinese strategy-specific UI text; this English document provides matching behavior and metric definitions.

Creation failures retain the form and server error; background refresh does not erase submission errors. Symbol input accepts commas, Chinese enumeration commas, semicolons and whitespace; 1–12 distinct codes are required.
