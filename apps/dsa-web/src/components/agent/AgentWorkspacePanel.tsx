import {
  Bot,
  Boxes,
  Database,
  FileCheck2,
  FileText,
  PlugZap,
  Sparkles,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { SkillInfo } from "../../api/agent";
import { cn } from "../../utils/cn";

type AgentWorkspacePanelProps = {
  taskTypeLabel?: string;
  artifactTypes?: string[];
  skills: SkillInfo[];
  selectedSkillIds: string[];
  selectedToolCount: number;
  selectedDataSourceCount: number;
  selectedMcpCount: number;
  selectedExpertCount: number;
  selectedExpertTeamCount: number;
  activeStockCode?: string | null;
  hasConversation: boolean;
  isRunning: boolean;
  onOpenCapabilities: () => void;
};

const capabilityRows = [
  { key: "skills", label: "Skill", icon: Sparkles, to: "/capabilities/skills" },
  { key: "tools", label: "内置工具", icon: Boxes, to: "/capabilities/tools" },
  { key: "mcp", label: "MCP 服务", icon: PlugZap, to: "/capabilities/mcp" },
  { key: "data", label: "数据源", icon: Database, to: "/capabilities/data" },
  { key: "experts", label: "专家", icon: Users, to: "/capabilities/experts" },
] as const;

export function AgentWorkspacePanel({
  taskTypeLabel = "自然语言任务",
  artifactTypes = ["ResearchReport", "CandidateList", "StrategySpec"],
  skills,
  selectedSkillIds,
  selectedToolCount,
  selectedDataSourceCount,
  selectedMcpCount,
  selectedExpertCount,
  selectedExpertTeamCount,
  activeStockCode,
  hasConversation,
  isRunning,
  onOpenCapabilities,
}: AgentWorkspacePanelProps) {
  const selectedSkillNames = skills
    .filter((skill) => selectedSkillIds.includes(skill.id))
    .map((skill) => skill.name);
  const counts = {
    skills: selectedSkillIds.length,
    tools: selectedToolCount,
    mcp: selectedMcpCount,
    data: selectedDataSourceCount,
    experts: selectedExpertCount + selectedExpertTeamCount,
  };
  const taskStatus = isRunning ? "执行中" : hasConversation ? "可继续" : "等待目标";

  return (
    <aside
      className="hidden h-full w-[19rem] shrink-0 flex-col overflow-hidden border-l border-border/80 bg-card xl:flex"
      aria-label="Agent 工作区上下文"
    >
      <div className="border-b border-border/75 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Agent 工作区</h2>
          </div>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              isRunning
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-background text-secondary-text",
            )}
          >
            {taskStatus}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-muted-text">
          当前页面只加载完成任务所需的上下文与能力。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border/70 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">当前任务</p>
          <div className="mt-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-text">任务类型</span>
              <span className="font-medium text-foreground">{taskTypeLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-text">研究对象</span>
              <span className={cn("font-mono", activeStockCode ? "text-foreground" : "text-muted-text")}>
                {activeStockCode || "由 Agent 识别"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-text">数据快照</span>
              <span className="text-muted-text">任务启动后创建</span>
            </div>
          </div>
        </section>

        <section className="border-b border-border/70 py-4">
          <div className="flex items-center justify-between gap-3 px-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">会话能力</p>
              <p className="mt-1 text-[11px] text-muted-text">选择会随本轮请求提交，并由后端能力注册表校验。</p>
            </div>
            <button
              type="button"
              onClick={onOpenCapabilities}
              className="min-h-11 shrink-0 whitespace-nowrap text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              调整
            </button>
          </div>
          <div className="mt-3 divide-y divide-border/60">
            {capabilityRows.map(({ key, label, icon: Icon, to }) => (
              <div key={key} className="flex items-center gap-3 px-5 py-2.5">
                <Icon className="h-4 w-4 shrink-0 text-secondary-text" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-xs text-foreground">{label}</span>
                <span className="font-mono text-[11px] text-muted-text">{counts[key]}</span>
                <Link className="text-[11px] text-muted-text hover:text-primary" to={to}>
                  配置
                </Link>
              </div>
            ))}
          </div>
          <p className="mx-5 mt-3 truncate text-[11px] text-secondary-text" title={selectedSkillNames.join("、")}>
            {selectedSkillNames.length ? selectedSkillNames.join("、") : "当前使用通用分析"}
          </p>
        </section>

        <section className="px-5 py-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-secondary-text" aria-hidden="true" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">任务成果</p>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted-text">
            对话用于创建成果，正式结果会作为独立对象保存。
          </p>
          <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
            {artifactTypes.map((artifact) => (
              <div key={artifact} className="flex items-center gap-2 py-2.5">
                <FileText className="h-3.5 w-3.5 text-muted-text" aria-hidden="true" />
                <span className="flex-1 font-mono text-[11px] text-secondary-text">{artifact}</span>
                <span className="text-[10px] text-muted-text">待生成</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-muted-text">
            <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            本轮绑定会冻结到 Agent 请求上下文；MCP 仅调用已登记且已发现的 HTTP 工具，专家以独立 Persona Run 执行。
          </p>
        </section>
      </div>
    </aside>
  );
}
