import type React from "react";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  CandlestickChart,
  History,
  Menu,
  Newspaper,
  SearchCode,
  Target,
  UsersRound,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useAgentChatStore } from "../../stores/agentChatStore";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import type { UiTextKey } from "../../i18n/uiText";
import { cn } from "../../utils/cn";
import { StatusDot } from "../common/StatusDot";
import { Tooltip } from "../common/Tooltip";

type ShellHeaderProps = {
  onOpenMenu: () => void;
};

type HeaderNavItem = {
  key: string;
  labelKey: UiTextKey;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPrefix?: string;
  badge?: "completion";
};

const PRIMARY_NAV_ITEMS: HeaderNavItem[] = [
  {
    key: "agent",
    labelKey: "layout.nav.home",
    to: "/overview",
    icon: BarChart3,
    badge: "completion",
  },
  {
    key: "market",
    labelKey: "layout.nav.marketIntelligence",
    to: "/market-intelligence",
    icon: Newspaper,
  },
  {
    key: "research",
    labelKey: "layout.nav.stockResearch",
    to: "/stock-research",
    icon: SearchCode,
  },
  {
    key: "screening",
    labelKey: "layout.nav.screeningTool",
    to: "/screening",
    icon: Target,
  },
  {
    key: "trading",
    labelKey: "layout.nav.trading",
    to: "/trading",
    icon: CandlestickChart,
  },
];

const DESKTOP_UTILITY_ITEMS: HeaderNavItem[] = [
  {
    key: "expert-review",
    labelKey: "layout.nav.expertReview",
    to: "/expert-review",
    icon: UsersRound,
  },
  {
    key: "schedules",
    labelKey: "layout.nav.scheduledTasks",
    to: "/schedules",
    icon: CalendarClock,
  },
  {
    key: "runs",
    labelKey: "layout.nav.runs",
    to: "/runs",
    icon: History,
    matchPrefix: "/runs",
  },
  {
    key: "capabilities",
    labelKey: "layout.nav.capabilities",
    to: "/capabilities",
    icon: Boxes,
    matchPrefix: "/capabilities",
  },
];

const ROUTE_TITLES: Array<{ prefix: string; labelKey: UiTextKey }> = [
  { prefix: "/market-intelligence", labelKey: "layout.nav.marketIntelligence" },
  { prefix: "/stock-research", labelKey: "layout.nav.stockResearch" },
  { prefix: "/screening", labelKey: "layout.nav.screeningTool" },
  { prefix: "/trading", labelKey: "layout.nav.trading" },
  { prefix: "/expert-review", labelKey: "layout.nav.expertReview" },
  { prefix: "/schedules", labelKey: "layout.nav.scheduledTasks" },
  { prefix: "/runs", labelKey: "layout.nav.runs" },
  { prefix: "/capabilities", labelKey: "layout.nav.capabilities" },
  { prefix: "/usage", labelKey: "layout.nav.usage" },
  { prefix: "/settings", labelKey: "layout.nav.settings" },
  { prefix: "/overview", labelKey: "layout.nav.home" },
];

function itemIsActive(pathname: string, item: HeaderNavItem) {
  if (item.matchPrefix) {
    return pathname === item.to || pathname.startsWith(`${item.matchPrefix}/`);
  }
  return pathname === item.to;
}

function PrimaryNavLink({ item, mobile = false }: { item: HeaderNavItem; mobile?: boolean }) {
  const location = useLocation();
  const { t } = useUiLanguage();
  const completionBadge = useAgentChatStore((state) => state.completionBadge);
  const active = itemIsActive(location.pathname, item);
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      aria-label={t(item.labelKey)}
      className={cn(
        "group relative flex items-center justify-center text-secondary-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
        mobile
          ? "min-w-0 flex-1 flex-col gap-1 px-1 py-2 text-[10px]"
          : "h-11 gap-2 rounded-[10px] px-3 text-[13px] font-medium",
        active
          ? mobile
            ? "text-primary"
            : "bg-primary/10 text-primary"
          : "hover:bg-hover/70 hover:text-foreground",
      )}
    >
      <span className="relative inline-flex">
        <Icon className={mobile ? "h-5 w-5" : "h-[18px] w-[18px]"} aria-hidden="true" />
        {item.badge === "completion" && completionBadge ? (
          <StatusDot
            tone="info"
            data-testid={mobile ? "mobile-chat-completion-badge" : "chat-completion-badge"}
            className="absolute -right-1.5 -top-1.5 border-2 border-card"
            aria-label={t("layout.newChatMessage")}
          />
        ) : null}
      </span>
      <span className={cn("truncate", mobile ? "w-full text-center" : "")}>{t(item.labelKey)}</span>
      {mobile && active ? <span className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-primary" /> : null}
    </NavLink>
  );
}

export const ShellHeader: React.FC<ShellHeaderProps> = ({ onOpenMenu }) => {
  const location = useLocation();
  const { t, localize } = useUiLanguage();
  const currentTitle = ROUTE_TITLES.find(({ prefix }) => location.pathname.startsWith(prefix));

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-border/75 bg-card/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full items-center gap-3 px-3 lg:h-16 lg:px-4 xl:px-6">
        <NavLink
          to="/overview"
          className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
          aria-label="LLM TradeBot"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-primary/25 bg-primary text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.16)]">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="hidden text-sm font-semibold tracking-[-0.01em] text-foreground xl:block">
            LLM TradeBot
          </span>
        </NavLink>

        <div className="min-w-0 flex-1 lg:hidden">
          <p className="truncate text-sm font-semibold text-foreground">
            {currentTitle ? t(currentTitle.labelKey) : "LLM TradeBot"}
          </p>
          <p className="truncate text-[11px] text-muted-text">
            {localize("Agent 驱动的投资决策工作台", "Agent-driven investment workspace")}
          </p>
        </div>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex" aria-label={t("layout.mainNav")}>
          {PRIMARY_NAV_ITEMS.map((item) => (
            <PrimaryNavLink key={item.key} item={item} />
          ))}
        </nav>

        <nav className="hidden shrink-0 items-center gap-1 lg:flex" aria-label={localize("辅助导航", "Utility navigation")}>
          {DESKTOP_UTILITY_ITEMS.map((item) => {
            const active = itemIsActive(location.pathname, item);
            const Icon = item.icon;
            return (
              <Tooltip key={item.key} content={t(item.labelKey)} side="bottom">
                <NavLink
                  to={item.to}
                  aria-label={t(item.labelKey)}
                  className={cn(
                    "inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-secondary-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
                    active ? "bg-primary/10 text-primary" : "hover:bg-hover/70 hover:text-foreground",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </NavLink>
              </Tooltip>
            );
          })}
        </nav>

        <Tooltip content={localize("工作区与设置", "Workspace and settings")} side="bottom">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-secondary-text transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            aria-label={localize("打开工作区与设置", "Open workspace and settings")}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
};

export function MobilePrimaryNav() {
  const { localize } = useUiLanguage();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-16 border-t border-border/80 bg-card/97 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_rgba(3,8,20,0.08)] backdrop-blur-xl lg:hidden"
      aria-label={localize("移动端主导航", "Mobile primary navigation")}
    >
      {PRIMARY_NAV_ITEMS.map((item) => (
        <PrimaryNavLink key={item.key} item={item} mobile />
      ))}
    </nav>
  );
}
