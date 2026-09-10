# Strategy validation and daily simulation

`/trading` saves a strategy first: choose a rule template, configure symbols and default parameters, and save without selecting a validation mode. Afterwards choose historical backtest, run once, or continuous simulation and confirm the corresponding validation parameters. Saving a strategy creates no account or execution. Legacy research proposals remain at `/trading?view=reports`; existing `run` and `sourceRun` links still work. Proposals do not automatically become orders.

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

The trading symbol field now reuses the research stock catalog and autocomplete matching for names, aliases, pinyin and codes. It displays resolved symbols and automatically selects the market/currency. Ambiguous names require a candidate choice; unknown names and mixed-market pools are blocked before submission. Deduplication uses normalized codes. The API still receives canonical symbols and the existing market field. Unlisted codes are marked for verification. Changing markets resets the default lot (US 1, CN/HK 100); HK lot sizes still need verification in advanced settings.

The shared stock-index endpoint adds known Chinese aliases from the existing stock-name mapping (for example 英伟达 for NVIDIA), preserving vendor display names and source files. Research and trading consume the same enriched catalog.

The public catalog uses gzip transfer compression and a 60-second client timeout. On failure, the trading form retains input and offers a catalog retry. Compression is limited to the public index and does not affect streaming reports or private APIs.

## Save rules before choosing validation

The trading form now saves a private strategy definition without selecting backtest/paper mode or creating an account, task, or order. Choose historical backtest, run once, or continuous simulation afterwards, then confirm validation capital and (for backtests) dates. Each validation has an independent account and appears under its strategy. Existing simulations can continue or pause. Copy rules into a new definition to change them; old standalone records and portfolio links remain accessible.

`GET/POST /api/v1/simulation/portfolios/definitions` lists/saves definitions and rejects mode/date inputs. `POST /definitions/{id}/validations` creates a ready account; the client then uses the existing control endpoint. If starting fails, the account remains available for retry. Responses add nullable `definitionId`; old creation requests remain compatible. Definitions use the existing per-user database isolation, including the owner. Initialization adds `simulation_portfolio_definitions` without changing old columns. Image rollback preserves the new table and account records; the old client can still read accounts.

Top-level run-once and continuous actions resume the latest paper account for that strategy. Only the first simulation asks for capital and creates an account; changing run mode preserves positions and equity.

## Agent strategies and universes

New strategies default to an Agent with an enabled Skill, frozen instructions/digest and optional custom trading instructions. Existing deterministic templates remain available. Save first, then launch once, continuously or as a historical validation. Clone to change instructions. The first actual model name is retained; a later name change halts validation.

Scopes support explicit stocks, a private holdings account, or natural-language industry/concept and 20-day volatility conditions. Preview and confirm the interpreted criteria, source, timestamp and candidates before saving. Custom scopes filter at most 50 candidates from the existing screener; this is not complete market/industry coverage. Optional explicit stocks restrict that list by intersection. No match is an error, not a broader fallback. Holdings import symbols only, not real cash/costs. Snapshot/daily/weekly refresh is supported. Existing positions leaving the universe remain valued and may be reduced or exited, but not increased.

The Agent currently receives the last 21 daily bars through the decision date, the paper account, candidates and constraints; no automatic news/fundamental tools are supplied. Missing Skill evidence should produce an explained hold. Validated target weights feed the existing next-open ledger, including partial rebalances. Invalid decisions do not commit the account day. Each invocation processes at most 20 sessions within its Token budget; existing member daily limits still apply. Natural-language scope parsing also consumes Tokens.

Daily details retain universe evidence, model and actual Tokens. Visible prompts, answers and failures are stored in each user's private `simulation_trading_calls` table, including the owner; the page shows the latest 20 calls. `simulation_universe_snapshots` retains approved and daily scopes. Historical Agent runs are labelled AI replay, with potential pretrained future knowledge and frozen-list selection bias. Recorded-universe mode requires actual prior snapshots and fails when missing. Paper catch-up values prior sessions and fills pre-existing intent without inventing historical AI decisions. This remains daily paper trading, not intraday or brokerage execution.

Tables are additive and old rule accounts remain compatible. Back up data before deployment; rollback must restore both the old image and the pre-deployment database so old code cannot mistakenly execute Agent accounts.

US custom scopes reuse Yahoo snapshots over configured US tickers or the built-in large-cap universe (at most 50), without applying CN-only screening strategies. Explicit tickers are inspected directly. HK custom scopes require explicit tickers because there is no HK industry universe source. Volatility means annualized percentage volatility based on the latest 20 daily returns.
