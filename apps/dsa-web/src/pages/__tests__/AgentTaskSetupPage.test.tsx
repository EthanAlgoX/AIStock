import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import AgentTaskSetupPage from "../AgentTaskSetupPage";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";

const ScheduleDestination = () => {
  const location = useLocation();
  return <pre data-testid="schedule-navigation-state">{JSON.stringify(location.state)}</pre>;
};

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  getRun: vi.fn(),
  listRuns: vi.fn(),
  listStrategies: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock("../../components/agent/DefaultTaskLauncher", () => ({ default: () => null }));

vi.mock("../../api/workspace", () => ({
  workspaceApi: api,
}));
vi.mock("../../api/strategyWorkspace", () => ({ strategyWorkspaceApi: { listStrategies: api.listStrategies, getVersion: api.getVersion } }));

vi.mock("../../hooks/useStockIndex", () => ({
  useStockIndex: () => ({
    index: [
      { canonicalCode: "600519.SH", displayCode: "600519", nameZh: "贵州茅台", market: "CN", assetType: "stock", active: true, popularity: 10 },
      { canonicalCode: "00700.HK", displayCode: "00700", nameZh: "腾讯控股", market: "HK", assetType: "stock", active: true, popularity: 9 },
      { canonicalCode: "AAPL", displayCode: "AAPL", nameZh: "苹果", market: "US", assetType: "stock", active: true, popularity: 8 },
    ],
    loading: false,
    error: null,
    fallback: false,
    loaded: true,
  }),
}));

vi.mock("../../components/agent/AgentCapabilityPanel", async () => ({
  ...await vi.importActual("../../components/agent/AgentCapabilityPanel"),
  default: ({ scopeLabel, className }: { scopeLabel: string; className?: string }) => <aside aria-label={`本次${scopeLabel}能力`} className={className} />,
}));

const chooseStrategy = (label: string, value: string) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(screen.getAllByRole("radio").find((item) => (item as HTMLInputElement).value === value)!);
};

describe("AgentTaskSetupPage", () => {
  it("binds candidate research budget and the research tool to the submitted screening task", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "比较成长质量" } });
    fireEvent.change(screen.getByRole("combobox", { name: "候选深研数量" }), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "候选深研策略" })).toHaveValue("12"));
    fireEvent.click(screen.getByRole("button", { name: "运行选股任务" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ strategyVersionId: 13, deepResearchCount: 2, deepResearchVersionId: 12 }),
      capabilities: expect.objectContaining({ toolIds: expect.arrayContaining(["run_stock_screening", "run_stock_research"]) }),
    })));
  });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useWorkspaceRunStore.setState({ runs: {} });
    api.listRuns.mockResolvedValue([]);
    api.listStrategies.mockResolvedValue([
      { id: 1, name: "单股研究 · A股配置", productRole: "configured", currentPublishedVersionId: 12, currentPublishedVersionNumber: 1, kernelExecutionStatus: "ready", currentStrategyPurpose: "research_report" },
      { id: 2, name: "选股 · A股配置", productRole: "configured", currentPublishedVersionId: 13, currentPublishedVersionNumber: 1, kernelExecutionStatus: "ready", currentStrategyPurpose: "candidate_screening" },
    ]);
    api.getVersion.mockResolvedValue({ screeningPolicy: { market: "cn" } });
    api.getCapabilities.mockResolvedValue({
      ...workspaceCatalogFixture,
      skills: [{ ...workspaceCatalogFixture.skills[0], name: "质量分析" }],
    });
    const task = workspaceTaskFixture({
      id: "task-research",
      kind: "research",
      subject: { stock: "600519.SH", stockName: "贵州茅台" },
      capabilities: { skillIds: ["quality"], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
    });
    const run = workspaceRunFixture(task, {
      artifacts: [{ id: "artifact-1", type: "ResearchReport", title: "贵州茅台研究报告", content: { conclusion: "继续跟踪" }, text: "继续跟踪", version: 1, createdAt: "2026-09-02T01:01:00Z" }],
    });
    api.createTask.mockResolvedValue(task);
    api.runTask.mockResolvedValue(run);
    api.getRun.mockResolvedValue(run);
  });

  it("configures market, stock, task capabilities, and a research run preview", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "个股研究" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "向投研助理描述任务" })).not.toBeInTheDocument();
    const runButton = await screen.findByRole("button", { name: "运行单股分析" });
    expect(runButton).toBeDisabled();

    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("12"));
    chooseStrategy("研究策略", "custom");
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(await screen.findByText("任务 运行结束 · 成果待核实")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "贵州茅台研究报告" })).toBeInTheDocument();
  });

  it("binds the published workflow and its execution capability to the task", async () => {
    api.listStrategies.mockResolvedValue([{ id: 1, name: "单股研究 · A股配置", productRole: "configured", currentPublishedVersionId: 12, currentPublishedVersionNumber: 1, kernelExecutionStatus: "ready", currentStrategyPurpose: "research_report" }]);
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("12"));
    expect(screen.getByRole("button", { name: /研究策略/ })).toHaveValue("12");
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    fireEvent.click(screen.getByRole("button", { name: "运行单股分析" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      config: { strategyVersionId: 12 },
      capabilities: expect.objectContaining({ toolIds: expect.arrayContaining(["run_stock_research"]) }),
    })));
  });

  it("blocks unsupported markets before creating a screening task", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "策略选股" })).toBeInTheDocument();
    const runButton = await screen.findByRole("button", { name: "运行选股任务" });
    expect(runButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /港股/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "高股息低估值" } });
    fireEvent.change(screen.getByRole("textbox", { name: "行业范围（可选）" }), { target: { value: "金融" } });
    await screen.findByText(/当前市场尚无已发布的选股流程/);
    expect(runButton).toBeDisabled();
    fireEvent.click(runButton);

    expect(api.createTask).not.toHaveBeenCalled();
  });

  it.each(["custom", "preset"])("hands %s strategy bindings to the central scheduler", async (selection) => {
    render(
      <MemoryRouter initialEntries={["/stock-research"]}>
        <Routes>
          <Route path="/stock-research" element={<AgentTaskSetupPage mode="research" />} />
          <Route path="/schedules" element={<ScheduleDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("12"));
    chooseStrategy("研究策略", "custom");
    if (selection === "preset") chooseStrategy("研究策略", "12");
    await waitFor(() => expect(screen.getByRole("button", { name: "定时分析" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "定时分析" }));

    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"stock":"600519.SH"');
    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent(selection === "custom" ? '"skillIds":["quality"]' : '"skillIds":[]');
  });

  it("hands screening conditions to the central scheduler", async () => {
    render(
      <MemoryRouter initialEntries={["/screening"]}>
        <Routes>
          <Route path="/screening" element={<AgentTaskSetupPage mode="screening" />} />
          <Route path="/schedules" element={<ScheduleDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "高股息低估值" } });
    fireEvent.change(screen.getByRole("textbox", { name: "行业范围（可选）" }), { target: { value: "金融" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "定时更新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "定时更新" }));

    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"objective":"高股息低估值"');
    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"industry":"金融"');
  });

  it("restores a research workspace after returning from the scheduler", () => {
    const first = render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "关注问题（可选）" }), { target: { value: "关注盈利质量" } });
    fireEvent.click(screen.getByRole("button", { name: "定时分析" }));
    first.unmount();

    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    expect(screen.getByText("已选择")).toBeInTheDocument();
    expect(screen.getByText("600519.SH")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "关注问题（可选）" })).toHaveValue("关注盈利质量");
  });

  it("restores a screening workspace after returning from the scheduler", () => {
    const first = render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /港股/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "高股息低估值" } });
    fireEvent.change(screen.getByRole("textbox", { name: "行业范围（可选）" }), { target: { value: "金融" } });
    fireEvent.click(screen.getByRole("button", { name: "定时更新" }));
    first.unmount();

    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /港股/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "选股条件" })).toHaveValue("高股息低估值");
    expect(screen.getByRole("textbox", { name: "行业范围（可选）" })).toHaveValue("金融");
  });

  it("shows preset contents instead of a second Skill selector", async () => {
    api.getVersion.mockResolvedValue({ screeningPolicy: { market: "cn" }, decisionPolicy: { packageParameters: { skills: ["growth_quality"] } } });
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    expect(await screen.findByText("包含 Skill：growth_quality")).toBeVisible();
    expect(screen.queryByRole("group", { name: "组合策略 Skill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "高级能力配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits preset skills through the version without leaking hidden custom selections", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("12"));
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    chooseStrategy("研究策略", "custom");
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    expect(await screen.findByRole("checkbox", { name: /^质量分析/ })).toBeChecked();
    chooseStrategy("研究策略", "12");
    expect(screen.queryByRole("group", { name: "组合策略 Skill" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "运行单股分析" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      config: { strategyVersionId: 12 }, capabilities: expect.objectContaining({ skillIds: [] }),
    })));
  });

  it("restores custom choices and blocks an empty custom combination", async () => {
    const first = render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("12"));
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    chooseStrategy("研究策略", "custom");
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /^质量分析/ }));
    expect(screen.getByRole("button", { name: "运行单股分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "定时分析" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /^质量分析/ }));
    first.unmount();
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "研究策略" })).toHaveValue("custom"));
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    expect(screen.getByRole("checkbox", { name: /^质量分析/ })).toBeChecked();
  });

  it("separates screening rules from optional custom candidate research", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "筛选策略" })).toHaveValue("13"));
    expect(screen.queryByRole("button", { name: "候选深研策略" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "候选深研数量" }), { target: { value: "1" } });
    chooseStrategy("候选深研策略", "custom");
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    expect(await screen.findByRole("checkbox", { name: /^质量分析/ })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "寻找成长公司" } });
    fireEvent.click(screen.getByRole("button", { name: "运行选股任务" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ strategyVersionId: 13, deepResearchVersionId: 12, deepResearchCount: 1 }),
      capabilities: expect.objectContaining({ skillIds: ["quality"] }),
    })));
  });

  it.each(["research", "screening"] as const)("keeps %s running when switching pages during submission", async (kind) => {
    const task = workspaceTaskFixture({ kind, objective: "检查长期盈利质量", subject: { stock: "600519.SH", stockName: "贵州茅台" } });
    const run = workspaceRunFixture(task, { id: `pending-${kind}`, status: "running", completedAt: null });
    let resolve!: (value: typeof run) => void;
    api.createTask.mockResolvedValue(task);
    api.runTask.mockImplementation(() => new Promise<typeof run>((done) => { resolve = done; }));
    api.getRun.mockResolvedValue(run);
    render(<MemoryRouter initialEntries={[`/${kind}`]}>
      <Link to="/research">切到个股</Link><Link to="/screening">切到选股</Link>
      <Routes>
        <Route path="/research" element={<AgentTaskSetupPage key="research" mode="research" />} />
        <Route path="/screening" element={<AgentTaskSetupPage key="screening" mode="screening" />} />
      </Routes>
    </MemoryRouter>);
    const button = await screen.findByRole("button", { name: kind === "research" ? "运行单股分析" : "运行选股任务" });
    if (kind === "research") fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    else fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: task.objective } });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.runTask).toHaveBeenCalledTimes(1));
    const away = kind === "research" ? "切到选股" : "切到个股";
    const back = kind === "research" ? "切到个股" : "切到选股";
    fireEvent.click(screen.getByRole("link", { name: away }));
    expect(screen.queryByText("正在创建任务")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: back }));
    expect(screen.getByRole("button", { name: "正在提交…" })).toBeDisabled();
    await act(async () => { resolve(run); });
    expect(await screen.findByText("任务 运行中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看本次运行详情" })).toHaveAttribute("href", `/runs/${run.id}`);
    fireEvent.click(screen.getByRole("link", { name: away }));
    api.getRun.mockResolvedValue({ ...run, status: "completed", artifacts: [{ id: "result", type: "ResearchReport", title: "切页后的报告", content: { conclusion: "已保存" }, version: 1, createdAt: run.createdAt }] });
    fireEvent.click(screen.getByRole("link", { name: back }));
    expect(await screen.findByText("任务 运行结束 · 成果待核实")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "切页后的报告" })).toBeInTheDocument();
    expect(api.runTask).toHaveBeenCalledTimes(1);
  });

  it("keeps an edited next-task draft without changing the restored run summary", async () => {
    const task = workspaceTaskFixture({ kind: "screening", name: "原选股任务", objective: "原条件" });
    const run = workspaceRunFixture(task);
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    const first = render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    await screen.findByText("任务 运行结束 · 成果待核实");
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "下一次要用的新条件" } });
    first.unmount();
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);
    expect(screen.getByRole("textbox", { name: "选股条件" })).toHaveValue("下一次要用的新条件");
    expect(screen.getByText(/原选股任务/)).toBeInTheDocument();
  });

  it("does not navigate back when a submission finishes after leaving the configuration page", async () => {
    const onRunStarted = vi.fn();
    const run = workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { status: "running" });
    let resolve!: (value: typeof run) => void;
    api.runTask.mockImplementation(() => new Promise<typeof run>((done) => { resolve = done; }));
    const view = render(<MemoryRouter><AgentTaskSetupPage mode="research" onRunStarted={onRunStarted} /></MemoryRouter>);
    const button = await screen.findByRole("button", { name: "运行单股分析" });
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.runTask).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { resolve(run); });
    expect(onRunStarted).not.toHaveBeenCalled();
    expect(useWorkspaceRunStore.getState().runs.research?.run?.id).toBe(run.id);
  });
});
