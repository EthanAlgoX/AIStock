import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResearchReportsWorkspace from "../ResearchReportsWorkspace";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import { workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import type { WorkspaceRun } from "../../api/workspace";

const api = vi.hoisted(() => ({ listRuns: vi.fn(), getRun: vi.fn() }));
vi.mock("../../components/agent/DefaultTaskLauncher", () => ({ default: () => null }));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));
vi.mock("../AgentTaskSetupPage", () => ({ default: ({ onRunStarted }: { onRunStarted: (run: WorkspaceRun) => void }) => <div>市场与股票配置<button onClick={() => onRunStarted(workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { id: "new" }))}>提交测试分析</button></div> }));

const run = (id: string, name: string) => workspaceRunFixture(workspaceTaskFixture({ kind: "research", name, subject: { stock: id } }), {
  id, artifacts: [{ id: `report-${id}`, title: `${name}报告`, type: "ResearchReport", content: {}, text: `## ${name}结论\n\n**风险可控但仍需核验**`, version: 1, createdAt: "2026-09-06T00:00:00Z" }],
});

describe("report-first research workspace", () => {
  beforeEach(() => { vi.resetAllMocks(); useWorkspaceRunStore.setState({ runs: {} }); });

  it("opens the canonical formal report from an old task link and groups history without deleting it", async () => {
    const original = { ...run("old", "比亚迪 个股分析"), primaryReportRunId: "formal" };
    const formal = { ...run("formal", "正式单股研究"), relatedRunIds: ["old"], reportTitle: "比亚迪 个股研究", triggerType: "agent_tool" };
    api.listRuns.mockResolvedValue([formal, original]);
    api.getRun.mockImplementation(async (id: string) => id === "formal" ? formal : original);
    render(<MemoryRouter initialEntries={["/?run=old"]}><ResearchReportsWorkspace mode="research" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "正式单股研究结论" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /平安银行.*成果待核实/ }));
    expect(await screen.findByRole("heading", { name: "平安银行结论" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索历史报告" }), { target: { value: "000001" } });
    expect(screen.queryByRole("button", { name: /贵州茅台.*成果待核实/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建个股研究" }));
    expect(screen.getByText("市场与股票配置")).toBeInTheDocument();
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
    expect(screen.getByText("尚无历史分析。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建策略选股" })).toHaveAttribute("aria-expanded", "false");
  });
});
