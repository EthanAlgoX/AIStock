# Workspace journeys and run history

Research and holdings research share one stored run and report. The stock archive links research, structured stock discussions and candidate deep research by explicit code. Candidate tables link to the archive; starting another analysis is a separate action. Legacy free-text discussions are not assigned to guessed tickers. Stock discussions validate explicit codes and markets; broad topics may omit a stock.

Published screening versions determine actual markets, filters, rankings and limits. Natural-language and industry fields guide interpretation only. Trading proposals require an explicit completed screening source in the same market, the current user's watchlist, or recorded holdings. Submission freezes symbols, source run and source date. Empty sources are rejected. Historical candidates do not imply current quotes. Scheduled executions freeze inputs separately and do not silently replace an explicitly selected screening report.

The legacy trading proposal view (`/trading?view=reports`) produces research proposals and validates parameter ranges. It does not evaluate proposals against account risk, approve orders, simulate fills or execute trades.

The `/trading` strategy center adds separate historical and daily simulated accounts, persisted fills, positions and rule views. Checks appear in Tasks & Runs and link back to strategy details. See [Strategy portfolios](strategy-portfolios_EN.md).

`GET /api/v1/workspace/run-history` returns `items`, `total`, `statusCounts`, `offset`, and `limit` (default 30, maximum 100). Filters: `kind`, `status`, `query`, `stock`, `market`, `start`, and `end`. Dates use UTC with an inclusive end date. Counts cover the full filtered database set. The existing array-shaped `/runs` API remains compatible.

Market recaps retain their original background queue and task IDs. Chat workflows retain the strategy executor. Both register runs before execution and preserve failures. Ordinary short chat messages do not create runs; old unregistered tasks are not invented retrospectively.

Run details link sources and stock archives and show directly attributed model calls and tokens, including estimated member usage. Existing owner usage and member quota ledgers remain authoritative; no duplicate charging is introduced. Missing attribution does not mean zero usage. Independent child runs show their own usage rather than duplicating it in parents.

Workspace runs support cooperative cancellation and creating a new run from the original configuration, with fresh validation and additional usage. Original records remain unchanged. External executors currently do not expose cancellation or retry through these controls. Pausing a schedule is distinct from stopping a run.

When Web owns scheduling, `--serve-only` starts the independent price poller without enabling daily model scheduling. The existing alert flag still controls checks, and delivery also requires configured channels. External CLI ownership prevents a duplicate Web poller. Concurrent first visits handle duplicate expert initialization in an isolated savepoint without overwriting customizations. No new settings are required; strategy accounts add a control table during database initialization. Deployment preserves existing commands, private databases and SSH authorization; retain source/database backups and the previous container for rollback.

Regression checks cover pagination, filtering, workspace isolation, invalid/empty trading sources, failure persistence, attribution, and serve-only lifecycle. Builds do not establish real model or notification delivery. Deployment requires separate HTTPS, authentication and browser checks. This release does not infer tickers from legacy prose, manufacture chat history, connect real broker execution, or redesign all schedule configuration.
