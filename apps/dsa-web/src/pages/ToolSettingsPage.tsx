import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Database,
  Info,
  Save,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";

import { workspaceApi, type WorkspaceTool } from "../api/workspace";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";
import { AppPage, PageHeader } from "../components/common";
import {
  FINANCE_TOOL_CATALOG,
} from "../utils/financeToolCatalog";

const toolCopy = new Map(FINANCE_TOOL_CATALOG.map((tool) => [tool.id, tool]));
const categoryMeta: Record<string, {label:string;description:string}> = {
  data: { label: "行情与基础数据", description: "读取实时行情、历史价格与证券基础信息。" },
  analysis: { label: "确定性分析", description: "计算技术指标、趋势、量能与形态。" },
  search: { label: "研究与情报", description: "检索新闻、公告和综合研究证据。" },
  market: { label: "市场雷达", description: "读取指数、行业和市场结构数据。" },
  screening: { label: "股票池筛选", description: "运行确定性筛选管线并返回真实候选清单。" },
  backtest: { label: "验证与回测", description: "读取可复现的策略和个股回测结果。" },
};

export default function ToolSettingsPage() {
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const enabledSet = useMemo(() => new Set(enabledIds), [enabledIds]);
  const categoryOrder = useMemo(() => [...new Set(tools.map((tool) => tool.category))], [tools]);

  useEffect(() => {
    let active = true;
    void workspaceApi.listTools()
      .then((result) => {
        if (!active) return;
        setTools(result);
        setEnabledIds(result.filter((tool) => tool.enabled).map((tool) => tool.id));
      })
      .catch(() => active && setError("内置工具目录读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const toggle = (toolId: string) => {
    setSaved(false);
    setEnabledIds((current) => current.includes(toolId)
      ? current.filter((id) => id !== toolId)
      : [...current, toolId]);
  };

  const save = async () => {
    setError("");
    try {
      await workspaceApi.setPreferences("tool", enabledIds);
      setSaved(true);
    } catch {
      setError("工具白名单保存失败，请稍后重试。");
    }
  };

  return (
    <AppPage
      className="space-y-6 pb-20"
      data-testid="tool-settings-page"
      data-design-thesis="Tools are executable financial capabilities; MCP is only one way to supply them."
      data-design-world="Instrument-like ledgers, mineral rules, compact cobalt selection, no decorative cards."
      data-design-story="Understand the boundary, inspect published tools, choose a workspace allowlist, then connect external servers separately."
      data-design-first-viewport="Definition strip, truthful runtime boundary, and tool inventory summary before configuration."
      data-design-form="Established Operate surface; direct extension of the capability registry."
    >
      <PageHeader
        eyebrow="Capability registry"
        title="内置工具"
        description="管理平台自带的金融 Tool Surface。Tool 是 Agent 可直接执行的函数；MCP 服务是外部能力的连接协议，两者分别治理。"
        actions={<Link to="/overview" className="btn-primary">返回投研助理</Link>}
      />
      <CapabilityCenterNav />

      <section className="grid overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-[1fr_1fr]" aria-label="Tool 与 MCP 的边界">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-primary"><Wrench className="h-4 w-4" /><p className="text-xs font-semibold">Tool · 可执行能力</p></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text">有明确输入 Schema、权限、作用域和执行结果，例如读取行情、计算均线或搜索新闻。</p>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-primary"><Braces className="h-4 w-4" /><p className="text-xs font-semibold">MCP · 外部连接协议</p></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text">一个 MCP Server 可以暴露多个 Tool、Resource 或 Prompt；连接地址和凭据不属于内置工具配置。</p>
          <Link to="/capabilities/mcp" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">管理 MCP 服务 <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3 text-sm leading-6 text-secondary-text">
        <Info className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p><span className="font-medium text-warning">运行边界。</span> 下列站内工具已通过网站的金融 MCP Endpoint 发布给外部 Runtime；独立 Agent 引擎 仍需在自身配置中连接该 Endpoint。工作区白名单会同时限制站内 Agent 和 MCP 暴露面。</p>
      </div>

      {error ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-3" aria-label="工具目录摘要">
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">平台金融工具</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{loading ? "—" : tools.length}</p><p className="mt-1 text-xs text-muted-text">DSA Tool Surface</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">工作区白名单</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{enabledIds.length}</p><p className="mt-1 text-xs text-muted-text">启用但尚未按任务绑定</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text">运行权限</p><p className="mt-2 text-base font-semibold text-foreground">READ · COMPUTE</p><p className="mt-1 text-xs text-muted-text">不包含审批和交易执行</p></div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {categoryOrder.map((category) => {
            const meta = categoryMeta[category] || { label: category, description: "Agent 可调用的金融工具。" };
            const categoryTools = tools.filter((tool) => tool.category === category);
            return (
              <section key={category} className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby={`tool-category-${category}`}>
                <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                  <div><h2 id={`tool-category-${category}`} className="font-semibold text-foreground">{meta.label}</h2><p className="mt-1 text-xs leading-5 text-secondary-text">{meta.description}</p></div>
                  <span className="font-mono text-xs text-muted-text">{categoryTools.filter((tool) => enabledSet.has(tool.id)).length}/{categoryTools.length}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {categoryTools.map((tool) => {
                    const enabled = enabledSet.has(tool.id);
                    const copy = toolCopy.get(tool.id);
                    const policy = tool.policy || {};
                    return (
                      <label key={tool.id} className="flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-hover/35">
                        <input type="checkbox" checked={enabled} onChange={() => toggle(tool.id)} aria-label={`${tool.name} 工具`} className="mt-1" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{copy?.name || tool.name}</span><code className="text-[11px] text-muted-text">{tool.id}</code></span>
                          <span className="mt-1 block text-sm leading-6 text-secondary-text">{copy?.description || tool.description}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-1.5 sm:flex"><span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-text">{Array.isArray(policy.permissions) ? policy.permissions.join(" · ") || "READ" : "READ"}</span><span className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-text">{policy.read_only === false ? "受控副作用" : "只读/计算"}</span></span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6">
          <div className="rounded-[14px] border border-border bg-background p-5">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="font-semibold text-foreground">金融工具白名单</h2></div>
            <p className="mt-3 text-sm leading-6 text-secondary-text">只保留研究、选股、组合和策略验证需要的能力。Shell、文件写入、自我修改和远程安装不属于默认金融工具。</p>
            <button type="button" onClick={() => void save()} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2"><Save className="h-4 w-4" />保存工具白名单</button>
            {saved ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />已保存到后端工作区注册表。</p> : null}
          </div>
          <div className="rounded-[12px] border border-border bg-background p-4">
            <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><p className="text-xs font-semibold text-foreground">数据源不是 Tool</p></div>
            <p className="mt-2 text-xs leading-5 text-secondary-text">数据源负责事实数据和版本；Tool 负责查询或计算。一个行情 Tool 可以按任务绑定不同的数据源。</p>
            <Link to="/capabilities/data" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">管理数据源 <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </aside>
      </div>
    </AppPage>
  );
}
