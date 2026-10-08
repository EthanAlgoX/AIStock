import type React from "react";
import { useEffect } from "react";
import { BarChart3, Menu } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useAuth } from "../../contexts/AuthContext";
import { Tooltip } from "../common/Tooltip";
import { UiLanguageToggle } from "../i18n/UiLanguageToggle";
import { ThemeToggle } from "../theme/ThemeToggle";
import { WorkspaceNavLink } from "./SidebarNav";
import { WORKSPACE_NAV_ITEMS } from "./workspaceNavigation";
import { WORKSPACE_MODULES, workspaceModuleForPath, type NavItem } from "./workspaceNavigation";
import { useAgentChatStore } from "../../stores/agentChatStore";
import { StatusDot } from "../common/StatusDot";
import { cn } from "../../utils/cn";

const tradingSections = [
  { to: "/trading", zh: "模拟总览", en: "Simulation overview", view: "overview" },
  { to: "/trading?view=manage", zh: "策略管理", en: "Strategy management", view: "manage" },
  { to: "/trading?view=source", zh: "来源策略研究", en: "Source research", view: "source" },
  { to: "/trading?view=reports", zh: "历史研究提案", en: "Research proposals", view: "reports" },
];

// Task pages already share TaskCenterNav; keep one navigation strip per scope.
// eslint-disable-next-line react-refresh/only-export-components
export function workspaceSections(pathname: string): NavItem[] {
  const module = workspaceModuleForPath(pathname);
  if (!module || module.key === "tasks") return [];
  if (module.key === "trading") return WORKSPACE_NAV_ITEMS.filter(item => item.key === "trading");
  const items = WORKSPACE_NAV_ITEMS.filter(item => module.items.includes(item.key));
  if (module.key === "assets") return [
    { ...items[0], exact: true },
    { ...items[0], key: "ledger", to: "/portfolio/ledger", labelKey: "layout.module.ledger" },
    ...items.slice(1),
  ];
  return items.length > 1 ? items : [];
}

export function WorkspaceSectionNav() {
  const location = useLocation();
  const { localize } = useUiLanguage();
  const sections = workspaceSections(location.pathname);
  if (!sections.length) return null;
  const params = new URLSearchParams(location.search);
  const trading = sections[0].key === "trading";
  const view = params.get("view") === "reports" || params.has("sourceRun") || params.has("run")
    ? "reports" : params.get("view") === "source" ? "source"
      : params.get("view") === "manage" || params.has("portfolio") || params.has("strategy") ? "manage" : "overview";
  return <nav className="workspace-section-nav" aria-label={localize("模块页面", "Module pages")}>
    {trading ? tradingSections.map(item => <Link key={item.view} to={item.to}
      aria-current={view === item.view ? "page" : undefined}
      className={cn("workspace-section-link", view === item.view && "is-active")}>
      {localize(item.zh, item.en)}
    </Link>) : sections.map(item => <WorkspaceNavLink key={item.key} item={item} section />)}
  </nav>;
}

export const ShellHeader: React.FC<{ onOpenMenu: () => void }> = ({ onOpenMenu }) => {
  const location = useLocation();
  const { role } = useAuth();
  const { t, localize } = useUiLanguage();
  const module = workspaceModuleForPath(location.pathname);
  const completionBadge = useAgentChatStore(state => state.completionBadge);
  const current = WORKSPACE_NAV_ITEMS.find(item =>
    location.pathname === item.to || location.pathname.startsWith(item.to + "/"));
  const pageTitle = role === "member" && location.pathname === "/settings"
    ? localize("我的账户", "My account") : current ? t(current.labelKey) : "AI Stock";
  useEffect(() => { document.title = pageTitle + " - AI Stock"; }, [pageTitle]);

  return (
    <header className="workspace-command-bar">
      <NavLink to="/overview" className="workspace-brand" aria-label="AI Stock">
        <span className="workspace-brand-mark"><BarChart3 className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <span className="font-semibold tracking-[-0.02em]">AI Stock</span>
      </NavLink>
      <div className="min-w-0 flex-1 truncate pl-2 lg:hidden">
        <p className="truncate text-sm font-semibold text-foreground">{pageTitle}</p>
      </div>
      <nav className="workspace-module-nav" aria-label={t("layout.mainNav")}>
        {WORKSPACE_MODULES.map(item => <Link key={item.key} to={item.to}
          className={cn("workspace-module-link", item.key === module?.key && "is-active")}
          aria-label={t(item.labelKey)}
          aria-current={item.key === module?.key ? "page" : undefined}>
          {t(item.labelKey)}
          {item.key === "research" && completionBadge ? <StatusDot tone="info" data-testid="module-chat-completion-badge" aria-label={t("layout.newChatMessage")} /> : null}
        </Link>)}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ThemeToggle wrapperClassName="shrink-0"
          triggerClassName="workspace-toolbar-button" iconClassName="h-4 w-4" />
        <UiLanguageToggle wrapperClassName="workspace-language"
          triggerClassName="workspace-toolbar-button" iconClassName="h-4 w-4" />
        <Tooltip content={localize("工作区与设置", "Workspace and settings")} side="bottom">
          <button type="button" onClick={onOpenMenu} className="workspace-toolbar-button !w-11 !px-0"
            aria-label={localize("打开工作区与设置", "Open workspace and settings")}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
};

export function MobilePrimaryNav() {
  const { localize } = useUiLanguage();
  const keys = ["agent", "expert-review", "research", "screening", "trading"];
  return (
    <nav className="mobile-workspace-nav lg:hidden" aria-label={localize("移动端主导航", "Mobile primary navigation")}>
      {WORKSPACE_NAV_ITEMS.filter(item => keys.includes(item.key)).map(item => (
        <WorkspaceNavLink key={item.key} item={item} mobile />
      ))}
    </nav>
  );
}
