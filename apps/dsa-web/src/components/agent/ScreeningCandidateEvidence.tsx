import { ReportMarkdownBody } from "../report/ReportMarkdownBody";

const labels: Record<string, string> = {
  value: "估值", liquidity: "流动性", momentum: "动量", reversal: "反转",
  activity: "活跃度", stability: "稳定性", size: "规模", theme_heat: "题材热度", topic_alignment: "题材匹配",
};
const narrative = (value: unknown) => typeof value === "string" ? value : Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").join("；") : "";

/** Show only returned evidence; missing scores are not zero and missing risks are not safety. */
export function ScreeningCandidateEvidence({ row }: { row: Record<string, unknown> }) {
  const factors = row.factor_scores ?? row.factorScores;
  const entries = factors && typeof factors === "object" && !Array.isArray(factors)
    ? Object.entries(factors).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])) : [];
  const sections = [
    ["入选依据", row.llm_thesis || row.llmThesis || row.reason || row.reasons],
    ["数据增强摘要", row.dsa_analysis_summary || row.dsaAnalysisSummary],
    ["催化因素", row.llm_catalysts || row.llmCatalysts],
    ["后续观察", row.llm_watch_items || row.llmWatchItems],
    ["失效条件", row.llm_invalidators || row.llmInvalidators],
    ["风险与失效条件", [narrative(row.risk_flags ?? row.riskFlags), narrative(row.llm_risks ?? row.llmRisks)].filter(Boolean)],
  ].map(([label, value]) => [String(label), narrative(value)]).filter(([, value]) => value);
  return <details className="border-b border-border py-4">
    <summary className="cursor-pointer text-sm font-medium text-foreground">{String(row.name || row.code || row.symbol || "候选股票")} · 研究依据与因子明细</summary>
    <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-5">{sections.map(([label, value]) => <section key={label}><h5 className="mb-2 text-sm font-semibold text-foreground">{label}</h5><ReportMarkdownBody content={value} /></section>)}{!sections.length && <p className="text-sm text-secondary-text">本次未返回详细研究依据。</p>}</div>
      <section className="min-w-0"><h5 className="mb-3 text-sm font-semibold text-foreground">因子评分</h5><p className="mb-4 text-xs text-secondary-text">策略内部评分，不是收益预测或获利概率。</p>
        {entries.length ? <dl className="space-y-4">{entries.map(([key, value]) => <div key={key}><div className="flex justify-between gap-3 text-sm"><dt>{labels[key] || key}</dt><dd className="tabular-nums">{value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</dd></div>{value >= 0 && value <= 100 && <meter aria-label={`${labels[key] || key}评分`} min={0} max={100} value={value} className="mt-1 h-2 w-full accent-primary" />}</div>)}</dl> : <p className="text-sm text-secondary-text">未返回因子明细。</p>}
      </section>
    </div>
  </details>;
}
