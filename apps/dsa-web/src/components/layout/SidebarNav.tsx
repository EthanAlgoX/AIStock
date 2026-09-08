import React, { useState } from "react";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  Gauge,
  History,
  LogOut,
  Settings2,
  Newspaper,
  Wallet,
  Bell,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import type { UiTextKey } from "../../i18n/uiText";
import { cn } from "../../utils/cn";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { UiLanguageToggle } from "../i18n/UiLanguageToggle";
import { ThemeToggle } from "../theme/ThemeToggle";

type SidebarNavProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
  variant?: "default" | "rail";
};

type NavItem = {
  key: string;
  labelKey: UiTextKey;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "automation" | "applications" | "governance";
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: "scheduledTasks",
    labelKey: "layout.nav.scheduledTasks",
    to: "/schedules",
    icon: CalendarClock,
    group: "automation",
  },
  {
    key: "market",
    labelKey: "layout.nav.marketIntelligence",
    to: "/market-intelligence",
    icon: Newspaper,
    group: "automation",
  },
  { key: "portfolio", labelKey: "layout.nav.portfolio", to: "/portfolio", icon: Wallet, group: "automation" },
  { key: "alerts", labelKey: "layout.nav.alerts", to: "/alerts", icon: Bell, group: "automation" },
  {
    key: "capabilities",
    labelKey: "layout.nav.capabilities",
    to: "/capabilities",
    icon: Boxes,
    group: "applications",
  },
  {
    key: "runs",
    labelKey: "layout.nav.runs",
    to: "/runs",
    icon: History,
    group: "governance",
  },
  {
    key: "usage",
    labelKey: "layout.nav.usage",
    to: "/usage",
    icon: Gauge,
    group: "governance",
  },
  {
    key: "settings",
    labelKey: "layout.nav.settings",
    to: "/settings",
    icon: Settings2,
    group: "governance",
  },
];

const GROUP_LABELS: Record<NavItem["group"], UiTextKey> = {
  automation: "layout.navGroup.automation",
  applications: "layout.navGroup.assets",
  governance: "layout.navGroup.governance",
};

export const SidebarNav: React.FC<SidebarNavProps> = ({
  collapsed = false,
  onNavigate,
  variant = "default",
}) => {
  const { authEnabled, logout } = useAuth();
  const { t, localize } = useUiLanguage();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const navItems = NAV_ITEMS;
  const isRail = variant === "rail";
  const itemBaseClass = cn(
    "group relative flex h-11 w-full items-center overflow-hidden rounded-[10px] border border-transparent text-[13px] leading-none text-secondary-text transition-colors duration-150",
    isRail
      ? "justify-center gap-2.5 px-2"
      : collapsed
        ? "justify-center px-0"
        : "gap-3 px-3",
  );
  const itemInteractiveClass = cn(
    itemBaseClass,
    "hover:bg-hover/70 hover:text-foreground",
  );
  const itemActiveClass =
    "border-primary/20 bg-primary/10 font-medium text-primary before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-r before:bg-primary";
  const itemIconClass = cn(
    isRail ? "h-[18px] w-[18px]" : "h-5 w-5",
    "shrink-0",
  );
  const itemLabelClass = cn("truncate", isRail ? "text-center" : "");

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex items-center",
          isRail ? "mb-5 justify-center gap-2 pt-1" : "mb-5 gap-2.5 px-1 py-1",
          collapsed || isRail ? "justify-center" : "",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center border border-primary/25 bg-primary text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.16)]",
            isRail ? "h-9 w-9 rounded-[10px]" : "h-9 w-9 rounded-[10px]",
          )}
        >
          <BarChart3 className={cn(isRail ? "h-[19px] w-[19px]" : "h-5 w-5")} />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p
              className={cn(
                "truncate font-semibold tracking-[-0.01em] text-foreground",
                isRail ? "text-[0.9rem] leading-none" : "text-[15px]",
              )}
            >
              {localize("投研团", "InvestCrew")}
            </p>
            {isRail ? (
              <p className="mt-1 truncate text-[10px] text-muted-text">
                research · validate · act
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <nav
        className={cn("flex flex-col gap-1.5", isRail ? "" : "flex-1")}
        aria-label={t("layout.mainNav")}
      >
        {navItems.map(
          ({ key, labelKey, to, icon: Icon, group, exact }, index) => {
            const label = t(labelKey);
            const startsGroup =
              index === 0 || group !== navItems[index - 1]?.group;
            const shouldDivide =
              index > 0 && group !== navItems[index - 1]?.group;
            return (
              <div
                key={key}
                className={cn(
                  shouldDivide ? "mt-3 border-t border-border/65 pt-3" : "",
                )}
              >
                {startsGroup && !collapsed ? (
                  <p
                    className={cn(
                      "mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text",
                      isRail ? "px-2 text-center" : "px-3",
                    )}
                  >
                    {t(GROUP_LABELS[group])}
                  </p>
                ) : null}
                <NavLink
                  to={to}
                  end={exact}
                  onClick={onNavigate}
                  aria-label={label}
                  className={({ isActive }) =>
                    cn(itemInteractiveClass, isActive ? itemActiveClass : "")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          itemIconClass,
                          isActive
                            ? "text-[var(--nav-icon-active)]"
                            : "text-current",
                        )}
                      />
                      {!collapsed ? (
                        <span className={itemLabelClass}>{label}</span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </div>
            );
          },
        )}

        <ThemeToggle
          variant={isRail ? "rail" : "nav"}
          collapsed={collapsed}
          wrapperClassName="w-full"
          triggerClassName={itemInteractiveClass}
          triggerActiveClassName={itemActiveClass}
          iconClassName={itemIconClass}
          labelClassName={itemLabelClass}
        />
        <UiLanguageToggle
          variant={isRail ? "rail" : "nav"}
          collapsed={collapsed}
          wrapperClassName="w-full"
          triggerClassName={itemInteractiveClass}
          triggerActiveClassName={itemActiveClass}
          iconClassName={itemIconClass}
          labelClassName={itemLabelClass}
        />
      </nav>

      {authEnabled ? (
        <button
          type="button"
          aria-label={t("layout.logout")}
          onClick={() => setShowLogoutConfirm(true)}
          className={cn(itemInteractiveClass, isRail ? "mt-1.5" : "mt-5")}
        >
          <LogOut className={itemIconClass} />
          {!collapsed ? (
            <span className={itemLabelClass}>{t("layout.logout")}</span>
          ) : null}
        </button>
      ) : null}

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title={t("layout.logoutTitle")}
        message={t("layout.logoutMessage")}
        confirmText={t("layout.logoutConfirm")}
        cancelText={t("common.cancel")}
        isDanger
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onNavigate?.();
          void logout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
};
