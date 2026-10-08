import type React from "react";
import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { Drawer } from "../common/Drawer";
import { MobilePrimaryNav, ShellHeader, WorkspaceSectionNav, workspaceSections } from "./ShellHeader";
import { SidebarNav } from "./SidebarNav";

type ShellProps = {
  children?: React.ReactNode;
};

export const Shell: React.FC<ShellProps> = ({ children }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { localize } = useUiLanguage();
  const location = useLocation();
  const hasSections = workspaceSections(location.pathname).length > 0;

  return (
    <div className={hasSections ? "app-shell has-section-nav" : "app-shell"}>
      <a href="#workspace-content" className="skip-to-content">{localize("跳至主要内容", "Skip to content")}</a>
      <ShellHeader onOpenMenu={() => setMenuOpen(true)} />
      <WorkspaceSectionNav />

      <div className="app-shell-body">
        <main id="workspace-content" tabIndex={-1} className="app-main">
          {children ?? <Outlet />}
        </main>
      </div>

      <MobilePrimaryNav />

      <Drawer
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={localize("工作区与设置", "Workspace and settings")}
        width="max-w-sm"
        zIndex={90}
        side="right"
      >
        <SidebarNav onNavigate={() => setMenuOpen(false)} navigationLabel={localize("工作区导航", "Workspace navigation")} />
      </Drawer>
    </div>
  );
};
