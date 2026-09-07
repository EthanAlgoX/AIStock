import type React from "react";
import { useState } from "react";
import { Outlet } from "react-router-dom";

import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { Drawer } from "../common/Drawer";
import { MobilePrimaryNav, ShellHeader } from "./ShellHeader";
import { SidebarNav } from "./SidebarNav";

type ShellProps = {
  children?: React.ReactNode;
};

export const Shell: React.FC<ShellProps> = ({ children }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { localize } = useUiLanguage();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#workspace-content" className="skip-to-content">{localize("跳至主要内容", "Skip to content")}</a>
      <ShellHeader onOpenMenu={() => setMenuOpen(true)} />

      <main id="workspace-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 touch-pan-y pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children ?? <Outlet />}
      </main>

      <MobilePrimaryNav />

      <Drawer
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={localize("工作区与设置", "Workspace and settings")}
        width="max-w-sm"
        zIndex={90}
        side="right"
      >
        <SidebarNav onNavigate={() => setMenuOpen(false)} />
      </Drawer>
    </div>
  );
};
