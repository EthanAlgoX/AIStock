import {
  Activity,
  CalendarClock,
  Check,
  Database,
  Octagon,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { workspaceApi, type WorkspaceRun, type WorkspaceSkill, type WorkspaceTask } from "../api/workspace";
import AgentCapabilityPanel from "../components/agent/AgentCapabilityPanel";
import { AppPage, PageHeader } from "../components/common";
import {
  countAgentCapabilities,
  EMPTY_AGENT_CAPABILITIES,
  type AgentCapabilityBindings,
} from "../types/capabilities";
import type { ScheduledTaskNavigationState } from "../types/scheduledTasks";
import { cn } from "../utils/cn";

type MarketId = "CN" | "HK" | "US";
type RunStatus = "idle" | "queued" | "running" | "completed" | "failed" | "stopped";

type TradingStrategyDraft = {
  name: string;
  objective: string;
  market: MarketId;
  universeMode: "screening" | "watchlist" | "portfolio";
  cadence: "5m" | "15m" | "1h" | "1d";
  evaluationWindow: "7d" | "30d" | "90d";
  initialCapital: string;
  maxPositions: string;
  maxPositionPercent: string;
  maxDailyLossPercent: string;
  requireApproval: boolean;
};

const DEFAULT_DRAFT: TradingStrategyDraft = {
  name: "",
  objective: "",
  market: "CN",
  universeMode: "screening",
  cadence: "15m",
  evaluationWindow: "30d",
  initialCapital: "1000000",
  maxPositions: "10",
  maxPositionPercent: "15",
  maxDailyLossPercent: "3",
  requireApproval: true,
};

const MARKETS: Array<{ id: MarketId; label: string; description: string }> = [
  { id: "CN", label: "A 股", description: "沪深北模拟市场" },
  { id: "HK", label: "港股", description: "香港模拟市场" },
  { id: "US", label: "美股", description: "美国模拟市场" },
];

const toggleValue = <T,>(items: T[], value: T) => (
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
);

const formatElapsed = (seconds: number) => {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
};

export default function TradingWorkspacePage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TradingStrategyDraft>(DEFAULT_DRAFT);
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilityBindings>(EMPTY_AGENT_CAPABILITIES);
  const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [savedTask, setSavedTask] = useState<WorkspaceTask | null>(null);
  const [activeRun, setActiveRun] = useState<WorkspaceRun | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const capabilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const capabilityDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([workspaceApi.getCapabilities(), workspaceApi.listTasks("trading")])
      .then(([catalog, tasks]) => {
        if (!active) return;
        setSkills(catalog.skills.filter((skill) => skill.enabled));
        const task = tasks[0];
        if (!task) {
          setCapabilities(catalog.defaults.trading);
          return;
        }
        const config = task.config || {};
        const risk = typeof config.riskPolicy === "object" && config.riskPolicy
          ? config.riskPolicy as Record<string, unknown>
          : {};
        setSavedTask(task);
        setCapabilities(task.capabilities);
        setDraft({
          ...DEFAULT_DRAFT,
          name: task.name,
          objective: task.objective,
          market: task.market === "GLOBAL" ? "CN" : task.market,
          universeMode: String(task.subject?.universeMode || "screening") as TradingStrategyDraft["universeMode"],
          cadence: String(config.cadence || "15m") as TradingStrategyDraft["cadence"],
          evaluationWindow: String(config.evaluationWindow || "30d") as TradingStrategyDraft["evaluationWindow"],
          initialCapital: String(config.initialCapital || "1000000"),
          maxPositions: String(risk.maxPositions || "10"),
          maxPositionPercent: String(risk.maxPositionPercent || "15"),
          maxDailyLossPercent: String(risk.maxDailyLossPercent || "3"),
          requireApproval: risk.requireApproval !== false,
        });
      })
      .catch(() => {
        if (active) setSkillsError("Skill 目录读取失败，可保存策略后稍后重试。");
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (runStatus !== "running" && runStatus !== "queued") return;
    const timer = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runStatus]);

  useEffect(() => {
    if (!activeRun || !["queued", "running"].includes(activeRun.status)) return;
    const timer = window.setTimeout(() => {
      void workspaceApi.getRun(activeRun.id).then((run) => {
        setActiveRun(run);
        setRunStatus(run.status === "cancelled" ? "stopped" : run.status);
      }).catch(() => setRuntimeError("模拟运行状态读取失败。"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [activeRun]);

  useEffect(() => {
    if (!capabilityPanelOpen) return;
    const dialog = capabilityDialogRef.current;
    const trigger = capabilityTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusFirstControl = window.requestAnimationFrame(() => {
      const firstControl = dialog?.querySelector<HTMLElement>(focusableSelector);
      (firstControl || dialog)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapabilityPanelOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [capabilityPanelOpen]);

  const capabilityCount = countAgentCapabilities(capabilities);
  const strategyReady = Boolean(draft.name.trim() && draft.objective.trim());
  const runState = useMemo(() => ({
    idle: { label: "未启动", tone: "bg-muted-text" },
    queued: { label: "排队中", tone: "bg-warning" },
    running: { label: "模拟运行中", tone: "bg-warning" },
    completed: { label: "已完成", tone: "bg-success" },
    failed: { label: "运行失败", tone: "bg-danger" },
    stopped: { label: "已停止", tone: "bg-muted-text" },
  }[runStatus]), [runStatus]);

  const updateDraft = <K extends keyof TradingStrategyDraft>(key: K, value: TradingStrategyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const saveDraft = async () => {
    const payload = {
      name: draft.name.trim(),
      market: draft.market,
      objective: draft.objective.trim(),
      subject: { universeMode: draft.universeMode },
      config: {
        cadence: draft.cadence,
        evaluationWindow: draft.evaluationWindow,
        initialCapital: Number(draft.initialCapital),
        riskPolicy: {
          maxPositions: Number(draft.maxPositions),
          maxPositionPercent: Number(draft.maxPositionPercent),
          maxDailyLossPercent: Number(draft.maxDailyLossPercent),
          requireApproval: draft.requireApproval,
        },
        executionMode: "paper",
      },
      capabilities,
    } as const;
    try {
      const task = savedTask
        ? await workspaceApi.updateTask(savedTask.id, payload)
        : await workspaceApi.createTask({ kind: "trading", ...payload });
      setSavedTask(task);
      setSaved(true);
      setRuntimeError("");
      return task;
    } catch {
      setRuntimeError("交易策略保存失败，请检查能力配置。 ");
      return null;
    }
  };

  const startRun = async () => {
    if (!strategyReady) return;
    const task = await saveDraft();
    if (!task) return;
    setElapsedSeconds(0);
    try {
      const run = await workspaceApi.runTask(task.id);
      setActiveRun(run);
      setRunStatus(run.status === "cancelled" ? "stopped" : run.status);
    } catch {
      setRuntimeError("模拟运行未能启动，请检查主 Agent 状态。 ");
      setRunStatus("failed");
    }
  };

  const scheduleStrategy = async () => {
    if (!strategyReady) return;
    const task = await saveDraft();
    if (!task) return;
    const intervalMinutes = draft.cadence === "5m" ? "5" : draft.cadence === "15m" ? "15" : draft.cadence === "1h" ? "60" : "15";
    const state: ScheduledTaskNavigationState = {
      schedulePrefill: {
        sourceLabel: "交易策略",
        kind: "trading",
        name: `${draft.name.trim()}模拟运行计划`,
        market: draft.market,
        strategyRef: task.id,
        strategyName: draft.name.trim(),
        objective: draft.objective,
        scheduleMode: draft.cadence === "1d" ? "daily" : "interval",
        intervalMinutes,
        capabilities,
      },
    };
    navigate("/schedules?type=trading", { state });
  };

  const renderCapabilityPanel = (className: string, onClose?: () => void) => (
    <AgentCapabilityPanel
      scopeLabel="任务"
      skills={skills}
      selectedSkillIds={capabilities.skillIds}
      onToggleSkill={(id) => setCapabilities((current) => ({ ...current, skillIds: toggleValue(current.skillIds, id) }))}
      skillLimitReached={capabilities.skillIds.length >= 3}
      selectedToolIds={capabilities.toolIds}
      onToggleTool={(id) => setCapabilities((current) => ({ ...current, toolIds: toggleValue(current.toolIds, id) }))}
      selectedDataSourceIds={capabilities.dataSourceIds}
      onToggleDataSource={(id) => setCapabilities((current) => ({ ...current, dataSourceIds: toggleValue(current.dataSourceIds, id) }))}
      selectedMcpIds={capabilities.mcpIds}
      onToggleMcp={(id) => setCapabilities((current) => ({ ...current, mcpIds: toggleValue(current.mcpIds, id) }))}
      selectedExpertIds={capabilities.expertIds}
      onToggleExpert={(id) => setCapabilities((current) => ({ ...current, expertIds: toggleValue(current.expertIds, id) }))}
      selectedExpertTeamIds={capabilities.expertTeamIds}
      onToggleExpertTeam={(id) => setCapabilities((current) => ({ ...current, expertTeamIds: toggleValue(current.expertTeamIds, id) }))}
      onClose={onClose}
      className={className}
    />
  );

  return (
    <AppPage className="space-y-6 pb-20" data-testid="trading-strategy-workspace">
      <PageHeader
        eyebrow="Paper strategy runtime"
        title="交易策略"
        description="把投资目标、运行节奏、风险边界和 Agent 能力保存为交易策略，再通过模拟运行观察信号和流程稳定性。"
        actions={<Link to="/capabilities/skills" className="btn-secondary inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />管理工作区能力</Link>}
      />

      <ol className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4" aria-label="交易策略配置流程">
        {[
          { label: "定义策略", ready: Boolean(draft.name.trim() && draft.objective.trim()) },
          { label: "设置信号", ready: true },
          { label: "锁定风控", ready: true },
          { label: "运行预览", ready: runStatus !== "idle" },
        ].map((step, index) => (
          <li key={step.label} className="flex items-center gap-3 bg-card px-4 py-3">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", step.ready ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-text")}>{step.ready ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <span className={step.ready ? "text-sm font-medium text-foreground" : "text-sm text-secondary-text"}>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_304px]">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-definition-heading">
              <h2 id="trading-definition-heading" className="text-base font-semibold text-foreground">策略定义</h2>
              <p className="mt-1 text-sm text-secondary-text">这里保存策略目标与适用范围，不上传代码包。</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-foreground">策略名称<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="例如：高质量趋势跟踪" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">候选范围<select value={draft.universeMode} onChange={(event) => updateDraft("universeMode", event.target.value as TradingStrategyDraft["universeMode"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="screening">选股任务最新候选池</option><option value="watchlist">工作区观察池</option><option value="portfolio">当前模拟持仓</option></select></label>
              </div>
              <label className="mt-4 block text-sm font-medium text-foreground">交易逻辑<textarea value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder="例如：从高质量候选池中寻找中期趋势确认的公司；信号冲突时保持现金，并要求专家团复核重大基本面变化" className="mt-2 min-h-28 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {MARKETS.map((market) => (
                  <button key={market.id} type="button" aria-pressed={draft.market === market.id} onClick={() => updateDraft("market", market.id)} className={cn("flex min-h-16 items-center justify-between rounded-[10px] border px-4 py-3 text-left transition-colors", draft.market === market.id ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/40")}>
                    <span><span className="block text-sm font-semibold text-foreground">{market.label}</span><span className="mt-1 block text-xs text-muted-text">{market.description}</span></span>
                    {draft.market === market.id ? <Check className="h-4 w-4 text-primary" /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-signal-heading">
              <h2 id="trading-signal-heading" className="text-base font-semibold text-foreground">信号与运行节奏</h2>
              <p className="mt-1 text-sm text-secondary-text">模拟周期用于观察策略运行稳定性，不代表回测已通过。</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-foreground">信号检查频率<select value={draft.cadence} onChange={(event) => updateDraft("cadence", event.target.value as TradingStrategyDraft["cadence"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="5m">每 5 分钟</option><option value="15m">每 15 分钟</option><option value="1h">每小时</option><option value="1d">每日收盘后</option></select></label>
                <label className="text-sm font-medium text-foreground">评估窗口<select value={draft.evaluationWindow} onChange={(event) => updateDraft("evaluationWindow", event.target.value as TradingStrategyDraft["evaluationWindow"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="7d">连续 7 天</option><option value="30d">连续 30 天</option><option value="90d">连续 90 天</option></select></label>
                <div className="rounded-[10px] border border-success/20 bg-success/5 px-3 py-2.5"><span className="block text-xs text-muted-text">执行模式</span><span className="mt-1 block text-sm font-semibold text-success">模拟盘 · 不下真实订单</span></div>
              </div>
            </section>

            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-risk-heading">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 id="trading-risk-heading" className="text-base font-semibold text-foreground">硬性风险边界</h2></div>
              <p className="mt-1 text-sm text-secondary-text">这些限制属于确定性风控，目标架构中不允许 Agent 修改或绕过。</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium text-foreground">模拟初始资金<input type="number" min="10000" value={draft.initialCapital} onChange={(event) => updateDraft("initialCapital", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">最大持仓数<input type="number" min="1" max="100" value={draft.maxPositions} onChange={(event) => updateDraft("maxPositions", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">单股仓位上限（%）<input type="number" min="1" max="100" value={draft.maxPositionPercent} onChange={(event) => updateDraft("maxPositionPercent", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">单日亏损上限（%）<input type="number" min="0.1" max="100" step="0.1" value={draft.maxDailyLossPercent} onChange={(event) => updateDraft("maxDailyLossPercent", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-[10px] border border-border bg-background px-4 py-3 text-sm text-foreground"><input type="checkbox" checked={draft.requireApproval} onChange={(event) => updateDraft("requireApproval", event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" /><span><span className="font-medium">模拟交易提案进入人工确认</span><span className="mt-1 block text-xs leading-5 text-muted-text">即使后端接通，也先生成提案，不自动提交真实订单。</span></span></label>
            </section>

            <section className="px-5 py-5 sm:px-6" aria-labelledby="trading-capability-heading">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div><h2 id="trading-capability-heading" className="text-base font-semibold text-foreground">策略能力</h2><p className="mt-1 text-sm text-secondary-text">已选择 {capabilityCount} 项能力{skillsLoading ? "，正在读取 Skill" : ""}。专家可以参与信号复核和交易提案评审。</p>{skillsError ? <p role="alert" className="mt-1 text-xs text-warning">{skillsError}</p> : null}</div>
                <button ref={capabilityTriggerRef} type="button" className="btn-secondary inline-flex items-center justify-center gap-2 xl:hidden" onClick={() => setCapabilityPanelOpen(true)}><SlidersHorizontal className="h-4 w-4" />配置策略能力</button>
              </div>
              <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-text"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />策略定义和能力绑定会保存到后端；每次模拟运行都会冻结独立快照。</p>
                <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => void saveDraft()}><Save className="h-4 w-4" />保存交易策略</button><button type="button" disabled={!strategyReady} className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void scheduleStrategy()}><CalendarClock className="h-4 w-4" />创建定时计划</button><button type="button" disabled={!strategyReady || runStatus === "queued" || runStatus === "running"} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void startRun()}><Play className="h-4 w-4" />启动模拟运行</button></div>
              </div>
              {saved ? <p role="status" className="mt-3 text-xs font-medium text-success">交易策略已保存到后端工作区。</p> : null}
            </section>
          </div>

          <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="paper-runtime-heading">
            <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h2 id="paper-runtime-heading" className="font-semibold text-foreground">模拟运行</h2></div><p className="mt-1 text-xs leading-5 text-secondary-text">后端运行主 Agent，保存交易提案、风险检查和 PaperTradingRun；真实订单始终禁用。</p></div>
              <div className="flex items-center gap-2 text-xs font-medium text-foreground"><span className={cn("h-2 w-2 rounded-full", runState.tone)} />{runState.label}</div>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-4">
              <div className="bg-card px-5 py-4"><span className="block text-xs text-muted-text">运行计时</span><span className="mt-1 block font-mono text-lg font-semibold text-foreground">{formatElapsed(elapsedSeconds)}</span></div>
              <div className="bg-card px-5 py-4"><span className="block text-xs text-muted-text">数据快照</span><span className="mt-1 block text-sm font-medium text-foreground">{activeRun?.dataSnapshotId ? activeRun.dataSnapshotId.slice(0, 8) : "尚未创建"}</span></div>
              <div className="bg-card px-5 py-4"><span className="block text-xs text-muted-text">正式成果</span><span className="mt-1 block text-sm font-medium text-foreground">{activeRun?.artifacts?.length || 0} 项</span></div>
              <div className="bg-card px-5 py-4"><span className="block text-xs text-muted-text">订单执行</span><span className="mt-1 block text-sm font-medium text-foreground">已禁用</span></div>
            </div>
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium text-foreground">{runStatus === "running" || runStatus === "queued" ? "主 Agent 正在生成模拟交易提案" : runStatus === "completed" ? "本次模拟运行已完成" : runStatus === "failed" ? "本次模拟运行失败" : runStatus === "stopped" ? "本次模拟运行已停止" : "尚未开始模拟运行"}</p><p className="mt-1 text-xs leading-5 text-muted-text">所有结果只进入模拟账本；风险检查不会被 Agent 绕过。</p>{runtimeError || activeRun?.errorMessage ? <p role="alert" className="mt-2 text-xs text-danger">{runtimeError || activeRun?.errorMessage}</p> : null}</div>
              {(runStatus === "queued" || runStatus === "running") && activeRun ? <button type="button" className="btn-secondary inline-flex items-center gap-2 text-danger" onClick={() => { void workspaceApi.cancelRun(activeRun.id); setRunStatus("stopped"); }}><Octagon className="h-4 w-4" />停止</button> : null}
            </div>
          </section>
        </div>

        {renderCapabilityPanel("hidden h-[calc(100vh-10rem)] w-full xl:sticky xl:top-6 xl:flex")}
      </div>

      {capabilityPanelOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 p-3 xl:hidden" role="presentation" onClick={() => setCapabilityPanelOpen(false)}>
          <div ref={capabilityDialogRef} tabIndex={-1} className="ml-auto h-full w-fit outline-none" role="dialog" aria-modal="true" aria-label="配置交易策略能力" onClick={(event) => event.stopPropagation()}>{renderCapabilityPanel("h-full w-[min(21rem,calc(100vw-1.5rem))]", () => setCapabilityPanelOpen(false))}</div>
        </div>
      ) : null}
    </AppPage>
  );
}
