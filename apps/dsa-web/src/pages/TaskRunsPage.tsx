import {
  ArrowRight,
  CalendarClock,
  Clock3,
  FileCheck2,
  History,
  ListFilter,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { workspaceApi, type WorkspaceRun, type WorkspaceSchedule } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import { TaskCenterNav } from "../components/tasks/TaskCenterNav";

const TASK_META = {
  research: { label: "单股分析", output: "ResearchReport", icon: Search },
  screening: { label: "选股", output: "ScreenSpec · CandidateList", icon: ListFilter },
  trading: { label: "交易策略", output: "PaperTradingRun · TradeProposal", icon: ShieldCheck },
  expert_review: { label: "专家评审", output: "ExpertReview", icon: History },
} as const;

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

const statusLabel: Record<WorkspaceRun["status"], string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function TaskRunsPage() {
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => Promise.all([workspaceApi.listRuns(), workspaceApi.listSchedules()])
      .then(([nextRuns, nextSchedules]) => {
        if (!active) return;
        setRuns(nextRuns);
        setSchedules(nextSchedules);
        setError("");
      })
      .catch(() => active && setError("任务账本读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    void load();
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const artifactCount = useMemo(() => runs.reduce((total, run) => total + (run.resultSummary?.artifactTypes && Array.isArray(run.resultSummary.artifactTypes) ? run.resultSummary.artifactTypes.length : 0), 0), [runs]);

  return (
    <AppPage className="space-y-6 pb-20" data-testid="task-runs-page">
      <PageHeader
        eyebrow="Task and run ledger"
        title="任务与运行"
        description="统一查看研究、选股、专家评审和交易任务。每次运行都绑定冻结任务、能力清单、数据快照和正式成果。"
        actions={<Link to="/schedules" className="btn-primary inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" />创建定时任务</Link>}
      />
      <TaskCenterNav />

      {error ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-3" aria-label="任务运行状态摘要">
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">已注册计划</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : schedules.length}</p><p className="mt-1 text-xs text-muted-text">后端持久化调度</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">运行实例</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : runs.length}</p><p className="mt-1 text-xs text-muted-text">手动与定时运行</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">正式成果</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : artifactCount}</p><p className="mt-1 text-xs text-muted-text">Artifact 合同计数</p></div>
      </section>

      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="run-ledger-heading">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 id="run-ledger-heading" className="font-semibold text-foreground">最近运行</h2></div><p className="mt-1 text-xs leading-5 text-secondary-text">运行状态来自后端账本；失败和中断会保留明确原因。</p></div>
          <Link to="/usage" className="text-sm font-medium text-primary hover:underline">查看模型用量</Link>
        </div>
        {runs.length ? <div className="divide-y divide-border/60">{runs.map((run) => {
          const meta = TASK_META[run.kind];
          const Icon = meta.icon;
          const tone = run.status === "completed" ? "text-success" : run.status === "failed" ? "text-danger" : run.status === "running" || run.status === "queued" ? "text-warning" : "text-muted-text";
          return <article key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_11rem_9rem] sm:items-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-secondary-text"><Icon className="h-4 w-4" /></span>
            <div><p className="text-sm font-semibold text-foreground">{run.taskSnapshot?.name || meta.label}</p><p className="mt-1 text-xs text-secondary-text">{meta.label} · {run.taskSnapshot?.market || "—"} · {meta.output}</p>{run.errorMessage ? <p className="mt-1 line-clamp-1 text-xs text-danger">{run.errorMessage}</p> : null}</div>
            <div className="text-xs text-secondary-text"><p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatTime(run.startedAt || run.createdAt)}</p><p className="mt-1 text-muted-text">Snapshot {run.dataSnapshotId?.slice(0, 8)}</p></div>
            <div className="sm:text-right"><p className={`text-xs font-medium ${tone}`}>{statusLabel[run.status]}</p><p className="mt-1 text-[11px] text-muted-text">{run.triggerType === "schedule" ? "定时触发" : "手动触发"}</p></div>
          </article>;
        })}</div> : <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"><CalendarClock className="h-7 w-7 text-muted-text" /><p className="mt-4 font-medium text-foreground">还没有运行记录</p><p className="mt-2 max-w-lg text-sm leading-6 text-secondary-text">从个股分析、选股、交易或专家评审页面启动第一个任务。</p><Link to="/stock-research" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">开始个股分析 <ArrowRight className="h-3.5 w-3.5" /></Link></div>}
      </section>

      <section className="overflow-hidden rounded-[12px] border border-border bg-background" aria-labelledby="run-contract-heading">
        <div className="border-b border-border px-5 py-4"><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-primary" /><h2 id="run-contract-heading" className="font-semibold text-foreground">正式运行合同</h2></div></div>
        <ol className="grid gap-px bg-border sm:grid-cols-4">{["TaskSpec · 冻结任务", "CapabilityBinding · 锁定能力", "DataSnapshot · 固定事实", "Artifact · 保存成果"].map((item, index) => <li key={item} className="bg-card px-5 py-4"><span className="font-mono text-[10px] text-muted-text">0{index + 1}</span><p className="mt-2 text-xs font-medium text-foreground">{item}</p></li>)}</ol>
      </section>
    </AppPage>
  );
}
