import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import TradingWorkspacePage from "../TradingWorkspacePage";

const ScheduleDestination = () => {
  const location = useLocation();
  return <pre data-testid="schedule-navigation-state">{JSON.stringify(location.state)}</pre>;
};

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  runTask: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

vi.mock("../../components/agent/AgentCapabilityPanel", () => ({
  default: ({ onToggleExpert, className, skills, selectedExpertIds }: { onToggleExpert: (id: number) => void; className?: string; skills: unknown[]; selectedExpertIds: number[] }) => (
    <aside aria-label="本次任务能力" className={className}>
      <span>{`skills:${skills.length}`}</span><span>{`experts:${selectedExpertIds.length}`}</span>
      <button type="button" onClick={() => onToggleExpert(-1001)}>选择巴菲特专家</button>
    </aside>
  ),
}));

describe("TradingWorkspacePage", () => {
  let task: ReturnType<typeof workspaceTaskFixture> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    task = null;
    api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
    api.listTasks.mockImplementation(async () => task ? [task] : []);
    api.createTask.mockImplementation(async (value: Partial<ReturnType<typeof workspaceTaskFixture>>) => {
      task = workspaceTaskFixture({ ...value, id: "trading-task", kind: "trading" });
      return task;
    });
    api.updateTask.mockImplementation(async (_id: string, value: Partial<ReturnType<typeof workspaceTaskFixture>>) => {
      task = workspaceTaskFixture({ ...task, ...value, id: "trading-task", kind: "trading", version: 2 });
      return task;
    });
    api.runTask.mockImplementation(async () => workspaceRunFixture(task!, {
      kind: "trading",
      status: "completed",
      resultSummary: { artifactTypes: ["TradeProposal", "RiskAssessment", "PaperTradingRun"] },
      artifacts: [{ id: "proposal", type: "TradeProposal", title: "模拟交易提案", content: { actions: [] }, version: 1, createdAt: "2026-09-02T01:00:00Z" }],
    }));
    api.cancelRun.mockResolvedValue({ accepted: true });
  });

  const fillStrategy = () => {
    fireEvent.change(screen.getByRole("textbox", { name: "策略名称" }), { target: { value: "高质量趋势跟踪" } });
    fireEvent.change(screen.getByRole("textbox", { name: "交易逻辑" }), { target: { value: "从高质量候选池中寻找趋势确认的公司" } });
    fireEvent.click(screen.getByRole("button", { name: "选择巴菲特专家" }));
  };

  it("saves a trading task and starts an honest backend paper run", async () => {
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    await screen.findByText("skills:2");
    const startButton = screen.getByRole("button", { name: "启动模拟运行" });
    expect(startButton).toBeDisabled();
    fillStrategy();
    fireEvent.click(startButton);

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: "trading",
      config: expect.objectContaining({ executionMode: "paper" }),
    })));
    expect(api.runTask).toHaveBeenCalledWith("trading-task");
    expect(await screen.findByText("本次模拟运行已完成")).toBeInTheDocument();
    expect(screen.getByText(/真实订单始终禁用/)).toBeInTheDocument();
  });

  it("restores the latest backend strategy instead of a browser draft", async () => {
    task = workspaceTaskFixture({
      id: "trading-task",
      kind: "trading",
      name: "港股防御策略",
      market: "HK",
      objective: "关注现金流稳定且波动较低的公司",
      capabilities: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [-1001], expertTeamIds: [] },
      config: { executionMode: "paper", cadence: "15m", evaluationWindow: "30d", riskPolicy: {} },
    });
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);

    expect(await screen.findByRole("textbox", { name: "策略名称" })).toHaveValue("港股防御策略");
    expect(screen.getByRole("button", { name: "港股香港模拟市场" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("experts:1")).toBeInTheDocument();
  });

  it("saves the task before handing its durable id to the central scheduler", async () => {
    render(
      <MemoryRouter initialEntries={["/trading"]}>
        <Routes>
          <Route path="/trading" element={<TradingWorkspacePage />} />
          <Route path="/schedules" element={<ScheduleDestination />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("skills:2");
    fillStrategy();
    fireEvent.click(screen.getByRole("button", { name: "创建定时计划" }));

    await waitFor(() => expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"strategyRef":"trading-task"'));
    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"expertIds":[-1001]');
    expect(api.createTask).toHaveBeenCalled();
  });
});
