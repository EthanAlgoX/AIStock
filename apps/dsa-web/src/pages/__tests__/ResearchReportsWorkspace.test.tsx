import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResearchReportsWorkspace from "../ResearchReportsWorkspace";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import { workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import type { WorkspaceRun } from "../../api/workspace";
import { UiLanguageProvider, useUiLanguage } from "../../contexts/UiLanguageContext";

function LanguageSwitch() {
  const { setLanguage } = useUiLanguage();
  return <><button onClick={() => setLanguage("en")}>English</button><button onClick={() => setLanguage("zh")}>Chinese</button></>;
}

const api = vi.hoisted(() => ({ listRuns: vi.fn(), getRun: vi.fn(), runHistory: vi.fn(), loadStockIndex: vi.fn() }));
vi.mock("../../components/agent/DefaultTaskLauncher", () => ({ default: () => null }));
vi.mock("../../utils/stockIndexLoader", () => ({ loadStockIndex: api.loadStockIndex }));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));
vi.mock("../AgentTaskSetupPage", () => ({ default: ({ onRunStarted }: { onRunStarted: (run: WorkspaceRun) => void }) => <div>市场与股票配置<button onClick={() => onRunStarted(workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { id: "new" }))}>提交测试分析</button></div> }));
vi.mock("../TradingTaskSetupPage", () => ({ default: () => <div>交易策略配置内容</div> }));

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="当前链接">{location.search}</output>;
}

const run = (id: string, name: string) => workspaceRunFixture(workspaceTaskFixture({ kind: "research", name, subject: { stock: id } }), {
  id, artifacts: [{ id: `report-${id}`, title: `${name}报告`, type: "ResearchReport", content: {}, text: `## ${name}结论\n\n**风险可控但仍需核验**`, version: 1, createdAt: "2026-09-06T00:00:00Z" }],
});

describe("report-first research workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem("dsa.uiLanguage", "zh");
    useWorkspaceRunStore.setState({ runs: {} });
    api.runHistory.mockResolvedValue({ items: [], total: 0 });
    api.loadStockIndex.mockResolvedValue({ loaded: true, fallback: false, data: [] });
  });

  it("keeps failed research errors visible without opening provenance", async () => {
    const failed = { ...run("failed", "失败研究"), status: "failed" as const, artifacts: [], errorMessage: "行情服务超时，请重新运行" };
    api.listRuns.mockResolvedValue([failed]);
    api.getRun.mockResolvedValue(failed);
    render(<MemoryRouter><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("行情服务超时，请重新运行");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("alert").closest("details")).toHaveAttribute("open");
  });

  it.each(["research", "screening", "trading"] as const)("updates %s report controls immediately and preserves language after remount", async (mode) => {
    localStorage.setItem("dsa.uiLanguage", "zh");
    api.listRuns.mockResolvedValue([]);
    const view = render(<UiLanguageProvider><MemoryRouter><LanguageSwitch /><ResearchReportsWorkspace mode={mode} /></MemoryRouter></UiLanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    await screen.findByText(mode === "trading" ? "尚无模拟运行记录。" : "尚无历史分析。");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
    const title = mode === "research" ? "Stock research" : mode === "screening" ? "Strategy screening" : "Trade simulation";
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    view.unmount();
    render(<UiLanguageProvider><MemoryRouter><LanguageSwitch /><ResearchReportsWorkspace mode={mode} /></MemoryRouter></UiLanguageProvider>);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chinese" }));
    expect(screen.getByRole("heading", { name: mode === "research" ? "个股研究" : mode === "screening" ? "策略选股" : "交易推演" })).toBeInTheDocument();
    localStorage.setItem("dsa.uiLanguage", 'zh');
  });

  it("opens the canonical formal report from an old task link and groups history without deleting it", async () => {
    const original = { ...run("old", "比亚迪 个股分析"), primaryReportRunId: "formal" };
    const formal = { ...run("formal", "正式单股研究"), relatedRunIds: ["old"], reportTitle: "比亚迪 个股研究", triggerType: "agent_tool" };
    api.listRuns.mockResolvedValue([formal, original]);
    api.getRun.mockImplementation(async (id: string) => id === "formal" ? formal : original);
    render(<MemoryRouter initialEntries={["/?run=old"]}><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "正式单股研究结论" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    expect(screen.queryByRole("button", { name: /^比亚迪 个股分析/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "比亚迪 个股分析结论" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索历史报告" }), { target: { value: "比亚迪" } });
    expect(screen.getByRole("button", { name: /^比亚迪 个股研究/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("相关任务与 Agent 解读 · 1 条"));
    expect(screen.getByRole("link", { name: /查看 比亚迪 个股分析/ })).toHaveAttribute("href", "/runs/old");
  });

  it("opens on the detailed report, keeps configuration collapsed, and lets users switch and search history", async () => {
    const first = run("600519", "贵州茅台");
    const second = run("000001", "平安银行");
    api.listRuns.mockResolvedValue([first, second]);
    api.getRun.mockImplementation(async (id: string) => id === first.id ? first : second);
    render(<MemoryRouter><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "贵州茅台结论" })).toBeInTheDocument();
    expect(screen.queryByText("市场与股票配置")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "搜索历史报告" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    fireEvent.click(screen.getByRole("button", { name: /平安银行.*成果待核实/ }));
    expect(await screen.findByRole("heading", { name: "平安银行结论" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索历史报告" }), { target: { value: "000001" } });
    expect(screen.queryByRole("button", { name: /贵州茅台.*成果待核实/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "搜索历史报告" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "新建个股研究" }));
    expect(screen.getByText("市场与股票配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起分析配置" })).toHaveClass("btn-secondary");
    expect(screen.getByRole("button", { name: "收起分析配置" })).not.toHaveClass("btn-primary");
    expect(screen.getByRole("heading", { name: "平安银行结论" })).toBeInTheDocument();
    api.getRun.mockResolvedValue(run("new", "新分析"));
    fireEvent.click(screen.getByRole("button", { name: "提交测试分析" }));
    expect(screen.queryByText("市场与股票配置")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "新分析结论" })).toBeInTheDocument();
  });

  it("ignores a delayed response for the previously selected report", async () => {
    const first = run("first", "第一份");
    const second = run("second", "第二份");
    api.listRuns.mockResolvedValue([first, second]);
    let resolve!: (value: WorkspaceRun) => void;
    api.getRun.mockImplementation((id: string) => id === "first" ? new Promise<WorkspaceRun>((done) => { resolve = done; }) : Promise.resolve(second));
    render(<MemoryRouter initialEntries={["/?run=first"]}><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    fireEvent.click(await screen.findByRole("button", { name: /第二份.*成果待核实/ }));
    expect(await screen.findByRole("heading", { name: "第二份结论" })).toBeInTheDocument();
    await act(async () => { resolve(first); });
    expect(screen.getByRole("heading", { name: "第二份结论" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "第一份结论" })).not.toBeInTheDocument();
  });

  it("provides a retry for missing report details and an honest empty state", async () => {
    api.listRuns.mockResolvedValue([]);
    api.getRun.mockRejectedValue(new Error("offline"));
    render(<MemoryRouter initialEntries={["/?run=missing"]}><ResearchReportsWorkspace mode="screening" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "重试读取报告" }));
    await waitFor(() => expect(api.getRun.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    expect(screen.getByText("尚无历史分析。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建策略选股" })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes history after selection, preserves URL context, and restores keyboard focus to the trigger", async () => {
    const first = run("first", "第一份");
    const second = run("second", "第二份");
    api.listRuns.mockResolvedValue([first, second]);
    api.getRun.mockImplementation(async (id: string) => id === first.id ? first : second);
    render(<MemoryRouter initialEntries={["/?run=first&stock=AAPL&market=US"]}><CurrentLocation /><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    await screen.findByRole("heading", { name: "第一份结论" });
    const trigger = screen.getByRole("button", { name: /历史报告/ });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "历史分析报告" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("button", { name: "关闭抽屉" })).toHaveFocus();
    fireEvent.click(within(drawer).getByRole("button", { name: /第二份.*成果待核实/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText("当前链接")).toHaveTextContent("?run=second&stock=AAPL&market=US");
    await screen.findByRole("heading", { name: "第二份结论" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭抽屉" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps a linked stock archive expanded while analysis configuration remains collapsed", async () => {
    api.listRuns.mockResolvedValue([]);
    render(<MemoryRouter initialEntries={["/?stock=AAPL&market=US"]}><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    const archive = screen.getByText("股票档案 · 研究、候选深研与专家讨论").closest("details");
    expect(archive).toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: "股票代码" })).toHaveValue("AAPL");
    expect(screen.getByRole("button", { name: "新建个股研究" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("市场与股票配置")).not.toBeInTheDocument();
    await waitFor(() => expect(api.runHistory).toHaveBeenCalledWith({ stock: "AAPL", limit: 10 }));
  });

  it.each([
    { mode: "research" as const, search: "sourceSession=assistant", content: "市场与股票配置", button: "收起分析配置" },
    { mode: "screening" as const, search: "sourceSession=assistant", content: "市场与股票配置", button: "收起分析配置" },
    { mode: "trading" as const, search: "sourceRun=screening-run", content: "交易策略配置内容", button: "收起策略配置" },
  ])("keeps $mode source links opening their task configuration", async ({ mode, search, content, button }) => {
    api.listRuns.mockResolvedValue([]);
    render(<MemoryRouter initialEntries={[`/?${search}`]}><ResearchReportsWorkspace mode={mode} /></MemoryRouter>);
    expect(screen.getByText(content)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: button })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledWith(mode));
  });

  it("shows a failed directory read with a retry while history is collapsed and recovers without a false empty history", async () => {
    const first = run("first", "第一份");
    api.listRuns.mockRejectedValue(new Error("offline"));
    api.getRun.mockResolvedValue(first);
    render(<MemoryRouter><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    expect(await screen.findByText("报告目录读取失败，请重试。")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /历史报告/ }));
    expect(screen.queryByText("尚无历史分析。")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "历史分析报告" })).getByRole("alert")).toHaveTextContent("报告目录读取失败，请重试。");
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭抽屉" }), { key: "Escape" });
    api.listRuns.mockResolvedValue([first]);
    fireEvent.click(screen.getByRole("button", { name: "刷新报告列表" }));
    expect(await screen.findByRole("heading", { name: "第一份结论" })).toBeInTheDocument();
    expect(screen.queryByText("报告目录读取失败，请重试。")).not.toBeInTheDocument();
  });
});
