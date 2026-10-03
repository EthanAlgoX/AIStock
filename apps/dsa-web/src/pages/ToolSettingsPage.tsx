import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
import { useEffect, useMemo, useRef, useState } from "react";
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
  const uiLiteral = useUiLiteral();
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const saveInFlight = useRef(false);
  const dirty = enabledIds.length !== savedIds.length || enabledIds.some((id) => !savedIds.includes(id));
  const retry = () => { setError(''); setLoaded(false); setLoading(true); setRevision((value) => value + 1); };
  const enabledSet = useMemo(() => new Set(enabledIds), [enabledIds]);
  const categoryOrder = useMemo(() => [...new Set(tools.map((tool) => tool.category))], [tools]);

  useEffect(() => {
    let active = true;
    void workspaceApi.listTools()
      .then((result) => {
        if (!active) return;
        setTools(result);
        const ids = result.filter((tool) => tool.enabled).map((tool) => tool.id);
        setEnabledIds(ids);
        setSavedIds(ids);
        setLoaded(true);
      })
      .catch(() => active && setError("内置工具目录读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [revision]);

  const toggle = (toolId: string) => {
    setSaved(false);
    setEnabledIds((current) => current.includes(toolId)
      ? current.filter((id) => id !== toolId)
      : [...current, toolId]);
  };

  const save = async () => {
    if (!loaded || loading || !dirty || saveInFlight.current) return;
    const snapshot = [...enabledIds];
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await workspaceApi.setPreferences("tool", snapshot);
      setSavedIds(snapshot);
      setSaved(true);
    } catch {
      setError("工具白名单保存失败，请稍后重试。");
    } finally { saveInFlight.current = false; setSaving(false); }
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
        eyebrow={uiLiteral("能力注册表")}
        title={uiLiteral("内置工具")}
        description={uiLiteral("选择研究、选股和风险检查需要的内置工具。启用后，可在任务中按需使用。")}
        actions={<Link to="/overview" className="btn-primary"><UiLiteral text={"返回投研助理"} /></Link>}
      />
      <CapabilityCenterNav />

      <details className="border-b border-border pb-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-secondary-text"><UiLiteral text="Tool 与 MCP 的边界" /></summary>
      <section className="mt-3 grid overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-[1fr_1fr]" aria-label={uiLiteral("Tool 与 MCP 的边界")}>
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-primary"><Wrench className="h-4 w-4" /><p className="text-xs font-semibold"><UiLiteral text={"Tool · 可执行能力"} /></p></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text"><UiLiteral text={"有明确输入 Schema、权限、作用域和执行结果，例如读取行情、计算均线或搜索新闻。"} /></p>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-primary"><Braces className="h-4 w-4" /><p className="text-xs font-semibold"><UiLiteral text={"MCP · 外部连接协议"} /></p></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text"><UiLiteral text={"一个 MCP Server 可以暴露多个 Tool、Resource 或 Prompt；连接地址和凭据不属于内置工具配置。"} /></p>
          <Link to="/capabilities/mcp" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><UiLiteral text={"管理 MCP 服务 "} /><ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3 text-sm leading-6 text-secondary-text">
        <Info className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p><span className="font-medium text-warning"><UiLiteral text={"运行边界。"} /></span> <UiLiteral text={" 下列站内工具已通过网站的金融 MCP Endpoint 发布给外部 Runtime；独立 Agent 引擎 仍需在自身配置中连接该 Endpoint。工作区白名单会同时限制站内 Agent 和 MCP 暴露面。"} /></p>
      </div>
      </details>

      {loading && <p role="status" className="text-sm text-secondary-text"><UiLiteral text="正在读取工具目录…" /></p>}
      {error ? <div role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"><p>{uiLiteral(error)}</p>{!loaded && <button type="button" className="btn-secondary mt-3" disabled={loading} onClick={retry}><UiLiteral text="重新读取" /></button>}</div> : null}

      <section className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-3" aria-label={uiLiteral("工具目录摘要")}>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"平台金融工具"} /></p><p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{loaded ? tools.length : '—'}</p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"工作区白名单"} /></p><p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{loaded ? enabledIds.length : '—'}</p><p className="mt-1 text-xs text-muted-text"><UiLiteral text={"启用但尚未按任务绑定"} /></p></div>
        <div className="bg-card px-5 py-4"><p className="text-xs text-secondary-text"><UiLiteral text={"运行权限"} /></p><p className="mt-2 text-base font-semibold text-foreground">READ · COMPUTE</p><p className="mt-1 text-xs text-muted-text"><UiLiteral text={"不包含审批和交易执行"} /></p></div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {categoryOrder.map((category) => {
            const meta = categoryMeta[category] || { label: category, description: "Agent 可调用的金融工具。" };
            const categoryTools = tools.filter((tool) => tool.category === category);
            return (
              <section key={category} className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby={`tool-category-${category}`}>
                <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                  <div><h2 id={`tool-category-${category}`} className="font-semibold text-foreground">{uiLiteral(meta.label)}</h2><p className="mt-1 text-xs leading-5 text-secondary-text">{uiLiteral(meta.description)}</p></div>
                  <span className="font-mono text-xs text-muted-text">{categoryTools.filter((tool) => enabledSet.has(tool.id)).length}/{categoryTools.length}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {categoryTools.map((tool) => {
                    const enabled = enabledSet.has(tool.id);
                    const copy = toolCopy.get(tool.id);
                    const policy = tool.policy || {};
                    return (
                      <label key={tool.id} className="flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-hover/35">
                        <input type="checkbox" checked={enabled} disabled={saving} onChange={() => toggle(tool.id)} aria-label={uiLiteral(`${tool.name} 工具`)} className="mt-1" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{uiLiteral(copy?.name || tool.name)}</span><code className="text-[11px] text-muted-text">{tool.id}</code></span>
                          <span className="mt-1 block text-sm leading-6 text-secondary-text">{uiLiteral(copy?.description || tool.description)}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-1.5 sm:flex"><span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-text">{Array.isArray(policy.permissions) ? policy.permissions.join(" · ") || "READ" : "READ"}</span><span className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-text">{policy.read_only === false ? uiLiteral("受控副作用") : uiLiteral("只读/计算")}</span></span>
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
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="font-semibold text-foreground"><UiLiteral text={"金融工具白名单"} /></h2></div>
            <p className="mt-3 text-sm leading-6 text-secondary-text"><UiLiteral text={"只保留研究、选股、组合和策略验证需要的能力。Shell、文件写入、自我修改和远程安装不属于默认金融工具。"} /></p>
            <button type="button" onClick={() => void save()} disabled={!loaded || loading || saving || !dirty} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45"><Save className="h-4 w-4" /><UiLiteral text={saving ? '正在保存…' : '保存工具白名单'} /></button>
            {saved ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" /><UiLiteral text={"已保存到后端工作区注册表。"} /></p> : null}
          </div>
          <div className="rounded-[12px] border border-border bg-background p-4">
            <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><p className="text-xs font-semibold text-foreground"><UiLiteral text={"数据源不是 Tool"} /></p></div>
            <p className="mt-2 text-xs leading-5 text-secondary-text"><UiLiteral text={"数据源负责事实数据和版本；Tool 负责查询或计算。一个行情 Tool 可以按任务绑定不同的数据源。"} /></p>
            <Link to="/capabilities/data" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><UiLiteral text={"管理数据源 "} /><ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </aside>
      </div>
    </AppPage>
  );
}
