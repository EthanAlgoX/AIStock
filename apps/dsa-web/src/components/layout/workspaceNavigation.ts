import type React from "react";
import { Bell, Boxes, CalendarClock, CandlestickChart, Gauge, History, MessageSquare, Newspaper, SearchCode, Settings2, Target, UsersRound, Wallet } from "lucide-react";
import type { UiTextKey } from "../../i18n/uiText";

export type NavItem = {
  key: string;
  labelKey: UiTextKey;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "research" | "validation" | "governance";
  exact?: boolean;
};

export const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { key: "market", labelKey: "layout.nav.marketIntelligence", to: "/market-intelligence", icon: Newspaper, group: "research" },
  { key: "agent", labelKey: "layout.nav.home", to: "/overview", icon: MessageSquare, group: "research", exact: true },
  { key: "expert-review", labelKey: "layout.nav.expertReview", to: "/expert-review", icon: UsersRound, group: "research" },
  { key: "research", labelKey: "layout.nav.stockResearch", to: "/stock-research", icon: SearchCode, group: "research" },
  { key: "screening", labelKey: "layout.nav.screeningTool", to: "/screening", icon: Target, group: "validation" },
  { key: "trading", labelKey: "layout.nav.trading", to: "/trading", icon: CandlestickChart, group: "validation" },
  { key: "portfolio", labelKey: "layout.nav.portfolio", to: "/portfolio", icon: Wallet, group: "validation" },
  { key: "alerts", labelKey: "layout.nav.alerts", to: "/alerts", icon: Bell, group: "validation" },
  { key: "runs", labelKey: "layout.nav.runs", to: "/runs", icon: History, group: "governance" },
  { key: "schedules", labelKey: "layout.nav.scheduledTasks", to: "/schedules", icon: CalendarClock, group: "governance" },
  { key: "capabilities", labelKey: "layout.route.capabilities.title", to: "/capabilities", icon: Boxes, group: "governance" },
  { key: "usage", labelKey: "layout.nav.usage", to: "/usage", icon: Gauge, group: "governance" },
  { key: "settings", labelKey: "layout.nav.settings", to: "/settings", icon: Settings2, group: "governance" },
];

export type WorkspaceModule = {
  key: string;
  labelKey: UiTextKey;
  to: string;
  items: string[];
};

/** Modules organize existing routes; they do not create new runtime capabilities. */
export const WORKSPACE_MODULES: WorkspaceModule[] = [
  { key: "market", labelKey: "layout.nav.marketIntelligence", to: "/market-intelligence", items: ["market"] },
  { key: "research", labelKey: "layout.module.research", to: "/overview", items: ["agent", "expert-review", "research"] },
  { key: "screening", labelKey: "layout.nav.screeningTool", to: "/screening", items: ["screening"] },
  { key: "trading", labelKey: "layout.nav.trading", to: "/trading", items: ["trading"] },
  { key: "assets", labelKey: "layout.module.assets", to: "/portfolio", items: ["portfolio", "alerts"] },
  { key: "tasks", labelKey: "layout.module.tasks", to: "/runs", items: ["runs", "schedules"] },
  { key: "workspace", labelKey: "layout.module.workspace", to: "/capabilities", items: ["capabilities", "usage", "settings"] },
];

export function workspaceModuleForPath(pathname: string) {
  const item = WORKSPACE_NAV_ITEMS.find(item => pathname === item.to || pathname.startsWith(item.to + "/"));
  return WORKSPACE_MODULES.find(module => module.items.includes(item?.key ?? ""));
}
