import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, FileText, Octagon, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { workspaceApi, type WorkspaceRun } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
import WorkflowArtifact from "../components/agent/WorkflowArtifact";
import RunStages from "../components/agent/RunStages";
import DecisionReviewPanel from "../components/agent/DecisionReviewPanel";
import { useWorkspaceRun } from "../hooks/useWorkspaceRun";
import { isRunActive } from "../stores/workspaceRunStore";
import AgentTaskSetupPage from "./AgentTaskSetupPage";
import TradingTaskSetupPage from "./TradingTaskSetupPage";
import DefaultTaskLauncher from "../components/agent/DefaultTaskLauncher";

import { visibleWorkspaceArtifacts, workspaceRunLabel, workspaceRunTone } from "../utils/workspaceOutcome";
const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function RunElapsed({ run }: { run: WorkspaceRun }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isRunActive(run)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.id, run.status, run]);
  const start = Date.parse(run.startedAt || run.createdAt);
  const end = run.completedAt ? Date.parse(run.completedAt) : isRunActive(run) ? now : NaN;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return <span className="tabular-nums">{Number.isFinite(seconds) ? [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":") : "未提供"}</span>;
}

export default function ResearchReportsWorkspace({ mode }: { mode: "research" | "screening" | "trading" }) {
  const { activeRun, submitting, runError, cancelRun } = useWorkspaceRun(mode);
  const trading = mode === "trading";
  const newAction = trading ? "新建模拟运行" : mode === "research" ? "新建单股分析" : "新建选股";
  const statusLabel = workspaceRunLabel;
  const [params, setParams] = useSearchParams();
  const [configOpen, setConfigOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [configVisited, setConfigVisited] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<{ id: string; run?: WorkspaceRun; error?: string }>({ id: "" });
  const ledgerEntries = (activeRun ? [runs.find((run) => run.id === activeRun.id) || activeRun, ...runs.filter((run) => run.id !== activeRun.id)] : [...runs]);
  const entries = ledgerEntries.filter((run) => !run.primaryReportRunId)
    .sort((left, right) => Number(isRunActive(right)) - Number(isRunActive(left)) || Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const requestedId = params.get("run") || (isRunActive(activeRun) ? activeRun?.id : undefined) || entries[0]?.id || "";
  const selectedId = ledgerEntries.find((run) => run.id === requestedId)?.primaryReportRunId || requestedId;
  const selected = selectedId === activeRun?.id ? activeRun : detail.id === selectedId ? detail.run : undefined;
  const reportMeta = runs.find((run) => run.id === selectedId);
  const filtered = entries.filter((run) => `${run.reportTitle || ""} ${run.taskSnapshot.name} ${String(run.taskSnapshot.subject.stock || "")}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    let mounted = true;
    workspaceApi.listRuns(mode).then((items) => {
      if (mounted) { setRuns(items); setLoaded(true); setHistoryError(""); }
    }).catch(() => { if (mounted) { setLoaded(true); setHistoryError("报告目录读取失败，请重试。"); } });
    return () => { mounted = false; };
  }, [mode, activeRun?.id, activeRun?.status, retry]);

  useEffect(() => {
    if (!selectedId || selectedId === activeRun?.id) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const run = await workspaceApi.getRun(selectedId);
        if (!mounted) return;
        setDetail({ id: selectedId, run });
        if (isRunActive(run)) timer = setTimeout(() => void refresh(), 1500);
      } catch {
        if (mounted) {
          setDetail((current) => ({ id: selectedId, run: current.id === selectedId ? current.run : undefined, error: "报告读取失败，正在自动重试。" }));
          timer = setTimeout(() => void refresh(), 3000);
        }
      }
    };
    void refresh();
    return () => { mounted = false; clearTimeout(timer); };
  }, [selectedId, activeRun?.id, retry]);

  const select = (id: string) => setParams((current) => { const next = new URLSearchParams(current); next.set("run", id); return next; });
  return <AppPage className="space-y-5 pb-20">
    <PageHeader title={trading ? "交易" : mode === "research" ? "个股分析" : "选股"}
      description={trading ? "回看模拟交易提案、风险检查与执行记录；策略配置按需展开。" : mode === "research" ? "阅读研究结论、关键价位与风险，回看每一次个股分析。" : "回看筛选结果、候选依据与风险，比较每一次选股报告。"}
      actions={<button className="btn-primary inline-flex items-center gap-2" type="button" aria-expanded={configOpen} aria-controls="new-analysis-config" onClick={() => { setConfigVisited(true); setConfigOpen(!configOpen); }}>{configOpen ? <ChevronDown className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{configOpen ? trading ? "收起策略配置" : "收起分析配置" : newAction}</button>} />
    {!configOpen && <DefaultTaskLauncher kind={mode} onRunStarted={(run) => { select(run.id); setConfigOpen(false); }} />}
    {trading && <p className="flex items-start gap-2 text-sm leading-6 text-secondary-text"><ShieldCheck className="mt-1 h-4 w-4 shrink-0" />模拟盘 · 真实订单始终禁用。生成提案不等于已通过风险评估，也不等于已经成交。</p>}
    {(configOpen || (trading && configVisited)) && <section hidden={!configOpen} id="new-analysis-config" aria-label={trading ? "交易策略配置" : "新建分析配置"} className="border-b border-border pb-4">
      {mode === "trading" ? <TradingTaskSetupPage onRunStarted={(run) => { select(run.id); setConfigOpen(false); }} /> : <AgentTaskSetupPage mode={mode} embedded onRunStarted={(run) => { select(run.id); setConfigOpen(false); }} />}
    </section>}
    {(submitting || isRunActive(activeRun) || runError) && <div role={runError ? "alert" : "status"} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <p>{runError || (submitting ? "正在提交任务，切换页面不会中断。" : trading ? `主 Agent 正在生成模拟交易提案 · ${activeRun?.taskSnapshot.name}` : `${activeRun?.taskSnapshot.name} · 后台分析中，可以继续阅读历史报告。`)}</p>
      {activeRun && <div className="flex items-center gap-4"><button type="button" className="text-primary hover:underline" onClick={() => select(activeRun.id)}>{trading ? "查看本次模拟" : "查看本次分析"}</button>{trading && isRunActive(activeRun) && <button type="button" className="btn-secondary inline-flex items-center gap-2 text-danger" onClick={() => void cancelRun()}><Octagon className="h-4 w-4" />停止</button>}</div>}
    </div>}
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label={trading ? "历史模拟运行" : "历史分析报告"} className="min-w-0 lg:sticky lg:top-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-foreground">历史报告 <span className="ml-1 text-xs font-normal text-muted-text">{entries.length}</span></h2><button type="button" aria-label="刷新报告列表" className="rounded-md p-2 text-secondary-text hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setRetry((value) => value + 1)}><RefreshCw className="h-4 w-4" /></button></div>
        <button type="button" className="mb-3 text-sm text-primary lg:hidden" aria-expanded={historyOpen} aria-controls="report-history-list" onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? "收起历史报告" : "切换历史报告"}</button>
        <div id="report-history-list" className={`${historyOpen ? "block" : "hidden"} lg:block`}>
        <input aria-label="搜索历史报告" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={trading ? "搜索交易策略名称" : "搜索股票名称或代码"} className="mb-3 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary" />
        {historyError && <p role="alert" className="mb-3 text-sm text-danger">{historyError}</p>}
        {!loaded && !entries.length ? <p role="status" className="py-6 text-sm text-secondary-text">正在读取报告目录…</p> : <div className="max-h-64 overflow-y-auto lg:max-h-[calc(100vh-18rem)]">
          {filtered.map((run) => <button key={run.id} type="button" aria-pressed={selectedId === run.id} onClick={() => select(run.id)} className={`mb-1 w-full rounded-lg border px-3 py-3 text-left focus-visible:ring-2 focus-visible:ring-primary ${selectedId === run.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-hover"}`}>
            <span className="block break-words text-sm font-medium text-foreground">{run.reportTitle || run.taskSnapshot.name}</span>
            {typeof run.taskSnapshot.subject.stock === "string" && <span className="mt-1 block text-xs text-secondary-text">{run.taskSnapshot.subject.stock}</span>}
            <span className="mt-2 flex justify-between gap-2 text-xs text-secondary-text"><span>{time(run.createdAt)}</span><span className={workspaceRunTone(run)}>{statusLabel(run)}</span></span>
          </button>)}
          {loaded && !filtered.length && <p className="py-4 text-sm text-secondary-text">{query ? "没有匹配的报告，试试其他名称或代码。" : trading ? "尚无模拟运行记录。" : "尚无历史分析。"}</p>}
        </div>}
        {loaded && entries.length >= 100 && <Link to="/runs" className="mt-3 block text-xs text-primary">查看更早的运行记录</Link>}
        </div>
      </aside>
      <section aria-label={trading ? "模拟交易结果" : "分析报告详情"} className="min-w-0 border-t border-border pt-5 lg:border-t-0 lg:pt-0">
        {selected ? <>
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><h2 className="text-xl font-semibold text-foreground">{selected.taskSnapshot.name}</h2><p className="mt-2 text-xs text-secondary-text">{time(selected.createdAt)} · {statusLabel(selected)} · {selected.taskSnapshot.market}</p>{trading && <p className="mt-2 text-xs text-secondary-text">运行耗时 <RunElapsed run={selected} /> · 结果仅用于模拟研究</p>}</div><div className="flex flex-wrap gap-2"><Link className="btn-secondary text-xs" to={`/overview?runId=${encodeURIComponent(selected.id)}`}>继续问 Agent</Link><Link className="btn-secondary text-xs" to={`/runs/${selected.id}`}>运行详情与数据来源</Link></div></header>
          {trading && selected.status === "completed" && <p className="mb-3 text-sm text-secondary-text">本次提案运行已结束，不代表成交</p>}
          {selected.outcome && !isRunActive(selected) && <p role="status" className={`mb-4 text-sm leading-6 ${workspaceRunTone(selected)}`}>{selected.outcome.message}</p>}
          <RunStages run={selected} />
          {!!reportMeta?.relatedRunIds?.length && <details className="mb-5 border-b border-border pb-4"><summary className="cursor-pointer text-sm text-secondary-text">相关任务与 Agent 解读 · {reportMeta.relatedRunIds.length} 条</summary><p className="mt-3 text-sm leading-6 text-secondary-text">以下任务调用了本份正式研究。这里只展示一份报告，原始解读和运行记录保留备查。</p>{reportMeta.relatedRunIds.map((id) => <Link key={id} className="mt-2 block text-sm text-primary hover:underline" to={`/runs/${id}`}>查看 {runs.find((run) => run.id === id)?.taskSnapshot.name || "原任务"} 的解读与过程</Link>)}</details>}
          {selected.errorMessage && <p role="alert" className="mb-4 text-sm text-danger">{selected.errorMessage}</p>}
          {selected.artifacts.length ? visibleWorkspaceArtifacts(selected.artifacts).map((artifact) => <WorkflowArtifact key={artifact.id} artifact={artifact} />) : <div className="py-16 text-center"><FileText className="mx-auto mb-4 h-7 w-7 text-muted-text" /><p className="text-sm text-secondary-text">{isRunActive(selected) ? "正在准备证据与报告，成果生成后会自动显示。" : "本次运行没有生成报告，可查看运行详情了解原因。"}</p></div>}
        </> : selectedId ? <p role="status" className="py-16 text-center text-sm text-secondary-text">{detail.id === selectedId && detail.error ? detail.error : "正在读取完整报告…"}</p> : loaded ? <div className="py-20 text-center"><FileText className="mx-auto mb-4 h-8 w-8 text-muted-text" /><h2 className="text-lg font-semibold text-foreground">{trading ? "从一次模拟运行开始" : "从一份研究报告开始"}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-secondary-text">点击“{newAction}”配置任务。生成的报告会保存在这里，随时回来继续阅读。</p></div> : null}
        {detail.id === selectedId && detail.error && <button type="button" className="btn-secondary mt-3" onClick={() => setRetry((value) => value + 1)}>重试读取报告</button>}
      </section>
    </div>
    {trading && <section><button type="button" className="btn-secondary" aria-expanded={reviewOpen} onClick={() => setReviewOpen(!reviewOpen)}>{reviewOpen ? "收起信号跟踪与复盘" : "打开信号跟踪与复盘"}</button>{reviewOpen && <DecisionReviewPanel />}</section>}
  </AppPage>;
}
