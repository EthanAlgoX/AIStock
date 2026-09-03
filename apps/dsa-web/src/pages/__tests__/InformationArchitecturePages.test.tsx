import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceScheduleFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import CapabilityOverviewPage from "../CapabilityOverviewPage";
import TaskRunsPage from "../TaskRunsPage";

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  listRuns: vi.fn(),
  listSchedules: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

describe("information architecture pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
    api.listRuns.mockResolvedValue([]);
    api.listSchedules.mockResolvedValue([]);
  });

  it("separates the workspace capability registry from task-level mounting", async () => {
    render(<MemoryRouter><CapabilityOverviewPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "能力中心" })).toBeInTheDocument();
    expect(screen.getByText("工作区可用")).toBeInTheDocument();
    expect(screen.getByText("本次任务使用")).toBeInTheDocument();
    expect(await screen.findByText("已接入能力网关")).toBeInTheDocument();
    expect(screen.getByText("注册、发现与调用已接入")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /MCP 服务/ }).some((link) => link.getAttribute("href") === "/capabilities/mcp")).toBe(true);
  });

  it("reads schedules, runs, snapshots, and Artifact counts from the backend ledger", async () => {
    const task = workspaceTaskFixture({ name: "每日高质量选股", kind: "screening" });
    api.listRuns.mockResolvedValue([workspaceRunFixture(task, {
      resultSummary: { artifactTypes: ["ScreenSpec", "CandidateList"] },
    })]);
    api.listSchedules.mockResolvedValue([workspaceScheduleFixture({ name: "每日高质量选股" })]);

    render(<MemoryRouter><TaskRunsPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "任务与运行" })).toBeInTheDocument();
    expect(await screen.findByText("每日高质量选股")).toBeInTheDocument();
    expect(screen.getByText("后端持久化调度")).toBeInTheDocument();
    expect(screen.getByText("Artifact 合同计数")).toBeInTheDocument();
    expect(screen.getByText(/Snapshot snapshot/)).toBeInTheDocument();
  });
});
