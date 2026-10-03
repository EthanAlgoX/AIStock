import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { DefaultTaskPlan, WorkspaceRun } from "../../api/workspace";
import type { IndexLoadResult } from "../../utils/stockIndexLoader";
import { EMPTY_RUN_STATE, useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import { workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import StockArchive from "./StockArchive";

const api = vi.hoisted(() => ({ runHistory: vi.fn(), getDefaultTaskPlan: vi.fn(), createTask: vi.fn(), runTask: vi.fn(), loadStockIndex: vi.fn() }));
const { runHistory, getDefaultTaskPlan } = api;
vi.mock("../../api/workspace", () => ({ workspaceApi: api }));
vi.mock("../../utils/stockIndexLoader", () => ({ loadStockIndex: api.loadStockIndex }));

const directory: IndexLoadResult = { loaded: true, fallback: false, data: [
  { canonicalCode: "600519.SH", displayCode: "600519", nameZh: "贵州茅台", market: "CN", assetType: "stock", active: true },
  { canonicalCode: "AAPL", displayCode: "AAPL", nameZh: "苹果", market: "US", assetType: "stock", active: true },
  { canonicalCode: "006208.TW", displayCode: "006208", nameZh: "富邦台湾", market: "TW", assetType: "etf", active: true },
] };
const NavigateArchive = ({ onRunStarted = () => {} }: { onRunStarted?: (run: WorkspaceRun) => void }) => {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/?stock=AAPL")}>Apple archive</button><button onClick={() => navigate("/?stock=00700.HK")}>Tencent archive</button><StockArchive onRunStarted={onRunStarted} /></>;
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem("dsa.uiLanguage", "zh");
  useWorkspaceRunStore.setState({ runs: { research: { ...EMPTY_RUN_STATE, restoring: false } } });
  api.loadStockIndex.mockResolvedValue(directory);
  runHistory.mockResolvedValue({ items: [], total: 0 });
  getDefaultTaskPlan.mockImplementation(async (_kind, market, stock): Promise<DefaultTaskPlan> => ({
    policyVersion: "starter-v1", strategyName: "单股研究", skillNames: [], teamName: "", expertCount: 0,
    reasons: [], warnings: [], notice: "使用真实数据与模型，可能产生调用费用。",
    task: { kind: "research", name: "股票档案研究", market, objective: "研究证据与风险", subject: { stock }, config: {}, capabilities: { skillIds: [], toolIds: [], dataSourceIds: [], mcpIds: [], expertIds: [], expertTeamIds: [] } },
  }));
  api.createTask.mockImplementation(async (payload) => workspaceTaskFixture(payload));
  api.runTask.mockImplementation(async () => workspaceRunFixture(workspaceTaskFixture(api.createTask.mock.lastCall![0])));
});

it("retries the same stock after a failed request and reloads after success", async () => {
  runHistory.mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({items: [], total: 2})
    .mockResolvedValueOnce({items: [], total: 3});
  render(<MemoryRouter initialEntries={["/?stock=600519"]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  fireEvent.click(screen.getByRole("button", {name: "查询档案"}));
  await screen.findByText(/共 2 次相关运行/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "查询档案"}));
  await screen.findByText(/共 3 次相关运行/);
  await waitFor(() => expect(runHistory).toHaveBeenCalledTimes(3));
});

it.each([{ market: "JP", stock: "7203.T" }, { market: "CRYPTO", stock: "btcusdt" }, { market: "TW", stock: "006208.TW" }, { market: "GB", stock: "HSBA.L" }])("identifies $market and prepares the same canonical subject without manual market correction", async ({ market, stock }) => {
  render(<MemoryRouter initialEntries={[`/?stock=${stock}`]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  const selector = screen.getByRole("combobox", { name: "新研究市场" });
  expect(selector.querySelector(`option[value="${market}"]`)).not.toBeNull();
  expect(selector).toHaveValue(market);
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", market, stock.toUpperCase()));
});

it("updates the input, market, history and follow-up run together when the URL stock changes", async () => {
  let resolveOld!: (page: { items: WorkspaceRun[]; total: number }) => void;
  runHistory.mockImplementation(({ stock }) => stock === "7203.T" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ items: [], total: 2 }));
  const started = vi.fn();
  render(<MemoryRouter initialEntries={["/?stock=7203.T"]}><NavigateArchive onRunStarted={started} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Apple archive" }));
  expect(screen.getByRole("textbox", { name: "股票代码" })).toHaveValue("AAPL");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("US"));
  await screen.findByText(/共 2 次相关运行/);
  await act(async () => resolveOld({ items: [workspaceRunFixture(workspaceTaskFixture({ name: "旧日本报告" }))], total: 99 }));
  expect(screen.queryByText(/99 次/)).not.toBeInTheDocument();
  expect(screen.queryByText(/旧日本报告/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看全部关联记录与筛选" })).toHaveAttribute("href", "/runs?stock=AAPL");
  fireEvent.click(screen.getByText("快速试用默认方案"));
  const run = screen.getByRole("button", { name: "运行默认方案" });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ market: "US", subject: { stock: "AAPL" } })));
  expect(started).toHaveBeenCalledWith(expect.objectContaining({ taskSnapshot: expect.objectContaining({ market: "US", subject: { stock: "AAPL" } }) }));
  fireEvent.click(screen.getByRole("button", { name: "Tencent archive" }));
  expect(screen.getByRole("textbox", { name: "股票代码" })).toHaveValue("HK00700");
  expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("HK");
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "HK", "HK00700"));
});

it("preserves an explicit market while a pending directory resolves and resets it for a new stock context", async () => {
  let resolveDirectory!: (value: IndexLoadResult) => void;
  api.loadStockIndex.mockReturnValue(new Promise(resolve => { resolveDirectory = resolve; }));
  render(<MemoryRouter initialEntries={["/?stock=AAPL"]}><NavigateArchive /></MemoryRouter>);
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "US", "AAPL"));
  fireEvent.change(screen.getByRole("combobox", { name: "新研究市场" }), { target: { value: "JP" } });
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "JP", "AAPL"));
  await act(async () => resolveDirectory(directory));
  expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("JP");
  expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "JP", "AAPL");
  fireEvent.click(screen.getByRole("button", { name: "Tencent archive" }));
  expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("HK");
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "HK", "HK00700"));
});

it("does not infer a foreign market from an ambiguous bare numeric display code", async () => {
  render(<MemoryRouter initialEntries={["/?stock=006208"]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenCalledWith("research", "CN", "006208"));
  expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("CN");
  fireEvent.change(screen.getByRole("textbox", { name: "股票代码" }), { target: { value: "006208.TW" } });
  fireEvent.click(screen.getByRole("button", { name: "查询档案" }));
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "TW", "006208.TW"));
  expect(screen.getByRole("link", { name: "查看全部关联记录与筛选" })).toHaveAttribute("href", "/runs?stock=006208.TW");
});

it("honors an explicit URL market but removes the hint when searching for a different stock", async () => {
  render(<MemoryRouter initialEntries={["/?stock=AAPL&market=US"]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenCalledWith("research", "US", "AAPL"));
  fireEvent.change(screen.getByRole("textbox", { name: "股票代码" }), { target: { value: "005930.KS" } });
  fireEvent.click(screen.getByRole("button", { name: "查询档案" }));
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "KR", "005930.KS"));
  expect(screen.getByRole("combobox", { name: "新研究市场" })).toHaveValue("KR");
});
