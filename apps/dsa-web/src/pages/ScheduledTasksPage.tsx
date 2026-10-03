import { uiLocale } from "../utils/uiLanguage";
import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Clock3,
  FileText,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppPage, ConfirmDialog, PageHeader } from "../components/common";
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
import { useUiLanguage } from "../contexts/UiLanguageContext";
import { workspaceApi, type WorkspaceTask } from "../api/workspace";

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
  intervalDays: string;
  intervalMinutes: string;
  capabilities: ScheduledCapabilityBindings;
  publishToMarket: boolean;
};

type ScheduledTaskPlan = Omit<ScheduleDraft, "kind"> & {
  kind: ScheduledPlanKind;
  id: string;
  taskId?: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastRunId?: string | null;
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
  intervalDays: "1",
  intervalMinutes: "15",
  capabilities: EMPTY_SCHEDULED_CAPABILITIES,
  publishToMarket: true,
};

const MARKETS: Array<{ id: MarketId; label: string; timezone: string; timezoneLabel: string }> = [
  { id: "CN", label: "A 股", timezone: "Asia/Shanghai", timezoneLabel: "中国标准时间" },
  { id: "HK", label: "港股", timezone: "Asia/Hong_Kong", timezoneLabel: "香港时间" },
  { id: "US", label: "美股", timezone: "America/New_York", timezoneLabel: "纽约时间" },
  { id: "TW", label: "台股", timezone: "Asia/Taipei", timezoneLabel: "Asia/Taipei" },
  { id: "JP", label: "日股", timezone: "Asia/Tokyo", timezoneLabel: "Asia/Tokyo" },
  { id: "KR", label: "韩股", timezone: "Asia/Seoul", timezoneLabel: "Asia/Seoul" },
  { id: "GB", label: "英国股票", timezone: "Europe/London", timezoneLabel: "Europe/London" },
  { id: "CA", label: "加拿大股票", timezone: "America/Toronto", timezoneLabel: "America/Toronto" },
  { id: "AU", label: "澳大利亚股票", timezone: "Australia/Sydney", timezoneLabel: "Australia/Sydney" },
  { id: "IN", label: "印度股票", timezone: "Asia/Kolkata", timezoneLabel: "Asia/Kolkata" },
  { id: "DE", label: "德国股票", timezone: "Europe/Berlin", timezoneLabel: "Europe/Berlin" },
  { id: "FR", label: "法国股票", timezone: "Europe/Paris", timezoneLabel: "Europe/Paris" },
  { id: "CRYPTO", label: "加密货币", timezone: "UTC", timezoneLabel: "UTC" },

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
    title: "交易提案计划",
    description: "定时生成研究提案，不运行模拟账户",
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
    items: ["本次信号与触发原因", "目标持仓和拟议变动", "风险检查与阻断原因", "提案与运行记录"],
    boundary: "交易提案计划仅生成研究提案与风险检查；模拟账户的持续日线在交易页单独控制。",
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

const getScheduleSummary = (plan: { intervalDays: string; kind: ScheduledPlanKind; scheduleMode: ScheduleMode; runAt: string; intervalMinutes: string; market: MarketId; timezone?: string }, translate: (text: string) => string) => {
  if (plan.kind === "trading" && plan.scheduleMode === "interval") {
    const minutes = Number(plan.intervalMinutes);
    if (minutes >= 60 && minutes % 60 === 0) return translate(`每 ${minutes / 60} 小时运行`);
    return translate(`每 ${plan.intervalMinutes} 分钟运行`);
  }
  return `${translate(`每 ${plan.intervalDays} 天`)} ${plan.runAt} · ${plan.timezone || getMarket(plan.market).timezone}`;
};

const getTargetSummary = (plan: ScheduledTaskPlan, translate: (text: string) => string) => {
  const market = translate(getMarket(plan.market).label);
  if (plan.strategyVersionId && ["research", "screening"].includes(plan.kind)) return `${market} · ${plan.kind === "research" ? plan.stockName || plan.stock : translate("按策略配置筛选")} · ${translate(`策略版本 #${plan.strategyVersionId}`)}`;
  if (plan.kind === "research") return `${market} · ${plan.stockName ? `${plan.stockName} (${plan.stock})` : plan.stock}`;
  if (plan.kind === "screening") return `${market} · ${plan.industry?.trim() || translate("全行业")} · Top ${plan.candidateCount}`;
  if (plan.kind === "market_analysis") return `${market} · ${plan.objective}`;
  if (plan.kind === "industry_analysis") return `${market} · ${plan.industry?.trim() || plan.objective}`;
  return `${market} · ${plan.strategyName}`;
};

export default function ScheduledTasksPage() {
  const uiLiteral = useUiLiteral();
  const { localize: l, language, t } = useUiLanguage();
  const location = useLocation();
  const navigationState = location.state as ScheduledTaskNavigationState | null;
  const prefill = navigationState?.schedulePrefill;
  const initialDraft = getInitialDraft(location.search, prefill);
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialDraft);
  const [plans, setPlans] = useState<ScheduledTaskPlan[]>([]);
  const [tradingStrategies, setTradingStrategies] = useState<TradingStrategyOption[]>([]);
  const [plansRevision, setPlansRevision] = useState(0);
  const [plansRead, setPlansRead] = useState<{ revision: number; error?: string }>();
  const loadingPlans = plansRead?.revision !== plansRevision;
  const plansError = loadingPlans ? "" : plansRead?.error || "";
  const [builderOpen, setBuilderOpen] = useState(Boolean(prefill || new URLSearchParams(location.search).get('type')));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledTaskPlan | null>(null);
  const operation = useRef(false);
  const createdTask = useRef<{ draftKey: string; task: WorkspaceTask } | null>(null);
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
        setPlans(schedules.map((schedule) => {
          const task = taskById.get(schedule.taskId);
          const subject = task?.subject || {};
          const config = task?.config || {};
          return {
            ...DEFAULT_DRAFT,
            id: schedule.id,
            taskId: schedule.taskId,
            createdAt: schedule.createdAt,
            enabled: schedule.enabled,
            timezone: schedule.timezone,
            nextRunAt: schedule.nextRunAt,
            lastRunAt: schedule.lastRunAt,
            lastRunId: schedule.lastRunId,
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
            intervalDays: String(schedule.intervalDays || 1),
            intervalMinutes: String(schedule.intervalMinutes || 15),
            capabilities: normalizeCapabilities(task?.capabilities),
            publishToMarket: subscriptions.some((item) => item.taskId === schedule.taskId && item.enabled),
          };
        }));
        setPlansRead({ revision: plansRevision });
      })
      .catch(() => { if (active) setPlansRead({ revision: plansRevision, error: "定时计划读取失败，请稍后重试。" }); });
    return () => { active = false; };
  }, [plansRevision]);

  useEffect(() => {
    if (draft.kind !== "trading") return;
    let active = true;
    void workspaceApi.listTasks("trading")
      .then(tasks => {
        if (!active) return;
        setTradingStrategies(tasks.filter(task => task.enabled).map(task => ({ id: task.id, name: task.name, versionLabel: `Task v${task.version}` })));
        setError(current => current === '交易提案任务读取失败，请重试。' ? '' : current);
      })
      .catch(() => { if (active) setError("交易提案任务读取失败，请重试。"); });
    return () => { active = false; };
  }, [draft.kind, plansRevision]);

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
  const sourcePath = draft.kind === "research" ? "/stock-research" : draft.kind === "screening" ? "/screening" : "/trading?view=reports";
  const showBuilder = builderOpen || (!loadingPlans && !plansError && !plans.length);
  const mutating = saving || deleting !== null || updating !== null;
  const planTime = (value: string | null | undefined, timezone: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(uiLocale(language), { timeZone: timezone });
  };

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
    if (!Number.isInteger(Number(draft.intervalDays)) || Number(draft.intervalDays) < 1 || Number(draft.intervalDays) > 365) return { message: l("运行周期必须为 1 至 365 天的整数。", "Run interval must be a whole number from 1 to 365 days."), field: "runAt" };
    if (!draft.name.trim()) return { message: "请先填写计划名称。", field: "name" };
    if (draft.kind === "research" && !draft.stock.trim()) return { message: "请从股票目录选择需要定时分析的股票。", field: "stock" };
    if (draft.kind === "screening" && !draft.objective.trim()) return { message: "请描述定时选股使用的筛选目标。", field: "objective" };
    if (draft.kind === "trading" && !draft.strategyRef) return { message: "请先选择一个已保存的交易提案任务。", field: "strategy" };
    if (draft.scheduleMode === "daily" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.runAt)) return { message: "请设置有效的每日运行时间。", field: "runAt" };
    if (draft.kind === "trading" && draft.scheduleMode === "interval" && Number(draft.intervalMinutes) < 5) return { message: "交易策略运行间隔不能少于 5 分钟。", field: "interval" };
    return null;
  };

  const savePlan = async () => {
    if (operation.current || loadingPlans) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError.message);
      setErrorField(validationError.field);
      window.requestAnimationFrame(() => document.getElementById(`schedule-field-${validationError.field}`)?.focus());
      return;
    }
    operation.current = true;
    setSaving(true);
    setError("");
    setSavedMessage("");
    const draftKey = JSON.stringify([draft, language]);
    try {
      let task = draft.kind === "trading"
        ? (await workspaceApi.listTasks("trading")).find((item) => item.id === draft.strategyRef)
        : createdTask.current?.draftKey === draftKey ? createdTask.current.task : undefined;
      if (!task && draft.kind !== "trading") {
        task = await workspaceApi.createTask({
          kind: draft.kind,
          name: draft.name.trim(),
          market: draft.market,
          objective: draft.objective.trim() || `定时分析 ${draft.stock}`,
          subject: draft.kind === "research" ? { stock: draft.stock, stockName: draft.stockName } : { industry: draft.industry.trim() || null },
          config: {
            reportLanguage: language,
            ...(draft.kind === "screening" ? { candidateCount: Number(draft.candidateCount) } : {}),
            ...(["research", "screening"].includes(draft.kind) && draft.strategyVersionId ? { strategyVersionId: draft.strategyVersionId } : {}),
            ...(draft.kind === "screening" && draft.deepResearchCount ? { deepResearchCount: draft.deepResearchCount, deepResearchVersionId: draft.deepResearchVersionId } : {}),
          },
          capabilities: draft.capabilities,
        });
        createdTask.current = { draftKey, task };
      }
      if (!task) throw new Error("trading_task_missing");
      const schedule = await workspaceApi.createSchedule({
        taskId: task.id,
        name: draft.name.trim(),
        scheduleMode: draft.scheduleMode,
        runAt: draft.scheduleMode === "daily" ? draft.runAt : undefined,
        intervalDays: Number(draft.intervalDays),
        intervalMinutes: draft.scheduleMode === "interval" ? Number(draft.intervalMinutes) : undefined,
        timezone: getMarket(draft.market).timezone,
        publishToMarket: draft.publishToMarket,
        marketDashboardTitle: draft.name.trim(),
      });
      const plan: ScheduledTaskPlan = { ...draft, id: schedule.id, taskId: task.id, createdAt: schedule.createdAt, enabled: schedule.enabled, timezone: schedule.timezone, nextRunAt: schedule.nextRunAt, lastRunAt: schedule.lastRunAt, lastRunId: schedule.lastRunId };
      setPlans((current) => [...current, plan]);
      createdTask.current = null;
      setBuilderOpen(false);
      setSavedMessage(`“${plan.name.trim()}”已注册，下一次运行时间为 ${planTime(schedule.nextRunAt, schedule.timezone)} (${schedule.timezone})。`);
      setError("");
      setErrorField(null);
      setStockQuery("");
      setDraft((current) => ({ ...DEFAULT_DRAFT, kind: current.kind, market: current.market, scheduleMode: current.kind === "trading" ? current.scheduleMode : "daily", publishToMarket: current.kind === "research" }));
      setPrefillSource("");
    } catch {
      setError("计划注册失败，请检查任务能力和调度配置。");
    } finally {
      operation.current = false;
      setSaving(false);
    }
  };

  const deletePlan = async (id: string) => {
    if (operation.current) return;
    operation.current = true;
    setDeleting(id);
    setError("");
    setSavedMessage("");
    try {
      await workspaceApi.deleteSchedule(id);
      setPlans((current) => current.filter((plan) => plan.id !== id));
      setPendingDelete(null);
      setSavedMessage("定时计划已删除。");
    } catch {
      setError("定时计划删除失败。");
    } finally {
      operation.current = false;
      setDeleting(null);
    }
  };

  const togglePlan = async (plan: ScheduledTaskPlan) => {
    if (operation.current) return;
    operation.current = true;
    setUpdating(plan.id);
    setError("");
    setSavedMessage("");
    try {
      const schedule = await workspaceApi.updateSchedule(plan.id, { enabled: !plan.enabled });
      setPlans(current => current.map(item => item.id === schedule.id ? {
        ...item, name: schedule.name, enabled: schedule.enabled, timezone: schedule.timezone,
        nextRunAt: schedule.nextRunAt, lastRunAt: schedule.lastRunAt, lastRunId: schedule.lastRunId,
        scheduleMode: schedule.scheduleMode, runAt: schedule.runAt || item.runAt,
        intervalDays: String(schedule.intervalDays), intervalMinutes: String(schedule.intervalMinutes || item.intervalMinutes),
      } : item));
    } catch {
      setError("定时计划更新失败，请重试。");
    } finally {
      operation.current = false;
      setUpdating(null);
    }
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="scheduled-tasks-page">
      <PageHeader
        eyebrow={uiLiteral("智能任务调度")}
        title={uiLiteral("定时任务")}
        description={uiLiteral("为单股分析、选股和交易提案安排运行节奏。服务需保持运行。")}
        actions={<>{prefillSource && <Link to={sourcePath} className="btn-secondary inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /><UiLiteral text="返回" />{prefillSource}</Link>}{(plans.length > 0 || loadingPlans || plansError) && <button type="button" disabled={mutating} aria-expanded={showBuilder} aria-controls="schedule-builder" onClick={() => setBuilderOpen(!showBuilder)} className={showBuilder ? 'btn-secondary' : 'btn-primary'}>{uiLiteral(showBuilder ? '收起新建计划' : '新建计划')}</button>}</>}
      />

      <TaskCenterNav />

      <p className="max-w-[75ch] text-xs leading-6 text-secondary-text"><UiLiteral text="浏览器关闭后计划仍会保留；服务重启后会恢复调度。每次触发都会创建独立 Run、数据快照和成果记录。" /></p>

      <section className="min-w-0 border-y border-border" aria-labelledby="saved-plans-heading" aria-busy={loadingPlans}>
        <div className="flex flex-wrap items-baseline justify-between gap-3 py-4">
          <h2 id="saved-plans-heading" className="text-lg font-semibold text-foreground"><UiLiteral text="已保存计划" /></h2>
          <p className="text-xs text-secondary-text" role={loadingPlans ? "status" : undefined}>{loadingPlans ? uiLiteral("正在读取后端计划…") : plansError ? "—" : uiLiteral(`共 ${plans.length} 个已注册计划。`)}</p>
        </div>
        {plansError && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 pb-4 text-sm text-danger">{uiLiteral(plansError)}<button className="btn-secondary" onClick={() => setPlansRevision(value => value + 1)}>{t('common.retry')}</button></p>}
        {!loadingPlans && plans.length > 0 && <div className="divide-y divide-border">{plans.map(plan => {
          const type = getTaskType(plan.kind);
          return <article key={plan.id} className="grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h3 className="break-words font-semibold text-foreground">{plan.name}</h3><span className={`text-xs ${plan.enabled ? 'text-success' : 'text-secondary-text'}`}>{uiLiteral(plan.enabled ? '计划已启用' : '计划已暂停')}</span></div>
              <p className="mt-2 text-xs text-secondary-text">{uiLiteral(type.title)} · {countScheduledCapabilities(plan.capabilities)} <UiLiteral text=" 项能力" />{plan.publishToMarket ? <> · <UiLiteral text="市场展示" /></> : null}</p>
              <p className="mt-2 break-words text-sm text-secondary-text">{getTargetSummary(plan, uiLiteral)}</p>
              <p className="mt-2 break-words text-xs text-secondary-text">{getScheduleSummary(plan, uiLiteral)}</p>
              <p className="mt-2 break-words text-xs text-muted-text"><UiLiteral text="输出" /> · {type.output}</p>
            </div>
            <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm md:grid-cols-1">
              <div className="min-w-0"><dt className="text-xs text-secondary-text">{uiLiteral('下次运行')}</dt><dd className="mt-1 break-words tabular-nums">{plan.enabled ? <time dateTime={plan.nextRunAt}>{planTime(plan.nextRunAt, plan.timezone)}</time> : uiLiteral('计划已暂停')}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-secondary-text">{uiLiteral('上次运行')}</dt><dd className="mt-1 break-words tabular-nums">{plan.lastRunAt ? <time dateTime={plan.lastRunAt}>{planTime(plan.lastRunAt, plan.timezone)}</time> : uiLiteral('尚未运行')}</dd>{plan.lastRunId && <Link className="inline-flex min-h-11 items-center text-xs text-primary hover:underline" to={`/runs/${plan.lastRunId}`}>{uiLiteral('查看上次运行')}</Link>}</div>
            </dl>
            <div className="flex flex-wrap items-start gap-2"><button type="button" disabled={mutating} onClick={() => void togglePlan(plan)} className="btn-secondary">{uiLiteral(plan.enabled ? '暂停计划' : '启用计划')}</button><button type="button" disabled={mutating} onClick={() => setPendingDelete(plan)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary-text hover:bg-danger/10 hover:text-danger disabled:opacity-50" aria-label={uiLiteral(`删除计划 ${plan.name}`)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>
          </article>;
        })}</div>}
        {!loadingPlans && !plansError && !plans.length && <div className="py-7 text-sm text-secondary-text"><h3 className="font-medium text-foreground"><UiLiteral text="还没有运行计划" /></h3><p className="mt-2 max-w-[65ch] leading-6">{uiLiteral('在下方选择任务类型并保存后，计划会注册到后端并按设定时间运行。')}</p></div>}
      </section>
      {plans.length > 0 && <p className="max-w-[75ch] text-xs leading-6 text-secondary-text">{uiLiteral('暂停或删除只影响后续调度，已领取或已启动的运行仍可能继续。')}</p>}
      {error && <p id="schedule-form-error" role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-danger">{uiLiteral(error)}{error === '交易提案任务读取失败，请重试。' && <button className="btn-secondary" disabled={mutating || loadingPlans} onClick={() => setPlansRevision(value => value + 1)}>{t('common.retry')}</button>}</p>}
      {savedMessage && <p role="status" className="text-sm text-success">{uiLiteral(savedMessage)}</p>}
      <ConfirmDialog isOpen={pendingDelete !== null} title={uiLiteral('确认删除计划')}
        message={pendingDelete ? uiLiteral(`删除计划“${pendingDelete.name}”后将停止后续调度；已领取或已启动的运行仍可能继续。`) : ''}
        confirmText={t('common.delete')} confirmDisabled={mutating} cancelDisabled={mutating} isDanger
        onConfirm={() => { if (pendingDelete) void deletePlan(pendingDelete.id); }}
        onCancel={() => { if (!operation.current) setPendingDelete(null); }} />

      {showBuilder && <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section id="schedule-builder" className="min-w-0 border-t border-border" aria-labelledby="schedule-builder-heading">
          <fieldset disabled={mutating || loadingPlans} className="min-w-0">
          <div className="border-b border-border/70 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 id="schedule-builder-heading" className="text-base font-semibold text-foreground"><UiLiteral text={"新建运行计划"} /></h2>
            </div>
            <p className="mt-1 text-sm text-secondary-text"><UiLiteral text={"先选择任务，再定义运行对象和触发节奏。"} /></p>

            <div className="mt-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label={uiLiteral("任务类型")}>
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
                    <span className="mt-3 block text-xs font-semibold text-foreground sm:mt-4 sm:text-sm">{uiLiteral(item.title)}</span>
                    <span className="mt-1 hidden text-xs leading-5 text-muted-text sm:block">{uiLiteral(item.description)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-[10px] border border-border bg-background px-4 py-3 xl:hidden" aria-live="polite">
              <p className="text-[11px] font-medium text-primary"><UiLiteral text={"当前输出契约"} /></p>
              <p className="mt-1 text-sm font-semibold text-foreground">{output.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-text">{uiLiteral(output.boundary)}</p>
            </div>

            {prefillSource ? (
              <div className="mt-4 flex items-start gap-3 rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3" role="status">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground"><UiLiteral text={"已从"} />{prefillSource}<UiLiteral text={"带入当前配置"} /></p>
                  <p className="mt-1 text-xs leading-5 text-secondary-text"><UiLiteral text={"运行对象、业务条件和 "} />{capabilityCount} <UiLiteral text={" 项 Agent 能力已预填；这里只需要确认运行时间。"} /></p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-b border-border/70 px-5 py-5 sm:px-6">
            <h3 className="text-sm font-semibold text-foreground"><UiLiteral text={"任务对象"} /></h3>
            {draft.scheduleMode === "daily" && <label className="mt-4 block text-sm">{l("每隔几天运行", "Run every (days)")}<input type="number" min="1" max="365" step="1" required value={draft.intervalDays} onChange={e => updateDraft("intervalDays", e.target.value)} className="ml-3 w-24 rounded-lg border border-border bg-background p-2" /></label>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-foreground">
                <UiLiteral text={"计划名称"} /><input
                  id="schedule-field-name"
                  required
                  aria-invalid={errorField === "name"}
                  aria-describedby={errorField === "name" ? "schedule-form-error" : undefined}
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder={draft.kind === "research" ? uiLiteral("例如：每日贵州茅台复盘") : draft.kind === "screening" ? uiLiteral("例如：每日价值候选池") : uiLiteral("例如：趋势策略提案巡检")}
                  className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                <UiLiteral text={"市场"} /><select value={draft.market} onChange={(event) => changeMarket(event.target.value as MarketId)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                  {MARKETS.map((item) => <option key={item.id} value={item.id}>{uiLiteral(item.label)}</option>)}
                </select>
              </label>
            </div>

            {draft.kind === "research" ? (
              <>
                <div className="mt-4">
                  <label htmlFor="schedule-field-stock" className="block text-sm font-medium text-foreground"><UiLiteral text={"股票"} /></label>
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
                      placeholder={stockIndex.loading ? uiLiteral("正在读取股票目录…") : uiLiteral("搜索股票代码或名称")}
                      className="h-10 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                    {stockIndex.loading ? <LoaderCircle className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-text" aria-hidden="true" /> : null}
                  </div>
                  {stockSuggestions.length ? (
                    <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-[9px] border border-border" role="listbox" aria-label={uiLiteral("股票搜索结果")}>
                      {stockSuggestions.map((stock) => (
                        <button key={stock.canonicalCode} type="button" role="option" aria-selected="false" onClick={() => selectStock(stock)} className="flex w-full items-center justify-between gap-4 bg-background px-3 py-2.5 text-left transition-colors hover:bg-hover/60">
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{stock.nameZh || stock.nameEn || stock.displayCode}</span><span className="mt-0.5 block text-xs text-muted-text">{stock.canonicalCode}</span></span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-text" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {draft.stock ? <p className="mt-2 text-xs font-medium text-success"><UiLiteral text={"已绑定 "} />{draft.stockName} · {draft.stock}</p> : null}
                  {stockIndex.error ? <p className="mt-2 text-xs text-warning"><UiLiteral text={"股票目录使用降级数据，搜索范围可能有限。"} /></p> : null}
                </div>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  <UiLiteral text={"每日关注问题（可选）"} /><textarea value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder={uiLiteral("例如：跟踪盈利质量、估值变化和最新风险事件")} className="mt-2 min-h-24 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" />
                </label>
              </>
            ) : null}

            {draft.kind === "screening" ? (
              <>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  <UiLiteral text={"选股目标"} /><textarea id="schedule-field-objective" required aria-invalid={errorField === "objective"} aria-describedby={errorField === "objective" ? "schedule-form-error" : undefined} value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder={uiLiteral("例如：每天寻找盈利持续增长、估值低于行业中位数且近期无重大利空的公司")} className="mt-2 min-h-28 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" />
                </label>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground">
                    <UiLiteral text={"行业范围（可选）"} /><input value={draft.industry} onChange={(event) => updateDraft("industry", event.target.value)} placeholder={uiLiteral("例如：半导体")} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    <UiLiteral text={"每次保留候选数"} /><select value={draft.candidateCount} onChange={(event) => updateDraft("candidateCount", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
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
                  <UiLiteral text={"交易提案计划"} /><select
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
                    <option value="">{tradingStrategies.length ? uiLiteral("选择已保存的交易提案任务") : uiLiteral("尚未保存交易提案任务")}</option>
                    {tradingStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.versionLabel}</option>)}
                  </select>
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-text"><UiLiteral text={"计划绑定后端保存的交易任务版本；后续修改策略会生成新的 Task 版本，并保留每次 Run 的冻结快照。"} />{!tradingStrategies.length ? <> <UiLiteral text={" 请先"} /><Link to="/trading?view=reports" className="mx-1 font-medium text-primary hover:underline"><UiLiteral text={"保存交易提案任务"} /></Link>。</> : null}</p>
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-4 text-xs text-muted-text">
              <span className="font-medium text-secondary-text"><UiLiteral text={"继承 Agent 能力"} /></span>
              <span>{capabilityCount} <UiLiteral text={" 项"} /></span>
              {capabilityCount ? (
                <span>Skill {draft.capabilities.skillIds.length} <UiLiteral text={" · 工具 "} />{draft.capabilities.toolIds.length} · MCP {draft.capabilities.mcpIds.length} <UiLiteral text={" · 数据源 "} />{draft.capabilities.dataSourceIds.length} <UiLiteral text={" · 专家 "} />{draft.capabilities.expertIds.length + draft.capabilities.expertTeamIds.length}</span>
              ) : <span><UiLiteral text={"运行时使用该任务的通用配置"} /></span>}
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground"><UiLiteral text={"运行节奏"} /></h3>
            </div>

            {draft.kind === "trading" ? (
              <div className="mt-4 inline-flex rounded-[9px] border border-border bg-background p-1" role="radiogroup" aria-label={uiLiteral("交易提案运行方式")}>
                <button type="button" role="radio" aria-checked={draft.scheduleMode === "daily"} onClick={() => updateDraft("scheduleMode", "daily")} className={cn("rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors", draft.scheduleMode === "daily" ? "bg-primary text-primary-foreground" : "text-secondary-text hover:text-foreground")}><UiLiteral text={"每天定时"} /></button>
                <button type="button" role="radio" aria-checked={draft.scheduleMode === "interval"} onClick={() => updateDraft("scheduleMode", "interval")} className={cn("rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors", draft.scheduleMode === "interval" ? "bg-primary text-primary-foreground" : "text-secondary-text hover:text-foreground")}><UiLiteral text={"按间隔运行"} /></button>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-muted-text"><UiLiteral text={"单股分析和选股每天运行一次，避免同一天重复生成大量报告或候选池。"} /></p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {draft.scheduleMode === "daily" ? (
                <label className="text-sm font-medium text-foreground">
                  {l("运行时间", "Run time")}
                  <input id="schedule-field-runAt" required aria-invalid={errorField === "runAt"} aria-describedby={errorField === "runAt" ? "schedule-form-error" : undefined} type="time" value={draft.runAt} onChange={(event) => updateDraft("runAt", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
                </label>
              ) : (
                <label className="text-sm font-medium text-foreground">
                  <UiLiteral text={"运行频率"} /><select id="schedule-field-interval" required aria-invalid={errorField === "interval"} aria-describedby={errorField === "interval" ? "schedule-form-error" : undefined} value={draft.intervalMinutes} onChange={(event) => updateDraft("intervalMinutes", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                    <option value="5"><UiLiteral text={"每 5 分钟"} /></option>
                    <option value="15"><UiLiteral text={"每 15 分钟"} /></option>
                    <option value="30"><UiLiteral text={"每 30 分钟"} /></option>
                    <option value="60"><UiLiteral text={"每 1 小时"} /></option>
                    <option value="240"><UiLiteral text={"每 4 小时"} /></option>
                  </select>
                </label>
              )}
              <div className="rounded-[10px] border border-border bg-background px-3 py-2.5">
                <span className="block text-xs text-muted-text"><UiLiteral text={"市场时区"} /></span>
                <span className="mt-1 block text-sm font-medium text-foreground">{uiLiteral(market.timezoneLabel)}</span>
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
                    <UiLiteral text={"展示到"} />{uiLiteral(market.label)}<UiLiteral text={"市场看板"} /></span>
                  <span className="mt-1 block text-xs leading-5 text-muted-text">
                    <UiLiteral text={"看板只展示最近一次成功运行的摘要、数据时间和状态；点击后进入完整成果。"} /></span>
                </span>
              </label>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-text"><UiLiteral text={"拟定节奏："} />{getScheduleSummary(draft, uiLiteral)}</p>
              <button type="button" disabled={mutating || loadingPlans} onClick={() => void savePlan()} className="btn-primary inline-flex shrink-0 items-center justify-center gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                {uiLiteral(saving ? '正在注册…' : '注册定时计划')}</button>
            </div>
          </div>
          </fieldset>
        </section>

        <aside className="hidden min-w-0 border-t border-border xl:sticky xl:top-6 xl:block" aria-labelledby="output-contract-heading">
          <div className="border-b border-border px-5 py-5">
            <p className="text-xs font-medium text-primary"><UiLiteral text={"当前输出契约"} /></p>
            <h2 id="output-contract-heading" className="mt-2 text-base font-semibold text-foreground">{output.title}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">{uiLiteral(output.description)}</p>
          </div>
          <div className="px-5 py-5">
            <ul className="space-y-3">
              {output.items.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-secondary-text">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {uiLiteral(item)}
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-border pt-4">
              <p className="flex items-start gap-2 text-xs leading-5 text-muted-text">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {uiLiteral(output.boundary)}
              </p>
            </div>
          </div>
        </aside>
      </div>}
    </AppPage>
  );
}
