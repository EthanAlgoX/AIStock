import { useUiLanguage } from "../../contexts/UiLanguageContext";
import type { WorkspaceArtifact, WorkspaceRun } from "../../api/workspace";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Drawer } from "../common/Drawer";
import { ReportMarkdownBody } from "../report/ReportMarkdownBody";
import { RoundtableMessageReport } from "../report/RoundtableMessageReport";

const summaryLabels: Record<string, string> = {
  pipeline: "主持人 · 汇总各项任务与衔接缺口",
  debate: "主持人 · 总结共识、分歧与待核实问题",
  voting: "主持人 · 依据独立评审计票总结",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function speaker(artifact: WorkspaceArtifact, mode: string, tx: (text: string, ...values: Array<string | number>) => string) {
  const content = record(artifact.content);
  if (artifact.type === "ExpertReview") return tx(summaryLabels[mode] || "主持人 · 综合总结");
  if (artifact.type === "DiscussionEvidence") return tx("主持人 · 整理议题与公共证据");
  if (artifact.type === "DiscussionPlan") return tx("主持人 · 任务分工");
  if (artifact.type === "DiscussionQuestions") return tx("主持人 · {0}", tx(artifact.title));
  if (artifact.type === "DiscussionVote") return tx("系统 · 独立评审计票");
  if (artifact.type === "ExpertBallot") return tx("独立{0}", tx(artifact.title));
  if (artifact.type === "ExpertOpinion") return tx("{0} · 独立分析", tx(String(content.expertName || artifact.title)));
  if (artifact.type === "ExpertResponse") return tx("{0} · 第 {1} 轮回应", tx(String(content.expertName || artifact.title)), String(content.round || "?"));
  return artifact.title;
}

/** Public, persisted outputs only; no invented progress or private reasoning. */
export default function DiscussionTimeline({ run }: { run: WorkspaceRun }) {
  const { translate: tx } = useUiLanguage();
  const [report, setReport] = useState<WorkspaceArtifact>();
  const mode = String(run.taskSnapshot.config.collaborationMode || "debate");
  const artifacts = [...run.artifacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const names = new Map(run.artifacts.filter((a) => a.type === "ExpertOpinion").map((a) => {
    const data = record(a.content);
    return [String(data.expertId), String(data.expertName || a.title)];
  }));
  const stages = Array.isArray(run.resultSummary?.stages) ? run.resultSummary.stages : [];
  const pending = stages.map(record).filter((stage) => stage.status === "running" || stage.status === "failed");
  return <section aria-label={tx("讨论对话")} className="space-y-6">
    <div className="ml-auto max-w-[85%] rounded-xl border border-border bg-background px-4 py-3">
      <p className="mb-2 flex items-center justify-end gap-2 text-xs font-medium text-secondary-text">{tx("你 · 讨论议题")}<span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{tx("我")}</span></p>
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{run.taskSnapshot.objective}</p>
    </div>
    <ol aria-label={tx("专家发言时间线")} className="space-y-5">
      {artifacts.map((artifact) => {
        const data = record(artifact.content);
        const vote = artifact.type === "ExpertBallot";
        const label = speaker(artifact, mode, tx);
        return <li key={artifact.id} className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold">{label.slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{label}</h3>
            <time className="text-xs tabular-nums text-secondary-text" dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            {data.status === "failed" && <span className="text-xs text-danger">{tx("本阶段未完成")}</span>}
          </div>
          {vote && <p className="mb-3 text-sm text-secondary-text">{data.status === "failed" ? tx("无效票 · 未计入") : data.expertId == null ? tx("弃权") : tx("投给：{0}", String(names.get(String(data.expertId)) || `专家 ${String(data.expertId)}`))} · {String(data.criterion || tx("报告质量评审"))}</p>}
          {artifact.type === "ExpertReview" ? <div className="w-full min-w-0 rounded-xl border border-primary/30 bg-card p-4 md:p-5"><RoundtableMessageReport content={artifact.content} text={artifact.text} summary /><button type="button" onClick={() => setReport(artifact)} className="mt-4 flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left hover:border-primary focus-visible:ring-2 focus-visible:ring-primary">
            <FileText className="h-7 w-7 shrink-0 text-primary" />
            <span><span className="block text-sm font-semibold">{tx("本轮研究报告")}</span><span className="mt-1 block text-xs leading-5 text-secondary-text">{run.taskSnapshot.name}</span><span className="mt-2 block text-xs text-primary">{tx("打开完整报告")}</span></span>
          </button></div> : ["ExpertOpinion", "ExpertResponse"].includes(artifact.type) ? <div data-testid="expert-message-body" className="w-full min-w-0 rounded-xl border border-border bg-card p-4 md:p-5">
            {artifact.type === "ExpertResponse" && typeof data.question === "string" && <details className="mb-4 border-b border-border pb-3"><summary className="cursor-pointer py-2 text-xs text-secondary-text">{tx("回应主持人质询：")}</summary><ReportMarkdownBody content={data.question} /></details>}
            <RoundtableMessageReport content={artifact.content} text={artifact.text} />
            <button type="button" className="mt-3 min-h-11 text-sm text-primary" onClick={() => setReport(artifact)}>{tx("阅读完整发言")}</button>
          </div> : <div data-testid="expert-message-body" className="w-full min-w-0 overflow-x-auto rounded-xl border border-border bg-card px-4 py-3 md:px-5 md:py-4">
            {artifact.text && artifact.text.length > 900 && <p className="mb-2 text-xs text-secondary-text">{tx("发言摘录 · 完整内容可展开阅读")}</p>}
            {artifact.type === "ExpertResponse" && typeof data.question === "string" && <p className="mb-3 border-b border-border pb-3 text-xs leading-6 text-secondary-text">{tx("回应主持人质询：")}{data.question}</p>}
            <ReportMarkdownBody content={artifact.text && artifact.text.length > 900 ? `${artifact.text.slice(0, 900)}\n\n…` : artifact.text || tx("该阶段无文本记录，请查看运行详情中的结构化证据。")} />
            {artifact.text && artifact.text.length > 900 && <button type="button" className="mt-3 min-h-11 text-sm text-primary" onClick={() => setReport(artifact)}>{tx("阅读完整发言")}</button>}
          </div>}
          </div>
        </li>;
      })}
    </ol>
    {!!pending.length && <div role="status" className="space-y-2 border-t border-border pt-4">{pending.map((stage, index) => <p key={String(stage.id || index)} className="text-sm text-secondary-text">{String(stage.label || "执行阶段").split(" · ").map((part) => /^第 \d+ 轮$/.test(part) ? tx("第 {0} 轮", part.match(/\d+/)![0]) : tx(part)).join(" · ")} · {stage.status === "failed" ? tx("未完成") : run.status === "running" ? tx("执行中，等待发言保存") : tx("已中断，未收到完整发言")}</p>)}</div>}
    {!artifacts.some((a) => a.type === "ExpertReview") && <p role="status" className="text-sm leading-6 text-secondary-text">{run.status === "running" || run.status === "queued" ? tx("专家正在研究，发言完成后逐条显示；主持人将在协作结束后总结。") : tx("本次尚无综合报告，已完成的意见保留在上方。")}</p>}
    <p className="text-xs leading-5 text-secondary-text">{tx("按实际发言保存时间展示，并行专家可能先后返回。这里展示公开分析与协作记录，不展示模型内部思考。")}</p>
    <Drawer isOpen={!!report} onClose={() => setReport(undefined)} title={report?.type === "ExpertReview" ? tx("本轮研究报告") : tx("完整发言")} width="max-w-6xl">
      {report && (["ExpertReview", "ExpertOpinion", "ExpertResponse"].includes(report.type) ? <RoundtableMessageReport content={report.content} text={report.text} summary={report.type === "ExpertReview"} /> : <ReportMarkdownBody content={report.text || tx("暂无报告正文")} />)}
    </Drawer>
  </section>;
}
