---
version: 1
slug: "apps-dsa-web-src-pages-stockanalysispage-tsx"
primary_target: "apps/dsa-web/src/pages/StockAnalysisPage.tsx"
related_targets: ["apps/dsa-web/src/components/report/ResearchMemo.tsx"]
---

# Stock research memorandum

Mode: Read. Scope: the formal stock-report reader at /stock-research, not the global identity.
The user approved A research memorandum plus B evidence comparison. Approved preview: .impeccable/mocks/research-memo.png; supporting comparison: .impeccable/mocks/research-evidence.png. Preview claims and sources are illustrative and must not be copied into reports.

THESIS: lead with the recorded thesis and inspectable positive/negative evidence, not a sentiment dashboard.
OWN-WORLD: existing neutral light/dark surfaces, cobalt controls, system typography, ruled sections.
STORY: understand the conclusion, inspect evidence and limitations, review conditions, trace sources.
FIRST VIEWPORT: stock masthead, compact thesis, paired arc score gauges and a vertical price map. After rejecting both text-only and weak bar/dot treatments, the user requested borrowing the reference project's visual structure. Retain neutral/cobalt styling without glow; show four conditional reference panels before detailed evidence. Price marks use a true shared numeric axis with separated leader-line labels. Narrative uses full width; mobile stacks panels and keeps the limitations link visible.
FORM: approved A + B, semantic document and evidence columns; no synthetic charts, consensus or forecasts.

Implementation inventory: masthead, navigation, comparison, conditions and boundary notes use semantic HTML/Tailwind; original prose uses existing Markdown renderer; disclosures reuse report diagnostics/news/raw-data components; no raster assets in product UI.
Keep original report data, independent-agent claims, backend tasks and default membership unchanged. Plain Markdown/unmatched structures retain legacy rendering. Historical reports are not live market data. Image export keeps its existing layout.
Evidence screenshots remain local under output/playwright; no acceptance screenshots or generated comps are committed.

Expert-report continuation: retain the approved leading charts. Group persisted ExpertOpinion/ExpertReview artifacts into host synthesis, selectable position/confidence comparisons, and full-width claim/evidence/counterevidence reading. Collapse detailed synthesis, risks and raw records; merge identical aggregate copies only. Preserve differing snapshots and failures; never synthesize consensus or scores. Mobile stacks the opinion selectors and evidence columns.
