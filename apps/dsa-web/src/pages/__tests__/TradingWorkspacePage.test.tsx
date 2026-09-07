import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import TradingWorkspacePage from "../TradingWorkspacePage";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";

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
  listRuns: vi.fn(),
  cancelRun: vi.fn(),
}));

vi.mock("../../components/agent/DefaultTaskLauncher", () => ({ default: () => null }));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

vi.mock("../../components/agent/AgentCapabilityPanel", async () => ({
  ...await vi.importActual("../../components/agent/AgentCapabilityPanel"),
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
    useWorkspaceRunStore.setState({ runs: {} });
    api.listRuns.mockResolvedValue([]);
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
    const completedRun = () => workspaceRunFixture(task!, {
      kind: "trading",
      status: "completed",
      resultSummary: { artifactTypes: ["TradeProposal", "RiskAssessment", "PaperTradingRun"] },
      artifacts: [{ id: "proposal", type: "TradeProposal", title: "模拟交易提案", content: { actions: [] }, version: 1, createdAt: "2026-09-02T01:00:00Z" }],
    });
    api.runTask.mockImplementation(async () => completedRun());
    api.cancelRun.mockResolvedValue({ accepted: true });
    api.getRun.mockImplementation(async () => completedRun());
  });

  const fillStrategy = () => {
    fireEvent.change(screen.getByRole("textbox", { name: "策略名称" }), { target: { value: "高质量趋势跟踪" } });
    fireEvent.change(screen.getByRole("textbox", { name: "交易逻辑" }), { target: { value: "从高质量候选池中寻找趋势确认的公司" } });
    fireEvent.click(screen.getByRole("button", { name: "选择巴菲特专家" }));
  };

  it("saves a trading task and starts an honest backend paper run", async () => {
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    expect(screen.queryByRole("textbox", { name: "策略名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));
    await screen.findByText("skills:2");
    expect(screen.getByRole("button", { name: "选择巴菲特专家" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "配置策略能力" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const startButton = screen.getByRole("button", { name: "启动模拟运行" });
    expect(startButton).toBeDisabled();
    fillStrategy();
    fireEvent.click(startButton);

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: "trading",
      config: expect.objectContaining({ executionMode: "paper" }),
    })));
    expect(api.runTask).toHaveBeenCalledWith("trading-task");
    expect(await screen.findByText("本次提案运行已结束，不代表成交")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "策略名称" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模拟交易提案" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));

    expect(await screen.findByRole("textbox", { name: "策略名称" })).toHaveValue("港股防御策略");
    expect(screen.getByRole("button", { name: "港股香港模拟市场" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("experts:1")).toBeInTheDocument();
  });

  it("restores a running simulation and does not mark it stopped before backend confirmation", async () => {
    task = workspaceTaskFixture({ kind: "trading", name: "后台模拟策略" });
    const run = workspaceRunFixture(task, { status: "running", completedAt: null });
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    api.cancelRun.mockRejectedValueOnce(new Error("offline"));
    const first = render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    expect(await screen.findByText(/主 Agent 正在生成模拟交易提案/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("停止请求未确认");
    expect(screen.queryByText("本次模拟运行已停止")).not.toBeInTheDocument();
    first.unmount();
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    expect(await screen.findByText(/主 Agent 正在生成模拟交易提案/)).toBeInTheDocument();
    expect(api.runTask).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));
    await screen.findByText("skills:2");
    fillStrategy();
    fireEvent.click(screen.getByRole("button", { name: "创建定时计划" }));

    await waitFor(() => expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"strategyRef":"trading-task"'));
    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"expertIds":[-1001]');
    expect(api.createTask).toHaveBeenCalled();
  });

  it("shows historical proposals and risk checks before loading any configuration", async () => {
    task = workspaceTaskFixture({ kind: "trading", name: "历史模拟策略" });
    const run = workspaceRunFixture(task, { id: "saved-paper", artifacts: [
      { id: "risk", type: "RiskAssessment", title: "风险", content: { contractPassed: true, proposalRiskEvaluated: false, realOrderExecutionAllowed: false }, version: 1, createdAt: task.createdAt },
      { id: "paper", type: "PaperTradingRun", title: "执行", content: { executionEnabled: false, realOrdersCreated: 0, simulatedFillsCreated: 0 }, version: 1, createdAt: task.createdAt },
    ] });
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "风险检查" })).toBeInTheDocument();
    expect(screen.getByText(/尚未确认完成提案风险评估/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模拟执行记录" })).toBeInTheDocument();
    expect(api.getCapabilities).not.toHaveBeenCalled();
    expect(api.listTasks).not.toHaveBeenCalled();
    expect(api.runTask).not.toHaveBeenCalled();
  });

  it("finishes submission in the background without navigating back after leaving", async () => {
    let resolve!: (run: ReturnType<typeof workspaceRunFixture>) => void;
    api.runTask.mockImplementation(() => new Promise<ReturnType<typeof workspaceRunFixture>>((done) => { resolve = done; }));
    const view = render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));
    await screen.findByText("skills:2");
    fillStrategy();
    fireEvent.click(screen.getByRole("button", { name: "启动模拟运行" }));
    await waitFor(() => expect(api.runTask).toHaveBeenCalledTimes(1));
    view.unmount();
    const run = workspaceRunFixture(task!, { id: "background", status: "running" });
    await act(async () => { resolve(run); });
    expect(useWorkspaceRunStore.getState().runs.trading?.run?.id).toBe("background");
    api.getRun.mockResolvedValue(run);
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    expect(await screen.findByText(/主 Agent 正在生成模拟交易提案/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "策略名称" })).not.toBeInTheDocument();
    expect(api.runTask).toHaveBeenCalledTimes(1);
  });

  it("preserves unsaved strategy inputs when collapsing configuration", async () => {
    render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));
    await screen.findByText("skills:2");
    fillStrategy();
    fireEvent.click(screen.getByRole("button", { name: "收起策略配置" }));
    expect(screen.queryByRole("textbox", { name: "策略名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建模拟运行" }));
    expect(screen.getByRole("textbox", { name: "策略名称" })).toHaveValue("高质量趋势跟踪");
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("keeps the stop target on the current run while reading another history report", async () => {
    task = workspaceTaskFixture({ kind: "trading", name: "当前模拟策略" });
    const active = workspaceRunFixture(task, { id: "active", status: "running", completedAt: null });
    const history = workspaceRunFixture({ ...task, name: "过去的模拟策略" }, { id: "history" });
    api.listRuns.mockResolvedValue([active, history]);
    api.getRun.mockImplementation(async (id: string) => id === "active" ? active : history);
    render(<MemoryRouter initialEntries={["/trading?run=history"]}><TradingWorkspacePage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "过去的模拟策略" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    await waitFor(() => expect(api.cancelRun).toHaveBeenCalledWith("active"));
    expect(api.cancelRun).not.toHaveBeenCalledWith("history");
  });
});
