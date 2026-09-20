import { useUiLiteral } from '../../hooks/useUiLiteral';
import { UiLiteral } from '../i18n/UiLiteral';
import {
  Activity,
  ArrowDown,
  BarChart3,
  BookOpenCheck,
  Braces,
  CheckCircle2,
  CircleDot,
  Database,
  FileSearch,
  Gauge,
  GitBranch,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { Agent, AgentTemplate } from "../../api/strategyWorkspace";
import { Card } from "../common";

type CompositeAgentId = "stock-research" | "stock-screening";
type FailurePolicy = "block" | "continue";
type ToolStage = "data" | "transform" | "context" | "constraint";

type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  stage: ToolStage;
  defaultEnabled: boolean;
  dependsOn: string[];
  optionalInputs?: string[];
  output: string;
  defaultFailurePolicy: FailurePolicy;
};

type CompositeAgentDefinition = {
  id: CompositeAgentId;
  name: string;
  kind: string;
  description: string;
  inputLabel: string;
  packLabel: string;
  outputLabel: string;
  route: string;
  routeLabel: string;
  llmType: Exclude<Agent["agentType"], "INPUT">;
  inputContract: string[];
  outputContract: string[];
  tools: ToolDefinition[];
};

const stageMeta: Record<ToolStage, { label: string; description: string }> = {
  data: { label: "数据准备", description: "从策略数据配置读取本次所需证据" },
  transform: { label: "确定性加工", description: "把原始数据转成可复核的结构化特征" },
  context: { label: "语境补充", description: "增加事件、市场与跨维度解释材料" },
  constraint: { label: "候选约束", description: "在进入 LLM 前压缩范围并保留筛选依据" },
};

const definitions: Record<CompositeAgentId, CompositeAgentDefinition> = {
  "stock-research": {
    id: "stock-research",
    name: "综合单股研究 Agent",
    kind: "研究报告",
    description: "把一只股票的行情、技术、基本面与事件证据组装后，再交给分析 Agent 形成报告。",
    inputLabel: "股票 + 市场 + 数据配置",
    packLabel: "EquityEvidencePack",
    outputLabel: "ResearchReport",
    route: "/stock-research",
    routeLabel: "打开现有单股研究",
    llmType: "ANALYSIS",
    inputContract: ["symbol · 股票代码 · 必填", "market · A/HK/US · 必填", "asOf · 截止时间 · 必填", "dataConfigId · 数据配置 · 必填"],
    outputContract: ["summary · 研究结论", "evidence[] · 引用证据", "riskFactors[] · 风险因素", "missingDimensions[] · 缺失维度"],
    tools: [
      { id: "daily-bars", name: "K 线读取", description: "按市场、截止时间和数据配置读取日 K 序列。", stage: "data", defaultEnabled: true, dependsOn: [], output: "DailyBarSeries", defaultFailurePolicy: "block" },
      { id: "quote", name: "实时行情", description: "补充价格、涨跌幅、量比与换手率等当前快照。", stage: "data", defaultEnabled: true, dependsOn: [], output: "RealtimeQuote", defaultFailurePolicy: "continue" },
      { id: "fundamentals", name: "基本面聚合", description: "读取估值、成长、盈利、机构与资金等结构化事实。", stage: "data", defaultEnabled: true, dependsOn: [], output: "FundamentalSnapshot", defaultFailurePolicy: "continue" },
      { id: "news-events", name: "新闻与公告", description: "检索、去重并保留具有时间与来源的公司事件证据。", stage: "data", defaultEnabled: true, dependsOn: [], output: "EventEvidenceSet", defaultFailurePolicy: "continue" },
      { id: "technical", name: "技术指标", description: "确定性计算 MA、MACD、RSI、ATR、波动率与回撤。", stage: "transform", defaultEnabled: true, dependsOn: ["daily-bars"], output: "TechnicalFeatureSet", defaultFailurePolicy: "block" },
      { id: "trend", name: "趋势结构", description: "根据 K 线与指标识别均线结构、突破、回踩和强弱状态。", stage: "transform", defaultEnabled: true, dependsOn: ["daily-bars", "technical"], output: "TrendStructure", defaultFailurePolicy: "block" },
      { id: "market-context", name: "市场环境", description: "补充交易阶段、大盘环境和所属板块语境。", stage: "context", defaultEnabled: true, dependsOn: [], output: "MarketContext", defaultFailurePolicy: "continue" },
      { id: "chip-distribution", name: "筹码分布", description: "可选补充获利比例、筹码集中度与结构风险。", stage: "context", defaultEnabled: false, dependsOn: ["quote"], output: "ChipDistribution", defaultFailurePolicy: "continue" },
    ],
  },
  "stock-screening": {
    id: "stock-screening",
    name: "多因子选股扫描 Agent",
    kind: "候选发现",
    description: "先用确定性工具过滤和压缩市场候选，再让选股 Agent 在授权范围内比较与解释。",
    inputLabel: "市场快照 + 数据配置",
    packLabel: "CandidateEvidencePack",
    outputLabel: "CandidateSet",
    route: "/screening",
    routeLabel: "打开现有选股扫描",
    llmType: "SCREENING",
    inputContract: ["market · A/HK/US · 必填", "asOf · 截止时间 · 必填", "universeSource · 候选范围 · 必填", "maxCandidates · 最大候选数"],
    outputContract: ["candidates[] · 排序候选", "rankReason · 排序依据", "riskFlags[] · 风险标记", "missingDimensions[] · 缺失维度"],
    tools: [
      { id: "normalize-fields", name: "字段标准化", description: "统一股票代码、价格、市值、估值、量比和换手率字段。", stage: "data", defaultEnabled: true, dependsOn: [], output: "NormalizedMarketSnapshot", defaultFailurePolicy: "block" },
      { id: "industry-map", name: "行业与题材映射", description: "为市场快照补充行业、概念和热点归属。", stage: "context", defaultEnabled: true, dependsOn: ["normalize-fields"], output: "IndustryContext", defaultFailurePolicy: "continue" },
      { id: "hard-filter", name: "策略硬过滤", description: "按成交额、估值、价格、涨跌幅或技术条件排除不合格股票。", stage: "constraint", defaultEnabled: true, dependsOn: ["normalize-fields"], output: "FilteredUniverse", defaultFailurePolicy: "block" },
      { id: "daily-features", name: "候选日 K 特征", description: "只为粗筛后的候选补充 MA、突破、回踩、波动与回撤。", stage: "transform", defaultEnabled: true, dependsOn: ["hard-filter"], output: "CandidateDailyFeatures", defaultFailurePolicy: "continue" },
      { id: "factor-score", name: "多因子评分", description: "确定性计算估值、流动性、动量、稳定性与活跃度评分。", stage: "transform", defaultEnabled: true, dependsOn: ["normalize-fields"], optionalInputs: ["CandidateDailyFeatures", "IndustryContext"], output: "RankedCandidatePool", defaultFailurePolicy: "block" },
      { id: "risk-overlay", name: "风险扣分", description: "对追高、破位、异常量比、高换手和数据质量问题扣分。", stage: "constraint", defaultEnabled: true, dependsOn: ["factor-score"], output: "RiskAdjustedPool", defaultFailurePolicy: "block" },
      { id: "portfolio-overlay", name: "集中度约束", description: "降低同一行业或同一拥挤题材在候选中的过度集中。", stage: "constraint", defaultEnabled: true, dependsOn: ["risk-overlay"], output: "DiversifiedCandidatePool", defaultFailurePolicy: "continue" },
      { id: "candidate-events", name: "候选新闻事件", description: "只为进入短名单的股票补充新闻、公告与催化证据。", stage: "context", defaultEnabled: true, dependsOn: ["hard-filter"], output: "CandidateEventEvidence", defaultFailurePolicy: "continue" },
    ],
  },
};

const defaultEnabled = (definition: CompositeAgentDefinition) =>
  new Set(definition.tools.filter((tool) => tool.defaultEnabled).map((tool) => tool.id));

const defaultPolicies = (definition: CompositeAgentDefinition) =>
  Object.fromEntries(definition.tools.map((tool) => [tool.id, tool.defaultFailurePolicy])) as Record<string, FailurePolicy>;

const llmDisplayName = (name: string) => name.replace(/\s*Agent$/i, " LLM");

function ToolSwitch({
  tool,
  enabled,
  policy,
  dependencyNames,
  onToggle,
  onPolicyChange,
}: {
  tool: ToolDefinition;
  enabled: boolean;
  policy: FailurePolicy;
  dependencyNames: string[];
  onToggle: () => void;
  onPolicyChange: (policy: FailurePolicy) => void;
}) {
  const uiLiteral = useUiLiteral();
  return (
    <div className={`border px-3 py-3 transition-colors ${enabled ? "border-cyan/35 bg-cyan/5" : "border-border/70 bg-base/35"}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={tool.name}
          onClick={onToggle}
          className="-my-2 flex h-11 w-11 shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
        >
          <span className={`relative flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors ${enabled ? "border-cyan bg-cyan" : "border-border bg-surface"}`}>
            <span className={`h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{tool.name}</p>
            <span className={`text-[11px] font-medium ${enabled ? "text-cyan" : "text-muted-text"}`}>{enabled ? uiLiteral("预览中启用") : uiLiteral("预览中省略")}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-secondary-text">{tool.description}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-text">
            <span><UiLiteral text={"输出 "} /><code className="text-secondary-text">{tool.output}</code></span>
            {dependencyNames.length ? <span><UiLiteral text={"依赖 "} />{dependencyNames.join("、")}</span> : <span><UiLiteral text={"无工具硬依赖"} /></span>}
            {tool.optionalInputs?.length ? <span><UiLiteral text={"可增强 "} />{tool.optionalInputs.join("、")}</span> : null}
          </div>
        </div>
      </div>
      {enabled ? (
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-xs text-secondary-text">
          <UiLiteral text={"失败处理"} /><select
            aria-label={uiLiteral(`${tool.name}失败处理`)}
            value={policy}
            onChange={(event) => onPolicyChange(event.target.value as FailurePolicy)}
            className="rounded-md border border-border bg-base px-2 py-1.5 text-xs text-foreground"
          >
            <option value="block"><UiLiteral text={"失败则阻止 Agent（规划）"} /></option>
            <option value="continue"><UiLiteral text={"失败则跳过依赖链（规划）"} /></option>
          </select>
        </label>
      ) : null}
      {enabled && policy === "continue" ? <p className="mt-2 text-[11px] leading-5 text-muted-text"><UiLiteral text={"规划规则：工具仍会尝试执行；失败时跳过依赖它的下游，并向 Agent 写入缺失标记。"} /></p> : null}
    </div>
  );
}

export function CompositeAgentWorkbench({ llmTemplates, onOpenLlmLibrary }: { llmTemplates: AgentTemplate[]; onOpenLlmLibrary: () => void }) {
  const uiLiteral = useUiLiteral();
  const [activeId, setActiveId] = useState<CompositeAgentId>("stock-research");
  const [enabledByAgent, setEnabledByAgent] = useState<Record<CompositeAgentId, Set<string>>>(() => ({
    "stock-research": defaultEnabled(definitions["stock-research"]),
    "stock-screening": defaultEnabled(definitions["stock-screening"]),
  }));
  const [policiesByAgent, setPoliciesByAgent] = useState<Record<CompositeAgentId, Record<string, FailurePolicy>>>(() => ({
    "stock-research": defaultPolicies(definitions["stock-research"]),
    "stock-screening": defaultPolicies(definitions["stock-screening"]),
  }));
  const [selectedLlmByAgent, setSelectedLlmByAgent] = useState<Record<CompositeAgentId, number | "">>(() => ({
    "stock-research": llmTemplates.find((template) => template.agentType === "ANALYSIS")?.templateId ?? "",
    "stock-screening": llmTemplates.find((template) => template.agentType === "SCREENING")?.templateId ?? "",
  }));
  const [notice, setNotice] = useState("");

  const definition = definitions[activeId];
  const enabled = enabledByAgent[activeId];
  const policies = policiesByAgent[activeId];
  const toolById = useMemo(
    () => new Map(definition.tools.map((tool) => [tool.id, tool])),
    [definition],
  );
  const enabledTools = definition.tools.filter((tool) => enabled.has(tool.id));
  const disabledTools = definition.tools.filter((tool) => !enabled.has(tool.id));
  const selectedLlm = llmTemplates.find((template) => template.templateId === selectedLlmByAgent[activeId]);

  const toggleTool = (toolId: string) => {
    const next = new Set(enabled);
    const changedNames: string[] = [];
    if (next.has(toolId)) {
      next.delete(toolId);
      const disableDependents = (dependencyId: string) => {
        definition.tools.forEach((candidate) => {
          if (next.has(candidate.id) && candidate.dependsOn.includes(dependencyId)) {
            next.delete(candidate.id);
            changedNames.push(candidate.name);
            disableDependents(candidate.id);
          }
        });
      };
      disableDependents(toolId);
      setNotice(changedNames.length ? `已同步停用依赖它的工具：${changedNames.join("、")}。` : `${toolById.get(toolId)?.name} 已停用；Agent 将收到对应缺失标记。`);
    } else {
      const enableDependencies = (candidateId: string) => {
        const candidate = toolById.get(candidateId);
        candidate?.dependsOn.forEach((dependencyId) => {
          if (!next.has(dependencyId)) {
            enableDependencies(dependencyId);
            next.add(dependencyId);
            const dependencyName = toolById.get(dependencyId)?.name;
            if (dependencyName) changedNames.push(dependencyName);
          }
        });
      };
      enableDependencies(toolId);
      next.add(toolId);
      setNotice(changedNames.length ? `已自动启用硬依赖：${changedNames.join("、")}。` : `${toolById.get(toolId)?.name} 已加入本次前置工具图。`);
    }
    setEnabledByAgent((current) => ({ ...current, [activeId]: next }));
  };

  const resetCurrent = () => {
    setEnabledByAgent((current) => ({ ...current, [activeId]: defaultEnabled(definition) }));
    setPoliciesByAgent((current) => ({ ...current, [activeId]: defaultPolicies(definition) }));
    setNotice("已恢复这条成熟链路的默认工具选择与失败策略；LLM 配置未改变。");
  };

  const switchAgent = (nextId: CompositeAgentId) => {
    setActiveId(nextId);
    setNotice("");
  };

  return (
    <section aria-labelledby="complete-agent-heading" className="space-y-5">
      <div className="border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-secondary-text">
        <span className="font-medium text-warning"><UiLiteral text={"前端结构预览"} /></span>
        <span className="ml-2"><UiLiteral text={"当前只演示工具选择、依赖联动与 Agent 输入覆盖；所有执行、产物和校验均为规划状态，不会保存 AgentVersion，也不会触发任何研究或选股 API。"} /></span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="complete-agent-heading" className="text-xl font-semibold text-foreground"><UiLiteral text={"完整 Agent 配置"} /></h2>
          <p className="mt-2 text-sm leading-6 text-secondary-text"><UiLiteral text={"一个完整 Agent 由 LLM 配置、前置工具图和输入输出契约共同构成。工具先形成结构化证据，再由所选 LLM 完成研究推理。"} /></p>
        </div>
        <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-2" onClick={resetCurrent}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /><UiLiteral text={"恢复默认工具设置"} /></button>
      </div>

      <div className="grid gap-px overflow-hidden border border-border bg-border lg:grid-cols-2">
        {(Object.values(definitions) as CompositeAgentDefinition[]).map((item) => {
          const active = item.id === activeId;
          const selectedCount = enabledByAgent[item.id].size;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => switchAgent(item.id)}
              className={`flex items-start gap-4 bg-surface px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan/60 ${active ? "bg-cyan/5" : "hover:bg-hover/50"}`}
            >
              <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? "bg-cyan text-white" : "bg-base text-secondary-text"}`}>
                {item.id === "stock-research" ? <FileSearch className="h-5 w-5" /> : <ScanSearch className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.name}</span><span className="border border-border px-2 py-0.5 text-[11px] text-secondary-text">{item.kind}</span></span>
                <span className="mt-1.5 block text-sm leading-5 text-secondary-text">{item.description}</span>
                <span className="mt-2 block text-xs text-muted-text"><UiLiteral text={"预览启用 "} />{selectedCount}/{item.tools.length} <UiLiteral text={" 个工具"} /></span>
              </span>
              {active ? <CheckCircle2 className="mt-2 h-4 w-4 shrink-0 text-cyan" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {notice ? <p role="status" className="border border-cyan/25 bg-cyan/5 px-4 py-3 text-sm text-secondary-text">{notice}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card variant="bordered" padding="none" className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-cyan" aria-hidden="true" /><h3 className="font-semibold text-foreground"><UiLiteral text={"前置工具图"} /></h3></div>
              <p className="mt-1 text-xs text-secondary-text"><UiLiteral text={"预览启用 "} />{enabledTools.length} <UiLiteral text={" 个；被停用的维度预计作为缺失信息交给 Agent。"} /></p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 border border-border bg-base px-2.5 py-1.5 text-xs text-secondary-text"><LockKeyhole className="h-3.5 w-3.5" /><UiLiteral text={"选中工具计划为必经步骤"} /></span>
          </div>

          <div className="px-5 py-5">
            <div className="grid gap-3 border border-border/70 bg-base/35 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex items-center gap-3"><Database className="h-4 w-4 text-cyan" aria-hidden="true" /><div><p className="text-sm font-medium text-foreground"><UiLiteral text={"运行输入"} /></p><p className="mt-0.5 text-xs text-secondary-text">{definition.inputLabel}</p></div></div>
              <span className="text-xs text-muted-text"><UiLiteral text={"规划骨架 · 后端待接入"} /></span>
            </div>
            <div className="flex h-8 items-center pl-6 text-muted-text"><ArrowDown className="h-4 w-4" aria-hidden="true" /></div>

            <div className="space-y-5">
              {(Object.keys(stageMeta) as ToolStage[]).map((stage) => {
                const tools = definition.tools.filter((tool) => tool.stage === stage);
                if (!tools.length) return null;
                const meta = stageMeta[stage];
                return (
                  <section key={stage} aria-labelledby={`${activeId}-${stage}-heading`}>
                    <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <h4 id={`${activeId}-${stage}-heading`} className="text-sm font-semibold text-foreground">{meta.label}</h4>
                      <p className="text-xs text-muted-text">{meta.description}</p>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {tools.map((tool) => (
                        <ToolSwitch
                          key={tool.id}
                          tool={tool}
                          enabled={enabled.has(tool.id)}
                          policy={policies[tool.id]}
                          dependencyNames={tool.dependsOn.map((dependencyId) => toolById.get(dependencyId)?.name || dependencyId)}
                          onToggle={() => toggleTool(tool.id)}
                          onPolicyChange={(policy) => setPoliciesByAgent((current) => ({ ...current, [activeId]: { ...current[activeId], [tool.id]: policy } }))}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="flex h-8 items-center pl-6 text-muted-text"><ArrowDown className="h-4 w-4" aria-hidden="true" /></div>
            <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
              <div className="bg-surface px-4 py-4"><div className="flex items-center gap-2"><Braces className="h-4 w-4 text-cyan" /><p className="text-sm font-medium text-foreground"><UiLiteral text={"证据组装"} /></p></div><p className="mt-2 break-all font-mono text-xs text-secondary-text">{definition.packLabel}</p><p className="mt-2 text-[11px] text-muted-text"><UiLiteral text={"规划骨架 · 预计汇总可用与缺失产物"} /></p></div>
              <div className="bg-cyan/5 px-4 py-4"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan" /><p className="text-sm font-medium text-foreground">{definition.name}</p></div><p className="mt-2 text-xs leading-5 text-secondary-text"><UiLiteral text={"规划为只消费 EvidencePack，不自行猜测未提供的数据。"} /></p></div>
              <div className="bg-surface px-4 py-4"><div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-success" /><p className="text-sm font-medium text-foreground"><UiLiteral text={"结构化输出"} /></p></div><p className="mt-2 break-all font-mono text-xs text-secondary-text">{definition.outputLabel}</p><p className="mt-2 text-[11px] text-muted-text"><UiLiteral text={"规划中的输出契约校验"} /></p></div>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card variant="bordered" padding="lg">
            <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-cyan" /><h3 className="font-semibold text-foreground"><UiLiteral text={"Agent 配置"} /></h3></div>
            <p className="mt-2 text-xs leading-5 text-secondary-text"><UiLiteral text={"选择一个真实数据库 LLM 配置作为推理核心，再组合前置工具。职责与 Prompt 继承所选 LLM 版本，不在 Agent 层重复维护。"} /></p>
            <label className="mt-4 block text-xs font-medium text-secondary-text">
              <UiLiteral text={"LLM 推理配置"} /><select
                aria-label={uiLiteral(`${definition.name} LLM 配置`)}
                value={selectedLlmByAgent[activeId]}
                onChange={(event) => setSelectedLlmByAgent((current) => ({ ...current, [activeId]: event.target.value ? Number(event.target.value) : "" }))}
                className="mt-2 w-full rounded-md border border-border bg-base px-3 py-2.5 text-sm text-foreground"
              >
                <option value=""><UiLiteral text={"选择数据库 LLM 配置"} /></option>
                {llmTemplates.filter((template) => template.agentType === definition.llmType).map((template) => (
                  <option key={template.templateId} value={template.templateId}>{llmDisplayName(template.name)} · v{template.currentVersion}</option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-[11px] leading-5 text-muted-text"><UiLiteral text={"列表来自现有 AgentTemplate API；本版只重新明确其产品角色，不修改后端模型。"} /></p>
            <div className="mt-4 border border-border/70 bg-base/40 p-3">
              <p className="text-xs font-medium text-secondary-text"><UiLiteral text={"LLM 继承状态"} /></p>
              <p className="mt-1 text-sm text-foreground">{selectedLlm ? `${llmDisplayName(selectedLlm.name)} · v${selectedLlm.currentVersion}` : uiLiteral("尚未选择 LLM 配置")}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-text"><UiLiteral text={"AgentVersion 将引用这个不可变 LLM 配置版本；修改 Prompt 会产生新的 LLM 配置版本。"} /></p>
              <button type="button" onClick={onOpenLlmLibrary} className="mt-2 text-xs font-medium text-cyan hover:text-foreground"><UiLiteral text={"前往 LLM 配置查看或编辑 Prompt"} /></button>
            </div>
            <div className="mt-4 grid gap-3">
              <div><p className="text-xs font-medium text-secondary-text"><UiLiteral text={"输入契约 · 预览"} /></p><ul className="mt-2 space-y-1.5">{definition.inputContract.map((field) => <li key={field} className="border border-border/70 bg-base/40 px-2.5 py-2 font-mono text-[11px] text-secondary-text">{field}</li>)}</ul></div>
              <div><p className="text-xs font-medium text-secondary-text"><UiLiteral text={"输出契约 · 预览"} /></p><ul className="mt-2 space-y-1.5">{definition.outputContract.map((field) => <li key={field} className="border border-border/70 bg-base/40 px-2.5 py-2 font-mono text-[11px] text-secondary-text">{field}</li>)}</ul></div>
            </div>
            <button type="button" disabled className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50"><UiLiteral text={"保存完整 Agent 新版本 · 后端待接入"} /></button>
          </Card>

          <Card variant="bordered" padding="lg">
            <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-cyan" /><h3 className="font-semibold text-foreground"><UiLiteral text={"预计 Agent 输入"} /></h3></div>
            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border text-center">
              <div className="bg-surface px-3 py-3"><dt className="text-[11px] text-muted-text"><UiLiteral text={"预计可用"} /></dt><dd className="mt-1 text-xl font-semibold text-foreground">{enabledTools.length}</dd></div>
              <div className="bg-surface px-3 py-3"><dt className="text-[11px] text-muted-text"><UiLiteral text={"预计缺失"} /></dt><dd className="mt-1 text-xl font-semibold text-foreground">{disabledTools.length}</dd></div>
            </dl>
            <div className="mt-4 space-y-3">
              <div><p className="text-xs font-medium text-secondary-text"><UiLiteral text={"预计组装产物"} /></p><div className="mt-2 flex flex-wrap gap-1.5">{enabledTools.map((tool) => <code key={tool.id} className="border border-success/25 bg-success/5 px-2 py-1 text-[11px] text-success">{tool.output}</code>)}</div></div>
              {disabledTools.length ? <div><p className="text-xs font-medium text-secondary-text"><UiLiteral text={"预计不进入 Prompt"} /></p><div className="mt-2 flex flex-wrap gap-1.5">{disabledTools.map((tool) => <span key={tool.id} className="border border-border bg-base px-2 py-1 text-[11px] text-muted-text">{tool.name}</span>)}</div></div> : null}
            </div>
          </Card>

          <Card variant="bordered" padding="lg">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan" /><h3 className="font-semibold text-foreground"><UiLiteral text={"本阶段边界"} /></h3></div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-secondary-text">
              <li className="flex gap-2"><CircleDot className="mt-1 h-3 w-3 shrink-0 text-cyan" /><UiLiteral text={"只展示配置结构，不保存工具图。"} /></li>
              <li className="flex gap-2"><CircleDot className="mt-1 h-3 w-3 shrink-0 text-cyan" /><UiLiteral text={"不会改写现有成熟服务或运行结果。"} /></li>
              <li className="flex gap-2"><CircleDot className="mt-1 h-3 w-3 shrink-0 text-cyan" /><UiLiteral text={"关闭工具只改变预览中的证据覆盖。"} /></li>
            </ul>
            <Link to={definition.route} className="btn-secondary mt-4 inline-flex w-full items-center justify-center gap-2">
              {definition.id === "stock-research" ? <Activity className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}{definition.routeLabel}
            </Link>
          </Card>
        </div>
      </div>
    </section>
  );
}
