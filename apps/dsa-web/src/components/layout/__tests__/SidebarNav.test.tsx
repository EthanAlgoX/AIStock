import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SidebarNav } from "../SidebarNav";

const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    authEnabled: true,
    logout: mockLogout,
  }),
}));

describe("SidebarNav", () => {
  it("exposes all business workspaces through three consistent navigation groups", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "/market-intelligence",
      "/overview",
      "/expert-review",
      "/stock-research",
      "/screening",
      "/trading",
      "/portfolio",
      "/alerts",
      "/runs",
      "/schedules",
      "/capabilities",
      "/usage",
      "/settings",
    ]);
    expect(screen.getByRole("region", { name: "研究与发现" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "策略与持仓" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "任务与设置" })).toBeInTheDocument();
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

    const capabilityLink = screen.getByRole("link", { name: "能力中心" });
    expect(capabilityLink).toHaveAttribute("href", "/capabilities");
    expect(capabilityLink).toHaveAttribute("aria-current", "page");
  });

  it("retains named and active navigation when labels are collapsed", () => {
    render(
      <MemoryRouter initialEntries={["/portfolio/ledger"]}>
        <SidebarNav collapsed />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link")).toHaveLength(13);
    expect(screen.getByRole("link", { name: "持仓管理" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "持仓管理" })).toHaveTextContent("");
    expect(screen.queryByText("研究与发现")).not.toBeInTheDocument();
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
