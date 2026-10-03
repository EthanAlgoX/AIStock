import { useUiLanguage } from "../contexts/UiLanguageContext";
import { uiLocale } from "../utils/uiLanguage";
import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
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

const formatTime = (value: string | null | undefined, locale: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

import { workspaceRunLabel, workspaceRunTone } from "../utils/workspaceOutcome";

export default function TaskRunsPage() {
  const uiLiteral = useUiLiteral();
  const { language, t } = useUiLanguage();
  const [params, setParams] = useSearchParams();
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const filters = Object.fromEntries(["kind", "status", "query", "stock", "market", "start", "end"].map(key => [key, params.get(key) || undefined]));
  const filterKey = params.toString();
  const filter = (key:string, value:string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete("offset"); setParams(next, {replace:true}); };
  const [retry, setRetry] = useState(0);
  const requestKey = `${filterKey}:${retry}`;
  const [result, setResult] = useState<{ key: string; runs: WorkspaceRun[]; schedules: WorkspaceSchedule[]; total: number; counts: Record<string, number>; error?: string }>();
  const current = result?.key === requestKey ? result : undefined;
  const runs = current?.runs || [];
  const schedules = current?.schedules || [];
  const total = current?.total ?? 0;
  const counts = current?.counts || {};
  const loading = !current;
  const error = current?.error || "";
  const summaryUnknown = loading || Boolean(error);

  useEffect(() => {
    let active = true;
    let pending = false;
    const load = () => {
      if (pending) return;
      pending = true;
      return Promise.all([workspaceApi.runHistory({...filters, offset, limit:30}), workspaceApi.listSchedules()])
      .then(([nextRuns, nextSchedules]) => {
        if (!active) return;
        setResult({ key: requestKey, runs: nextRuns.items, total: nextRuns.total, counts: nextRuns.statusCounts, schedules: nextSchedules });
      })
      .catch(() => { if (active) setResult(previous => ({ key: requestKey, runs: [], schedules: [], total: 0, counts: {}, ...(previous?.key === requestKey ? previous : {}), error: "任务账本读取失败，请稍后重试。" })); })
      .finally(() => { pending = false; });
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  // URL parameters are the source of truth for shareable filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);


  return (
    <AppPage className="space-y-6 pb-20" data-testid="task-runs-page">
      <PageHeader
        eyebrow={uiLiteral("任务运行账本")}
        title={uiLiteral("任务与运行")}
        description={uiLiteral("按功能、状态和股票查找运行；从结果继续研究、讨论或追踪持仓。日期筛选使用 UTC。")}
        actions={<Link to="/schedules" className="btn-primary inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" /><UiLiteral text={"创建定时任务"} /></Link>}
      />
      <TaskCenterNav />

      {error ? <p role="alert" className="flex flex-wrap items-center justify-between gap-3 border-y border-danger/25 py-3 text-sm text-danger">{uiLiteral(error)}<button className="btn-secondary" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></p> : null}

      <section className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label={uiLiteral("任务运行状态摘要")}>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"已注册计划"} /></p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{summaryUnknown ? "—" : schedules.length}</p><p className="mt-1 text-xs text-muted-text"><UiLiteral text={"后端持久化调度"} /></p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"匹配运行"} /></p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{summaryUnknown ? "—" : total}</p><p className="mt-1 text-xs text-muted-text"><UiLiteral text={"手动与定时运行"} /></p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"正在运行"} /></p><p className="mt-2 font-mono text-2xl font-semibold text-foreground">{summaryUnknown ? "—" : (counts.running || 0) + (counts.queued || 0)}</p><p className="mt-1 text-xs text-muted-text"><UiLiteral text={"当前筛选范围内的排队与执行任务"} /></p></div>
      </section>

      <form className="grid gap-3 sm:grid-cols-3" onSubmit={event => event.preventDefault()} aria-label={uiLiteral("筛选运行")}>
        <label className="text-sm"><UiLiteral text={"搜索任务"} /><input className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("query") || ""} onChange={e => filter("query", e.target.value)} placeholder={uiLiteral("任务名称、问题或运行编号")} /></label>
        <label className="text-sm"><UiLiteral text={"功能"} /><select className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("kind") || ""} onChange={e => filter("kind", e.target.value)}><option value=""><UiLiteral text={"全部功能"} /></option>{Object.entries(TASK_META).map(([key, meta]) => <option key={key} value={key}>{uiLiteral(meta.label)}</option>)}</select></label>
        <label className="text-sm"><UiLiteral text={"状态"} /><select className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("status") || ""} onChange={e => filter("status", e.target.value)}><option value=""><UiLiteral text={"全部状态"} /></option>{Object.entries({queued:"排队中",running:"运行中",completed:"已完成",failed:"失败",cancelled:"已取消"}).map(([key,label]) => <option key={key} value={key}>{uiLiteral(label)}</option>)}</select></label>
        <label className="text-sm"><UiLiteral text={"股票代码"} /><input className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("stock") || ""} onChange={e => filter("stock", e.target.value)} placeholder="600519 / HK00700 / AAPL" /></label>
        <label className="text-sm"><UiLiteral text={"开始日期（UTC）"} /><input type="date" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("start") || ""} onChange={e => filter("start",e.target.value)} /></label>
        <label className="text-sm"><UiLiteral text={"结束日期（UTC）"} /><input type="date" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 w-full" value={params.get("end") || ""} onChange={e => filter("end",e.target.value)} /></label>
      </form>
      <section className="min-w-0 border-y border-border" aria-labelledby="run-ledger-heading" aria-busy={loading}>
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 id="run-ledger-heading" className="font-semibold text-foreground"><UiLiteral text={"最近运行"} /></h2></div><p className="mt-1 text-xs leading-5 text-secondary-text"><UiLiteral text={"运行状态来自后端账本；失败和中断会保留明确原因。"} /></p></div>
          <Link to="/usage" className="text-sm font-medium text-primary hover:underline"><UiLiteral text={"查看模型用量"} /></Link>
        </div>
        {loading ? <p role="status" className="py-12 text-sm text-secondary-text">{t('common.loading')}</p> : runs.length ? <div className="divide-y divide-border/60">{runs.map((run) => {
          const meta = TASK_META[run.kind];
          const Icon = meta.icon;
          const tone = workspaceRunTone(run);
          return <article key={run.id} className="grid min-w-0 gap-3 py-4 md:grid-cols-[2.5rem_minmax(0,1fr)_10rem_8rem] md:items-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-secondary-text"><Icon className="h-4 w-4" /></span>
            <div className="min-w-0"><p className="break-words text-sm font-semibold text-foreground">{run.taskSnapshot?.name || uiLiteral(meta.label)}</p><p className="mt-1 text-xs text-secondary-text">{uiLiteral(meta.label)} · {run.taskSnapshot?.market || "—"}</p>{run.errorMessage ? <p className="mt-1 break-words text-xs text-danger">{uiLiteral(run.errorMessage)}</p> : null}</div>
            <div className="text-xs text-secondary-text"><p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatTime(run.startedAt || run.createdAt, uiLocale(language))}</p><p className="mt-1 text-muted-text">{String(run.taskSnapshot.subject?.stock || run.taskSnapshot.subject?.symbol || "")}</p></div>
            <div className="sm:text-right"><p className={`text-xs font-medium ${tone}`}>{uiLiteral(workspaceRunLabel(run))}</p><p className="mt-1 text-[11px] text-muted-text">{run.triggerType === "schedule" ? uiLiteral("定时触发") : uiLiteral("手动触发")}</p><Link to={`/runs/${run.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><UiLiteral text={"查看详情 "} /><ArrowRight className="h-3 w-3" /></Link></div>
          </article>;
        })}</div> : !error ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center"><CalendarClock className="h-7 w-7 text-muted-text" /><p className="mt-4 font-medium text-foreground"><UiLiteral text={"没有匹配的运行记录"} /></p>{Object.values(filters).some(Boolean) ? <button className="btn-secondary mt-4" onClick={() => setParams({})}>{uiLiteral('清除筛选')}</button> : <><p className="mt-2 max-w-lg text-sm leading-6 text-secondary-text"><UiLiteral text={"从个股分析、选股、交易或专家评审页面启动第一个任务。"} /></p><Link to="/stock-research" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"><UiLiteral text={"开始个股分析 "} /><ArrowRight className="h-3.5 w-3.5" /></Link></>}</div> : null}
      </section>

      <nav aria-label={uiLiteral("运行历史分页")} className="flex flex-wrap items-center justify-between gap-3 text-sm"><button className="btn-secondary" disabled={loading || offset === 0} onClick={() => { const next = new URLSearchParams(params); next.set("offset", String(Math.max(0, offset - 30))); setParams(next); }}><UiLiteral text={"上一页"} /></button><span><UiLiteral text={"共 "} />{summaryUnknown ? "—" : total} <UiLiteral text={" 条 · 第 "} />{Math.floor(offset / 30) + 1} <UiLiteral text={" 页"} /></span><button className="btn-secondary" disabled={loading || offset + 30 >= total} onClick={() => { const next = new URLSearchParams(params); next.set("offset", String(offset + 30)); setParams(next); }}><UiLiteral text={"下一页"} /></button></nav>
      <details className="border-t border-border pt-3">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-secondary-text"><FileCheck2 className="h-4 w-4" /><UiLiteral text={"每次运行保留什么"} /></summary>
        <ul className="mt-2 grid gap-3 pb-4 text-sm text-secondary-text sm:grid-cols-2">{["提交时的目标与配置", "使用的工具与专家", "数据来源与时间", "报告与失败原因"].map(item => <li key={item}>{uiLiteral(item)}</li>)}</ul>
      </details>
    </AppPage>
  );
}
