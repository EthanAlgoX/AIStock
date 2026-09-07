import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  CircleAlert,
  Database,
  Network,
  PlugZap,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { workspaceApi } from "../api/workspace";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";
import { AppPage, PageHeader } from "../components/common";

type CapabilitySummary = {
  skills: number | null;
  tools: number;
  mcp: number;
  data: number | null;
  experts: number;
};

const capabilityItems = [
  {
    key: "skills" as const,
    title: "Skill",
    description: "可复用的金融研究方法和任务流程。",
    state: "已接入能力网关",
    stateTone: "success",
    icon: Sparkles,
    to: "/capabilities/skills",
  },
  {
    key: "tools" as const,
    title: "内置工具",
    description: "站内行情、研究、计算和验证函数。",
    state: "已发布金融 MCP",
    stateTone: "success",
    icon: Wrench,
    to: "/capabilities/tools",
  },
  {
    key: "mcp" as const,
    title: "MCP 服务",
    description: "连接外部 Tool、Resource 和 Prompt。",
    state: "注册、发现与调用已接入",
    stateTone: "success",
    icon: PlugZap,
    to: "/capabilities/mcp",
  },
  {
    key: "data" as const,
    title: "数据源",
    description: "提供行情、新闻、财务和研究事实。",
    state: "目录与任务快照已接入",
    stateTone: "success",
    icon: Database,
    to: "/capabilities/data",
  },
  {
    key: "experts" as const,
    title: "专家配置",
    description: "以版本化 Persona Prompt 提供评审视角。",
    state: "Persona Run 已接入",
    stateTone: "success",
    icon: Bot,
    to: "/capabilities/experts",
  },
] as const;

export default function CapabilityOverviewPage() {
  const [summary, setSummary] = useState<CapabilitySummary>({ skills: null, tools: 0, mcp: 0, data: null, experts: 0 });
  const [loadFailed, setLoadFailed] = useState(false);

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
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const configuredCount = useMemo(() => (
    Object.values(summary).reduce<number>((total, count) => total + (count ?? 0), 0)
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
        eyebrow="Capability registry"
        title="能力中心"
        description="统一管理投研助理可以发现的工作方法、执行工具、外部连接、事实数据和专家视角；工作区启用不等于本次任务已经挂载。"
        actions={<Link to="/overview" className="btn-primary">返回投研助理</Link>}
      />
      <CapabilityCenterNav />

      <section className="grid overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-[1.15fr_0.85fr]" aria-label="能力中心运行边界">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-primary"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">两层能力模型</h2></div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-border bg-border sm:grid-cols-2">
            <div className="bg-background px-4 py-3"><p className="text-xs font-medium text-foreground">工作区可用</p><p className="mt-1 text-xs leading-5 text-secondary-text">管理员启用并治理能力目录、权限和连接。</p></div>
            <div className="bg-background px-4 py-3"><p className="text-xs font-medium text-foreground">本次任务使用</p><p className="mt-1 text-xs leading-5 text-secondary-text">研究、选股或交易只挂载完成任务所需的子集。</p></div>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-warning"><Braces className="h-4 w-4" /><h2 className="text-sm font-semibold">当前运行边界</h2></div>
          <p className="mt-3 text-sm leading-6 text-secondary-text">网站已持久化工作区能力、校验任务绑定并冻结运行快照。独立 Agent 引擎 继续承担自己的 ReAct、会话与记忆；站内金融 Tool 通过受控 MCP Endpoint 对外发布。</p>
          <Link to="/runs" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">查看任务与运行 <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>

      {loadFailed ? (
        <div className="flex items-start gap-3 rounded-[12px] border border-warning/25 bg-warning/5 px-4 py-3 text-sm text-secondary-text">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>工作区能力目录暂时不可用。页面不会用浏览器缓存或推算值补齐，请恢复后端连接后重试。</p>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="capability-inventory-heading">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 id="capability-inventory-heading" className="font-semibold text-foreground">能力目录</h2><p className="mt-1 text-xs leading-5 text-secondary-text">当前可见 {configuredCount} 项已启用配置；数量全部来自后端工作区注册表。</p></div>
          <span className="text-xs text-muted-text">5 类能力 · 分别治理</span>
        </div>
        <div className="divide-y divide-border/60">
          {capabilityItems.map((item) => {
            const Icon = item.icon;
            const count = summary[item.key];
            return (
              <Link key={item.key} to={item.to} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-hover/35 sm:grid-cols-[2.5rem_minmax(0,1fr)_10rem_4rem] sm:items-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border bg-background text-secondary-text group-hover:text-primary"><Icon className="h-4 w-4" /></span>
                <span><span className="block text-sm font-semibold text-foreground">{item.title}</span><span className="mt-1 block text-xs leading-5 text-secondary-text">{item.description}</span></span>
                <span className={`flex items-center gap-2 text-xs ${item.stateTone === "success" ? "text-success" : "text-warning"}`}>
                  {item.stateTone === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  {item.state}
                </span>
                <span className="flex items-center justify-end gap-2 font-mono text-sm font-semibold text-foreground">{count ?? "—"}<ArrowRight className="h-3.5 w-3.5 text-muted-text" /></span>
              </Link>
            );
          })}
        </div>
      </section>
    </AppPage>
  );
}
