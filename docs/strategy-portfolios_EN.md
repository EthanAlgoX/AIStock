# Strategy validation and daily simulation

Starting a new strategy clears the previous scope, preview approval and assistant source. Late preview responses from cancelled or reset forms cannot update the new form. Previewing again revokes the previous approval first; a failed request requires a successful new preview before saving.

`/trading` saves an Agent strategy first: choose an enabled Strategy Skill, configure its scope and default parameters, and save without selecting a validation mode. Afterwards choose historical backtest, run once, or continuous simulation and confirm the corresponding validation parameters. Saving a strategy creates no account or execution. Legacy research proposals remain at `/trading?view=reports`; existing `run` and `sourceRun` links still work. Proposals do not automatically become orders.

New trading strategies preselect the fixed-rules backend and high-volume high-volatility grid Skill with a 5-trading-day lookback, a 1.3 minimum volume ratio, a 5% minimum price range, and 5 grid levels. Switch to LLM/JEV to use another method. Existing strategies and copied configurations retain their backend; a Skill supplied by the research assistant defaults to LLM so its instructions remain effective. Preselection does not save a strategy or start an account: confirm the stock universe, save, and choose continuous simulation for automatic trading-day updates.

High-volume high-volatility grid is a built-in Strategy Skill. Model-backed decisions receive frozen daily bars and grid parameters, and may form a grid target only when recent volume reaches its configured multiple of prior average volume and the recent high-low range reaches its volatility threshold; failed conditions require a zero target weight. Its lookback, volume multiple, price-range threshold, and grid count are configurable. Trades remain next-open simulation-ledger executions. This is an end-of-day grid, not intraday execution. Accounts accept 1–12 fixed symbols in one market (CN/CNY, US/USD, HK/HKD). CN supports 100-share lots only; users must verify HK lot sizes and configured costs.

The decision backend now offers **Fixed rules · High-volume high-volatility grid**, following QuantEvo's reproducible strategy pattern. Saving freezes rule version `high_volume_volatility_grid:v1` and its parameters. Historical backtests and daily paper simulation use the same closed-bar calculation and never call an LLM/JEV decision API or spend decision Tokens. Existing LLM/JEV strategies retain their behavior. Retired fixed templates remain unavailable; this rule backend supports only the built-in grid. Previewing a custom industry or natural-language stock universe may still call an LLM; use an explicit-symbol scope for a fully model-free validation.

For each decision date, the rule reads its latest `N` complete daily bars. Current volume divided by the preceding `N−1` bars' average must reach the configured volume multiple; `(N-bar highest high − N-bar lowest low) / N-bar lowest low` must reach the range threshold. A close nearer the range low maps to a higher level from `0` through the configured grid count. Target weight is `single-stock cap × level / grid count`. Position limits rank eligible symbols by level, then volume ratio times range, then symbol; total target weight cannot exceed 100%. Failed thresholds or leaving the day's candidate universe produce a zero target. The existing ledger reduces or exits holdings at the next open. Missing or invalid bars stop the day instead of inventing a signal. The page shows rule version, targets, and trade reasons; daily bars and provider sources are retained in private run records for audit. A frozen historical universe still has selection bias, and data-vendor revisions can change a later replay.

Historical tests support up to two years. Forward accounts start on their creation date in the market timezone. Both use the same engine, but keep separate accounts and observation periods. Pause or stop to edit all settings in place. Old ledgers remain unchanged; new revisions use a new paper account. Matching configurations can be compared in account details.

Yesterday's intent executes at today's open with configured slippage, commission and sell-side tax. The close marks positions and generates tomorrow's rule views. The first day generates views only. Retained selections are held, removed selections sold, and new selections bought within cash, lot and entry-weight limits. Entry limits are not continuous weight caps after price changes. Rejected intents retain their reasons.

The existing workspace scheduler checks completed exchange sessions with a 20-minute close buffer. No new session means no duplicate task. Older dates filled after interruption are labeled historical replay. Pausing stops automatic trades while continuing valuation; manual Run once processes available daily steps. This is daily simulation, not an intraday feed or broker execution.

## Detail and metric definitions

Details show cumulative/daily/annualized return, maximum drawdown, annualized volatility, period turnover, Sharpe and Calmar; cumulative returns versus the market benchmark; daily return bars; dated trades and stock views; latest positions. Views cover every pool member with bullish/bearish/neutral stance and rule reasons. Trades retain the preceding signal date and reason. No model opinion is fabricated.

Cumulative return is final equity / initial capital − 1. Daily return compares consecutive equity observations, starting at initial capital. Annualized return uses 252-session compounding; volatility uses sample daily-return deviation × √252. Drawdown includes initial capital in its high-water mark. Period turnover is total buy-and-sell notional / 2 / mean daily equity. Sharpe uses mean daily excess return divided by sample deviation, multiplied by √252; the configured annual risk-free rate is compounded to daily. Calmar is annualized return / maximum drawdown.

Annualized statistics require 20 recorded sessions. Zero volatility leaves Sharpe undefined; zero drawdown leaves Calmar undefined. Missing values display a dash. Benchmark proxies are 510300 (CSI300), SPY (S&P500) and 02800 (Hang Seng), using ETF price returns, not index total returns. Charts support series toggles, data tables and SVG export. Definitions reference the [QuantConnect glossary](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/glossary); the precise conventions above govern this implementation.

## Persistence and operations

API: `GET/POST /api/v1/simulation/portfolios`, `GET /{id}`, `POST /{id}/control` with `run/start/pause`. New strategies use a frozen configuration without executable code. `decisionBackend=rules` accepts only the built-in grid, and historical validation requires `historyMode=rules`. Old fixed-template creation and its templates endpoint remain retired; old fixed-template records remain view-only. Existing private databases isolate members and the owner. Background jobs inherit workspace scope and recheck member enablement.

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

Model-backed strategies use an Agent with an enabled Skill, frozen instructions/digest and optional custom trading instructions. Save first, then launch once, continuously or as a historical validation. Pause and use Edit configuration to change instructions. The first actual model name is retained; a later name change halts validation. The rules backend rejects custom model instructions and executes only its saved rule version and parameters.

Scopes support explicit stocks, a private holdings account, or industry and 20-day volatility conditions. For custom scopes, an LLM selects from the frozen same-market candidate set using preset industries, natural-language constraints, and available market-value evidence. It may return only candidate-set codes; the service validates scope and count before freezing the list. Preview and confirm the interpreted criteria, source, timestamp and candidates before saving. Custom scopes filter at most 50 candidates from the existing screener; this is not complete market/industry coverage. Optional explicit stocks restrict that list by intersection. No match is an error, not a broader fallback. Holdings import symbols only, not real cash/costs. Snapshot/daily/weekly refresh is supported. Existing positions leaving the universe remain valued and may be reduced or exited, but not increased.

The Agent currently receives the last 21 daily bars through the decision date, the paper account, candidates and constraints; no automatic news/fundamental tools are supplied. Missing Skill evidence should produce an explained hold. Validated target weights feed the existing next-open ledger, including partial rebalances. Invalid decisions do not commit the account day. Each invocation processes at most 20 sessions; model-backed decisions also obey their Token budget. If a JEV replay has completed some days but its remaining batch budget cannot fit the next day's input, it stops cleanly before the call; run the backtest again to resume from the next day with a fresh budget. If even the full budget cannot fit one day's input, reduce the universe or raise the budget. Existing member daily limits still apply. Natural-language scope parsing also consumes Tokens.

Daily details retain universe evidence, model and actual Tokens for model-backed decisions. Visible prompts, answers and failures are stored in each user's private `simulation_trading_calls` table, including the owner; the page shows the latest 20 calls. `simulation_universe_snapshots` retains approved and daily scopes. Historical model runs are labelled AI replay, with potential pretrained future knowledge; rules runs are labelled rule historical backtests and use closed-bar calculations. Both frozen-list modes have selection bias. Recorded-universe mode requires actual prior snapshots and fails when missing. Model-backed paper catch-up values prior sessions and fills pre-existing intent without inventing historical AI decisions; rules paper catch-up recomputes deterministic signals. This remains daily paper trading, not intraday or brokerage execution.

Tables are additive and old rule accounts remain compatible. Back up data before deployment; rollback must restore both the old image and the pre-deployment database so old code cannot mistakenly execute Agent accounts.

US custom scopes reuse Yahoo snapshots over configured US tickers or the built-in large-cap universe (at most 50), without applying CN-only screening strategies. Explicit tickers are inspected directly. HK custom scopes require explicit tickers because there is no HK industry universe source. Volatility means annualized percentage volatility based on the latest 20 daily returns.

New Agent strategies default to an explicit-symbol scope: enter symbols, preview and confirm the list, then save. Switch to a custom industry/volatility scope and enter a scope description when screening is intended; explicit symbols may then be omitted or used as an intersection restriction. Saving an approved Agent scope does not wait for the stock-name catalog.

Configuration is ordered as stock selection, strategy, then execution/risk: confirm the universe, choose the decision backend and Skill/rule parameters, then set capital, position limits and costs. Token budget is displayed and used only for model-backed decisions.

## Stop and delete

Use **Stop running** at the top of a saved strategy to stop all its backtests and simulations, cancel pending plans and revoke execution leases. Automatic model calls and valuation updates stop; the strategy, history and simulated holdings remain. Use the existing run-once or continuous-simulation actions to resume. A validation can also be stopped individually. **Pause trading** keeps its existing meaning: suspend automatic trades while continuing valuation updates.

**Delete strategy** requires confirmation and removes the strategy and every linked validation, including strategies that have never run. **Delete validation** removes only the selected validation. Deletion is logical: historical ledgers and call audits remain in the private database, with no restore action in the interface. Model requests already sent may still incur charges, but results returning after stop/delete cannot commit to the ledger. Failed deletions remain open for retry.

New endpoints: `POST /api/v1/simulation/portfolios/definitions/{id}/stop`, `DELETE /api/v1/simulation/portfolios/definitions/{id}`, and `DELETE /api/v1/simulation/portfolios/{id}`. The existing `/control` also accepts `stop`. Accounts add `stopped` and `deleted` statuses; deleted records are excluded from lists, details, comparisons and scheduling. All endpoints use the authenticated user's private database.

Startup adds a nullable `deleted_at` column to `simulation_portfolio_definitions` without rewriting existing data. Back up the database before deployment. Restore that backup when rolling back to an older application version: older versions do not recognize deletion markers and may redisplay removed strategies. Stopping does not liquidate simulated holdings or place broker orders.


## Edit after pausing

Pause or stop all active runs for the strategy, then choose **Edit configuration**. The complete creation form is prefilled: name, market, universe, Skill, LLM/JEV tasks and allocation step, capital, position limits, grid parameters, refresh frequency, Token budget and costs. Preview the universe again before saving. Cancelling leaves the saved configuration unchanged.

Re-previewing sends only the market and editable scope inputs (source, symbols, account, query, industries and candidate limit), excluding derived fields such as `selection` and `rule` from the old preview. Changing the candidate limit reruns selection; saving uses the new preview’s candidates.

Saving updates the same strategy and increments its configuration revision, cancelling old pending plans and execution leases. Previous holdings, trades, model calls and returns remain available as read-only history. Saving does not start execution. The next run creates a separate account using the new initial capital; subsequent runs of that revision reuse its latest paper account. Stale edits require a refresh instead of overwriting newer settings.

`PUT /api/v1/simulation/portfolios/definitions/{id}` accepts the same writable fields as creation plus required `expectedRevision`. Responses include `config.definitionRevision`; existing records default to revision 1 without a schema migration. Active runs and non-paused execution leases block editing. Outstanding model calls may still incur costs, but cannot commit to the old ledger after saving. Rolling back to code without revision checks requires restoring the pre-release database backup to avoid resuming obsolete runs.

## Run status and missing trades

The account’s Run details section shows the latest processed day’s target allocations and reasons without opening a separate tab. It distinguishes missing decisions, zero targets with no holdings, rejected orders, paused valuation and fills. Targets are not filled orders. Historical explanations retain their original language.

Until historical validation finishes, metrics cover only processed dates. Failed calls are labelled as interrupted validation, not a completed backtest. After resolving the error, use Run backtest to resume unfinished dates. Model-backed runs make further model calls; rules runs only recalculate the rules.

Daily simulations check new trading days at least 20 minutes after market close. Earlier plans fill at a subsequent trading day’s opening price, but fills appear only after that day’s closing data is processed. This is not intraday execution.

Daily/weekly refreshes of custom scopes only refresh stocks confirmed in the initial preview. They do not select stocks outside that list. Pause, edit and preview again to change candidates. This UI update does not change existing scopes, thresholds or running states.
