import { Bot, Boxes, Database, PlugZap, Sparkles, Wrench } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "../../utils/cn";

const items = [
  { to: "/capabilities", label: "总览", icon: Boxes, end: true },
  { to: "/capabilities/skills", label: "Skill", icon: Sparkles, end: false },
  { to: "/capabilities/tools", label: "内置工具", icon: Wrench, end: false },
  { to: "/capabilities/mcp", label: "MCP 服务", icon: PlugZap, end: false },
  { to: "/capabilities/data", label: "数据源", icon: Database, end: false },
  { to: "/capabilities/experts", label: "专家配置", icon: Bot, end: false },
];

export function CapabilityCenterNav() {
  return (
    <div>
      <nav aria-label="Agent 能力页面" className="flex gap-1 overflow-x-auto border-b border-border/70">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive ? "border-primary text-foreground" : "border-transparent text-secondary-text hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <p className="mt-2 text-[11px] text-muted-text sm:hidden">横向滑动可查看数据源和专家配置</p>
    </div>
  );
}
