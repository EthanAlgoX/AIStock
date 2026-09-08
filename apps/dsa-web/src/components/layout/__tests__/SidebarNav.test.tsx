import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SidebarNav } from "../SidebarNav";

const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockThemeToggle = vi.fn(({ collapsed }: { collapsed?: boolean }) => (
  <button type="button">{collapsed ? "切换主题(折叠)" : "切换主题"}</button>
));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    authEnabled: true,
    logout: mockLogout,
  }),
}));

vi.mock("../../theme/ThemeToggle", () => ({
  ThemeToggle: (props: { collapsed?: boolean }) => mockThemeToggle(props),
}));

describe("SidebarNav", () => {
  it("keeps the utility drawer focused on collaboration, capabilities and governance", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "/schedules",
      "/market-intelligence",
      "/portfolio",
      "/alerts",
      "/capabilities",
      "/runs",
      "/usage",
      "/settings",
    ]);
    expect(screen.getByText("协作与自动化")).toBeInTheDocument();
    expect(screen.getByText("能力中心")).toBeInTheDocument();
    expect(screen.getByText("治理与记录")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "主 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "MCP 服务" })).not.toBeInTheDocument();
  });

  it("uses capability center as the single global entry for capability configuration", () => {
    render(
      <MemoryRouter initialEntries={["/capabilities/data"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    const capabilityLink = screen.getByRole("link", { name: "能力总览" });
    expect(capabilityLink).toHaveAttribute("href", "/capabilities");
    expect(capabilityLink).toHaveClass("font-medium");
  });

  it("renders the collapsed theme toggle variant when requested", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav collapsed />
      </MemoryRouter>,
    );

    expect(mockThemeToggle).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "nav", collapsed: true }),
    );
  });

  it("opens the logout confirmation and confirms logout", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    expect(await screen.findByRole("heading", { name: "退出登录" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
