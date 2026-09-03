import { ArrowLeft, Clock3, Database, FileCheck2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { workspaceApi, type WorkspaceArtifact, type WorkspaceRun } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import { ReportMarkdownBody } from "../components/report/ReportMarkdownBody";
import { cn } from "../utils/cn";

const STATUS_LABEL: Record<WorkspaceRun["status"], string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

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
  const { runId = "" } = useParams();
  const [run, setRun] = useState<WorkspaceRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const statusTone = run.status === "completed" ? "text-success" : run.status === "failed" ? "text-danger" : run.status === "running" || run.status === "queued" ? "text-warning" : "text-muted-text";

  return (
    <AppPage className="space-y-6 pb-20" data-testid="task-run-detail-page">
      <PageHeader
        eyebrow="Run and artifact"
        title={run.taskSnapshot?.name || "运行详情"}
        description="查看这次运行冻结的任务、数据快照和完整成果。市场看板只引用这里的摘要，不复制或截断正式报告。"
        actions={<Link to="/runs" className="btn-secondary inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />返回任务与运行</Link>}
      />

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4" aria-label="运行信息">
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">运行状态</p><p className={cn("mt-2 text-sm font-semibold", statusTone)}>{STATUS_LABEL[run.status]}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">任务类型</p><p className="mt-2 text-sm font-semibold text-foreground">{run.kind}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">触发方式</p><p className="mt-2 text-sm font-semibold text-foreground">{run.triggerType === "schedule" ? "定时任务" : "手动运行"}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-muted-text">完成时间</p><p className="mt-2 text-sm font-semibold text-foreground">{formatTime(run.completedAt || run.startedAt || run.createdAt)}</p></div>
      </section>

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
        {run.artifacts.length ? <div className="divide-y divide-border">{run.artifacts.map((artifact) => {
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
