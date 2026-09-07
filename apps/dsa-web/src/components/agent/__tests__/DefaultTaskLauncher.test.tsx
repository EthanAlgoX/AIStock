import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DefaultTaskLauncher from "../DefaultTaskLauncher";
import ResearchReportsWorkspace from "../../../pages/ResearchReportsWorkspace";
import { EMPTY_RUN_STATE, useWorkspaceRunStore } from "../../../stores/workspaceRunStore";
import { workspaceRunFixture, workspaceTaskFixture } from "../../../testWorkspaceFixtures";
import type { DefaultTaskPlan } from "../../../api/workspace";

const api = vi.hoisted(() => ({ getDefaultTaskPlan: vi.fn(), createTask: vi.fn(), runTask: vi.fn(), listRuns: vi.fn(), getRun: vi.fn() }));
vi.mock("../../../api/workspace", () => ({ workspaceApi: api }));

const makePlan = (kind: "research" | "screening" | "trading", stock = "688981.SH"): DefaultTaskPlan => ({
  policyVersion: "starter-v1", strategyName: "成长质量", skillNames: ["成长质量"], teamName: "创新与价值辩论组", expertCount: 4,
  reasons: ["成长板块审查现金流与估值"], warnings: [], notice: "使用真实模型，可能产生费用",
  task: { kind, name: "默认试用", market: "CN", objective: "研究证据与风险", subject: { stock }, config: { defaultPolicyVersion: "starter-v1" }, capabilities: { skillIds: [], toolIds: [], dataSourceIds: [], mcpIds: [], expertIds: [], expertTeamIds: [-2002] } },
});

describe("default task entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    useWorkspaceRunStore.setState({ runs: {} });
    api.listRuns.mockResolvedValue([]);
    api.getDefaultTaskPlan.mockImplementation(async (kind) => makePlan(kind));
    api.createTask.mockImplementation(async (payload) => workspaceTaskFixture(payload));
    api.runTask.mockImplementation(async () => workspaceRunFixture(workspaceTaskFixture(api.createTask.mock.calls[0][0]), { status: "completed" }));
  });

  it.each(["research", "screening", "trading"] as const)("starts %s from its homepage without opening or filling a form", async (kind) => {
    render(<MemoryRouter><ResearchReportsWorkspace mode={kind} /></MemoryRouter>);
    const button = screen.getByRole("button", { name: "运行默认方案" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(api.createTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId("research-task-workspace")).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.runTask).toHaveBeenCalledTimes(1));
    expect(api.createTask).toHaveBeenCalledExactlyOnceWith(makePlan(kind).task);
  });

  it("does not apply a late plan for a previous stock", async () => {
    useWorkspaceRunStore.setState({ runs: { research: { ...EMPTY_RUN_STATE, restoring: false } } });
    let resolveOld!: (plan: DefaultTaskPlan) => void;
    api.getDefaultTaskPlan.mockImplementation((_kind, _market, stock) => stock === "600519.SH" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(makePlan("research", stock)));
    const { rerender } = render(<DefaultTaskLauncher kind="research" market="CN" stock="600519.SH" />);
    rerender(<DefaultTaskLauncher kind="research" market="CN" stock="688981.SH" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "运行默认方案" })).toBeEnabled());
    await act(async () => resolveOld(makePlan("research", "600519.SH")));
    fireEvent.click(screen.getByRole("button", { name: "运行默认方案" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ subject: { stock: "688981.SH" } })));
  });

  it("shows missing prerequisites and retries without creating a task", async () => {
    useWorkspaceRunStore.setState({ runs: { research: { ...EMPTY_RUN_STATE, restoring: false } } });
    api.getDefaultTaskPlan.mockRejectedValueOnce({ response: { data: { detail: { message: "默认工具未启用" } } } });
    render(<DefaultTaskLauncher kind="research" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("默认工具未启用");
    expect(screen.getByRole("button", { name: "运行默认方案" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试默认方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "运行默认方案" })).toBeEnabled());
    expect(api.createTask).not.toHaveBeenCalled();
  });
});
