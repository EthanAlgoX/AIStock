import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Database,
  Network,
  PlugZap,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { SkillInfo } from "../../api/agent";
import {
  workspaceApi,
  type WorkspaceDataSource,
  type WorkspaceExpert,
  type WorkspaceExpertTeam,
  type WorkspaceMcpServer,
  type WorkspaceTool,
} from "../../api/workspace";
import { cn } from "../../utils/cn";
import ChoiceList from "../common/ChoiceList";

type CapabilityPanelProps = {
  scopeLabel?: "会话" | "任务";
  skills: SkillInfo[];
  selectedSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
  skillLimitReached: boolean;
  selectedToolIds: string[];
  onToggleTool: (toolId: string) => void;
  selectedDataSourceIds: string[];
  onToggleDataSource: (sourceId: string) => void;
  selectedMcpIds: string[];
  onToggleMcp: (mcpId: string) => void;
  selectedExpertIds: number[];
  onToggleExpert: (expertId: number) => void;
  selectedExpertTeamIds: number[];
  onToggleExpertTeam: (teamId: number) => void;
  onClose?: () => void;
  className?: string;
  presentation?: "sidebar" | "inline";
  showSkills?: boolean;
  showExperts?: boolean;
};

type SectionKey = "skills" | "tools" | "mcp" | "data" | "experts";

const sectionMeta: Record<SectionKey, { title: string; icon: typeof Sparkles }> = {
  skills: { title: "Skills", icon: Sparkles },
  tools: { title: "内置工具", icon: Wrench },
  mcp: { title: "MCP 服务", icon: PlugZap },
  data: { title: "数据源", icon: Database },
  experts: { title: "专家", icon: Bot },
};

export function CapabilityButton({
  active,
  disabled,
  title,
  description,
  statusLabel,
  onClick,
  comfortable = false,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  description?: string | null;
  statusLabel?: string;
  onClick: () => void;
  comfortable?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/10 text-foreground" : "text-secondary-text hover:bg-hover/55 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-45",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
        )}
        aria-hidden="true"
      >
        {active ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center justify-between gap-2 font-medium", comfortable ? "text-sm" : "text-xs")}>
          <span className={comfortable ? "break-words" : "truncate"}>{title}</span>
          {statusLabel ? <span className="shrink-0 text-[9px] font-normal text-muted-text">{statusLabel}</span> : null}
        </span>
        {description ? <span className={cn("mt-1 block", comfortable ? "text-sm leading-6 text-secondary-text" : "line-clamp-2 text-[11px] leading-4 text-muted-text")}>{description}</span> : null}
      </span>
    </button>
  );
}

export default function AgentCapabilityPanel({
  scopeLabel = "会话",
  skills,
  selectedSkillIds,
  onToggleSkill,
  skillLimitReached,
  selectedToolIds,
  onToggleTool,
  selectedDataSourceIds,
  onToggleDataSource,
  selectedMcpIds,
  onToggleMcp,
  selectedExpertIds,
  onToggleExpert,
  selectedExpertTeamIds,
  onToggleExpertTeam,
  onClose,
  className,
  presentation = "sidebar",
  showSkills = true,
  showExperts = true,
}: CapabilityPanelProps) {
  const inline = presentation === "inline";
  const [dataSources, setDataSources] = useState<WorkspaceDataSource[]>([]);
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [mcpConnections, setMcpConnections] = useState<WorkspaceMcpServer[]>([]);
  const [experts, setExperts] = useState<WorkspaceExpert[]>([]);
  const [teams, setTeams] = useState<WorkspaceExpertTeam[]>([]);
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    new Set(inline ? ["skills", "experts"] : []),
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await Promise.allSettled([workspaceApi.getCapabilities()]);
      if (!active) return;
      if (result[0].status === "fulfilled") {
        setDataSources(result[0].value.dataSources);
        setTools(result[0].value.tools.filter((item) => item.enabled));
        setMcpConnections(result[0].value.mcpServers.filter((item) => item.selectable));
        setExperts(result[0].value.experts.filter((item) => item.enabled));
        setTeams(result[0].value.expertTeams.filter((item) => item.enabled));
      }
      setLoadFailed(result[0].status === "rejected");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [retry]);

  const effectiveExpertIds = [...new Set([...selectedExpertIds, ...teams.filter((team) => selectedExpertTeamIds.includes(team.id)).flatMap((team) => team.memberIds)])];
  const toggleExpert = (expertId: number) => {
    const desired = effectiveExpertIds.includes(expertId) ? effectiveExpertIds.filter((id) => id !== expertId) : [...effectiveExpertIds, expertId];
    selectedExpertTeamIds.forEach((id) => onToggleExpertTeam(id));
    [...new Set([...selectedExpertIds, ...desired])].filter((id) => selectedExpertIds.includes(id) !== desired.includes(id)).forEach((id) => onToggleExpert(id));
  };
  const boundCount = selectedToolIds.length + selectedDataSourceIds.length + selectedMcpIds.length + effectiveExpertIds.length;
  const readyDataSources = useMemo(() => dataSources.filter((source) => source.selectable), [dataSources]);
  const dataSourceStatusLabel = (source: WorkspaceDataSource) => {
    if (source.healthStatus === "available") return "实测可用";
    if (source.healthStatus === "degraded") return "部分可用";
    if (source.healthStatus === "unavailable") return "上次检测不可用";
    return "已配置 · 未检测";
  };

  const toggleSection = (key: SectionKey) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const inlineChoices = {
    skills: { items: skills.map((item) => ({ id: item.id, name: item.name, description: item.description })), ids: selectedSkillIds, toggle: onToggleSkill },
    experts: { items: experts.map((item) => ({ id: String(item.id), name: item.name, description: `${item.style} · ${item.description}`, badge: item.builtIn ? "平台预置" : "自定义" })), ids: effectiveExpertIds.map(String), toggle: (id: string) => toggleExpert(Number(id)) },
    tools: { items: tools.map((item) => ({ id: item.id, name: item.name, description: item.description })), ids: selectedToolIds, toggle: onToggleTool },
    mcp: { items: mcpConnections.map((item) => ({ id: item.id, name: item.name, description: `${item.transport} · ${item.location}`, badge: "已连接" })), ids: selectedMcpIds, toggle: onToggleMcp },
    data: { items: readyDataSources.map((item) => ({ id: item.sourceId, name: item.name, description: item.description, badge: dataSourceStatusLabel(item) })), ids: selectedDataSourceIds, toggle: onToggleDataSource },
  };

  return (
    <aside className={cn(inline ? "w-full min-w-0" : "flex h-full w-[19rem] shrink-0 flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card", className)} aria-label={`本次${scopeLabel}能力`}>
      {!inline && <>
      <div className="border-b border-border/70 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">本次{scopeLabel}能力</h2>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-text">
              由工作区注册表提供，按任务最小化挂载。
            </p>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-text hover:bg-hover hover:text-foreground" aria-label={`关闭${scopeLabel}能力`}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-border bg-border text-[11px]">
          <div className="bg-background px-3 py-2">
            <span className="block text-muted-text">Skill 已选择</span>
            <span className="mt-0.5 block font-semibold text-foreground">{selectedSkillIds.length} 项</span>
          </div>
          <div className="bg-background px-3 py-2">
            <span className="block text-muted-text">能力已绑定</span>
            <span className="mt-0.5 block font-semibold text-foreground">{boundCount} 项</span>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-muted-text">目标权限模型</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="主 Agent 目标权限模型">
          {["READ", "COMPUTE", "PROPOSE"].map((permission) => (
            <span key={permission} className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-text">{permission}</span>
          ))}
        </div>
      </div>
      </>}
      {inline && <p className="mb-3 text-sm leading-6 text-secondary-text">{showSkills ? "Skill 决定研究方法，专家提供独立观点。最多选择 3 个 Skill。" : "研究方法由上方策略统一确定；这里选择独立评审的专家，以及补充证据所需的工具。"}</p>}
      {inline && loading && <p role="status" className="mb-3 text-sm text-muted-text">正在读取 Agent 能力目录…</p>}
      <div className={inline ? "grid min-w-0 items-start gap-x-4 sm:grid-cols-2" : "min-h-0 flex-1 overflow-y-auto px-2 py-2"}>
        {(inline ? ["skills", "experts", "tools", "mcp", "data"] as SectionKey[] : Object.keys(sectionMeta) as SectionKey[]).filter((key) => (showSkills || key !== "skills") && (showExperts || key !== "experts")).map((key) => {
          const { title, icon: Icon } = sectionMeta[key];
          const open = openSections.has(key);
          const count = key === "skills" ? skills.length : key === "tools" ? tools.length : key === "mcp" ? mcpConnections.length : key === "data" ? readyDataSources.length : key === "experts" ? experts.length : 0;
          if (inline) {
            const choices = inlineChoices[key];
            return <div key={key} className="py-2">
              <ChoiceList label={title} multiple limit={key === "skills" ? 3 : undefined} items={choices.items} selectedIds={choices.ids} onSelect={choices.toggle} loading={key !== "skills" && loading} disabled={key !== "skills" && loadFailed} placeholder="未选择 · 按需添加" emptyText={`暂无可用${title}`} />
              {key === "mcp" && !loading && !loadFailed && !choices.items.length && <Link to="/capabilities/mcp" className="mt-1 inline-block text-xs text-primary hover:underline">配置 MCP 连接</Link>}
              {key === "tools" && !loading && !loadFailed && !choices.items.length && <Link to="/capabilities/tools" className="mt-1 inline-block text-xs text-primary hover:underline">配置工具白名单</Link>}
            </div>;
          }
          return (
            <section key={key} className="border-b border-border/60 last:border-b-0">
              <button type="button" onClick={() => toggleSection(key)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-2 py-3 text-left">
                <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Icon className="h-3.5 w-3.5 text-secondary-text" aria-hidden="true" />
                  {title}
                  <span className="font-normal text-muted-text">{count}</span>
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-text transition-transform", open && "rotate-180")} aria-hidden="true" />
              </button>

              {open ? (
                <div className={cn("pb-3", inline ? "grid gap-2 sm:grid-cols-2" : "space-y-1")}>
                  {key === "skills" ? (
                    skills.length ? skills.map((skill) => (
                      <CapabilityButton
                        comfortable={inline}
                        key={skill.id}
                        active={selectedSkillIds.includes(skill.id)}
                        disabled={!selectedSkillIds.includes(skill.id) && skillLimitReached}
                        title={skill.name}
                        description={skill.description}
                        statusLabel="已接通"
                        onClick={() => onToggleSkill(skill.id)}
                      />
                    )) : <p className="px-3 py-2 text-[11px] leading-4 text-muted-text">暂无可用 Skill。</p>
                  ) : null}

                  {key === "tools" ? (
                    tools.length ? tools.map((tool) => (
                        <CapabilityButton
                        comfortable={inline}
                          key={tool.id}
                          active={selectedToolIds.includes(tool.id)}
                          title={tool.name}
                          description={tool.description}
                          statusLabel="已接通"
                          onClick={() => onToggleTool(tool.id)}
                        />
                      )) : <div className="px-3 py-2 text-[11px] leading-4 text-muted-text"><p>工作区没有启用金融内置工具。</p><Link to="/capabilities/tools" className="mt-2 inline-flex font-medium text-primary hover:underline">配置工具白名单</Link></div>
                  ) : null}

                  {key === "mcp" ? (
                    mcpConnections.length ? mcpConnections.map((connection) => (
                      <CapabilityButton
                        comfortable={inline}
                        key={connection.id}
                        active={selectedMcpIds.includes(connection.id)}
                        title={connection.name}
                        description={`${connection.transport} · ${connection.location}`}
                        statusLabel="已连接"
                        onClick={() => onToggleMcp(connection.id)}
                      />
                    )) : <div className="px-3 py-2 text-[11px] leading-4 text-muted-text"><p>还没有启用的 MCP 连接。</p><Link to="/capabilities/mcp" className="mt-2 inline-flex font-medium text-primary hover:underline">打开 MCP 配置</Link></div>
                  ) : null}

                  {key === "data" ? (
                    loading ? <p className="px-3 py-2 text-[11px] text-muted-text">正在读取数据源…</p> : readyDataSources.length ? readyDataSources.slice(0, 8).map((source) => (
                      <CapabilityButton
                        comfortable={inline}
                        key={source.sourceId}
                        active={selectedDataSourceIds.includes(source.sourceId)}
                        title={source.name}
                        description={source.description}
                        statusLabel={dataSourceStatusLabel(source)}
                        onClick={() => onToggleDataSource(source.sourceId)}
                      />
                    )) : <p className="px-3 py-2 text-[11px] leading-4 text-muted-text">暂无可绑定的数据源。</p>
                  ) : null}

                  {key === "experts" ? (
                    experts.map((expert) => (
                      <CapabilityButton
                        comfortable={inline}
                        key={expert.id}
                        active={effectiveExpertIds.includes(expert.id)}
                        title={expert.name}
                        description={`${expert.style} · ${expert.description}`}
                        statusLabel={expert.builtIn ? "平台预置" : "自定义 Prompt"}
                        onClick={() => toggleExpert(expert.id)}
                      />
                    ))
                  ) : null}
                  {key === "experts" && !loading && !loadFailed && experts.length === 0 && <p className="px-3 py-2 text-sm text-muted-text">暂无启用的专家。</p>}

                </div>
              ) : null}
            </section>
          );
        })}

        {loadFailed ? <div role="alert" className="my-3 text-sm text-warning sm:col-span-2">能力目录读取失败。<button type="button" className="ml-2 underline" onClick={() => { setLoading(true); setLoadFailed(false); setRetry((value) => value + 1); }}>重试读取</button></div> : null}
      </div>

      <div className="border-t border-border/70 px-4 py-3">
        <p className="text-[10px] leading-4 text-muted-text">所选能力会随会话或任务提交；运行记录会冻结能力清单与数据快照。</p>
      </div>
    </aside>
  );
}
