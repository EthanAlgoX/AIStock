import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Repeat2,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppPage, PageHeader } from "../components/common";
import { TaskCenterNav } from "../components/tasks/TaskCenterNav";
import { useStockIndex } from "../hooks/useStockIndex";
import { normalizeAgentCapabilities } from "../types/capabilities";
import {
  countScheduledCapabilities,
  EMPTY_SCHEDULED_CAPABILITIES,
  type ScheduledCapabilityBindings,
  type ScheduledTaskKind,
  type ScheduledTaskMarket,
  type ScheduledTaskNavigationState,
  type ScheduledTaskPrefill,
} from "../types/scheduledTasks";
import type { StockIndexItem } from "../types/stockIndex";
import { cn } from "../utils/cn";
import { workspaceApi } from "../api/workspace";

type TaskKind = ScheduledTaskKind;
type ScheduledPlanKind = TaskKind | "market_analysis" | "industry_analysis";
type MarketId = ScheduledTaskMarket;
type ScheduleMode = "daily" | "interval";
type ErrorField = "name" | "stock" | "objective" | "strategy" | "runAt" | "interval";

type ScheduleDraft = {
  kind: TaskKind;
  name: string;
  market: MarketId;
  stock: string;
  stockName: string;
  objective: string;
  industry: string;
  candidateCount: string;
  strategyVersionId?: number;
  deepResearchCount?: number;
  deepResearchVersionId?: number;
  strategyRef: string;
  strategyName: string;
  scheduleMode: ScheduleMode;
  runAt: string;
  intervalMinutes: string;
  capabilities: ScheduledCapabilityBindings;
  publishToMarket: boolean;
};

type ScheduledTaskPlan = Omit<ScheduleDraft, "kind"> & {
  kind: ScheduledPlanKind;
  id: string;
  taskId?: string;
  createdAt: string;
};

const DEFAULT_DRAFT: ScheduleDraft = {
  kind: "research",
  name: "",
  market: "CN",
  stock: "",
  stockName: "",
  objective: "",
  industry: "",
  candidateCount: "20",
  strategyRef: "",
  strategyName: "",
  scheduleMode: "daily",
  runAt: "18:30",
  intervalMinutes: "15",
  capabilities: EMPTY_SCHEDULED_CAPABILITIES,
  publishToMarket: true,
};

const MARKETS: Array<{ id: MarketId; label: string; timezone: string; timezoneLabel: string }> = [
  { id: "CN", label: "A 股", timezone: "Asia/Shanghai", timezoneLabel: "中国标准时间" },
  { id: "HK", label: "港股", timezone: "Asia/Hong_Kong", timezoneLabel: "香港时间" },
  { id: "US", label: "美股", timezone: "America/New_York", timezoneLabel: "纽约时间" },
];

const TASK_TYPES: Array<{
  id: TaskKind;
  title: string;
  description: string;
  output: string;
  icon: typeof FileText;
}> = [
  {
    id: "research",
    title: "单股分析",
    description: "每天分析一只指定股票",
    output: "ResearchReport",
    icon: FileText,
  },
  {
    id: "screening",
    title: "选股",
    description: "每天按条件更新候选池",
    output: "CandidateList + ScreenSpec",
    icon: ListFilter,
  },
  {
    id: "trading",
    title: "交易策略",
    description: "按时间或间隔模拟运行",
    output: "PaperTradingRun + TradeProposal",
    icon: ShieldCheck,
  },
];

const PLAN_TASK_TYPES: Array<{
  id: ScheduledPlanKind;
  title: string;
  description: string;
  output: string;
  icon: typeof FileText;
}> = [
  ...TASK_TYPES,
  {
    id: "market_analysis",
    title: "市场分析",
    description: "按市场生成宏观与风险摘要",
    output: "MarketAnalysisReport",
    icon: FileText,
  },
  {
    id: "industry_analysis",
    title: "产业分析",
    description: "跟踪指定产业的趋势与风险",
    output: "IndustryReport",
    icon: ListFilter,
  },
];

const OUTPUT_CONTRACTS: Record<TaskKind, {
  title: string;
  description: string;
  items: string[];
  boundary: string;
}> = {
  research: {
    title: "ResearchReport",
    description: "一次运行形成一份带数据时间点的个股研究报告。",
    items: ["核心结论与置信度", "事实、计算与观点分层", "关键假设、风险与失效条件", "本次数据快照与引用来源"],
    boundary: "报告用于研究，不直接产生订单。",
  },
  screening: {
    title: "CandidateList + ScreenSpec",
    description: "一次运行更新候选股票及其可复核的筛选逻辑。",
    items: ["入选股票与排序", "结构化筛选条件", "入选与排除原因", "股票池和数据快照版本"],
    boundary: "候选名单不是买入建议，也不会自动进入交易。",
  },
  trading: {
    title: "PaperTradingRun + TradeProposal",
    description: "一次运行保存策略逻辑、信号与模拟交易提案。",
    items: ["本次信号与触发原因", "目标持仓和拟议变动", "风险检查与阻断原因", "模拟订单、持仓与运行记录"],
    boundary: "当前只定义模拟运行，不创建或提交真实订单。",
  },
};

const normalizeCapabilities = normalizeAgentCapabilities;

const isScheduledTaskKind = (value: string | undefined): value is TaskKind => (
  value === "research" || value === "screening" || value === "trading"
);

const isScheduledPlanKind = (value: string | undefined): value is ScheduledPlanKind => (
  isScheduledTaskKind(value) || value === "market_analysis" || value === "industry_analysis"
);

const getMarket = (market: MarketId) => MARKETS.find((item) => item.id === market) || MARKETS[0];

const getTaskType = (kind: ScheduledPlanKind) => PLAN_TASK_TYPES.find((item) => item.id === kind) || PLAN_TASK_TYPES[0];

const getInitialDraft = (search: string, prefill?: ScheduledTaskPrefill): ScheduleDraft => {
  const requestedKind = new URLSearchParams(search).get("type");
  const kind = prefill?.kind || (["research", "screening", "trading"].includes(requestedKind || "") ? requestedKind as TaskKind : "research");
  return {
    ...DEFAULT_DRAFT,
    kind,
    name: prefill?.name || "",
    market: prefill?.market || "CN",
    stock: prefill?.stock || "",
    stockName: prefill?.stockName || "",
    objective: prefill?.objective || "",
    industry: prefill?.industry || "",
    candidateCount: prefill?.candidateCount || "20",
    strategyVersionId: prefill?.strategyVersionId,
    deepResearchCount: prefill?.deepResearchCount,
    deepResearchVersionId: prefill?.deepResearchVersionId,
    strategyRef: prefill?.strategyRef || "",
    strategyName: prefill?.strategyName || "",
    scheduleMode: prefill?.scheduleMode || "daily",
    intervalMinutes: prefill?.intervalMinutes || "15",
    capabilities: normalizeCapabilities(prefill?.capabilities),
    publishToMarket: kind === "research",
  };
};

const marketMatches = (item: StockIndexItem, market: MarketId) => (
  market === "CN" ? item.market === "CN" || item.market === "BSE" : item.market === market
);

type TradingStrategyOption = { id: string; name: string; versionLabel: string };

const getScheduleSummary = (plan: { kind: ScheduledPlanKind; scheduleMode: ScheduleMode; runAt: string; intervalMinutes: string; market: MarketId }) => {
  if (plan.kind === "trading" && plan.scheduleMode === "interval") {
    const minutes = Number(plan.intervalMinutes);
    if (minutes >= 60 && minutes % 60 === 0) return `每 ${minutes / 60} 小时运行`;
    return `每 ${plan.intervalMinutes} 分钟运行`;
  }
  return `每日 ${plan.runAt} · ${getMarket(plan.market).timezoneLabel}`;
};

const getTargetSummary = (plan: ScheduledTaskPlan) => {
  const market = getMarket(plan.market).label;
  if (plan.strategyVersionId && ["research", "screening"].includes(plan.kind)) return `${market} · ${plan.kind === "research" ? plan.stockName || plan.stock : "按策略配置筛选"} · 策略版本 #${plan.strategyVersionId}`;
  if (plan.kind === "research") return `${market} · ${plan.stockName ? `${plan.stockName} (${plan.stock})` : plan.stock}`;
  if (plan.kind === "screening") return `${market} · ${plan.industry?.trim() || "全行业"} · Top ${plan.candidateCount}`;
  if (plan.kind === "market_analysis") return `${market} · ${plan.objective}`;
  if (plan.kind === "industry_analysis") return `${market} · ${plan.industry?.trim() || plan.objective}`;
  return `${market} · ${plan.strategyName}`;
};

export default function ScheduledTasksPage() {
  const location = useLocation();
  const navigationState = location.state as ScheduledTaskNavigationState | null;
  const prefill = navigationState?.schedulePrefill;
  const initialDraft = getInitialDraft(location.search, prefill);
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialDraft);
  const [plans, setPlans] = useState<ScheduledTaskPlan[]>([]);
  const [tradingStrategies, setTradingStrategies] = useState<TradingStrategyOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [stockQuery, setStockQuery] = useState(() => initialDraft.stockName || initialDraft.stock);
  const [prefillSource, setPrefillSource] = useState(prefill?.sourceLabel || "");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ErrorField | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const stockIndex = useStockIndex(draft.kind === "research");

  useEffect(() => {
    let active = true;
    void Promise.all([workspaceApi.listSchedules(), workspaceApi.listTasks(), workspaceApi.listMarketSubscriptions()])
      .then(([schedules, tasks, subscriptions]) => {
        if (!active) return;
        const taskById = new Map(tasks.map((task) => [task.id, task]));
        setTradingStrategies(tasks.filter((task) => task.kind === "trading" && task.enabled).map((task) => ({ id: task.id, name: task.name, versionLabel: `Task v${task.version}` })));
        setPlans(schedules.map((schedule) => {
          const task = taskById.get(schedule.taskId);
          const subject = task?.subject || {};
          const config = task?.config || {};
          return {
            ...DEFAULT_DRAFT,
            id: schedule.id,
            taskId: schedule.taskId,
            createdAt: schedule.createdAt,
            kind: isScheduledPlanKind(task?.kind) ? task.kind : "research",
            name: schedule.name,
            market: task?.market === "GLOBAL" ? "CN" : task?.market || "CN",
            stock: String(subject.stock || ""),
            stockName: String(subject.stockName || ""),
            objective: task?.objective || "",
            industry: String(subject.industry || ""),
            candidateCount: String(config.candidateCount || "20"),
            strategyVersionId: typeof config.strategyVersionId === "number" ? config.strategyVersionId : undefined,
            deepResearchCount: typeof config.deepResearchCount === "number" ? config.deepResearchCount : undefined,
            deepResearchVersionId: typeof config.deepResearchVersionId === "number" ? config.deepResearchVersionId : undefined,
            strategyRef: task?.kind === "trading" ? task.id : "",
            strategyName: task?.kind === "trading" ? task.name : "",
            scheduleMode: schedule.scheduleMode,
            runAt: schedule.runAt || "18:30",
            intervalMinutes: String(schedule.intervalMinutes || 15),
            capabilities: normalizeCapabilities(task?.capabilities),
            publishToMarket: subscriptions.some((item) => item.taskId === schedule.taskId && item.enabled),
          };
        }));
      })
      .catch(() => setError("定时计划读取失败，请稍后重试。"))
      .finally(() => active && setLoadingPlans(false));
    return () => { active = false; };
  }, []);

  const stockSuggestions = useMemo(() => {
    const normalizedQuery = stockQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery || draft.stock) return [];
    return stockIndex.index
      .filter((item) => item.active && marketMatches(item, draft.market))
      .filter((item) => [item.canonicalCode, item.displayCode, item.nameZh, item.nameEn, ...(item.aliases || [])]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))
      .slice(0, 6);
  }, [draft.market, draft.stock, stockIndex.index, stockQuery]);

  const output = OUTPUT_CONTRACTS[draft.kind];
  const market = getMarket(draft.market);
  const capabilityCount = countScheduledCapabilities(draft.capabilities);
  const sourcePath = draft.kind === "research" ? "/stock-research" : draft.kind === "screening" ? "/screening" : "/trading";

  const updateDraft = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
    setErrorField(null);
    setSavedMessage("");
  };

  const changeMarket = (value: MarketId) => {
    setDraft((current) => ({ ...current, market: value, stock: "", stockName: "" }));
    setStockQuery("");
    setError("");
    setErrorField(null);
    setSavedMessage("");
  };

  const selectStock = (stock: StockIndexItem) => {
    setDraft((current) => ({
      ...current,
      stock: stock.canonicalCode,
      stockName: stock.nameZh || stock.nameEn || stock.displayCode,
    }));
    setStockQuery(stock.nameZh || stock.nameEn || stock.displayCode);
    setError("");
    setErrorField(null);
  };

  const selectKind = (kind: TaskKind) => {
    setDraft((current) => ({
      ...DEFAULT_DRAFT,
      kind,
      market: current.market,
      publishToMarket: kind === "research",
    }));
    setStockQuery("");
    setPrefillSource("");
    setError("");
    setErrorField(null);
    setSavedMessage("");
  };

  const validate = (): { message: string; field: ErrorField } | null => {
    if (!draft.name.trim()) return { message: "请先填写计划名称。", field: "name" };
    if (draft.kind === "research" && !draft.stock.trim()) return { message: "请从股票目录选择需要定时分析的股票。", field: "stock" };
    if (draft.kind === "screening" && !draft.objective.trim()) return { message: "请描述定时选股使用的筛选目标。", field: "objective" };
    if (draft.kind === "trading" && !draft.strategyRef) return { message: "请先选择一个已保存的交易策略。", field: "strategy" };
    if (draft.scheduleMode === "daily" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.runAt)) return { message: "请设置有效的每日运行时间。", field: "runAt" };
    if (draft.kind === "trading" && draft.scheduleMode === "interval" && Number(draft.intervalMinutes) < 5) return { message: "交易策略运行间隔不能少于 5 分钟。", field: "interval" };
    return null;
  };

  const savePlan = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError.message);
      setErrorField(validationError.field);
      window.requestAnimationFrame(() => document.getElementById(`schedule-field-${validationError.field}`)?.focus());
      return;
    }
    try {
      const task = draft.kind === "trading"
        ? (await workspaceApi.listTasks("trading")).find((item) => item.id === draft.strategyRef)
        : await workspaceApi.createTask({
          kind: draft.kind,
          name: draft.name.trim(),
          market: draft.market,
          objective: draft.objective.trim() || `定时分析 ${draft.stock}`,
          subject: draft.kind === "research" ? { stock: draft.stock, stockName: draft.stockName } : { industry: draft.industry.trim() || null },
          config: {
            ...(draft.kind === "screening" ? { candidateCount: Number(draft.candidateCount) } : {}),
            ...(["research", "screening"].includes(draft.kind) && draft.strategyVersionId ? { strategyVersionId: draft.strategyVersionId } : {}),
            ...(draft.kind === "screening" && draft.deepResearchCount ? { deepResearchCount: draft.deepResearchCount, deepResearchVersionId: draft.deepResearchVersionId } : {}),
          },
          capabilities: draft.capabilities,
        });
      if (!task) throw new Error("trading_task_missing");
      const schedule = await workspaceApi.createSchedule({
        taskId: task.id,
        name: draft.name.trim(),
        scheduleMode: draft.scheduleMode,
        runAt: draft.scheduleMode === "daily" ? draft.runAt : undefined,
        intervalMinutes: draft.scheduleMode === "interval" ? Number(draft.intervalMinutes) : undefined,
        timezone: getMarket(draft.market).timezone,
        publishToMarket: draft.publishToMarket,
        marketDashboardTitle: draft.name.trim(),
      });
      const plan: ScheduledTaskPlan = { ...draft, id: schedule.id, taskId: task.id, createdAt: schedule.createdAt };
      setPlans((current) => [...current, plan]);
      setSavedMessage(`“${plan.name.trim()}”已注册，下一次运行时间为 ${new Date(schedule.nextRunAt).toLocaleString("zh-CN")}。`);
      setError("");
      setErrorField(null);
      setStockQuery("");
      setDraft((current) => ({ ...DEFAULT_DRAFT, kind: current.kind, market: current.market, scheduleMode: current.kind === "trading" ? current.scheduleMode : "daily", publishToMarket: current.kind === "research" }));
      setPrefillSource("");
    } catch {
      setError("计划注册失败，请检查任务能力和调度配置。");
    }
  };

  const deletePlan = async (id: string) => {
    try {
      await workspaceApi.deleteSchedule(id);
      setPlans((current) => current.filter((plan) => plan.id !== id));
      setSavedMessage("定时计划已删除。");
    } catch {
      setError("定时计划删除失败。");
    }
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="scheduled-tasks-page">
      <PageHeader
        eyebrow="Agent task scheduler"
        title="定时任务"
        description="为单股分析、选股和交易策略安排运行节奏。调度只负责何时启动，任务仍使用各自的 Agent、Skill、内置工具、MCP 服务、数据源和专家配置。"
        actions={prefillSource ? (
          <Link to={sourcePath} className="btn-secondary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回{prefillSource}
          </Link>
        ) : undefined}
      />

      <TaskCenterNav />

      <div className="flex items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3.5 text-sm leading-6">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-medium text-foreground">计划由后端持久化调度器运行</p>
          <p className="text-secondary-text">浏览器关闭后计划仍会保留；服务重启后会恢复调度。每次触发都会创建独立 Run、数据快照和成果记录。</p>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="schedule-builder-heading">
          <div className="border-b border-border/70 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 id="schedule-builder-heading" className="text-base font-semibold text-foreground">新建运行计划</h2>
            </div>
            <p className="mt-1 text-sm text-secondary-text">先选择任务，再定义运行对象和触发节奏。</p>

            <div className="mt-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="任务类型">
              {TASK_TYPES.map((item) => {
                const Icon = item.icon;
                const active = draft.kind === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectKind(item.id)}
                    className={cn(
                      "min-h-20 rounded-[10px] border px-2.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-28 sm:px-4 sm:py-3.5",
                      active ? "border-primary/40 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-text")} aria-hidden="true" />
                      {active ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                    </span>
                    <span className="mt-3 block text-xs font-semibold text-foreground sm:mt-4 sm:text-sm">{item.title}</span>
                    <span className="mt-1 hidden text-xs leading-5 text-muted-text sm:block">{item.description}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-[10px] border border-border bg-background px-4 py-3 xl:hidden" aria-live="polite">
              <p className="text-[11px] font-medium text-primary">当前输出契约</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{output.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-text">{output.boundary}</p>
            </div>

            {prefillSource ? (
              <div className="mt-4 flex items-start gap-3 rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3" role="status">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground">已从{prefillSource}带入当前配置</p>
                  <p className="mt-1 text-xs leading-5 text-secondary-text">运行对象、业务条件和 {capabilityCount} 项 Agent 能力已预填；这里只需要确认运行时间。</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-b border-border/70 px-5 py-5 sm:px-6">
            <h3 className="text-sm font-semibold text-foreground">任务对象</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-foreground">
                计划名称
                <input
                  id="schedule-field-name"
                  required
                  aria-invalid={errorField === "name"}
                  aria-describedby={errorField === "name" ? "schedule-form-error" : undefined}
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder={draft.kind === "research" ? "例如：每日贵州茅台复盘" : draft.kind === "screening" ? "例如：每日价值候选池" : "例如：趋势策略模拟巡检"}
                  className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                市场
                <select value={draft.market} onChange={(event) => changeMarket(event.target.value as MarketId)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                  {MARKETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
            </div>

            {draft.kind === "research" ? (
              <>
                <div className="mt-4">
                  <label htmlFor="schedule-field-stock" className="block text-sm font-medium text-foreground">股票</label>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-text" aria-hidden="true" />
                    <input
                      id="schedule-field-stock"
                      required
                      aria-invalid={errorField === "stock"}
                      aria-describedby={errorField === "stock" ? "schedule-form-error" : undefined}
                      value={stockQuery}
                      onChange={(event) => {
                        setStockQuery(event.target.value);
                        setDraft((current) => ({ ...current, stock: "", stockName: "" }));
                        setError("");
                        setErrorField(null);
                      }}
                      placeholder={stockIndex.loading ? "正在读取股票目录…" : "搜索股票代码或名称"}
                      className="h-10 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                    {stockIndex.loading ? <LoaderCircle className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-text" aria-hidden="true" /> : null}
                  </div>
                  {stockSuggestions.length ? (
                    <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-[9px] border border-border" role="listbox" aria-label="股票搜索结果">
                      {stockSuggestions.map((stock) => (
                        <button key={stock.canonicalCode} type="button" role="option" aria-selected="false" onClick={() => selectStock(stock)} className="flex w-full items-center justify-between gap-4 bg-background px-3 py-2.5 text-left transition-colors hover:bg-hover/60">
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{stock.nameZh || stock.nameEn || stock.displayCode}</span><span className="mt-0.5 block text-xs text-muted-text">{stock.canonicalCode}</span></span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-text" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {draft.stock ? <p className="mt-2 text-xs font-medium text-success">已绑定 {draft.stockName} · {draft.stock}</p> : null}
                  {stockIndex.error ? <p className="mt-2 text-xs text-warning">股票目录使用降级数据，搜索范围可能有限。</p> : null}
                </div>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  每日关注问题（可选）
                  <textarea value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder="例如：跟踪盈利质量、估值变化和最新风险事件" className="mt-2 min-h-24 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" />
                </label>
              </>
            ) : null}

            {draft.kind === "screening" ? (
              <>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  选股目标
                  <textarea id="schedule-field-objective" required aria-invalid={errorField === "objective"} aria-describedby={errorField === "objective" ? "schedule-form-error" : undefined} value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder="例如：每天寻找盈利持续增长、估值低于行业中位数且近期无重大利空的公司" className="mt-2 min-h-28 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" />
                </label>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground">
                    行业范围（可选）
                    <input value={draft.industry} onChange={(event) => updateDraft("industry", event.target.value)} placeholder="例如：半导体" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    每次保留候选数
                    <select value={draft.candidateCount} onChange={(event) => updateDraft("candidateCount", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                      <option value="10">Top 10</option>
                      <option value="20">Top 20</option>
                      <option value="50">Top 50</option>
                    </select>
                  </label>
                </div>
              </>
            ) : null}

            {draft.kind === "trading" ? (
              <>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  交易策略
                  <select
                    id="schedule-field-strategy"
                    required
                    aria-invalid={errorField === "strategy"}
                    aria-describedby={errorField === "strategy" ? "schedule-form-error" : undefined}
                    value={draft.strategyRef}
                    onChange={(event) => {
                      const strategy = tradingStrategies.find((item) => item.id === event.target.value);
                      setDraft((current) => ({ ...current, strategyRef: strategy?.id || "", strategyName: strategy?.name || "" }));
                      setError("");
                      setErrorField(null);
                    }}
                    disabled={!tradingStrategies.length}
                    className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{tradingStrategies.length ? "选择已保存的交易策略" : "尚未保存交易策略"}</option>
                    {tradingStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.versionLabel}</option>)}
                  </select>
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-text">计划绑定后端保存的交易任务版本；后续修改策略会生成新的 Task 版本，并保留每次 Run 的冻结快照。{!tradingStrategies.length ? <> 请先<Link to="/trading" className="mx-1 font-medium text-primary hover:underline">保存交易策略</Link>。</> : null}</p>
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-4 text-xs text-muted-text">
              <span className="font-medium text-secondary-text">继承 Agent 能力</span>
              <span>{capabilityCount} 项</span>
              {capabilityCount ? (
                <span>Skill {draft.capabilities.skillIds.length} · 工具 {draft.capabilities.toolIds.length} · MCP {draft.capabilities.mcpIds.length} · 数据源 {draft.capabilities.dataSourceIds.length} · 专家 {draft.capabilities.expertIds.length + draft.capabilities.expertTeamIds.length}</span>
              ) : <span>运行时使用该任务的通用配置</span>}
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">运行节奏</h3>
            </div>

            {draft.kind === "trading" ? (
              <div className="mt-4 inline-flex rounded-[9px] border border-border bg-background p-1" role="radiogroup" aria-label="交易策略运行方式">
                <button type="button" role="radio" aria-checked={draft.scheduleMode === "daily"} onClick={() => updateDraft("scheduleMode", "daily")} className={cn("rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors", draft.scheduleMode === "daily" ? "bg-primary text-primary-foreground" : "text-secondary-text hover:text-foreground")}>每天定时</button>
                <button type="button" role="radio" aria-checked={draft.scheduleMode === "interval"} onClick={() => updateDraft("scheduleMode", "interval")} className={cn("rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors", draft.scheduleMode === "interval" ? "bg-primary text-primary-foreground" : "text-secondary-text hover:text-foreground")}>按间隔运行</button>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-muted-text">单股分析和选股每天运行一次，避免同一天重复生成大量报告或候选池。</p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {draft.scheduleMode === "daily" ? (
                <label className="text-sm font-medium text-foreground">
                  每天运行时间
                  <input id="schedule-field-runAt" required aria-invalid={errorField === "runAt"} aria-describedby={errorField === "runAt" ? "schedule-form-error" : undefined} type="time" value={draft.runAt} onChange={(event) => updateDraft("runAt", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
                </label>
              ) : (
                <label className="text-sm font-medium text-foreground">
                  运行频率
                  <select id="schedule-field-interval" required aria-invalid={errorField === "interval"} aria-describedby={errorField === "interval" ? "schedule-form-error" : undefined} value={draft.intervalMinutes} onChange={(event) => updateDraft("intervalMinutes", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                    <option value="5">每 5 分钟</option>
                    <option value="15">每 15 分钟</option>
                    <option value="30">每 30 分钟</option>
                    <option value="60">每 1 小时</option>
                    <option value="240">每 4 小时</option>
                  </select>
                </label>
              )}
              <div className="rounded-[10px] border border-border bg-background px-3 py-2.5">
                <span className="block text-xs text-muted-text">市场时区</span>
                <span className="mt-1 block text-sm font-medium text-foreground">{market.timezoneLabel}</span>
                <span className="mt-0.5 block text-[11px] text-muted-text">{market.timezone}</span>
              </div>
            </div>

            {draft.kind !== "trading" ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background px-4 py-3.5">
                <input
                  type="checkbox"
                  checked={draft.publishToMarket}
                  onChange={(event) => updateDraft("publishToMarket", event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden="true" />
                    展示到{market.label}市场看板
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-text">
                    看板只展示最近一次成功运行的摘要、数据时间和状态；点击后进入完整成果。
                  </span>
                </span>
              </label>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-text">拟定节奏：{getScheduleSummary(draft)}</p>
              <button type="button" onClick={() => void savePlan()} className="btn-primary inline-flex shrink-0 items-center justify-center gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                注册定时计划
              </button>
            </div>
            {error ? <p id="schedule-form-error" role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
            {savedMessage ? <p role="status" className="mt-3 text-sm text-success">{savedMessage}</p> : null}
          </div>
        </section>

        <aside className="hidden overflow-hidden rounded-[14px] border border-border bg-card xl:sticky xl:top-6 xl:block" aria-labelledby="output-contract-heading">
          <div className="border-b border-border px-5 py-5">
            <p className="text-xs font-medium text-primary">当前输出契约</p>
            <h2 id="output-contract-heading" className="mt-2 text-base font-semibold text-foreground">{output.title}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">{output.description}</p>
          </div>
          <div className="px-5 py-5">
            <ul className="space-y-3">
              {output.items.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-secondary-text">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-border pt-4">
              <p className="flex items-start gap-2 text-xs leading-5 text-muted-text">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {output.boundary}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="saved-plans-heading">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 id="saved-plans-heading" className="text-base font-semibold text-foreground">已保存计划</h2>
            <p className="mt-1 text-xs text-muted-text">{loadingPlans ? "正在读取后端计划…" : `共 ${plans.length} 个已注册计划。`}</p>
          </div>
          <span className="inline-flex self-start rounded-full border border-success/25 bg-success/5 px-2.5 py-1 text-[11px] font-medium text-success sm:self-auto">调度已接通</span>
        </div>

        {plans.length ? (
          <div className="divide-y divide-border/70">
            {plans.map((plan) => {
              const type = getTaskType(plan.kind);
              const Icon = type.icon;
              return (
                <div key={plan.id} className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_minmax(11rem,1fr)_minmax(9rem,0.8fr)_auto] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background"><Icon className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{plan.name}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-text"><span>{type.title} · {countScheduledCapabilities(plan.capabilities)} 项能力</span>{plan.publishToMarket ? <span className="text-primary">市场展示</span> : null}</span></span>
                  </div>
                  <div><span className="block text-[11px] text-muted-text">运行对象</span><span className="mt-1 block truncate text-sm text-secondary-text">{getTargetSummary(plan)}</span></div>
                  <div><span className="block text-[11px] text-muted-text">拟定节奏</span><span className="mt-1 block text-sm text-secondary-text">{getScheduleSummary(plan)}</span></div>
                  <div><span className="block text-[11px] text-muted-text">输出</span><span className="mt-1 block font-mono text-xs text-secondary-text">{type.output}</span></div>
                  <button type="button" onClick={() => void deletePlan(plan.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-muted-text transition-colors hover:bg-danger/10 hover:text-danger" aria-label={`删除计划 ${plan.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
            <Repeat2 className="h-7 w-7 text-muted-text" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">还没有运行计划</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-text">在上方选择任务类型并保存后，计划会注册到后端并按设定时间运行。</p>
          </div>
        )}
      </section>
    </AppPage>
  );
}
