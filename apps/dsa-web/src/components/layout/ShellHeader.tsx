import type React from "react";
import { useEffect } from "react";
import { BarChart3, Menu } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useAuth } from "../../contexts/AuthContext";
import { Tooltip } from "../common/Tooltip";
import { UiLanguageToggle } from "../i18n/UiLanguageToggle";
import { ThemeToggle } from "../theme/ThemeToggle";
import { WorkspaceNavLink } from "./SidebarNav";
import { WORKSPACE_NAV_ITEMS } from "./workspaceNavigation";

export const ShellHeader: React.FC<{ onOpenMenu: () => void }> = ({ onOpenMenu }) => {
  const location = useLocation();
  const { role } = useAuth();
  const { t, localize } = useUiLanguage();
  const current = WORKSPACE_NAV_ITEMS.find(item =>
    location.pathname === item.to || location.pathname.startsWith(item.to + "/"));
  const pageTitle = role === "member" && location.pathname === "/settings"
    ? localize("我的账户", "My account") : current ? t(current.labelKey) : "AI Stock";
  useEffect(() => { document.title = pageTitle + " - AI Stock"; }, [pageTitle]);

  return (
    <header className="workspace-command-bar">
      <NavLink to="/overview" className="workspace-brand" aria-label="AI Stock">
        <span className="workspace-brand-mark"><BarChart3 className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <span className="hidden font-semibold tracking-[-0.02em] lg:block">AI Stock</span>
      </NavLink>
      <div className="min-w-0 flex-1 border-l border-border pl-3 lg:pl-5">
        <p className="truncate text-sm font-semibold text-foreground">{pageTitle}</p>
        <p className="hidden text-xs text-secondary-text sm:block">
          {localize("研究、验证与跟踪", "Research, validate and track")}
        </p>
      </div>
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
