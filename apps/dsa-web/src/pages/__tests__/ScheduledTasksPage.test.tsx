import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceScheduleFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import ScheduledTasksPage from "../ScheduledTasksPage";

const api = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  listMarketSubscriptions: vi.fn(),
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
    api.listMarketSubscriptions.mockResolvedValue([]);
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
    api.updateSchedule.mockImplementation(async (id: string, value: Partial<ReturnType<typeof workspaceScheduleFixture>>) => {
      const schedule = schedules.find(item => item.id === id)!;
      Object.assign(schedule, value);
      return schedule;
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
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleMode: "daily", publishToMarket: true }));
    expect(await screen.findByText("每日茅台复盘")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已注册");
    expect(screen.getByRole("status")).toHaveTextContent("2026/9/3 18:30:00 (Asia/Shanghai)");
  });

  it("supports interval scheduling only for an existing trading task", async () => {
    const trading = workspaceTaskFixture({ id: "trading-1", kind: "trading", name: "高质量趋势跟踪" });
    tasks.push(trading);
    renderPage();
    await screen.findByText("还没有运行计划");
    fireEvent.click(screen.getByRole("radio", { name: /交易提案计划/ }));
    await screen.findByRole("option", { name: /高质量趋势跟踪/ });
    expect(screen.getByRole("heading", { name: "PaperTradingRun + TradeProposal" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "计划名称" }), { target: { value: "趋势策略巡检" } });
    fireEvent.change(screen.getByRole("combobox", { name: "交易提案计划" }), { target: { value: "trading-1" } });
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
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.deleteSchedule).toHaveBeenCalledWith("schedule-1"));
    expect(screen.getByText("还没有运行计划")).toBeInTheDocument();
  });

  it("waits for the saved plans before showing an empty state", async () => {
    let resolve!: (value: typeof schedules) => void;
    api.listSchedules.mockReturnValue(new Promise(value => { resolve = value; }));
    renderPage();
    expect(screen.getByText("正在读取后端计划…")).toBeInTheDocument();
    expect(screen.queryByText("还没有运行计划")).not.toBeInTheDocument();
    expect(screen.queryByText("调度已接通")).not.toBeInTheDocument();
    await act(async () => resolve([]));
    expect(screen.getByText("还没有运行计划")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "计划名称" })).toBeVisible();
  });

  it("leads with saved plan state and opens creation on request", async () => {
    const task = workspaceTaskFixture({ kind: "research", name: "已暂停的研究" });
    tasks.push(task);
    schedules.push(workspaceScheduleFixture({ name: task.name, enabled: false, lastRunAt: "2026-09-02T10:30:00Z", lastRunId: "prior-run", timezone: "Asia/Tokyo" }));
    renderPage();
    await screen.findByText(task.name);
    expect(screen.getAllByText("计划已暂停")[0]).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "计划名称" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看上次运行" })).toHaveAttribute("href", "/runs/prior-run");
    expect(screen.getByText(/Asia\/Tokyo/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新建计划" }));
    expect(screen.getByRole("textbox", { name: "计划名称" })).toBeVisible();
  });

  it("guards pending registration and retries only the failed schedule for an unchanged task", async () => {
    let reject!: (reason: Error) => void;
    api.createSchedule.mockReturnValueOnce(new Promise((_resolve, value) => { reject = value; }));
    renderPage();
    await screen.findByText("还没有运行计划");
    fireEvent.change(screen.getByRole("textbox", { name: "计划名称" }), { target: { value: "每日复核" } });
    fireEvent.change(screen.getByRole("textbox", { name: "股票" }), { target: { value: "600519" } });
    fireEvent.click(screen.getByRole("option", { name: /贵州茅台/ }));
    const save = screen.getByRole("button", { name: "注册定时计划" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(api.createSchedule).toHaveBeenCalledTimes(1));
    expect(save).toBeDisabled();
    expect(api.createTask).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("计划注册失败");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByText("每日复核");
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(api.createSchedule).toHaveBeenCalledTimes(2);
    expect(api.createSchedule.mock.calls[1][0].taskId).toBe("task-1");
  });

  it("reloads failed plan reads instead of claiming there are no plans", async () => {
    api.listSchedules.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("定时计划读取失败");
    expect(screen.queryByText("还没有运行计划")).not.toBeInTheDocument();
    expect(screen.queryByText("共 0 个已注册计划。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("还没有运行计划");
    expect(api.listSchedules).toHaveBeenCalledTimes(2);
  });

  it("directs empty trading proposal selection to the proposal workspace", async () => {
    renderPage("/schedules?type=trading");
    await screen.findByText("还没有运行计划");
    expect(screen.getByRole("radio", { name: /交易提案计划/ })).toBeChecked();
    expect(screen.getByRole("link", { name: "保存交易提案任务" })).toHaveAttribute("href", "/trading?view=reports");
    expect(api.listTasks).toHaveBeenCalledWith("trading");
    expect(screen.getAllByText(/模拟账户的持续日线在交易页单独控制/).length).toBeGreaterThan(0);
  });

  it("retries a failed trading task read without switching to a simulation account", async () => {
    const task = workspaceTaskFixture({ kind: 'trading', name: '已保存提案任务' });
    api.listTasks.mockImplementation(async (kind?: string) => {
      if (kind === 'trading') throw new Error('offline');
      return [];
    });
    renderPage('/schedules?type=trading');
    expect(await screen.findByRole('alert')).toHaveTextContent('交易提案任务读取失败');
    api.listTasks.mockImplementation(async (kind?: string) => kind === 'trading' ? [task] : []);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('option', { name: /已保存提案任务/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("updates plan state only from the backend response and retries errors without duplicate requests", async () => {
    const task = workspaceTaskFixture({ name: "可暂停的计划" });
    tasks.push(task);
    const saved = workspaceScheduleFixture({ name: task.name });
    schedules.push(saved);
    let reject!: (reason: Error) => void;
    api.updateSchedule.mockReturnValueOnce(new Promise((_resolve, value) => { reject = value; }));
    renderPage();
    const pause = await screen.findByRole('button', { name: '暂停计划' });
    fireEvent.click(pause);
    fireEvent.click(pause);
    expect(api.updateSchedule).toHaveBeenCalledTimes(1);
    expect(api.updateSchedule).toHaveBeenCalledWith(saved.id, { enabled: false });
    expect(screen.getByText('计划已启用')).toBeVisible();
    expect(pause).toBeDisabled();
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('定时计划更新失败');
    expect(pause).toBeEnabled();
    api.updateSchedule.mockResolvedValueOnce({ ...saved, enabled: false, lastRunId: 'server-run', lastRunAt: '2026-10-03T10:00:00Z' });
    fireEvent.click(pause);
    const enable = await screen.findByRole('button', { name: '启用计划' });
    expect(screen.getByRole('link', { name: '查看上次运行' })).toHaveAttribute('href', '/runs/server-run');
    api.updateSchedule.mockResolvedValueOnce({ ...saved, enabled: true, nextRunAt: '2026-10-05T18:30:00Z' });
    fireEvent.click(enable);
    await screen.findByRole('button', { name: '暂停计划' });
    expect(document.querySelector('time[datetime="2026-10-05T18:30:00Z"]')).not.toBeNull();
  });

  it("confirms the named deletion, sends nothing on cancel and keeps a failed deletion retryable", async () => {
    const task = workspaceTaskFixture({ name: "不能撤销在途运行的计划" });
    tasks.push(task);
    schedules.push(workspaceScheduleFixture({ name: task.name }));
    renderPage();
    const remove = await screen.findByRole('button', { name: `删除计划 ${task.name}` });
    fireEvent.click(remove);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(task.name);
    expect(dialog).toHaveTextContent('已领取或已启动的运行仍可能继续');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    let reject!: (reason: Error) => void;
    api.deleteSchedule.mockReturnValueOnce(new Promise((_resolve, value) => { reject = value; }));
    fireEvent.click(remove);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '删除' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.deleteSchedule).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('定时计划删除失败');
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(confirm);
    await screen.findByText('还没有运行计划');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteSchedule).toHaveBeenCalledTimes(2);
  });
});
