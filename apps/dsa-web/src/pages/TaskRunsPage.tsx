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
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { workspaceApi, type WorkspaceRun, type WorkspaceSchedule } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import { TaskCenterNav } from "../components/tasks/TaskCenterNav";

const TASK_META = {
  research: { label: "单股分析", output: "ResearchReport", icon: Search },
  screening: { label: "选股", output: "ScreenSpec · CandidateList", icon: ListFilter },
  trading: { label: "交易策略", output: "PaperTradingRun · TradeProposal", icon: ShieldCheck },
  expert_review: { label: "专家评审", output: "ExpertReview", icon: History },
  market_analysis: { label: "市场分析", output: "MarketAnalysisReport", icon: History },
  industry_analysis: { label: "产业分析", output: "IndustryReport", icon: Search },
} as const;

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

import { workspaceRunLabel, workspaceRunTone } from "../utils/workspaceOutcome";

export default function TaskRunsPage() {
  const [params, setParams] = useSearchParams();
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const filters = Object.fromEntries(["kind", "status", "query", "stock", "market", "start", "end"].map(key => [key, params.get(key) || undefined]));
  const filterKey = params.toString();
  const filter = (key:string, value:string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete("offset"); setParams(next, {replace:true}); };
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => Promise.all([workspaceApi.runHistory({...filters, offset, limit:30}), workspaceApi.listSchedules()])
      .then(([nextRuns, nextSchedules]) => {
        if (!active) return;
        setRuns(nextRuns.items);
        setTotal(nextRuns.total);
        setCounts(nextRuns.statusCounts);
        setSchedules(nextSchedules);
        setError("");
      })
      .catch(() => active && setError("任务账本读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    void load();
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  // URL parameters are the source of truth for shareable filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);


  return (
    <AppPage className="space-y-6 pb-20" data-testid="task-runs-page">
      <PageHeader
        eyebrow="Task and run ledger"
        title="任务与运行"
        description="按功能、状态和股票查找运行；从结果继续研究、讨论或追踪持仓。日期筛选使用 UTC。"
        actions={<Link to="/schedules" className="btn-primary inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" />创建定时任务</Link>}
      />
      <TaskCenterNav />

      {error ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-3" aria-label="任务运行状态摘要">
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">已注册计划</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : schedules.length}</p><p className="mt-1 text-xs text-muted-text">后端持久化调度</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">匹配运行</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : total}</p><p className="mt-1 text-xs text-muted-text">手动与定时运行</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">正在运行</p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{loading ? "—" : (counts.running || 0) + (counts.queued || 0)}</p><p className="mt-1 text-xs text-muted-text">当前筛选范围内的排队与执行任务</p></div>
      </section>

      <form className="grid gap-3 sm:grid-cols-3" onSubmit={event => event.preventDefault()} aria-label="筛选运行">
        <label className="text-sm">搜索任务<input className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("query") || ""} onChange={e => filter("query", e.target.value)} placeholder="任务名称、问题或运行编号" /></label>
        <label className="text-sm">功能<select className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("kind") || ""} onChange={e => filter("kind", e.target.value)}><option value="">全部功能</option>{Object.entries(TASK_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
        <label className="text-sm">状态<select className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("status") || ""} onChange={e => filter("status", e.target.value)}><option value="">全部状态</option>{Object.entries({queued:"排队中",running:"运行中",completed:"已完成",failed:"失败",cancelled:"已取消"}).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm">股票代码<input className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("stock") || ""} onChange={e => filter("stock", e.target.value)} placeholder="600519 / HK00700 / AAPL" /></label>
        <label className="text-sm">开始日期（UTC）<input type="date" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("start") || ""} onChange={e => filter("start",e.target.value)} /></label>
        <label className="text-sm">结束日期（UTC）<input type="date" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("end") || ""} onChange={e => filter("end",e.target.value)} /></label>
      </form>
      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="run-ledger-heading">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 id="run-ledger-heading" className="font-semibold text-foreground">最近运行</h2></div><p className="mt-1 text-xs leading-5 text-secondary-text">运行状态来自后端账本；失败和中断会保留明确原因。</p></div>
          <Link to="/usage" className="text-sm font-medium text-primary hover:underline">查看模型用量</Link>
        </div>
        {runs.length ? <div className="divide-y divide-border/60">{runs.map((run) => {
          const meta = TASK_META[run.kind];
          const Icon = meta.icon;
          const tone = workspaceRunTone(run);
          return <article key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_11rem_9rem] sm:items-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-secondary-text"><Icon className="h-4 w-4" /></span>
            <div><p className="text-sm font-semibold text-foreground">{run.taskSnapshot?.name || meta.label}</p><p className="mt-1 text-xs text-secondary-text">{meta.label} · {run.taskSnapshot?.market || "—"}</p>{run.errorMessage ? <p className="mt-1 line-clamp-1 text-xs text-danger">{run.errorMessage}</p> : null}</div>
            <div className="text-xs text-secondary-text"><p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatTime(run.startedAt || run.createdAt)}</p><p className="mt-1 text-muted-text">{String(run.taskSnapshot.subject?.stock || run.taskSnapshot.subject?.symbol || "")}</p></div>
            <div className="sm:text-right"><p className={`text-xs font-medium ${tone}`}>{workspaceRunLabel(run)}</p><p className="mt-1 text-[11px] text-muted-text">{run.triggerType === "schedule" ? "定时触发" : "手动触发"}</p><Link to={`/runs/${run.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">查看详情 <ArrowRight className="h-3 w-3" /></Link></div>
          </article>;
        })}</div> : <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"><CalendarClock className="h-7 w-7 text-muted-text" /><p className="mt-4 font-medium text-foreground">没有匹配的运行记录</p><p className="mt-2 max-w-lg text-sm leading-6 text-secondary-text">从个股分析、选股、交易或专家评审页面启动第一个任务。</p><Link to="/stock-research" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">开始个股分析 <ArrowRight className="h-3.5 w-3.5" /></Link></div>}
      </section>

      <nav aria-label="运行历史分页" className="flex items-center justify-between gap-3 text-sm"><button className="btn-secondary" disabled={offset === 0} onClick={() => { const next = new URLSearchParams(params); next.set("offset", String(Math.max(0, offset - 30))); setParams(next); }}>上一页</button><span>共 {total} 条 · 第 {Math.floor(offset / 30) + 1} 页</span><button className="btn-secondary" disabled={offset + 30 >= total} onClick={() => { const next = new URLSearchParams(params); next.set("offset", String(offset + 30)); setParams(next); }}>下一页</button></nav>
      <section className="overflow-hidden rounded-[12px] border border-border bg-background" aria-labelledby="run-contract-heading">
        <div className="border-b border-border px-5 py-4"><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-primary" /><h2 id="run-contract-heading" className="font-semibold text-foreground">每次运行保留什么</h2></div></div>
        <ol className="grid gap-px bg-border sm:grid-cols-4">{["提交时的目标与配置", "使用的工具与专家", "数据来源与时间", "报告与失败原因"].map((item, index) => <li key={item} className="bg-card px-5 py-4"><span className="font-mono text-[10px] text-muted-text">0{index + 1}</span><p className="mt-2 text-xs font-medium text-foreground">{item}</p></li>)}</ol>
      </section>
    </AppPage>
  );
}
