import type React from "react";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useAgentChatStore } from "../../stores/agentChatStore";
import { cn } from "../../utils/cn";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { StatusDot } from "../common/StatusDot";

import { WORKSPACE_MODULES, WORKSPACE_NAV_ITEMS, type NavItem } from "./workspaceNavigation";

export function WorkspaceNavLink({
  item, mobile = false, collapsed = false, section = false, onNavigate,
}: { item: NavItem; mobile?: boolean; collapsed?: boolean; section?: boolean; onNavigate?: () => void }) {
  const { t, localize } = useUiLanguage();
  const { role } = useAuth();
  const completionBadge = useAgentChatStore(state => state.completionBadge);
  const label = item.key === "settings" && role === "member"
    ? localize("我的账户", "My account") : t(item.labelKey);
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.exact} onClick={onNavigate} aria-label={label}
      className={({ isActive }) => cn(
        mobile ? "mobile-workspace-link" : section ? "workspace-section-link" : "workspace-nav-link",
        isActive && "is-active", collapsed && "justify-center",
      )}>
      <span className="relative inline-flex shrink-0">
        <Icon className={mobile ? "h-5 w-5" : "h-[18px] w-[18px]"} aria-hidden="true" />
        {item.key === "agent" && completionBadge ? (
          <StatusDot tone="info" data-testid={mobile ? "mobile-chat-completion-badge" : "chat-completion-badge"}
            className="absolute -right-1.5 -top-1.5 border-2 border-card" aria-label={t("layout.newChatMessage")} />
        ) : null}
      </span>
      {!collapsed ? <span className="min-w-0">{label}</span> : null}
    </NavLink>
  );
}

type SidebarNavProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
  variant?: "default" | "rail";
  navigationLabel?: string;
};

export const SidebarNav: React.FC<SidebarNavProps> = ({
  collapsed = false, onNavigate, navigationLabel,
}) => {
  const { authEnabled, logout } = useAuth();
  const { t } = useUiLanguage();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="workspace-navigation">
      <nav className="workspace-navigation-links" aria-label={navigationLabel || t("layout.mainNav")}>
        {WORKSPACE_MODULES.map(module => (
          <section key={module.key} className="workspace-nav-group" aria-label={t(module.labelKey)}>
            {!collapsed && module.items.length > 1 ? <p className="workspace-nav-group-label">{t(module.labelKey)}</p> : null}
            {WORKSPACE_NAV_ITEMS.filter(item => module.items.includes(item.key)).map(item => (
              <WorkspaceNavLink key={item.key} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </section>
        ))}
      </nav>
      {authEnabled ? (
        <div className="workspace-navigation-footer">
          <button type="button" aria-label={t("layout.logout")} onClick={() => setShowLogoutConfirm(true)} className="workspace-nav-link w-full">
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            {!collapsed ? <span>{t("layout.logout")}</span> : null}
          </button>
        </div>
      ) : null}
      <ConfirmDialog isOpen={showLogoutConfirm} title={t("layout.logoutTitle")}
        message={t("layout.logoutMessage")} confirmText={t("layout.logoutConfirm")} cancelText={t("common.cancel")} isDanger
        onConfirm={() => { setShowLogoutConfirm(false); onNavigate?.(); void logout(); }}
        onCancel={() => setShowLogoutConfirm(false)} />
    </div>
  );
};
