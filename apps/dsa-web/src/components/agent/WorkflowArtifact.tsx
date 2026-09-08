import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { toCamelCase } from "../../api/utils";
import type { AnalysisResult } from "../../types/analysis";
import { ReportSummary } from "../report/ReportSummary";
import { ReportMarkdownBody } from "../report/ReportMarkdownBody";
import { ScreeningCandidateEvidence } from "./ScreeningCandidateEvidence";
import { DecisionReportVisuals } from "../report/DecisionReportVisuals";

type Artifact = { title: string; type: string; content: unknown; text?: string | null };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "未提供";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map(text).join("；") : "未提供";
  return JSON.stringify(value);
};
const hasContent = (value: unknown) => Array.isArray(value) ? value.length > 0 : Boolean(value);
const screeningDiagnostic = (value: unknown): string => {
  const message = text(value);
  if (/LLM ranking failed.*screen_score/i.test(message)) return "智能重排未完成，当前候选使用确定性因子排序。";
  const coverage = message.match(/DSA provider context applied (\d+) of (\d+) candidates/i);
  if (coverage) return `已为 ${coverage[2]} 只候选中的 ${coverage[1]} 只补充数据上下文。`;
  return message;
};
const FIELD_LABELS: Record<string, string> = {
  conclusion: "核心结论", conclusionText: "结论说明", action: "建议", asOf: "数据时点",
  instrument: "股票", risks: "风险", disagreements: "分歧", unverifiedConditions: "待核实条件",
  nextSteps: "后续观察", description: "说明", reason: "原因", note: "补充说明", source: "依据",
  category: "类别", between: "分歧对象", condition: "条件", status: "状态", time: "观察时间",
  confidence: "置信度", keyLevels: "关键价位", support: "支撑", resistance: "阻力",
  stopLoss: "止损", takeProfit: "目标", invalidationConditions: "失效条件", effectiveTradingBar: "有效交易日",
  score: "评分说明", adjustedScore: "调整后评分", rawScore: "原始评分", sentimentScore: "情绪评分",
  scoreBand: "评分区间", signalKey: "信号说明", content: "解读",
  stock: "分析标的", code: "股票代码", name: "名称", price: "参考价格", dataStatus: "数据状态",
  businessQuality: "商业质量", valuation: "估值分析", riskCheck: "风险核验", technical: "技术分析",
  facts: "事实与证据", inference: "推断", opinion: "分析观点", computed: "计算依据",
  summary: "核心结论", strategyScore: "策略评分", finalAction: "策略建议", guardrailReason: "风控依据",
  simulatedTradeProposal: "模拟交易情景", disclaimer: "使用边界", view: "研究观点", scenarios: "观察与应对",
  positionLimit: "仓位约束", timeSensitivity: "适用时段", dataLimitations: "数据缺口",
  decisionScoreCalibration: "评分校准", label: "结论标签", message: "运行说明", warnings: "数据提示",
  pe_ratio: "市盈率 PE", pb_ratio: "市净率 PB", ma_alignment: "均线结构", price_above_ma: "价格与均线",
  bias: "乖离率", macd: "MACD", rsi: "RSI", volume: "量能", pattern: "形态", support_resistance: "支撑与阻力",
  technical_analysis: "技术分析", fundamental_analysis: "基本面分析", news_summary: "新闻与事件", risk_warning: "风险提示",
  business_quality: "商业质量", next_steps: "后续观察", risk_flags: "风险标记", factor_scores: "因子评分",
  reportUrl: "完整研究报告", query_id: "分析历史引用", contract: "报告类型",
  bullTrendSkill: "趋势策略校准",
  actions: "模拟操作提案", orders: "订单提案（不代表成交）", symbol: "标的代码", side: "操作方向",
  quantity: "数量", targetWeight: "目标仓位", targetWeightPercent: "目标仓位（%）", rationale: "提案依据",
  entryPrice: "参考入场价", limitPrice: "限价", riskAssessment: "风险检查", tradeProposal: "交易提案",
  contractPassed: "任务配置校验通过", proposalRiskEvaluated: "已评估提案风险", executionMode: "执行模式",
  hardLimits: "配置的风险边界", realOrderExecutionAllowed: "允许真实下单", executionEnabled: "启用执行",
  realOrdersCreated: "已创建真实订单数", simulatedFillsCreated: "已生成模拟成交数", mode: "模式",
  maxPositions: "最大持仓数", maxPositionPercent: "单股仓位上限（%）", maxDailyLossPercent: "单日亏损上限（%）",
  requireApproval: "要求人工确认", pendingApproval: "等待人工确认", approved: "已确认", rejected: "已拒绝",
};

function InterpretationValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { translate: tx } = useUiLanguage();
  if (Array.isArray(value)) return <ul className="list-disc space-y-3 pl-5">{value.map((item, index) => <li key={index}><InterpretationValue value={item} depth={depth + 1} /></li>)}</ul>;
  if (value !== null && typeof value === "object") return <dl className={depth === 0 ? "divide-y divide-border" : "space-y-3"}>{Object.entries(value).map(([key, item]) => <div key={key} className={depth === 0 ? "py-5 first:pt-0" : ""}><dt className={`mb-2 font-semibold text-foreground ${depth === 0 ? "text-base" : "text-sm"}`}>{tx(FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "))}</dt><dd className="text-sm leading-7 text-secondary-text">{key === "reportUrl" && typeof item === "string" && /^\/runs\/[a-zA-Z0-9-]+$/.test(item) ? <a className="text-primary hover:underline" href={item}>{tx("打开完整研究报告")}</a> : <InterpretationValue value={item} depth={depth + 1} />}</dd></div>)}</dl>;
  return <ReportMarkdownBody content={tx(text(value))} />;
}

const parseObject = (content: string): unknown => {
  try { const value: unknown = JSON.parse(content); return value && typeof value === "object" ? value : undefined; }
  catch { return undefined; }
};

function ResearchObject({ value }: { value: unknown }) {
  const { translate: tx } = useUiLanguage();
  const data = object(value);
  const stock = object(data.stock);
  const conclusion = object(data.conclusion);
  const score = object(conclusion.strategyScore).adjustedScore;
  const valuation = object(object(data.valuation).facts);
  const hasOverview = typeof conclusion.summary === "string";
  if (!hasOverview) return <InterpretationValue value={value} />;
  const remaining = Object.fromEntries(Object.entries(data).filter(([key]) => !["stock", "conclusion", "contract", "query_id", "reportUrl"].includes(key)));
  return <div className="space-y-6">
    <section aria-label={tx("研究结论")} className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-xl font-semibold text-foreground">{text(stock.name || stock.code || tx("研究结论"))}</h3>{stock.asOf ? <p className="mt-1 text-xs text-secondary-text">{tx("数据截至")}{" "}{text(stock.asOf)}</p> : null}</div>
        {typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 && <div className="min-w-32"><p className="text-xs text-secondary-text">{tx("策略评分（非获利概率）")}</p><p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{score}<span className="text-xs font-normal text-muted-text"> / 100</span></p><meter aria-label={tx("策略评分")} min={0} max={100} value={score} className="mt-1 h-2 w-full" /></div>}
      </div>
      <div className="mt-5 text-sm leading-7 text-foreground"><ReportMarkdownBody content={String(conclusion.summary)} /></div>
      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-4">{[[tx("参考价格"), stock.price], [tx("市盈率 PE"), valuation.pe_ratio], [tx("市净率 PB"), valuation.pb_ratio]].filter(([, item]) => typeof item === "number" || typeof item === "string").map(([label, item]) => <div key={tx(String(label))}><dt className="text-xs text-secondary-text">{tx(String(label))}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{text(item)}</dd></div>)}</dl>
      {object(conclusion.strategyScore).guardrailReason ? <p className="mt-4 text-sm leading-6 text-warning">{tx("风控依据：")}{text(object(conclusion.strategyScore).guardrailReason)}</p> : null}
      <details className="mt-4"><summary className="cursor-pointer text-xs text-secondary-text">{tx("评分与结论依据")}</summary><div className="mt-3"><InterpretationValue value={Object.fromEntries(Object.entries(conclusion).filter(([key]) => key !== "summary"))} depth={1} /></div></details>
    </section>
    <InterpretationValue value={remaining} />
    {typeof data.reportUrl === "string" && /^\/runs\/[a-zA-Z0-9-]+$/.test(data.reportUrl) && <a href={data.reportUrl} className="inline-block text-sm text-primary hover:underline">{tx("查看底层策略完整报告 →")}</a>}
  </div>;
}

function ResearchNarrative({ content }: { content: string }) {
  const { translate: tx } = useUiLanguage();
  const value = parseObject(content);
  if (value) return <ResearchObject value={value} />;
  const parts = content.split(/(```(?:json)?\s*\n[\s\S]*?```)/g).filter(Boolean);
  const overviewIndex = parts.findIndex((part) => {
    const match = part.match(/^```(?:json)?\s*\n([\s\S]*?)```$/);
    return match && typeof object(object(parseObject(match[1])).conclusion).summary === "string";
  });
  const renderPart = (part: string, index: number) => {
    const match = part.match(/^```(?:json)?\s*\n([\s\S]*?)```$/);
    if (match) {
      const value = parseObject(match[1]);
      if (value) return <ResearchObject key={index} value={value} />;
      return <details key={index}><summary className="cursor-pointer text-sm text-secondary-text">{tx("展开未能结构化的原始片段")}</summary><ReportMarkdownBody content={part} /></details>;
    }
    return <ReportMarkdownBody key={index} content={part} />;
  };
  if (overviewIndex >= 0) return <div className="space-y-6">{renderPart(parts[overviewIndex], overviewIndex)}<details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-foreground">{tx("分析过程与来源说明")}</summary><div className="mt-4 space-y-5">{parts.map((part, index) => index === overviewIndex ? null : renderPart(part, index))}</div></details></div>;
  return <div className="space-y-5">{parts.map(renderPart)}</div>;
}

function TradeActionDetails({ row }: { row: Record<string, unknown> }) {
  const { translate: tx } = useUiLanguage();
  const fields = {
    quantity: row.quantity ?? row.shares,
    price: row.reference_price ?? row.referencePrice ?? row.entryPrice ?? row.limitPrice,
    targetWeightPercent: row.position_pct_of_equity ?? row.positionPctOfEquity ?? row.targetWeightPercent,
    stopLoss: row.stop_loss ?? row.stopLoss,
    takeProfit: row.take_profit_objective ?? row.takeProfitObjective ?? row.takeProfit,
    rationale: row.rationale ?? row.thesis ?? row.reason,
    condition: row.entry_plan ?? row.entryPlan ?? row.condition,
    risks: row.risk_flags ?? row.riskFlags ?? row.risks,
  };
  const metrics = Object.entries(fields).filter(([key, value]) => ["quantity", "price", "targetWeightPercent", "stopLoss"].includes(key) && value !== undefined);
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">{metrics.map(([key, value]) => <div key={key}><dt className="text-xs text-secondary-text">{tx(FIELD_LABELS[key] || key)}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums text-foreground">{text(value)}</dd></div>)}</dl>
    {[[tx("提案依据"), fields.rationale], [tx("入场条件"), fields.condition], [tx("目标与退出"), fields.takeProfit]].filter(([, value]) => value !== undefined).map(([label, value]) => <div key={tx(String(label))} className="max-w-prose text-sm leading-7"><p className="font-semibold text-foreground">{tx(String(label))}</p><ReportMarkdownBody content={text(value)} /></div>)}
    {Array.isArray(fields.risks) && fields.risks.length > 0 ? <div className="text-sm text-warning"><InterpretationValue value={fields.risks} /></div> : null}
    {(row.technical_evidence || row.technicalEvidence) ? <details><summary className="cursor-pointer text-xs text-secondary-text">{tx("技术依据")}</summary><div className="mt-3"><InterpretationValue value={row.technical_evidence || row.technicalEvidence} /></div></details> : null}
  </div>;
}

function TradingResult({ artifact }: { artifact: Artifact }) {
  const { translate: tx } = useUiLanguage();
  const data = object(artifact.content);
  if (artifact.type === "RiskAssessment") return <div className="space-y-4">
    <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">{data.proposalRiskEvaluated === true ? tx("记录显示已评估提案风险；这不代表允许真实下单或已经成交。") : tx("尚未确认完成提案风险评估。任务配置校验不等于账户、持仓及成交条件风控通过。")}</p>
    <InterpretationValue value={data} />
  </div>;
  if (artifact.type === "PaperTradingRun") return <div className="space-y-4">
    <InterpretationValue value={Object.fromEntries(Object.entries(data).filter(([key]) => !["tradeProposal", "riskAssessment"].includes(key)))} />
    {(data.tradeProposal || data.riskAssessment) ? <details><summary className="cursor-pointer text-sm text-secondary-text">{tx("查看快照中的提案与风险检查")}</summary><div className="mt-3"><InterpretationValue value={{ tradeProposal: data.tradeProposal, riskAssessment: data.riskAssessment }} /></div></details> : null}
  </div>;
  if (Array.isArray(data.actions)) return <div className="space-y-5">
    <div className="border-b border-border pb-5"><p className="text-sm font-medium text-primary">{tx("模拟交易研究报告 · 未执行")}</p><h4 className="mt-2 text-xl font-semibold text-foreground">{text(data.summary || data.strategy || tx("交易计划与条件"))}</h4><p className="mt-3 text-sm leading-6 text-secondary-text">{tx("本报告包含")}{" "}{data.actions.length} {" "}{tx("项操作建议。价格、仓位与风险估算是研究提案，不代表账户风控已通过，也不代表任何订单或成交。")}</p>{(data.data_as_of || data.dataAsOf) ? <p className="mt-2 text-xs text-secondary-text">{tx("数据截至")}{" "}{text(data.data_as_of || data.dataAsOf)}</p> : null}</div>
    <DecisionReportVisuals data={data} kind="trading" />
    <p className="text-xs text-secondary-text">{tx("Agent 生成的模拟提案，不是已执行订单。")}</p>
    {data.actions.length ? <div className="space-y-6">{data.actions.map((action, index) => {
      const row = object(action);
      return <section key={index} className="min-w-0 rounded-xl border border-border p-4 sm:p-6 [&_.home-markdown-prose]:text-secondary-text">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div><h4 className="text-lg font-semibold text-foreground">{text(row.name || row.symbol || row.code || row.stock)}</h4>{Boolean(row.name) && <p className="mt-1 text-xs text-secondary-text">{text(row.symbol ?? row.code ?? row.stock)}</p>}</div>
          <span className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">{({ BUY: tx("买入建议"), SELL: tx("卖出建议"), HOLD: tx("持有观察") } as Record<string, string>)[String(row.side ?? row.action).toUpperCase()] || text(row.side ?? row.action)}</span>
        </header><TradeActionDetails row={row} />
      </section>;
    })}</div> : <p className="text-sm text-secondary-text">{tx("本次提案没有列出模拟操作，不代表已经成交。")}</p>}
    {(data.risks || data.risk_notes || data.riskNotes) ? <section><h4 className="mb-3 font-semibold text-foreground">{tx("风险与失效条件")}</h4><InterpretationValue value={data.risks || data.risk_notes || data.riskNotes} /></section> : null}
    {data.agentRiskDiscussion ? <section><h4 className="mb-3 font-semibold text-foreground">{tx("风险研究与证据缺口")}</h4><p className="mb-3 text-sm text-warning">{tx("以下为 Agent 的风险讨论，未由账户风控引擎核验。")}</p><InterpretationValue value={object(data.agentRiskDiscussion).evidence_gaps || object(data.agentRiskDiscussion).evidenceGaps || object(data.agentRiskDiscussion).risks || tx("详细风险假设见原始提案。")} /></section> : null}
    {(data.watchlist_not_selected || data.watchlistNotSelected) ? <details><summary className="cursor-pointer text-sm text-secondary-text">{tx("未入选标的与原因")}</summary><div className="mt-3"><InterpretationValue value={data.watchlist_not_selected || data.watchlistNotSelected} /></div></details> : null}
  </div>;
  if (typeof data.content === "string") return <ResearchNarrative content={data.content} />;
  return Object.keys(data).length ? <InterpretationValue value={data} /> : <ResearchNarrative content={artifact.text || text(artifact.content)} />;
}

export default function WorkflowArtifact({ artifact, researchPresentation }: { artifact: Artifact; researchPresentation?: "memo" }) {
  const { translate: tx } = useUiLanguage();
  if (artifact.type === "CandidateResearch") {
    const entry = object(artifact.content);
    const report = object(entry.report);
    return <details className="border-t border-border py-4"><summary className="cursor-pointer font-medium">{text(entry.name || entry.symbol)} {" "}{tx("· 完整个股研究")}</summary><div className="mt-4">{report.status === "success" ? <WorkflowArtifact artifact={{ title: artifact.title, type: "ResearchReport", content: report }} /> : <p className="text-sm text-warning">{tx("深研未完成：")}{text(report.message)}{tx("。原筛选结果保留。")}</p>}</div></details>;
  }
  if (artifact.type === "ResearchInterpretation") return <details className="border-t border-border py-4"><summary className="cursor-pointer text-sm font-medium text-secondary-text">{tx("Agent 补充解读与待核实条件")}</summary><div className="mt-4"><InterpretationValue value={artifact.content} /></div></details>;
  if (artifact.type === "ScreenSpec" && !artifact.text) return <details className="border-t border-border py-4"><summary className="cursor-pointer text-sm text-secondary-text">{tx("筛选条件与原始配置")}</summary><div className="mt-4"><ResearchObject value={artifact.content} /></div></details>;
  if (artifact.type === "AgentResponse") return <details className="border-t border-border py-4"><summary className="cursor-pointer text-sm text-secondary-text">{tx("Agent 原始说明（未验证的内容）")}</summary><div className="mt-4"><ResearchNarrative content={artifact.text || text(artifact.content)} /></div></details>;
  const envelope = object(artifact.content);
  const result = object(envelope.result);
  const report = object(result.report);
  const details = object(report.details);
  const isReport = artifact.type === "ResearchReport" && envelope.status === "success"
    && Object.keys(object(report.meta)).length > 0 && Object.keys(object(report.summary)).length > 0;
  const candidates = artifact.type === "CandidateList" && envelope.status === "success" && Array.isArray(result.candidates)
    ? result.candidates : null;
  const screeningFailure = artifact.type === "CandidateList" && (envelope.failure_reason || envelope.failureReason
    || envelope.executionReason || envelope.execution_reason || (envelope.status === "failed" && envelope.message));
  const screeningWarnings = [...new Set([...(Array.isArray(result.warnings) ? result.warnings : []), ...(Array.isArray(result.degradation) ? result.degradation : [])].map(screeningDiagnostic))];
  const envelopeWarnings = Array.isArray(envelope.warnings) ? envelope.warnings.filter((item) => !candidates || !screeningWarnings.includes(screeningDiagnostic(item))) : [];

  return <section className={isReport && researchPresentation === "memo" ? "min-w-0" : "border-t border-border py-4"} aria-label={artifact.title}>
    {!(isReport && researchPresentation === "memo") && <h3 className="mb-3 text-sm font-semibold text-foreground">{{ ResearchReport: tx("研究报告"), CandidateList: tx("候选股票"), ScreenSpec: tx("筛选条件"), ResearchInterpretation: tx("Agent 解读"), TradeProposal: tx("模拟交易提案"), RiskAssessment: tx("风险检查"), PaperTradingRun: tx("模拟执行记录") }[artifact.type] || artifact.title}</h3>}
    {researchPresentation !== "memo" && envelope.workflowVersionId != null && <p className="mb-3 text-xs text-secondary-text">{tx("策略版本 #")}{text(envelope.workflowVersionId)} {" "}{tx("· 运行时间")}{" "}{text(envelope.asOf)}</p>}
    {["TradeProposal", "RiskAssessment", "PaperTradingRun"].includes(artifact.type) ? <TradingResult artifact={artifact} /> : isReport ? <ReportSummary data={toCamelCase<AnalysisResult>(result)} isHistory presentation={researchPresentation} /> : screeningFailure ? <section className="py-4"><h4 className="text-xl font-semibold text-foreground">{tx("未生成选股报告")}</h4><p className="mt-3 max-w-prose text-sm leading-7 text-warning">{text(screeningFailure)}</p><p className="mt-3 text-sm text-secondary-text">{tx("这不是“没有符合条件的股票”，而是本次筛选没有完成。请选择当前市场可用的正式筛选流程后重新运行。")}</p><div className="mt-4"><InterpretationValue value={envelope.risk_notes || envelope.riskNotes || []} /></div></section> : candidates ? <div className="space-y-5">
      <div className="border-b border-border pb-5"><h4 className="text-xl font-semibold text-foreground">{tx("选股研究报告 ·")}{" "}{candidates.length} {" "}{tx("只候选")}</h4><p className="mt-2 text-sm leading-6 text-secondary-text">{tx("市场")}{" "}{({ cn: tx("A 股"), hk: tx("港股"), us: tx("美股") } as Record<string, string>)[String(result.market).toLowerCase()] || text(result.market)} {" "}{tx("· 策略")}{" "}{text(result.strategy_display_name || result.strategyDisplayName || result.strategy)} {" "}{tx("· 来源")}{" "}{(result.snapshot_source || result.snapshotSource) === "last_good_cache" ? tx("最近可用缓存（非实时）") : text(result.snapshot_source || result.snapshotSource)}</p></div>
      <DecisionReportVisuals data={result} kind="screening" />
      {screeningWarnings.length > 0 && <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning"><InterpretationValue value={screeningWarnings} /></div>}
      {(result.llm_market_view || result.llmMarketView) ? <ReportMarkdownBody content={text(result.llm_market_view || result.llmMarketView)} /> : null}
      {(result.strategy_description || result.strategyDescription) ? <p className="max-w-prose text-sm leading-7 text-secondary-text">{text(result.strategy_description || result.strategyDescription)}</p> : null}
      {candidates.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="pb-3 text-left text-xs text-secondary-text">{tx("实际筛选候选；分数为策略评分，不代表获利概率。")}</caption>
        <thead><tr className="border-b border-border text-secondary-text"><th className="p-2">{tx("股票")}</th><th className="p-2">{tx("评分")}</th><th className="p-2">{tx("入选依据")}</th><th className="p-2">{tx("风险")}</th></tr></thead>
        <tbody>{candidates.map((candidate, index) => { const row = object(candidate); return <tr key={`${text(row.code ?? row.symbol)}-${index}`} className="border-b border-border/60 align-top"><td className="p-2">{text(row.name)}<br /><span className="text-xs text-secondary-text">{text(row.code ?? row.symbol)}</span></td><td className="p-2 tabular-nums">{typeof row.score === "number" ? row.score.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : text(row.score)}</td><td className="min-w-40 p-2">{text(row.reason || row.reasons || row.llm_thesis || tx("详见因子明细"))}</td><td className="min-w-32 p-2">{text(row.risks ?? row.risk_flags)}</td></tr>; })}</tbody>
      </table></div> : <p className="text-sm text-secondary-text">{tx("本次没有符合策略条件的候选股票。")}</p>
      }
      {(result.llm_selection_logic || result.llmSelectionLogic) ? <section><h4 className="mb-3 font-semibold text-foreground">{tx("筛选逻辑")}</h4><ReportMarkdownBody content={text(result.llm_selection_logic || result.llmSelectionLogic)} /></section> : null}
      {candidates.length > 0 && <section><h4 className="mb-2 font-semibold text-foreground">{tx("候选研究档案")}</h4>{candidates.map((candidate, index) => <ScreeningCandidateEvidence key={index} row={object(candidate)} />)}</section>}
      {[result.llm_portfolio_risk || result.llmPortfolioRisk, result.portfolio_concentration_notes || result.portfolioConcentrationNotes].some(hasContent) ? <section><h4 className="mb-3 font-semibold text-foreground">{tx("组合风险与集中度")}</h4><InterpretationValue value={[result.llm_portfolio_risk || result.llmPortfolioRisk, result.portfolio_concentration_notes || result.portfolioConcentrationNotes].filter(hasContent)} /></section> : null}
      {(result.ranking_mode || result.rankingMode) ? <p className="text-sm text-secondary-text">{tx("排序方式：")}{String(result.ranking_mode || result.rankingMode).includes("factor") || String(result.ranking_mode || result.rankingMode).includes("screen_score") ? tx("确定性因子排序") : text(result.ranking_mode || result.rankingMode)}{tx("。Agent 解读不改变已计算的候选排名。")}</p> : null}
    </div>
      : artifact.text ? <ResearchNarrative content={artifact.text} /> : <ResearchObject value={artifact.content} />}
    {isReport && researchPresentation !== "memo" && <div className="mt-4">
      {[["technical_analysis", tx("技术分析")], ["fundamental_analysis", tx("基本面分析")], ["news_summary", tx("新闻与事件")], ["risk_warning", tx("风险提示")]].map(([key, label]) => (
        details[key] ? <section key={key} className="mt-5 border-t border-border pt-5"><h4 className="mb-3 text-base font-semibold text-foreground">{label}</h4><ReportMarkdownBody content={text(details[key])} /></section> : null
      ))}
    </div>}
    {envelopeWarnings.length > 0 && <p className="mt-3 text-sm text-warning">{tx("数据与运行提示：")}{envelopeWarnings.map(value => tx(text(value))).join("; ")}</p>}
    <details className="mt-6 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-secondary-text">{tx("查看原始结果与数据覆盖")}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(artifact.content, null, 2)}</pre></details>
  </section>;
}
