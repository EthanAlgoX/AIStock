import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
import {
  ArrowRight,
  Bot,
  Braces,
  CircleAlert,
  Database,
  Network,
  PlugZap,
  LoaderCircle,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { workspaceApi } from "../api/workspace";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";
import { AppPage, PageHeader } from "../components/common";

type CapabilitySummary = {
  skills: number;
  tools: number;
  mcp: number;
  data: number;
  experts: number;
};

const capabilityItems = [
  {
    key: "skills" as const,
    title: "Skill",
    description: "可复用的金融研究方法和任务流程。",
    icon: Sparkles,
    to: "/capabilities/skills",
  },
  {
    key: "tools" as const,
    title: "内置工具",
    description: "站内行情、研究、计算和验证函数。",
    icon: Wrench,
    to: "/capabilities/tools",
  },
  {
    key: "mcp" as const,
    title: "MCP 服务",
    description: "连接外部 Tool、Resource 和 Prompt。",
    icon: PlugZap,
    to: "/capabilities/mcp",
  },
  {
    key: "data" as const,
    title: "数据源",
    description: "提供行情、新闻、财务和研究事实。",
    icon: Database,
    to: "/capabilities/data",
  },
  {
    key: "experts" as const,
    title: "专家配置",
    description: "以版本化 Persona Prompt 提供评审视角。",
    icon: Bot,
    to: "/capabilities/experts",
  },
] as const;

export default function CapabilityOverviewPage() {
  const uiLiteral = useUiLiteral();
  const [summary, setSummary] = useState<CapabilitySummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const retry = () => { setSummary(null); setLoadFailed(false); setLoading(true); setRevision((value) => value + 1); };

  useEffect(() => {
    let active = true;
    void workspaceApi.getCapabilities()
      .then((catalog) => {
        if (!active) return;
        setSummary({
          skills: catalog.skills.filter((item) => item.enabled).length,
          tools: catalog.tools.filter((item) => item.enabled).length,
          mcp: catalog.mcpServers.filter((item) => item.enabled).length,
          data: catalog.dataSources.filter((item) => item.selectable).length,
          experts: catalog.experts.filter((item) => item.enabled).length,
        });
      })
      .catch(() => active && setLoadFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision]);

  const configuredCount = useMemo(() => (
    summary ? Object.values(summary).reduce((total, count) => total + count, 0) : null
  ), [summary]);

  return (
    <AppPage
      className="space-y-6 pb-20"
      data-testid="capability-overview-page"
      data-design-thesis="A capability registry is an honest control plane, not a marketplace or a promise that every configured item already runs."
      data-design-world="Carbon instrument canvas, mineral rules, compact cobalt actions, and divided ledgers."
      data-design-story="Understand the capability model, inspect readiness, configure each category, then mount a subset on a task."
      data-design-first-viewport="Registry definition and truthful runtime boundary lead into five capability ledgers."
      data-design-form="Established Operate surface; capability control-plane overview."
    >
      <PageHeader
        eyebrow={uiLiteral("能力注册表")}
        title={uiLiteral("能力中心")}
        description={uiLiteral("选择研究方法、工具和专家，查看工作区有哪些可用能力。")}
        actions={<Link to="/overview" className="btn-primary"><UiLiteral text={"返回投研助理"} /></Link>}
      />
      <CapabilityCenterNav />

      {loadFailed ? (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3 text-sm text-secondary-text">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p><UiLiteral text={"工作区能力目录暂时不可用。页面不会用浏览器缓存或推算值补齐，请恢复后端连接后重试。"} /></p>
          <button type="button" className="btn-secondary" onClick={retry}><UiLiteral text="重新读取" /></button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="capability-inventory-heading">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 id="capability-inventory-heading" className="font-semibold text-foreground"><UiLiteral text={"能力目录"} /></h2>{summary ? <p className="mt-1 text-xs leading-5 text-secondary-text"><UiLiteral text={"当前可见 "} />{configuredCount} <UiLiteral text={" 项已启用配置；数量全部来自后端工作区注册表。"} /></p> : <p role={loading ? 'status' : undefined} className="mt-2 flex items-center gap-2 text-sm text-secondary-text">{loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}<UiLiteral text={loading ? '正在读取能力目录…' : '目录尚未读取'} /></p>}</div>
          <span className="text-xs text-muted-text"><UiLiteral text={"5 类能力 · 分别治理"} /></span>
        </div>
        <div className="divide-y divide-border/60">
          {capabilityItems.map((item) => {
            const Icon = item.icon;
            const count = summary?.[item.key];
            return (
              <Link key={item.key} to={item.to} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-hover/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem] sm:items-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-secondary-text group-hover:text-primary"><Icon className="h-4 w-4" /></span>
                <span><span className="block text-sm font-semibold text-foreground">{uiLiteral(item.title)}</span><span className="mt-1 block text-xs leading-5 text-secondary-text">{uiLiteral(item.description)}</span></span>
                <span className="flex items-center justify-end gap-2 text-sm text-secondary-text"><span className="tabular-nums">{count === undefined ? '—' : <>{count} <UiLiteral text={item.key === 'data' ? '可选' : '已启用'} /></>}</span><ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 border-y border-border py-5 sm:grid-cols-2" aria-label={uiLiteral('两层能力模型')}>
        <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Network className="size-4 text-secondary-text" aria-hidden /><UiLiteral text="工作区可用" /></h2><p className="mt-2 max-w-prose text-sm leading-6 text-secondary-text"><UiLiteral text="管理员启用并治理能力目录、权限和连接。" /></p></div>
        <div><h2 className="text-sm font-semibold"><UiLiteral text="本次任务使用" /></h2><p className="mt-2 max-w-prose text-sm leading-6 text-secondary-text"><UiLiteral text="研究、选股或交易只挂载完成任务所需的子集。" /></p><Link to="/overview" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"><UiLiteral text="返回投研助理" /><ArrowRight className="size-4" aria-hidden /></Link></div>
      </section>
      <details className="border-b border-border pb-5">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-secondary-text"><Braces className="size-4" aria-hidden /><UiLiteral text="当前运行边界" /></summary>
        <p className="mt-3 max-w-prose text-sm leading-6 text-secondary-text"><UiLiteral text="网站已持久化工作区能力、校验任务绑定并冻结运行快照。独立 Agent 引擎 继续承担自己的 ReAct、会话与记忆；站内金融 Tool 通过受控 MCP Endpoint 对外发布。" /></p>
        <Link to="/runs" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"><UiLiteral text="查看任务与运行 " /><ArrowRight className="size-4" aria-hidden /></Link>
      </details>
    </AppPage>
  );
}
