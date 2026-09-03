import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import ExpertReviewPage from "../ExpertReviewPage";

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

vi.mock("../../components/agent/AgentCapabilityPanel", () => ({
  default: ({ selectedSkillIds }: { selectedSkillIds: string[] }) => (
    <aside aria-label="本次会话能力">Agent 工具 {selectedSkillIds.length}</aside>
  ),
}));

describe("ExpertReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
    const task = workspaceTaskFixture({ id: "review-task", kind: "expert_review", market: "GLOBAL" });
    const run = workspaceRunFixture(task, {
      id: "review-run",
      kind: "expert_review",
      dataSnapshotId: "snapshot-review",
      resultSummary: { artifactTypes: ["ExpertReview"] },
      artifacts: [{ id: "artifact-1", type: "ExpertReview", title: "专家评审", content: {}, text: "结论仍需核验。", version: 1, createdAt: "2026-09-02T01:01:00Z" }],
    });
    api.createTask.mockResolvedValue(task);
    api.runTask.mockResolvedValue(run);
    api.getRun.mockResolvedValue(run);
  });

  it("runs a single expert as a durable task and shows only returned evidence", async () => {
    render(<MemoryRouter><ExpertReviewPage /></MemoryRouter>);

    expect(await screen.findByRole("button", { name: /沃伦·巴菲特/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByPlaceholderText(/请基于最新可得财务/), {
      target: { value: "分析腾讯的长期竞争优势" },
    });
    fireEvent.click(screen.getByRole("button", { name: "运行专家单聊" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: "expert_review",
      capabilities: expect.objectContaining({ expertIds: [-1001] }),
    })));
    expect(await screen.findByText("结论仍需核验。")).toBeInTheDocument();
    expect(screen.queryByText(/建议买入|看多结论/)).not.toBeInTheDocument();
  });

  it("lets users choose any group members before starting a staged debate", async () => {
    render(<MemoryRouter><ExpertReviewPage /></MemoryRouter>);
    await screen.findByRole("button", { name: /沃伦·巴菲特/ });
    fireEvent.click(screen.getByRole("button", { name: "专家群聊" }));
    expect(screen.getByText(/当前已选 3 位/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^凯西·伍德/ }));
    expect(screen.getByText(/当前已选 4 位/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^沃伦·巴菲特/ }));
    expect(screen.getByText(/当前已选 3 位/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/请基于最新可得财务/), {
      target: { value: "讨论一家创新公司的估值与增长假设" },
    });
    fireEvent.click(screen.getByRole("button", { name: "运行群聊评审" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    const payload = api.createTask.mock.calls[0][0];
    expect(payload.capabilities.expertIds).toEqual([-1002, -1003, -1004]);
    expect(screen.getByText("公共数据快照")).toBeInTheDocument();
    expect(screen.getByText("独立观点")).toBeInTheDocument();
    expect(screen.getByText("交叉质疑")).toBeInTheDocument();
    expect(screen.getByText("主 Agent 汇总")).toBeInTheDocument();
    const participantList = screen.getByText("参会视角 · 3").closest("aside");
    expect(participantList).not.toBeNull();
    expect(within(participantList!).queryByText("沃伦·巴菲特")).not.toBeInTheDocument();
    expect(within(participantList!).getByText("凯西·伍德")).toBeInTheDocument();
  });
});
