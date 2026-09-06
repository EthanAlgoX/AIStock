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
import { useWorkspaceRun } from "../hooks/useWorkspaceRun";
import { strategyWorkspaceApi, type StrategySummary } from "../api/strategyWorkspace";
import WorkflowArtifact from "../components/agent/WorkflowArtifact";
import { visibleWorkspaceArtifacts, workspaceRunLabel } from "../utils/workspaceOutcome";
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
  strategyVersionId?: string;
  deepResearchCount?: string;
  deepResearchVersionId?: string;
  runId?: string;
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

export default function AgentTaskSetupPage({ mode, embedded = false, onRunStarted }: { mode: WorkspaceMode; embedded?: boolean; onRunStarted?: (run: WorkspaceRun) => void }) {
  const copy = COPY[mode];
  const navigate = useNavigate();
  const initialWorkspace = useMemo(() => readTaskWorkspace(mode), [mode]);
  const [market, setMarket] = useState<MarketId>(initialWorkspace.market);
  const [query, setQuery] = useState(initialWorkspace.query);
  const [selectedStock, setSelectedStock] = useState<StockIndexItem | null>(initialWorkspace.selectedStock);
  const [objective, setObjective] = useState(initialWorkspace.objective);
  const [industry, setIndustry] = useState(initialWorkspace.industry);
  const [candidateCount, setCandidateCount] = useState(initialWorkspace.candidateCount);
  const [deepResearchCount, setDeepResearchCount] = useState(initialWorkspace.deepResearchCount || "0");
  const [deepResearchVersionId, setDeepResearchVersionId] = useState(initialWorkspace.deepResearchVersionId || "");
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilityBindings>(initialWorkspace.capabilities);
  const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
  const { activeRun, runError, submitting, restoring, busy, startRun } = useWorkspaceRun(mode, !embedded);
  const showRunPreview = Boolean(activeRun || submitting || runError);
  const [workflows, setWorkflows] = useState<Array<StrategySummary & { market: string }>>([]);
  const [preferredVersionId, setStrategyVersionId] = useState(initialWorkspace.strategyVersionId || "");
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const compatibleWorkflows = workflows.filter((item) => item.market.toUpperCase() === market && item.currentStrategyPurpose === (mode === "research" ? "research_report" : "candidate_screening"));
  const researchWorkflows = workflows.filter((item) => item.market.toUpperCase() === market && item.currentStrategyPurpose === "research_report");
  const researchVersionId = String((researchWorkflows.find((item) => String(item.currentPublishedVersionId) === deepResearchVersionId) || researchWorkflows.find((item) => item.name === "单股研究 · A股配置") || researchWorkflows[0])?.currentPublishedVersionId || "");
  const strategyVersionId = String((compatibleWorkflows.find((item) => String(item.currentPublishedVersionId) === preferredVersionId)
    || compatibleWorkflows.find((item) => item.name === (mode === "research" ? "单股研究 · A股配置" : "多因子选股 · A股配置")) || compatibleWorkflows[0])?.currentPublishedVersionId || "");
  const [workflowError, setWorkflowError] = useState("");
  const capabilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const capabilityDialogRef = useRef<HTMLDivElement | null>(null);
  const stockIndex = useStockIndex(mode === "research");
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [restoredRunId, setRestoredRunId] = useState<string | null>(initialWorkspace.runId || null);

  if (activeRun && restoredRunId !== activeRun.id) {
    setRestoredRunId(activeRun.id);
    const task = activeRun.taskSnapshot;
    const stock = String(task.subject.stock || "");
    setMarket(task.market === "GLOBAL" ? "CN" : task.market);
    setObjective(task.objective);
    setIndustry(String(task.subject.industry || ""));
    setCandidateCount(String(task.config.candidateCount || "20"));
    setDeepResearchCount(String(task.config.deepResearchCount || 0));
    setDeepResearchVersionId(String(task.config.deepResearchVersionId || ""));
    setStrategyVersionId(task.config.strategyVersionId ? String(task.config.strategyVersionId) : "");
    setCapabilities(task.capabilities);
    if (mode === "research" && stock) {
      setQuery(stock);
      setSelectedStock({ canonicalCode: stock, displayCode: stock, nameZh: String(task.subject.stockName || stock), market: task.market === "GLOBAL" ? "CN" : task.market, assetType: "stock", active: true });
    }
  }

  useEffect(() => {
    persistTaskWorkspace(mode, { market, query, selectedStock, objective, industry, candidateCount, capabilities, strategyVersionId, deepResearchCount, deepResearchVersionId: researchVersionId, runId: activeRun?.id });
  }, [mode, market, query, selectedStock, objective, industry, candidateCount, capabilities, strategyVersionId, deepResearchCount, researchVersionId, activeRun?.id]);

  useEffect(() => {
    let active = true;
    void strategyWorkspaceApi.listStrategies().then(async (items) => {
      if (!active) return;
      const available = items.filter((item) => item.productRole !== "kernel"
        && item.currentPublishedVersionId && item.kernelExecutionStatus === "ready"
        && (item.currentStrategyPurpose === "research_report" || (mode === "screening" && item.currentStrategyPurpose === "candidate_screening")));
      const configured = await Promise.all(available.map(async (item) => ({ ...item,
        market: (await strategyWorkspaceApi.getVersion(item.currentPublishedVersionId!)).screeningPolicy?.market || "",
      })));
      if (active) setWorkflows(configured);
    }).catch(() => { if (active) setWorkflowError("策略目录读取失败，请刷新后重试。"); })
      .finally(() => { if (active) setWorkflowsLoading(false); });
    return () => { active = false; };
  }, [mode]);

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
  const canRun = Boolean(strategyVersionId) && !workflowsLoading && !workflowError
    && (mode !== "screening" || deepResearchCount === "0" || Boolean(researchVersionId))
    && (mode === "research" ? Boolean(selectedStock) : Boolean(objective.trim()));
  const selectionReady = mode === "research" ? Boolean(selectedStock) : Boolean(objective.trim());

  const changeMarket = (next: MarketId) => {
    setMarket(next);
    setSelectedStock(null);
    setQuery("");
  };

  const selectStock = (stock: StockIndexItem) => {
    setSelectedStock(stock);
    setQuery(`${stock.nameZh || stock.nameEn || stock.displayCode} · ${stock.displayCode}`);
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
      strategyVersionId,
      deepResearchCount,
      deepResearchVersionId: researchVersionId,
      runId: activeRun?.id,
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
        strategyVersionId: strategyVersionId ? Number(strategyVersionId) : undefined,
        deepResearchCount: mode === "screening" ? Number(deepResearchCount) : 0,
        deepResearchVersionId: mode === "screening" && Number(deepResearchCount) ? Number(researchVersionId) : undefined,
        capabilities: { ...capabilities, toolIds: [...new Set([...capabilities.toolIds, mode === "research" ? "run_stock_research" : "run_stock_screening", ...(mode === "screening" && Number(deepResearchCount) ? ["run_stock_research"] : [])])] },
      },
    };
    navigate(`/schedules?type=${mode}`, { state });
  };

  const runCurrentTask = async () => {
    if (!canRun || busy) return;
    await startRun(async () => {
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
        config: {
          ...(mode === "screening" ? { candidateCount: Number(candidateCount) } : {}),
          ...(strategyVersionId ? { strategyVersionId: Number(strategyVersionId) } : {}),
          ...(mode === "screening" && Number(deepResearchCount) ? { deepResearchCount: Number(deepResearchCount), deepResearchVersionId: Number(researchVersionId) } : {}),
        },
        capabilities: { ...capabilities, toolIds: [...new Set([...capabilities.toolIds, mode === "research" ? "run_stock_research" : "run_stock_screening", ...(mode === "screening" && Number(deepResearchCount) ? ["run_stock_research"] : [])])] },
      });
      const run = await workspaceApi.runTask(task.id);
      setRestoredRunId(run.id);
      if (mountedRef.current) onRunStarted?.(run);
      return run;
    }, "任务启动未确认，请检查 Agent 状态和能力配置，并查看运行记录。");
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

  const Container = embedded ? "div" : AppPage;
  return (
    <Container className="space-y-6 pb-6" data-testid={`${mode}-task-workspace`}>
      {!embedded && <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={<Link to="/capabilities/skills" className="btn-secondary inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />管理工作区能力</Link>}
      />}

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

      <div className="grid items-start gap-5">
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
                <input aria-label="搜索股票" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedStock(null); }} placeholder={stockIndex.loading ? "正在加载股票目录…" : "输入股票代码或名称"} className="h-10 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary" />
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
              <label className="mt-4 block text-sm font-medium text-foreground">关注问题（可选）<textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：重点分析盈利质量、估值风险和未来两个季度的催化因素" className="mt-2 min-h-24 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
            </section>
          ) : (
            <section className="border-b border-border/70 px-5 py-5 sm:px-6" aria-labelledby="screening-objective-heading">
              <h2 id="screening-objective-heading" className="text-base font-semibold text-foreground">描述筛选目标</h2>
              <p className="mt-1 text-sm text-secondary-text">先用自然语言表达目标。Agent 按可用能力研究，实际候选与未验证条件会在结果中说明。</p>
              <label className="mt-4 block text-sm font-medium text-foreground">选股条件<textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：寻找盈利持续增长、估值处于行业中位数以下、近期无重大利空的半导体公司" className="mt-2 min-h-32 w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-primary" /></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">行业范围（可选）<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：半导体" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="block text-sm font-medium text-foreground">候选数量{strategyVersionId ? <p className="mt-2 text-sm font-normal text-secondary-text">使用正式策略中保存的数量</p> : <select value={candidateCount} onChange={(event) => setCandidateCount(event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"><option value="10">10 只</option><option value="20">20 只</option><option value="50">50 只</option></select>}</label>
              </div>
            </section>
          )}

          <section className="px-5 py-5 sm:px-6" aria-labelledby={`${mode}-run-heading`}>
            {mode === "screening" && <div className="mb-5 space-y-3">
              <label className="block text-sm font-medium">候选深研数量<select value={deepResearchCount} onChange={(event) => setDeepResearchCount(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-border bg-background px-3">{[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count ? `按原始排名深研前 ${count} 只` : "仅筛选与解读"}</option>)}</select></label>
              {Number(deepResearchCount) > 0 && <label className="block text-sm font-medium">候选研究方法<select value={researchVersionId} onChange={(event) => setDeepResearchVersionId(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-border bg-background px-3">{!researchVersionId && <option value="">当前市场无可用研究流程</option>}{researchWorkflows.map((item) => <option key={item.id} value={item.currentPublishedVersionId!}>{item.name}</option>)}</select></label>}
              <p className="text-xs leading-5 text-secondary-text">深研会额外调用数据和模型，最多 3 只；逐股报告归入本次选股，不改写原排名。失败的候选保留原因。</p>
            </div>}
            <label className="mb-5 block text-sm font-medium text-foreground">
              研究流程
              <select value={strategyVersionId} onChange={(event) => {
                const value = event.target.value;
                setStrategyVersionId(value);
                if (value) setCapabilities((current) => ({ ...current, toolIds: [...new Set([...current.toolIds, mode === "research" ? "run_stock_research" : "run_stock_screening"])] }));
              }} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                {!strategyVersionId && <option value="">{workflowsLoading ? "正在读取正式报告流程…" : "当前市场没有可用的正式报告流程"}</option>}
                {compatibleWorkflows.map((item) => <option key={item.id} value={item.currentPublishedVersionId!}>{item.name} · v{item.currentPublishedVersionNumber}</option>)}
              </select>
              {mode === "screening" && <p className="mt-3 text-sm font-normal leading-6 text-foreground">{compatibleWorkflows.find((item) => String(item.currentPublishedVersionId) === strategyVersionId)?.description}</p>}
              <span className="mt-2 block text-xs font-normal leading-5 text-secondary-text">选择正式策略后，先执行数据与代码分析，再由 Agent 和所选专家解读同一份结果。选股的市场、筛选条件及数量使用策略中保存的配置；单股内核使用平台数据路由。本页目标作为解读要求，所选 MCP 用于补充证据。</span>
              {workflowError && <span role="alert" className="mt-1 block text-xs text-warning">{workflowError}</span>}
              {!workflowsLoading && !strategyVersionId && !workflowError && <span role="alert" className="mt-2 block text-sm text-warning">当前市场尚无已发布的{mode === "research" ? "单股研究" : "选股"}流程，无法生成正式报告。请切换到有可用流程的市场；开放式讨论可前往主 Agent，不会在这里自动替代报告。</span>}
            </label>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /><h2 id={`${mode}-run-heading`} className="text-base font-semibold text-foreground">任务能力</h2></div>
                <p className="mt-1 text-sm text-secondary-text">已选择 {capabilityCount} 项能力{skillsLoading ? "，正在读取 Skill" : ""}。按当前预设运行；如需更换工具或专家，可展开高级配置。</p>
                {skillsError ? <p role="alert" className="mt-1 text-xs text-warning">{skillsError}</p> : null}
              </div>
              <button ref={capabilityTriggerRef} type="button" className="btn-secondary inline-flex items-center justify-center gap-2" onClick={() => setCapabilityPanelOpen(true)}><SlidersHorizontal className="h-4 w-4" />高级能力配置</button>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-text"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>运行时会冻结任务、能力清单和数据快照，并保存报告与原始说明。</span></div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" disabled={!canRun} onClick={scheduleCurrentTask} className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><CalendarClock className="h-4 w-4" />{mode === "research" ? "定时分析" : "定时更新"}</button>
                <button type="button" disabled={!canRun || busy} onClick={() => void runCurrentTask()} className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><Play className="h-4 w-4" />{restoring ? "恢复运行状态…" : submitting ? "正在提交…" : busy ? "运行中…" : copy.action}</button>
              </div>
            </div>
          </section>

          {showRunPreview && !embedded ? (
            <section aria-live="polite" className="border-t border-warning/25 bg-warning/5 px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold text-foreground">{submitting ? "正在创建任务" : activeRun ? `任务 ${workspaceRunLabel(activeRun)}` : restoring ? "正在恢复运行状态" : "任务启动未确认"}</p>
              <p className="mt-1 text-sm leading-6 text-secondary-text">
                {activeRun ? activeRun.taskSnapshot.name : mode === "research"
                  ? `${MARKETS.find((item) => item.id === market)?.label} · ${selectedStock?.nameZh || selectedStock?.canonicalCode} · ${capabilityCount || "通用"} 项能力`
                  : strategyVersionId ? `正式策略版本 #${strategyVersionId} · 按策略配置筛选 · ${capabilityCount} 项能力`
                    : `${MARKETS.find((item) => item.id === market)?.label} · ${industry.trim() || "全行业"} · Top ${candidateCount} · ${capabilityCount || "通用"} 项能力`}
                。{activeRun ? "任务在后台执行，切换页面不会中断。" : "正在与后台确认任务状态。"}
              </p>
              {activeRun ? <Link className="mt-2 inline-block text-xs text-primary" to={`/runs/${activeRun.id}`}>查看本次运行详情</Link> : null}
              <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-border bg-border sm:grid-cols-3">
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">任务定义</span><p className="mt-1 text-xs font-medium text-foreground">{activeRun ? `Task · ${activeRun.taskId.slice(0, 8)}` : "正在保存"}</p></div>
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">数据上下文</span><p className="mt-1 text-xs font-medium text-foreground">{activeRun?.dataSnapshotId ? `Snapshot · ${activeRun.dataSnapshotId.slice(0, 8)}` : "正在创建"}</p></div>
                <div className="bg-card px-4 py-3"><span className="text-[11px] text-muted-text">预期成果</span><p className="mt-1 text-xs font-medium text-foreground">{mode === "research" ? "ResearchReport" : "ScreenSpec · CandidateList"}</p></div>
              </div>
              {runError || activeRun?.errorMessage ? <p role="alert" className="mt-3 text-xs text-danger">{runError || activeRun?.errorMessage}</p> : null}
              {activeRun?.artifacts?.length ? <div className="mt-4 space-y-3">{visibleWorkspaceArtifacts(activeRun.artifacts).map((artifact) => <WorkflowArtifact key={artifact.id} artifact={artifact} />)}</div> : null}
              <Link to="/runs" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">查看任务与运行 <ArrowRight className="h-3.5 w-3.5" /></Link>
            </section>
          ) : null}
        </div>

      </div>

      {capabilityPanelOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 p-3" role="presentation" onClick={() => setCapabilityPanelOpen(false)}>
          <div ref={capabilityDialogRef} tabIndex={-1} className="ml-auto h-full w-fit outline-none" role="dialog" aria-modal="true" aria-label="配置本次任务能力" onClick={(event) => event.stopPropagation()}>{renderCapabilityPanel("h-full w-[min(21rem,calc(100vw-1.5rem))]", () => setCapabilityPanelOpen(false))}</div>
        </div>
      ) : null}
      {embedded && runError ? <p role="alert" className="text-sm text-danger">{runError}</p> : null}
    </Container>
  );
}
