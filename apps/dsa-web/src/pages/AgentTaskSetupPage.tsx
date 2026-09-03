import {
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  Database,
  LoaderCircle,
  Network,
  Play,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { workspaceApi, type WorkspaceRun, type WorkspaceSkill } from "../api/workspace";
import AgentCapabilityPanel from "../components/agent/AgentCapabilityPanel";
import { AppPage, PageHeader } from "../components/common";
import { useStockIndex } from "../hooks/useStockIndex";
import {
  countAgentCapabilities,
  EMPTY_AGENT_CAPABILITIES,
  normalizeAgentCapabilities,
  type AgentCapabilityBindings,
} from "../types/capabilities";
import type { StockIndexItem } from "../types/stockIndex";
import type { ScheduledTaskNavigationState } from "../types/scheduledTasks";
import { cn } from "../utils/cn";

type WorkspaceMode = "research" | "screening";
type MarketId = "CN" | "HK" | "US";

type PersistedTaskWorkspace = {
  market: MarketId;
  query: string;
  selectedStock: StockIndexItem | null;
  objective: string;
  industry: string;
  candidateCount: string;
  capabilities: AgentCapabilityBindings;
};

const TASK_DRAFT_KEYS: Record<WorkspaceMode, string> = {
  research: "dsa.research-task-draft.v1",
  screening: "dsa.screening-task-draft.v1",
};

const EMPTY_TASK_WORKSPACE: PersistedTaskWorkspace = {
  market: "CN",
  query: "",
  selectedStock: null,
  objective: "",
  industry: "",
  candidateCount: "20",
  capabilities: EMPTY_AGENT_CAPABILITIES,
};

const readTaskWorkspace = (mode: WorkspaceMode): PersistedTaskWorkspace => {
  if (typeof window === "undefined") return EMPTY_TASK_WORKSPACE;
  try {
    const stored = window.localStorage.getItem(TASK_DRAFT_KEYS[mode]);
    if (!stored) return EMPTY_TASK_WORKSPACE;
    const parsed = JSON.parse(stored) as Partial<PersistedTaskWorkspace>;
    return {
      ...EMPTY_TASK_WORKSPACE,
      ...parsed,
      capabilities: normalizeAgentCapabilities(parsed.capabilities),
    };
  } catch {
    return EMPTY_TASK_WORKSPACE;
  }
};

const persistTaskWorkspace = (mode: WorkspaceMode, workspace: PersistedTaskWorkspace) => {
  window.localStorage.setItem(TASK_DRAFT_KEYS[mode], JSON.stringify(workspace));
};

const MARKETS: Array<{ id: MarketId; label: string; description: string }> = [
  { id: "CN", label: "A 股", description: "沪深北市场" },
  { id: "HK", label: "港股", description: "香港市场" },
  { id: "US", label: "美股", description: "美国市场" },
];

const COPY = {
  research: {
    eyebrow: "Agent research task",
    title: "个股分析",
    description: "先选择市场和股票，再配置本次任务使用的 Skill、内置工具、MCP 服务、数据源与专家。提交后由 Agent 组织分析流程。",
    action: "运行单股分析",
  },
  screening: {
    eyebrow: "Agent screening task",
    title: "选股",
    description: "先确定市场和筛选目标，再配置本次任务能力。Agent 将把自然语言目标组织成选股任务。",
    action: "运行选股任务",
  },
} as const;

const marketMatches = (item: StockIndexItem, market: MarketId) => (
  market === "CN" ? item.market === "CN" || item.market === "BSE" : item.market === market
);

const toggleValue = <T,>(items: T[], value: T) => (
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
);

export default function AgentTaskSetupPage({ mode }: { mode: WorkspaceMode }) {
  const copy = COPY[mode];
  const navigate = useNavigate();
  const initialWorkspace = useMemo(() => readTaskWorkspace(mode), [mode]);
  const [market, setMarket] = useState<MarketId>(initialWorkspace.market);
  const [query, setQuery] = useState(initialWorkspace.query);
  const [selectedStock, setSelectedStock] = useState<StockIndexItem | null>(initialWorkspace.selectedStock);
  const [objective, setObjective] = useState(initialWorkspace.objective);
  const [industry, setIndustry] = useState(initialWorkspace.industry);
  const [candidateCount, setCandidateCount] = useState(initialWorkspace.candidateCount);
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilityBindings>(initialWorkspace.capabilities);
  const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
  const [showRunPreview, setShowRunPreview] = useState(false);
  const [activeRun, setActiveRun] = useState<WorkspaceRun | null>(null);
  const [runError, setRunError] = useState("");
  const capabilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const capabilityDialogRef = useRef<HTMLDivElement | null>(null);
  const stockIndex = useStockIndex(mode === "research");

  useEffect(() => {
    let active = true;
    void workspaceApi.getCapabilities()
      .then((catalog) => {
        if (!active) return;
        setSkills(catalog.skills.filter((skill) => skill.enabled));
        const valid = {
          skillIds: new Set(catalog.skills.filter((item) => item.enabled).map((item) => item.id)),
          toolIds: new Set(catalog.tools.filter((item) => item.enabled).map((item) => item.id)),
          mcpIds: new Set(catalog.mcpServers.filter((item) => item.selectable).map((item) => item.id)),
          dataSourceIds: new Set(catalog.dataSources.filter((item) => item.selectable).map((item) => item.sourceId)),
          expertIds: new Set(catalog.experts.filter((item) => item.enabled).map((item) => item.id)),
          expertTeamIds: new Set(catalog.expertTeams.filter((item) => item.enabled).map((item) => item.id)),
        };
        setCapabilities((current) => ({
          ...(() => {
            const selected = countAgentCapabilities(current) > 0 ? current : catalog.defaults[mode];
            return {
              skillIds: selected.skillIds.filter((id) => valid.skillIds.has(id)),
              toolIds: selected.toolIds.filter((id) => valid.toolIds.has(id)),
              mcpIds: selected.mcpIds.filter((id) => valid.mcpIds.has(id)),
              dataSourceIds: selected.dataSourceIds.filter((id) => valid.dataSourceIds.has(id)),
              expertIds: selected.expertIds.filter((id) => valid.expertIds.has(id)),
              expertTeamIds: selected.expertTeamIds.filter((id) => valid.expertTeamIds.has(id)),
            };
          })(),
        }));
      })
      .catch(() => {
        if (active) setSkillsError("Skill 目录读取失败，可先使用通用能力或稍后重试。");
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!activeRun || !["queued", "running"].includes(activeRun.status)) return;
    const timer = window.setTimeout(() => {
      void workspaceApi.getRun(activeRun.id)
        .then(setActiveRun)
        .catch(() => setRunError("运行状态读取失败，请到任务与运行页面重试。"));
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
      if (controls.length === 0) {
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

  const suggestions = useMemo(() => {
    if (mode !== "research") return [];
    const keyword = query.trim().toLocaleLowerCase();
    return stockIndex.index
      .filter((item) => item.active && item.assetType === "stock" && marketMatches(item, market))
      .filter((item) => {
        if (!keyword) return true;
        return [item.canonicalCode, item.displayCode, item.nameZh, item.nameEn, item.pinyinFull, item.pinyinAbbr, ...(item.aliases || [])]
          .some((value) => value?.toLocaleLowerCase().includes(keyword));
      })
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 8);
  }, [market, mode, query, stockIndex.index]);

  const capabilityCount = countAgentCapabilities(capabilities);
  const canRun = mode === "research" ? Boolean(selectedStock) : Boolean(objective.trim());
  const selectionReady = mode === "research" ? Boolean(selectedStock) : Boolean(objective.trim());

  const changeMarket = (next: MarketId) => {
    setMarket(next);
    setSelectedStock(null);
    setQuery("");
    setShowRunPreview(false);
  };

  const selectStock = (stock: StockIndexItem) => {
    setSelectedStock(stock);
    setQuery(`${stock.nameZh || stock.nameEn || stock.displayCode} · ${stock.displayCode}`);
    setShowRunPreview(false);
  };

  const scheduleCurrentTask = () => {
    if (!canRun) return;
    persistTaskWorkspace(mode, {
      market,
      query,
      selectedStock,
      objective,
      industry,
      candidateCount,
      capabilities,
    });
    const marketLabel = MARKETS.find((item) => item.id === market)?.label || market;
    const stockName = selectedStock?.nameZh || selectedStock?.nameEn || selectedStock?.displayCode;
    const state: ScheduledTaskNavigationState = {
      schedulePrefill: {
        sourceLabel: copy.title,
        kind: mode,
        name: mode === "research" ? `每日${stockName || "个股"}分析` : `${marketLabel}每日选股`,
        market,
        stock: selectedStock?.canonicalCode,
        stockName,
        objective,
        industry,
        candidateCount,
        capabilities,
      },
    };
    navigate(`/schedules?type=${mode}`, { state });
  };

  const runCurrentTask = async () => {
    if (!canRun || activeRun?.status === "queued" || activeRun?.status === "running") return;
    setShowRunPreview(true);
    setRunError("");
    try {
      const task = await workspaceApi.createTask({
        kind: mode,
        name: mode === "research"
          ? `${selectedStock?.nameZh || selectedStock?.nameEn || selectedStock?.canonicalCode} 个股分析`
          : `${MARKETS.find((item) => item.id === market)?.label || market} 选股`,
        market,
        objective: objective.trim() || `分析 ${selectedStock?.canonicalCode} 的商业质量、估值与风险`,
        subject: mode === "research" ? {
          stock: selectedStock?.canonicalCode,
          stockName: selectedStock?.nameZh || selectedStock?.nameEn,
        } : { industry: industry.trim() || null },
        config: mode === "screening" ? { candidateCount: Number(candidateCount) } : {},
        capabilities,
      });
      setActiveRun(await workspaceApi.runTask(task.id));
    } catch {
      setRunError("任务未能启动，请检查 Agent 状态和能力配置。 ");
    }
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
    <AppPage className="space-y-6 pb-20" data-testid={`${mode}-task-workspace`}>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={<Link to="/capabilities/skills" className="btn-secondary inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />管理工作区能力</Link>}
      />

      <ol className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4" aria-label={`${copy.title}操作流程`}>
        {[
          { label: "选择范围", ready: true },
          { label: mode === "research" ? "选择股票" : "描述筛选目标", ready: selectionReady },
          { label: "配置能力", ready: canRun },
          { label: "生成成果", ready: showRunPreview },
        ].map((step, index) => (
          <li key={step.label} className="flex items-center gap-3 bg-card px-4 py-3">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", step.ready ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-text")}>
              {step.ready ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={step.ready ? "text-sm font-medium text-foreground" : "text-sm text-secondary-text"}>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_304px]">
        <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
          <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby={`${mode}-market-heading`}>
            <h2 id={`${mode}-market-heading`} className="text-base font-semibold text-foreground">选择市场</h2>
            <p className="mt-1 text-sm text-secondary-text">市场决定可选股票范围与默认数据路由。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {MARKETS.map((item) => (
                <button key={item.id} type="button" aria-pressed={market === item.id} onClick={() => changeMarket(item.id)} className={cn("flex min-h-16 items-center justify-between rounded-[10px] border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", market === item.id ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/40")}>
                  <span><span className="block text-sm font-semibold text-foreground">{item.label}</span><span className="mt-1 block text-xs text-muted-text">{item.description}</span></span>
                  {market === item.id ? <Check className="h-4 w-4 text-primary" /> : null}
                </button>
              ))}
            </div>
          </section>

          {mode === "research" ? (
            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="stock-selection-heading">
              <h2 id="stock-selection-heading" className="text-base font-semibold text-foreground">选择股票</h2>
              <p className="mt-1 text-sm text-secondary-text">搜索代码、名称或拼音，从当前市场中选择一只股票。</p>
              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-text" />
                <input aria-label="搜索股票" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedStock(null); setShowRunPreview(false); }} placeholder={stockIndex.loading ? "正在加载股票目录…" : "输入股票代码或名称"} className="h-10 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary" />
              </label>
              {stockIndex.error ? <p className="mt-2 flex items-center gap-2 text-xs text-warning"><CircleAlert className="h-3.5 w-3.5" />股票目录使用了降级数据，搜索范围可能有限。</p> : null}
              {!selectedStock ? (
                <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-[10px] border border-border" role="listbox" aria-label="股票搜索结果">
                  {stockIndex.loading ? <p className="flex items-center gap-2 px-4 py-6 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取股票目录…</p> : suggestions.length ? suggestions.map((stock) => (
                    <button key={stock.canonicalCode} type="button" role="option" aria-selected="false" onClick={() => selectStock(stock)} className="flex w-full items-center justify-between gap-4 bg-background px-4 py-3 text-left transition-colors hover:bg-hover/60">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{stock.nameZh || stock.nameEn || stock.displayCode}</span><span className="mt-0.5 block text-xs text-muted-text">{stock.canonicalCode}</span></span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-text" />
                    </button>
                  )) : <p className="px-4 py-6 text-center text-sm text-muted-text">当前市场没有匹配股票。</p>}
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-4 rounded-[10px] border border-success/25 bg-success/5 px-4 py-3">
                  <span><span className="block text-sm font-medium text-foreground">{selectedStock.nameZh || selectedStock.nameEn}</span><span className="mt-0.5 block text-xs text-muted-text">{selectedStock.canonicalCode}</span></span>
                  <span className="text-xs font-medium text-success">已选择</span>
                </div>
              )}
              <label className="mt-4 block text-sm font-medium text-foreground">关注问题（可选）<textarea value={objective} onChange={(event) => { setObjective(event.target.value); setShowRunPreview(false); }} placeholder="例如：重点分析盈利质量、估值风险和未来两个季度的催化因素" className="mt-2 min-h-24 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
            </section>
          ) : (
            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="screening-objective-heading">
              <h2 id="screening-objective-heading" className="text-base font-semibold text-foreground">描述筛选目标</h2>
              <p className="mt-1 text-sm text-secondary-text">先用自然语言表达目标，Agent 会把它转成结构化 ScreenSpec 并保存候选结果。</p>
              <label className="mt-4 block text-sm font-medium text-foreground">选股条件<textarea value={objective} onChange={(event) => { setObjective(event.target.value); setShowRunPreview(false); }} placeholder="例如：寻找盈利持续增长、估值处于行业中位数以下、近期无重大利空的半导体公司" className="mt-2 min-h-32 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">行业范围（可选）<input value={industry} onChange={(event) => { setIndustry(event.target.value); setShowRunPreview(false); }} placeholder="例如：半导体" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="block text-sm font-medium text-foreground">候选数量<select value={candidateCount} onChange={(event) => { setCandidateCount(event.target.value); setShowRunPreview(false); }} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="10">10 只</option><option value="20">20 只</option><option value="50">50 只</option></select></label>
              </div>
            </section>
          )}

          <section className="px-5 py-5 sm:px-6" aria-labelledby={`${mode}-run-heading`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /><h2 id={`${mode}-run-heading`} className="text-base font-semibold text-foreground">任务能力</h2></div>
                <p className="mt-1 text-sm text-secondary-text">已选择 {capabilityCount} 项能力{skillsLoading ? "，正在读取 Skill" : ""}。未选择时由 Agent 使用通用能力。</p>
                {skillsError ? <p role="alert" className="mt-1 text-xs text-warning">{skillsError}</p> : null}
              </div>
              <button ref={capabilityTriggerRef} type="button" className="btn-secondary inline-flex items-center justify-center gap-2 xl:hidden" onClick={() => setCapabilityPanelOpen(true)}><SlidersHorizontal className="h-4 w-4" />配置本次任务</button>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-text"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>运行时会冻结任务、能力清单和数据快照，并把结果保存为正式 Artifact。</span></div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" disabled={!canRun} onClick={scheduleCurrentTask} className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><CalendarClock className="h-4 w-4" />{mode === "research" ? "定时分析" : "定时更新"}</button>
                <button type="button" disabled={!canRun || activeRun?.status === "queued" || activeRun?.status === "running"} onClick={() => void runCurrentTask()} className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><Play className="h-4 w-4" />{activeRun?.status === "queued" || activeRun?.status === "running" ? "运行中…" : copy.action}</button>
              </div>
            </div>
          </section>

          {showRunPreview ? (
            <section aria-live="polite" className="border-t border-warning/25 bg-warning/5 px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold text-foreground">{activeRun ? `任务 ${activeRun.status === "completed" ? "已完成" : activeRun.status === "failed" ? "失败" : "运行中"}` : "正在创建任务"}</p>
              <p className="mt-1 text-sm leading-6 text-secondary-text">
                {mode === "research"
                  ? `${MARKETS.find((item) => item.id === market)?.label} · ${selectedStock?.nameZh || selectedStock?.canonicalCode} · ${capabilityCount || "通用"} 项能力`
                  : `${MARKETS.find((item) => item.id === market)?.label} · ${industry.trim() || "全行业"} · Top ${candidateCount} · ${capabilityCount || "通用"} 项能力`}
                。本次运行已经写入统一任务账本。
              </p>
              <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-border bg-border sm:grid-cols-3">
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">任务定义</span><p className="mt-1 text-xs font-medium text-foreground">{activeRun ? `Task · ${activeRun.taskId.slice(0, 8)}` : "正在保存"}</p></div>
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">数据上下文</span><p className="mt-1 text-xs font-medium text-foreground">{activeRun?.dataSnapshotId ? `Snapshot · ${activeRun.dataSnapshotId.slice(0, 8)}` : "正在创建"}</p></div>
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">预期成果</span><p className="mt-1 text-xs font-medium text-foreground">{mode === "research" ? "ResearchReport" : "ScreenSpec · CandidateList"}</p></div>
              </div>
              {runError || activeRun?.errorMessage ? <p role="alert" className="mt-3 text-xs text-danger">{runError || activeRun?.errorMessage}</p> : null}
              {activeRun?.artifacts?.length ? <div className="mt-4 space-y-3">{activeRun.artifacts.map((artifact) => <details key={artifact.id} className="rounded-[10px] border border-border bg-card px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-foreground">{artifact.title}</summary><div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-secondary-text">{artifact.text || JSON.stringify(artifact.content, null, 2)}</div></details>)}</div> : null}
              <Link to="/runs" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">查看任务与运行 <ArrowRight className="h-3.5 w-3.5" /></Link>
            </section>
          ) : null}
        </div>

        {renderCapabilityPanel("hidden h-[calc(100vh-10rem)] w-full xl:sticky xl:top-6 xl:flex")}
      </div>

      {capabilityPanelOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 p-3 xl:hidden" role="presentation" onClick={() => setCapabilityPanelOpen(false)}>
          <div ref={capabilityDialogRef} tabIndex={-1} className="ml-auto h-full w-fit outline-none" role="dialog" aria-modal="true" aria-label="配置本次任务能力" onClick={(event) => event.stopPropagation()}>{renderCapabilityPanel("h-full w-[min(21rem,calc(100vw-1.5rem))]", () => setCapabilityPanelOpen(false))}</div>
        </div>
      ) : null}
    </AppPage>
  );
}
