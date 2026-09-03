import { CalendarClock, History } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { cn } from "../../utils/cn";

const items = [
  { to: "/schedules", labelKey: "layout.nav.scheduledTasks" as const, icon: CalendarClock },
  { to: "/runs", labelKey: "layout.nav.runs" as const, icon: History },
];

export function TaskCenterNav() {
  const { t, localize } = useUiLanguage();

  return (
    <nav
      aria-label={localize("任务中心页面", "Task center pages")}
      className="flex gap-1 border-b border-border/70"
    >
      {items.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn(
            "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            isActive
              ? "border-primary text-foreground"
              : "border-transparent text-secondary-text hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
