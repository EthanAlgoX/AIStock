import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import AgentTaskSetupPage from "../AgentTaskSetupPage";

const ScheduleDestination = () => {
  const location = useLocation();
  return <pre data-testid="schedule-navigation-state">{JSON.stringify(location.state)}</pre>;
};

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({
  workspaceApi: api,
}));

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

vi.mock("../../components/agent/AgentCapabilityPanel", () => ({
  default: ({ scopeLabel, onToggleSkill, className }: { scopeLabel: string; onToggleSkill: (id: string) => void; className?: string }) => (
    <aside aria-label={`本次${scopeLabel}能力`} className={className}>
      <button type="button" onClick={() => onToggleSkill("quality")}>选择质量分析 Skill</button>
    </aside>
  ),
}));

describe("AgentTaskSetupPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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

    expect(screen.getByRole("heading", { name: "个股分析" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "向主 Agent 描述任务" })).not.toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: "运行单股分析" });
    expect(runButton).toBeDisabled();

    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    fireEvent.click(screen.getByRole("button", { name: "选择质量分析 Skill" }));
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    expect(await screen.findByText("任务 已完成")).toBeInTheDocument();
    expect(screen.getByText("贵州茅台研究报告")).toBeInTheDocument();
  });

  it("uses market and natural-language conditions for a screening task", () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "选股" })).toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: "运行选股任务" });
    expect(runButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /港股/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "选股条件" }), { target: { value: "高股息低估值" } });
    fireEvent.change(screen.getByRole("textbox", { name: "行业范围（可选）" }), { target: { value: "金融" } });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    expect(screen.getByText(/港股 · 金融 · Top 20/)).toBeInTheDocument();
  });

  it("hands the selected stock and Agent capabilities to the central scheduler", () => {
    render(
      <MemoryRouter initialEntries={["/stock-research"]}>
        <Routes>
          <Route path="/stock-research" element={<AgentTaskSetupPage mode="research" />} />
          <Route path="/schedules" element={<ScheduleDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    fireEvent.click(screen.getByRole("button", { name: "选择质量分析 Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "定时分析" }));

    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"stock":"600519.SH"');
    expect(screen.getByTestId("schedule-navigation-state")).toHaveTextContent('"skillIds":["quality"]');
  });

  it("hands screening conditions to the central scheduler", () => {
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

  it("keeps the mobile capability drawer modal and restores trigger focus", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="screening" /></MemoryRouter>);

    const trigger = screen.getByRole("button", { name: "配置本次任务" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "配置本次任务能力" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "配置本次任务能力" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
