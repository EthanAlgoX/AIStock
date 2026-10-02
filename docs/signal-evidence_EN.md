# News, Social and Price-Volume Rule Evidence

[简体中文](signal-evidence.md)

This update draws on `market-radar` news collection, post attribution and candlestick rule events to make existing analysis inputs inspectable and expose data limitations. It reuses DSA's SearchService, social aggregation service, StockTrendAnalyzer, pipeline and AnalysisContextPack.

## What Was Adopted

| Reference approach | Implemented in this update | Deferred |
| --- | --- | --- |
| News provenance, publication time and stable identity | Conservative URL deduplication across on-demand search dimensions; repeated hits reference the same evidence; unknown dates, failures and empty results are explicit | Changes to stored intelligence identities, or automatic merging of search and local intelligence |
| Social author and original post attribution | Existing aggregation preserves supplied authors, valid links and upstream times; social data becomes a separate auxiliary input | New Reddit / X connectors, account login or OAuth |
| Rule parameters and numerical candle evidence | Existing trend results gain availability, window warnings, dates/sources and observations against the previous 20 bars | A separate event database, event revision/withdrawal lifecycle or execution engine |
| Separate facts from interpretation | News, social and technical inputs have distinct evidence limits; existing six-block quality scores and Prompt constraints are reused | New trading actions, standalone signal scores or profit claims |

## News and Social Inputs

`SearchService.count_unique_intel_results(intel_results)` counts independent retrieved results from successful responses. `format_intel_report()` shares its URL identity: only ordinary fragment anchors and `utm_*`, `fbclid`, `gclid`, `mc_cid` and `mc_eid` from the main URL query are removed. Hash routes starting with `/` or `!`, including their internal query, are preserved verbatim so different single-page application articles remain distinct. Business query values, ordering, encoding and path case are preserved. Missing URLs are never merged by similar titles. This identity applies only to on-demand search reports and counts; it changes neither `intelligence_items` nor persisted search identities and does not infer that different URLs are syndicated copies.

Reports retain the existing limit of 4 displayed hits per dimension. Duplicate hits keep an evidence reference and attribution without repeating the summary. Retrieval counts do not mean that every result reached the model. Displayed hits retain the publisher, valid original link and supplied publication time; missing or unparseable times are explicit and cannot establish a recent catalyst. Failed responses contribute no evidence. Failed searches and successful searches emptied by filters are distinct; neither proves that no relevant event exists. Existing sanitizers protect failure diagnostics and sensitive links; attribution accepts only absolute HTTP(S) URLs without authority credentials.

Social comments are unverified. Supplied post authors, valid original links and raw `published_at` / `created_at` values are retained. Missing times are explicitly unknown and are never fabricated. Buzz, mentions, votes and sentiment scores are platform statistics, not verified news, news causation or directional confidence. Scores from different platforms are not added together.

## Technical Inputs

`TrendAnalysisResult.to_dict()` adds the following optional evidence fields while preserving existing result fields:

| Field | Meaning |
| --- | --- |
| `indicator_availability` | Availability of moving averages, volume ratio, MACD, individual RSI periods and `rule_events`; an empty event list alone does not indicate readiness |
| `analysis_warnings` | Window, warmup, explicitly pending/estimated bars, gaps and provenance limitations |
| `analysis_date` / `analysis_source` / `valid_bars` | Last analyzed bar date, supplied source and current window size; missing sources remain unknown |
| `rule_events` | Observations with `rule_id`, `rule_version`, `parameters`, numerical `evidence`, `bar_date`, `source`, `reference_start` / `reference_end`, `direction` and `summary` |

`range20` compares the latest close with the high/low of the previous 20 bars. `volume20` records volume reaching twice the mean of the previous 20 bars. The current bar is excluded from the reference window. A volume observation has no upward/downward price implication. These events create no new trading action and do not contribute to the existing `signal_score`.

MA60 requires 60 valid samples and is never replaced with MA20. MACD requires 35 continuous samples; each RSI period requires period plus 1 samples, with 25 needed for the full RSI set. Unavailable MACD, RSI or volume ratio does not receive points from default states. The existing scoring framework remains, so short-window results can change.

Explicitly pending or estimated trailing bars remain usable for existing intraday `current_price`, moving average and MACD / RSI estimates, with `analysis_warnings`. Such latest bars emit no confirmed rule events and set `indicator_availability.rule_events=false`. Interior pending, estimated or invalid bars, and detected gaps or source/adjustment/unit changes, truncate the window and restart warmup. Legacy daily bars without closure markers remain compatible. This is not complete exchange closure, trading-calendar or provider adjustment validation.

Required daily fields pass BaseFetcher batch validation before indicators and persistence; invalid automatic-provider batches follow existing failover. Explicit/frozen history dates bound both database and network responses, excluding future bars. Zero volume and auction conventions remain compatible; previously discarded rows in stored history cannot be reconstructed. See the Chinese [data-source stability guide](data-source-stability.md).

## Context and Compatibility

`PipelineAnalysisArtifacts` keeps the combined `news_context` and adds optional `news_evidence_context` and `social_context`. With pipeline metadata `news_channels_separated=true`, the builder separates `news` and `social`; legacy callers without the marker retain the original `news_context` behavior. Social-only input or search diagnostics do not supply news evidence. Local intelligence remains a best-effort news addition but is excluded from independent search counts.

`social` carries `social_sentiment_unverified` and `metadata={"auxiliary": true, "quality_weighted": false}`. It does not affect the fixed six quality blocks: `quote`, `daily_bars`, `technical`, `news`, `fundamentals` and `chip`. When `indicator_availability.ma20=false`, history cannot establish a basic trend: `technical` is `missing`, with reason `technical_history_insufficient` and block quality score 35. With MA20 available but other indicators not warmed up, or with a realtime estimated overlay, the block is `partial`. These limits feed the existing Prompt / overview. Agent overview describes initial inputs only, excluding later tool results.

There are no new settings, dependencies, database migrations, public API parameters or real-order capability. No new report action/score contract is introduced. See the existing Chinese [context pack](analysis-context-pack.md) and [intelligence sources](intelligence-sources.md) references.

The public overview uses the stable `technical_input_limited` warning code for localized explanations. Full window diagnostics remain in technical input `analysis_warnings` for analysis.

## Validation and Rollback

Use these deterministic checks for actual search, social, technical and context integration. Execution results belong in the delivery record; listing commands does not claim they passed:

```bash
python -m pytest -q tests/test_search_intel_evidence.py tests/test_search_news_freshness.py tests/test_news_strategy_config.py
python -m pytest -q tests/test_social_sentiment_service.py tests/test_stock_analyzer_evidence.py tests/test_stock_analyzer_rsi.py tests/test_stock_analyzer_bias.py
python -m pytest -q tests/test_analysis_context_builder.py tests/test_analysis_context_pack_prompt.py tests/test_analysis_context_pack_overview.py tests/test_intelligence_analysis_integration.py tests/test_agent_pipeline.py tests/test_pipeline_realtime_indicators.py tests/test_analysis_context_pack_docs.py
python -m pytest -q tests/test_agent_analysis_evidence.py tests/test_analyzer_news_prompt.py tests/test_agent_executor.py
./scripts/ci_gate.sh
```

These checks do not establish live platform/LLM validation, complete exchange closure validation, backtest acceptance or improved profitability. Temporary page/report acceptance screenshots belong in delivery evidence or PR attachments, not repository files.

To roll back, inspect `git diff` and selectively reverse this update's search, social, trend, pipeline, builder, Prompt, test and documentation patches. Preserve unrelated user changes rather than replacing entire files. A deployed release can return to the previous version. No database or configuration migration rollback is required.
