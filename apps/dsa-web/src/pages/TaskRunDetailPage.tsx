import { ArrowLeft, Clock3, Database, FileCheck2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { workspaceApi, type WorkspaceArtifact, type WorkspaceRun } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import { ReportMarkdownBody } from "../components/report/ReportMarkdownBody";
import WorkflowArtifact from "../components/agent/WorkflowArtifact";
import RunStages from "../components/agent/RunStages";
import { cn } from "../utils/cn";

import { visibleWorkspaceArtifacts, workspaceRunLabel, workspaceRunTone } from "../utils/workspaceOutcome";

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
};

const artifactText = (artifact: WorkspaceArtifact) => {
  const raw = artifact.text?.trim();
  if (!raw || raw.startsWith("{") || raw.startsWith("[")) return "";
  return raw;
};

export default function TaskRunDetailPage() {
  const navigate = useNavigate();
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const { runId = "" } = useParams();
  const [run, setRun] = useState<WorkspaceRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const runStatus = run?.status;

  useEffect(() => {
    let active = true;
    void workspaceApi.getRun(runId)
      .then((value) => {
        if (!active) return;
        setRun(value);
        setError("");
      })
      .catch(() => active && setError("无法读取这次运行，记录可能已删除或服务暂时不可用。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [runId]);

  useEffect(() => {
    if (!runStatus || !["queued", "running"].includes(runStatus)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void workspaceApi.getRun(runId).then((value) => {
        if (active) setRun(value);
      }).catch(() => { /* Keep the saved report visible and retry next interval. */ });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [runId, runStatus]);

  if (loading) {
    return <AppPage className="flex min-h-[32rem] items-center justify-center"><p className="flex items-center gap-2 text-sm text-muted-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取完整成果…</p></AppPage>;
  }

  if (!run || error) {
    return (
      <AppPage className="space-y-6 pb-20">
        <PageHeader title="运行详情不可用" description={error || "没有找到对应运行记录。"} actions={<Link to="/runs" className="btn-secondary inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />返回任务与运行</Link>} />
      </AppPage>
    );
  }

  const statusTone = workspaceRunTone(run);
  const subject = run.taskSnapshot.subject || {};
  const symbol = String(subject.stock || subject.stockCode || subject.symbol || "");
  const universe = subject.resolvedUniverse as {symbols?:string[]; sourceRunId?:string;asOf?:string} | undefined;
  const sourceId = String(universe?.sourceRunId || run.taskSnapshot.config?.sourceRunId || run.taskSnapshot.config?.parentDiscussionRunId || run.resultSummary?.parentRunId || "");
  const kinds = {research:"个股研究",screening:"选股",trading:"交易提案",expert_review:"专家讨论",market_analysis:"市场分析",industry_analysis:"产业分析"};
  const active = ["queued", "running"].includes(run.status);
  const act = async () => {
    if (acting) return;
    setActing(true);setActionError("");
    try {
      if (active) { await workspaceApi.cancelRun(run.id);setRun(await workspaceApi.getRun(run.id)); }
      else {
        const task = await workspaceApi.createTask({kind:run.kind,name:run.taskSnapshot.name,market:run.taskSnapshot.market,objective:run.taskSnapshot.objective,subject:run.taskSnapshot.subject,config:run.taskSnapshot.config,capabilities:run.taskSnapshot.capabilities});
        const next = await workspaceApi.runTask(task.id);navigate(`/runs/${next.id}`);
      }
    } catch {setActionError("操作未确认，请检查运行列表后重试；原运行记录已保留。");}
    finally {setActing(false);}
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="task-run-detail-page">
      <PageHeader
        eyebrow="Run and artifact"
        title={run.taskSnapshot?.name || "运行详情"}
        description="查看这次运行冻结的任务、数据快照和完整成果。市场看板只引用这里的摘要，不复制或截断正式报告。"
        actions={<div className="flex flex-wrap gap-2"><Link to={`/overview?runId=${encodeURIComponent(run.id)}`} className="btn-secondary">继续问 Agent</Link><Link to="/runs" className="btn-secondary inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />返回任务与运行</Link></div>}
      />

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4" aria-label="运行信息">
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">运行状态</p><p className={cn("mt-2 text-sm font-semibold", statusTone)}>{workspaceRunLabel(run)}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">任务类型</p><p className="mt-2 text-sm font-semibold text-foreground">{kinds[run.kind]}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">触发方式</p><p className="mt-2 text-sm font-semibold text-foreground">{run.triggerType === "schedule" ? "定时任务" : run.triggerType === "agent_tool" ? "主 Agent" : "手动运行"}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">完成时间</p><p className="mt-2 text-sm font-semibold text-foreground">{run.completedAt ? formatTime(run.completedAt) : "尚未完成"}</p></div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="继续处理这份结果">
        <div className="flex flex-wrap gap-3">
          {symbol && <Link className="btn-secondary" to={`/stock-research?stock=${encodeURIComponent(symbol)}`}>查看 {symbol} 的股票档案</Link>}
          {sourceId && <Link className="btn-secondary" to={`/runs/${encodeURIComponent(sourceId)}`}>查看来源运行</Link>}
          {!active && run.kind === "screening" && <Link className="btn-secondary" to={`/trading?sourceRun=${encodeURIComponent(run.id)}`}>以此候选生成交易提案</Link>}
          {!active && <Link className="btn-secondary" to={`/expert-review?sourceRun=${encodeURIComponent(run.id)}`}>基于此结果请专家讨论</Link>}
          {!run.resultSummary?.externalExecutor && <button className="btn-secondary" disabled={acting || Boolean(run.cancelRequested)} onClick={() => void act()}>{acting ? "处理中…" : active ? run.cancelRequested ? "已请求停止" : "停止本次运行" : "按原配置重新运行（产生新消耗）"}</button>}
        </div>
        {universe && <p className="text-sm text-secondary-text">本次冻结股票：{universe.symbols?.join("、")} · 来源时点：{universe.asOf ? formatTime(universe.asOf) : "提交时的自选 / 持仓"}。仅生成提案，无订单与模拟成交。</p>}
        <p className="text-sm text-secondary-text">本次模型用量：{run.usage?.recorded ? `${run.usage.tokens.toLocaleString()} tokens · ${run.usage.calls} 次调用 · 其中估算 ${run.usage.estimatedTokens.toLocaleString()} tokens` : "暂无可归属的用量记录，不能视为零消耗"}。独立子运行用量在各自详情查看。</p>
        {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
      </section>
      <RunStages run={run} />
      {run.outcome && <p role="status" className={`text-sm leading-6 ${statusTone}`}>{run.outcome.message}</p>}
      {run.errorMessage ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{run.errorMessage}</p> : null}

      <section className="overflow-hidden rounded-[12px] border border-border bg-card" aria-labelledby="run-context-title">
        <div className="border-b border-border px-5 py-4"><h2 id="run-context-title" className="text-sm font-semibold text-foreground">运行上下文</h2></div>
        <div className="grid gap-5 px-5 py-5 text-sm sm:grid-cols-3">
          <div className="flex items-start gap-2.5"><Clock3 className="mt-0.5 h-4 w-4 text-primary" /><div><p className="font-medium text-foreground">数据时点</p><p className="mt-1 text-xs text-muted-text">{formatTime(run.dataSnapshot?.asOf)}</p></div></div>
          <div className="flex items-start gap-2.5"><Database className="mt-0.5 h-4 w-4 text-primary" /><div><p className="font-medium text-foreground">数据源</p><p className="mt-1 break-words text-xs text-muted-text">{run.dataSnapshot?.sourceIds?.join("、") || "未记录"}</p></div></div>
          <div className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /><div><p className="font-medium text-foreground">快照标识</p><p className="mt-1 break-all font-mono text-[11px] text-muted-text">{run.dataSnapshotId}</p></div></div>
        </div>
      </section>

      <section aria-labelledby="artifacts-title">
        <div className="flex items-end justify-between gap-3 border-b border-border pb-3">
          <div><h2 id="artifacts-title" className="text-base font-semibold text-foreground">完整成果</h2><p className="mt-1 text-xs text-muted-text">共 {run.artifacts.length} 个 Artifact，按本次运行顺序展示。</p></div>
          <FileCheck2 className="h-5 w-5 text-primary" />
        </div>
        {run.artifacts.length ? <div className="divide-y divide-border">{visibleWorkspaceArtifacts(run.artifacts).map((artifact) => {
          if (["ResearchReport", "CandidateList", "ScreenSpec", "AgentResponse", "ResearchInterpretation", "TradeProposal", "RiskAssessment", "PaperTradingRun"].includes(artifact.type) || (artifact.content && typeof artifact.content === "object" && "workflowVersionId" in artifact.content)) {
            return <WorkflowArtifact key={artifact.id} artifact={artifact} />;
          }
          const markdown = artifactText(artifact);
          return (
            <article key={artifact.id} className="py-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div><p className="text-xs font-medium text-primary">{artifact.type}</p><h3 className="mt-1 text-base font-semibold text-foreground">{artifact.title}</h3></div>
                <span className="text-[11px] text-muted-text">{formatTime(artifact.createdAt)} · v{artifact.version}</span>
              </div>
              <div className="mt-5 rounded-[10px] border border-border bg-background px-4 py-4 sm:px-5">
                {markdown ? <ReportMarkdownBody content={markdown} /> : <pre className="max-h-[48rem] overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-secondary-text">{JSON.stringify(artifact.content, null, 2)}</pre>}
              </div>
            </article>
          );
        })}</div> : <p className="py-10 text-center text-sm text-muted-text">本次运行还没有生成正式成果。</p>}
      </section>
    </AppPage>
  );
}
