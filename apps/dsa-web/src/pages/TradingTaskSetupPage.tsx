import { useUiLanguage } from "../contexts/UiLanguageContext";
import {
  CalendarClock,
  Check,
  Database,
  Play,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { workspaceApi, type WorkspaceRun, type WorkspaceSkill, type WorkspaceTask } from "../api/workspace";
import { useWorkspaceRun } from "../hooks/useWorkspaceRun";
import AgentCapabilityPanel from "../components/agent/AgentCapabilityPanel";
import { StrategySkillPicker } from "../components/agent/ResearchStrategySelector";
import DefaultTaskLauncher from "../components/agent/DefaultTaskLauncher";
import {
  countAgentCapabilities,
  EMPTY_AGENT_CAPABILITIES,
  type AgentCapabilityBindings,
} from "../types/capabilities";
import type { ScheduledTaskNavigationState } from "../types/scheduledTasks";
import { cn } from "../utils/cn";

type MarketId = "CN" | "HK" | "US";

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

export default function TradingTaskSetupPage({ onRunStarted }: { onRunStarted: (run: WorkspaceRun) => void }) {
  const { translate: tx } = useUiLanguage();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TradingStrategyDraft>(DEFAULT_DRAFT);
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilityBindings>(EMPTY_AGENT_CAPABILITIES);
  const [saved, setSaved] = useState(false);
  const [savedTask, setSavedTask] = useState<WorkspaceTask | null>(null);
  const { activeRun, runError, submitting, restoring, busy, startRun: submitRun } = useWorkspaceRun("trading", false);
  const [runtimeError, setRuntimeError] = useState("");
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

  const capabilityCount = countAgentCapabilities(capabilities);
  const strategyReady = Boolean(draft.name.trim() && draft.objective.trim());

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
    if (!strategyReady || busy) return;
    await submitRun(async () => {
      const task = await saveDraft();
      if (!task) throw new Error("交易策略未保存");
      const run = await workspaceApi.runTask(task.id);
      if (mountedRef.current) onRunStarted(run);
      return run;
    }, "模拟运行启动未确认，请检查主 Agent 状态和运行记录。");
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

  const renderCapabilityPanel = (className: string) => (
    <AgentCapabilityPanel
      scopeLabel="任务"
      presentation="inline"
      showSkills={false}
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
      className={className}
    />
  );

  return (
    <div className="space-y-6 pb-6" data-testid="trading-strategy-workspace">
      <ol className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4" aria-label={tx("交易策略配置流程")}>
        {[
          { label: tx("定义策略"), ready: Boolean(draft.name.trim() && draft.objective.trim()) },
          { label: tx("设置信号"), ready: true },
          { label: tx("锁定风控"), ready: true },
          { label: tx("生成提案"), ready: Boolean(activeRun) },
        ].map((step, index) => (
          <li key={step.label} className="flex items-center gap-3 bg-card px-4 py-3">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", step.ready ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-text")}>{step.ready ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <span className={step.ready ? "text-sm font-medium text-foreground" : "text-sm text-secondary-text"}>{step.label}</span>
          </li>
        ))}
      </ol>

      <DefaultTaskLauncher kind="trading" market={draft.market} onRunStarted={onRunStarted} />
      <div className="grid items-start gap-5">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-definition-heading">
              <h2 id="trading-definition-heading" className="text-base font-semibold text-foreground">{tx("策略定义")}</h2>
              <p className="mt-1 text-sm text-secondary-text">{tx("这里保存策略目标与适用范围，不上传代码包。")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-foreground">{tx("策略名称")}<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder={tx("例如：高质量趋势跟踪")} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">{tx("候选范围")}<select value={draft.universeMode} onChange={(event) => updateDraft("universeMode", event.target.value as TradingStrategyDraft["universeMode"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="screening">{tx("选股任务最新候选池")}</option><option value="watchlist">{tx("工作区观察池")}</option><option value="portfolio">{tx("当前模拟持仓")}</option></select></label>
              </div>
              <label className="mt-4 block text-sm font-medium text-foreground">{tx("交易逻辑")}<textarea value={draft.objective} onChange={(event) => updateDraft("objective", event.target.value)} placeholder={tx("例如：从高质量候选池中寻找中期趋势确认的公司；信号冲突时保持现金，并要求专家团复核重大基本面变化")} className="mt-2 min-h-28 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {MARKETS.map((market) => (
                  <button key={market.id} type="button" aria-pressed={draft.market === market.id} onClick={() => updateDraft("market", market.id)} className={cn("flex min-h-16 items-center justify-between rounded-[10px] border px-4 py-3 text-left transition-colors", draft.market === market.id ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/40")}>
                    <span><span className="block text-sm font-semibold text-foreground">{tx(market.label)}</span><span className="mt-1 block text-xs text-muted-text">{tx(market.description)}</span></span>
                    {draft.market === market.id ? <Check className="h-4 w-4 text-primary" /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-signal-heading">
              <h2 id="trading-signal-heading" className="text-base font-semibold text-foreground">{tx("信号与运行节奏")}</h2>
              <p className="mt-1 text-sm text-secondary-text">{tx("模拟周期用于观察策略运行稳定性，不代表回测已通过。")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-foreground">{tx("信号检查频率")}<select value={draft.cadence} onChange={(event) => updateDraft("cadence", event.target.value as TradingStrategyDraft["cadence"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="5m">{tx("每 5 分钟")}</option><option value="15m">{tx("每 15 分钟")}</option><option value="1h">{tx("每小时")}</option><option value="1d">{tx("每日收盘后")}</option></select></label>
                <label className="text-sm font-medium text-foreground">{tx("评估窗口")}<select value={draft.evaluationWindow} onChange={(event) => updateDraft("evaluationWindow", event.target.value as TradingStrategyDraft["evaluationWindow"])} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="7d">{tx("连续 7 天")}</option><option value="30d">{tx("连续 30 天")}</option><option value="90d">{tx("连续 90 天")}</option></select></label>
                <div className="rounded-[10px] border border-success/20 bg-success/5 px-3 py-2.5"><span className="block text-xs text-muted-text">{tx("执行模式")}</span><span className="mt-1 block text-sm font-semibold text-success">{tx("模拟盘 · 不下真实订单")}</span></div>
              </div>
            </section>

            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-risk-heading">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 id="trading-risk-heading" className="text-base font-semibold text-foreground">{tx("硬性风险边界")}</h2></div>
              <p className="mt-1 text-sm text-secondary-text">{tx("这些限制属于确定性风控，目标架构中不允许 Agent 修改或绕过。")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium text-foreground">{tx("模拟初始资金")}<input type="number" min="10000" value={draft.initialCapital} onChange={(event) => updateDraft("initialCapital", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">{tx("最大持仓数")}<input type="number" min="1" max="100" value={draft.maxPositions} onChange={(event) => updateDraft("maxPositions", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">{tx("单股仓位上限（%）")}<input type="number" min="1" max="100" value={draft.maxPositionPercent} onChange={(event) => updateDraft("maxPositionPercent", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-sm font-medium text-foreground">{tx("单日亏损上限（%）")}<input type="number" min="0.1" max="100" step="0.1" value={draft.maxDailyLossPercent} onChange={(event) => updateDraft("maxDailyLossPercent", event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-[10px] border border-border bg-background px-4 py-3 text-sm text-foreground"><input type="checkbox" checked={draft.requireApproval} onChange={(event) => updateDraft("requireApproval", event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" /><span><span className="font-medium">{tx("模拟交易提案进入人工确认")}</span><span className="mt-1 block text-xs leading-5 text-muted-text">{tx("即使后端接通，也先生成提案，不自动提交真实订单。")}</span></span></label>
            </section>

            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="trading-skills-heading">
              <h2 id="trading-skills-heading" className="text-base font-semibold text-foreground">{tx("交易策略 Skill（可选）")}</h2>
              <p className="mt-1 text-sm leading-6 text-secondary-text">{tx("交易逻辑与所选 Skill 共同组成这份自定义策略，用于研究信号和生成模拟提案；不另选执行流程，也不改变上方硬性风险边界。")}</p>
              <StrategySkillPicker skills={skills} selectedIds={capabilities.skillIds} onToggle={(id) => { setCapabilities((current) => ({ ...current, skillIds: toggleValue(current.skillIds, id) })); setSaved(false); }} loading={skillsLoading} error={tx(skillsError)} />
            </section>
            <section className="px-5 py-5 sm:px-6" aria-labelledby="trading-capability-heading">
              <div className="flex flex-col gap-4">
                <div><h2 id="trading-capability-heading" className="text-base font-semibold text-foreground">{tx("专家协作与数据工具")}</h2><p className="mt-1 text-sm text-secondary-text">{tx("已选择")}{" "}{capabilityCount} {" "}{tx("项能力。专家可以参与信号复核和交易提案评审。")}</p></div>
                {renderCapabilityPanel("mt-4 w-full")}
              </div>
              <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-text"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />{tx("策略定义和能力绑定会保存到后端；每次模拟运行都会冻结独立快照。")}</p>
                <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => void saveDraft()}><Save className="h-4 w-4" />{tx("保存交易策略")}</button><button type="button" disabled={!strategyReady} className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void scheduleStrategy()}><CalendarClock className="h-4 w-4" />{tx("创建定时计划")}</button><button type="button" disabled={!strategyReady || busy} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void startRun()}><Play className="h-4 w-4" />{restoring ? tx("恢复运行状态…") : submitting ? tx("正在提交…") : tx("启动模拟运行")}</button></div>
              </div>
              {saved ? <p role="status" className="mt-3 text-xs font-medium text-success">{tx("交易策略已保存到后端工作区。")}</p> : null}
            </section>
          </div>

          {runError || runtimeError ? <p role="alert" className="text-sm text-danger">{runError || runtimeError}</p> : null}
        </div>

      </div>

    </div>
  );
}
