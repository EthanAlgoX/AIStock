# Report visualization and calculated charts

Chat, research, expert discussions and run artifacts share chart rendering and improved prose spacing, headings and wrapping tables. Market reviews also chart existing index percentage changes. Historical prose remains readable and is never converted into invented numeric data.

Ask the Agent to calculate margins from retrieved revenue and cost, plot them and include sources. `build_analysis_chart` belongs to default task tool sets; frozen tasks retain their bindings and disabled tools stay disabled. Chart use depends on the model and available evidence.

Supported charts: lines, grouped bars with one unit, and conditional relationships. Figures identify observed, scenario or illustrative data; supplied sources are not independently verified. Numeric charts offer series toggles, value/input tables, formulas and SVG downloads. Narrow screens scroll charts horizontally. Missing values and division by zero remain gaps; categories are equally spaced in input order, not proportional to elapsed time.

The `spec` requires `type`, `title`, `source`; `basis` is observed/scenario/illustrative. Optional fields: `asOf`, `unit`, `description`. Numeric data uses `data: [{label, revenue, cost}]` and `series: [{name, expression: "(revenue - cost) / revenue * 100"}]`. Flows use string `nodes` and `edges: [{from, to, label}]` with zero-based indexes.

This is bounded programmable arithmetic and charting, not a general Python interpreter. Numeric columns, constants, parentheses and + - * / are allowed; imports, calls, attributes, filesystem, network and shell are unavailable. Limits: 120 rows, 4 series, 12 input columns; flows have at most 12 nodes and 20 edges. Existing permissions, cancellation and workspace isolation apply. No new environment variables or database migrations.

The tool returns a version 1 `analysis-chart` Markdown fence to embed verbatim. The frontend validates it again and renders SVG without executing code or raw HTML. Invalid, unsupported or incomplete streamed fences remain expandable source. Other notification/export consumers may show the code fence; flow SVG export is not supported. Charts persist in existing conversations/reports. Model tokens use the existing ledger; the calculation tool makes no model calls.

Rollback to the preceding image while preserving databases. Older clients display chart fences as source code.
