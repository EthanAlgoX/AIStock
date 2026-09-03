import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceScheduleFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import ScheduledTasksPage from "../ScheduledTasksPage";

const api = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  createSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

vi.mock("../../hooks/useStockIndex", () => ({
  useStockIndex: () => ({
    index: [
      { canonicalCode: "600519.SH", displayCode: "600519", nameZh: "贵州茅台", aliases: ["茅台"], market: "CN", assetType: "stock", active: true },
      { canonicalCode: "00700.HK", displayCode: "00700", nameZh: "腾讯控股", aliases: ["腾讯"], market: "HK", assetType: "stock", active: true },
    ],
    loading: false,
    error: null,
    fallback: false,
    loaded: true,
  }),
}));

const renderPage = (entry: string | { pathname: string; search?: string; state?: unknown } = "/schedules") => render(
  <MemoryRouter initialEntries={[entry]}><ScheduledTasksPage /></MemoryRouter>,
);

describe("ScheduledTasksPage", () => {
  let tasks: ReturnType<typeof workspaceTaskFixture>[];
  let schedules: ReturnType<typeof workspaceScheduleFixture>[];

  beforeEach(() => {
    vi.clearAllMocks();
    tasks = [];
    schedules = [];
    api.listTasks.mockImplementation(async (kind?: string) => tasks.filter((task) => !kind || task.kind === kind));
    api.listSchedules.mockImplementation(async () => schedules);
    api.createTask.mockImplementation(async (value: Partial<ReturnType<typeof workspaceTaskFixture>>) => {
      const task = workspaceTaskFixture({ ...value, id: `task-${tasks.length + 1}` });
      tasks.push(task);
      return task;
    });
    api.createSchedule.mockImplementation(async (value: Partial<ReturnType<typeof workspaceScheduleFixture>>) => {
      const schedule = workspaceScheduleFixture({ ...value, id: `schedule-${schedules.length + 1}` });
      schedules.push(schedule);
      return schedule;
    });
    api.deleteSchedule.mockImplementation(async (id: string) => {
      schedules = schedules.filter((schedule) => schedule.id !== id);
    });
  });

  it("registers a daily stock research task and schedule in the backend", async () => {
    renderPage();
    expect(await screen.findByText("还没有运行计划")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "计划名称" }), { target: { value: "每日茅台复盘" } });
    fireEvent.change(screen.getByRole("textbox", { name: "股票" }), { target: { value: "600519" } });
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    fireEvent.click(screen.getByRole("button", { name: "注册定时计划" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: "research",
      subject: { stock: "600519.SH", stockName: "贵州茅台" },
    })));
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleMode: "daily" }));
    expect(await screen.findByText("每日茅台复盘")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已注册");
  });

  it("supports interval scheduling only for an existing trading task", async () => {
    const trading = workspaceTaskFixture({ id: "trading-1", kind: "trading", name: "高质量趋势跟踪" });
    tasks.push(trading);
    renderPage();
    await screen.findByText("还没有运行计划");
    fireEvent.click(screen.getByRole("radio", { name: /交易策略/ }));
    expect(screen.getByRole("heading", { name: "PaperTradingRun + TradeProposal" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "计划名称" }), { target: { value: "趋势策略巡检" } });
    fireEvent.change(screen.getByRole("combobox", { name: "交易策略" }), { target: { value: "trading-1" } });
    fireEvent.click(screen.getByRole("radio", { name: "按间隔运行" }));
    fireEvent.change(screen.getByRole("combobox", { name: "运行频率" }), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "注册定时计划" }));

    await waitFor(() => expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "trading-1",
      intervalMinutes: 60,
    })));
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("prefills the central scheduler from a screening workspace context", async () => {
    renderPage({ pathname: "/schedules", search: "?type=screening", state: { schedulePrefill: {
      sourceLabel: "选股", kind: "screening", name: "港股每日选股", market: "HK", objective: "高股息低估值", industry: "金融", candidateCount: "10",
      capabilities: { skillIds: ["quality"], toolIds: [], mcpIds: [], dataSourceIds: ["market"], expertIds: [], expertTeamIds: [] },
    } } });
    await screen.findByText("已从选股带入当前配置");
    expect(screen.getByRole("radio", { name: /选股/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "选股目标" })).toHaveValue("高股息低估值");
    expect(screen.getByText("Skill 1 · 工具 0 · MCP 0 · 数据源 1 · 专家 0")).toBeInTheDocument();
  });

  it("validates the task-specific target before registration", async () => {
    renderPage();
    await screen.findByText("还没有运行计划");
    fireEvent.change(screen.getByRole("textbox", { name: "计划名称" }), { target: { value: "缺少股票" } });
    fireEvent.click(screen.getByRole("button", { name: "注册定时计划" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请从股票目录选择需要定时分析的股票");
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("restores and deletes backend schedules", async () => {
    const task = workspaceTaskFixture({ id: "research-1", kind: "research", name: "每日腾讯复盘", market: "HK", subject: { stock: "00700.HK", stockName: "腾讯控股" } });
    tasks.push(task);
    schedules.push(workspaceScheduleFixture({ taskId: task.id, name: task.name }));
    renderPage();
    expect(await screen.findByText("每日腾讯复盘")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除计划 每日腾讯复盘" }));
    await waitFor(() => expect(api.deleteSchedule).toHaveBeenCalledWith("schedule-1"));
    expect(screen.getByText("还没有运行计划")).toBeInTheDocument();
  });
});
