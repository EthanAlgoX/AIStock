# 选股与交易报告 / Screening and trading reports

`/screening` 与 `/trading` 沿用个股研究的阅读原则：正式成果与关键数字在前，详细依据、风险、专家意见和原始记录在后。已结束任务的运行上下文置后并折叠；运行中、失败或缺少成果时仍优先显示运行信息。设置、后台运行和历史记录机制不变。

## 选股

成功的 CandidateList 显示扫描范围、过滤后数量、实际候选数量和评分对照。保持服务返回顺序，不重新排名。评分图只接受 0–100 的有限数值，零分保留，缺失与越界不绘条。候选表用于精确查询，研究档案继续展示原有因子、入选依据、催化和失效条件。数据降级提示前置且去重；失败结果仍显示失败原因，不能当作成功的空候选。

## 交易

TradeProposal 的每项 action 独立展示标的、建议方向、数量、参考价、仓位、止损及完整入场/退出条件。仓位图仅接受明确的权益百分比字段（position_pct_of_equity、positionPctOfEquity、targetWeightPercent），不猜测 targetWeight 的单位，也不把多项操作相加推断现金或账户持仓。缺失仓位不填零。

所有内容仍是提案，不是订单或成交；RiskAssessment、PaperTradingRun 中的配置校验、风险评估、审批和执行记录保留原始语义，不以模型的 approved 文案判定授权。未增加任何下单、审批或执行操作。

## 专家与兼容性

历史主持汇总若 `structuredConclusion` 为空，先尝试解析原始 JSON 或单一 JSON 代码块。若整体因引号等错误无法解析，仅兼容两空格缩进的顶层字段：逐字段严格解析完整值，失败字段不修复、不猜测，在页面明确提示部分内容未能整理。有效结论、共识清单、风险和下一步转为报告，显示条目数量；复杂信心说明保留原文，不从文字提取百分比。完全无法解析时显示恢复说明，JSON 仅保存在默认折叠的原始记录入口。

Legacy host summaries with missing structured data are parsed from valid JSON or one fenced block. Damaged two-space-indented exports permit strict parsing of independently complete top-level values only; failed values are not repaired or inferred. A visible partial-format warning accompanies recovered content. JSON never falls back into the report body; the full original stays in a closed source disclosure. Descriptive confidence is not converted into a numeric score.

两类工作区复用个股的专家评审组件：主持汇总、专家立场与自评信心、意见切换、证据与反证、风险和原始记录。只合并相同意见快照，保留不同版本。候选单股深研仍保留原展示模式。API、报告载荷及存储不变；旧 Markdown / 非结构化成果继续兼容。

## English summary

Screening leads with recorded scan/filter/candidate counts and 0–100 score comparisons, preserves returned order, and surfaces degradation warnings before detailed evidence. Trading uses separate instrument plans and explicit proposed equity percentages, never inferred holdings, cash or executed orders. Missing/invalid values remain unavailable. Both workspaces reuse expert synthesis and selectable evidence views. UI labels are localized; historical prose stays unchanged. No model calls, approvals, order placement, API changes or data migrations are introduced. Revert the frontend changes and rebuild to roll back. Browser QA uses stored reports, not new trading runs.
