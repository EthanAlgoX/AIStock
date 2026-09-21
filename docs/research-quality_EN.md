# Research output quality

[简体中文](research-quality.md)

## Trade prices

Single-call analysis and Agent reports share price validation, also applied before history persistence and DecisionSignal extraction. A long scenario requires stop < entry < target; primary and secondary entries are checked separately. When the primary plan is consistent but the alternate entry has no matching stop/target, only the alternate entry is removed, with a warning that it needs a separate plan. Unparseable prices remain missing. NaN, infinity, negative values and booleans are not prices. An explicit “no entry” statement must not turn a later moving-average watch level into an entry price.

Contradictory plans receive `dashboard.battle_plan.price_validation.status=invalid`. Their four sniper_points are cleared, the conflicting execution plan is replaced, and a warning is added. Extractors cannot restore these prices from the raw model response. Buy/add actions become watch; existing sell/reduce intentions are not automatically changed. Raw model text is audit material, not an executable instruction. Existing historical records are not rewritten.

For complete, consistent prices, `price_validation.risk_reward_ratio` is computed as `(take_profit - ideal_buy) / (ideal_buy - stop_loss)`, with `entry_basis=ideal_buy`. Model-authored ratios in the target field are removed. This validates a price scenario, not entry conditions, fills or fees; `execution_authorized` is always false. Incomplete plans do not receive fabricated entries or stops.

This is a conservative check on the existing free-text price contract, not a proof of arbitrary natural-language trading plans. Complex ranges and intraday/closing conditions still require the structured strategy executor; research prose must not be submitted as order parameters.

## Evidence and missing data

Single-call, single-Agent and decision-Agent prompts distinguish facts, inferences, missing evidence and holding state. Historical or peer-relative valuation claims require supplied dated evidence. Missing news does not establish the absence of adverse news.

When the regular pipeline confirms zero news items, it replaces the news summary, dashboard news conclusion and news checklist items with an explicit unassessed-risk message and adds a warning. Unknown counts do not overwrite existing content. Agents use the shared evidence instructions; this is not comprehensive fact checking of arbitrary generated prose. Validation warnings support Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Historical dates and screening

`DatabaseManager.get_analysis_context(code, target_date)` returns only the latest two bars on or before the requested date. Non-trading dates resolve to preceding bars; no eligible data returns None. This does not freeze news, live quotes or other context; a historical replay must fix all inputs.

Screening defaults to strict Top-N. Near-score rotation requires an explicit `variant_seed`. Identical ordered candidates, scores, strategy version and seed produce identical selection; run IDs and wall-clock dates no longer perturb it. Changing market inputs or stochastic model responses can still change results.

Screening adds risk level `unknown` when penalties would otherwise imply low risk but daily quality, LLM risk evidence or industry data is incomplete. Medium/high risk remains unchanged and missing coverage appears in risk_flags. Factor scores and veto thresholds are unchanged. Clients must treat unknown as unassessed, not low.

## Validation and scope

Regression cases cover identical entry/stop prices, incorrect ratios, no-entry statements, raw-response recovery, signal downgrades, five-language warnings, future bars, identical seeds with different run IDs, and missing risk evidence.

This change does not alter model quotas/billing, member-call budgets or real trading channels, and does not claim end-to-end deadlines or improved investment returns. Deadline tuning, online member-path comparisons and larger evaluation sets require separate validation.
