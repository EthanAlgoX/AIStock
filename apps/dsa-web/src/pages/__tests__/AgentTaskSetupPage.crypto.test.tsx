import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentTaskSetupPage from "../AgentTaskSetupPage";
import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import { EMPTY_RUN_STATE, useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import type { WorkspaceTask } from "../../api/workspace";

const api = vi.hoisted(() => ({
  cryptoMarket: vi.fn(), loadStockIndex: vi.fn(), listStrategies: vi.fn(), getVersion: vi.fn(),
  getCapabilities: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), getDefaultTaskPlan: vi.fn(), createTask: vi.fn(), runTask: vi.fn(),
}));
vi.mock("../../api/crypto", () => ({ cryptoApi: { market: api.cryptoMarket } }));
vi.mock("../../utils/stockIndexLoader", () => ({ loadStockIndex: api.loadStockIndex }));
vi.mock("../../api/strategyWorkspace", () => ({ strategyWorkspaceApi: { listStrategies: api.listStrategies, getVersion: api.getVersion } }));
vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

// Keep the real stock-index hook, normalizer, selectors, task builder and
// default launcher. Only data/model request boundaries are replaced.
describe("crypto research selection contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem("dsa.uiLanguage", "zh");
    useWorkspaceRunStore.setState({ runs: {} });
    api.loadStockIndex.mockResolvedValue({ data: [{ canonicalCode: "600519.SH", displayCode: "600519", nameZh: "贵州茅台", market: "CN", assetType: "stock", active: true }], loaded: true, fallback: false });
    api.cryptoMarket.mockResolvedValue({ assets: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }], source: "Binance Spot", asOf: "2026-10-03T00:00:00Z" });
    api.listRuns.mockResolvedValue([]);
    api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
    api.listStrategies.mockResolvedValue([
      { id: 1, name: "单股研究 · A股配置", currentPublishedVersionId: 12, currentPublishedVersionNumber: 1, kernelExecutionStatus: "ready", currentStrategyPurpose: "research_report" },
      { id: 2, name: "单股研究 · 加密货币配置", currentPublishedVersionId: 21, currentPublishedVersionNumber: 1, kernelExecutionStatus: "ready", currentStrategyPurpose: "research_report" },
    ]);
    api.getVersion.mockImplementation(async (id: number) => ({ screeningPolicy: { market: id === 21 ? "crypto" : "cn" } }));
    api.getDefaultTaskPlan.mockImplementation(async (_kind: string, market: WorkspaceTask["market"], stock?: string) => ({
      strategyName: "综合研究", skillNames: [], teamName: "主 Agent 独立解读", expertCount: 0, reasons: [], warnings: [], notice: "使用真实数据与模型，可能产生调用费用。",
      task: workspaceTaskFixture({ kind: "research", market, subject: { stock: stock || (market === "CRYPTO" ? "BTCUSDT" : "600519.SH") } }),
    }));
    api.createTask.mockImplementation(async (payload) => workspaceTaskFixture(payload));
    api.runTask.mockImplementation(async () => workspaceRunFixture(workspaceTaskFixture(api.createTask.mock.calls[0][0])));
  });

  it("loads crypto index items, selects a pair and freezes the matching method in the research request", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    fireEvent.change(screen.getByRole("combobox", { name: "选择市场" }), { target: { value: "CRYPTO" } });
    fireEvent.click(await screen.findByRole("option", { name: /BTCUSDT/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "关注问题（可选）" }), { target: { value: "核对现货量价与风险" } });
    const run = screen.getByRole("button", { name: "运行单股分析" });
    await waitFor(() => expect(run).toBeEnabled());
    expect(api.cryptoMarket).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("dsa.research-task-draft.v1")!).selectedStock).toMatchObject({ canonicalCode: "BTCUSDT", market: "CRYPTO", assetType: "crypto" });
    await waitFor(() => expect(api.getDefaultTaskPlan).toHaveBeenLastCalledWith("research", "CRYPTO", "BTCUSDT"));
    fireEvent.click(run);
    await waitFor(() => expect(api.createTask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      market: "CRYPTO", objective: "核对现货量价与风险", subject: { stock: "BTCUSDT", stockName: "BTCUSDT" },
      config: { strategyVersionId: 21, reportLanguage: "zh" },
      capabilities: expect.objectContaining({ toolIds: ["run_stock_research"] }),
    })));
  });

  it("normalizes an explicit lowercase USDT pair without treating it as a stock or changing markets", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    fireEvent.change(screen.getByRole("combobox", { name: "选择市场" }), { target: { value: "CRYPTO" } });
    await screen.findByRole("option", { name: /BTCUSDT/ });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索股票" }), { target: { value: "dogeusdt" } });
    fireEvent.click(screen.getByRole("option", { name: /DOGEUSDT/ }));
    expect(JSON.parse(localStorage.getItem("dsa.research-task-draft.v1")!).selectedStock).toMatchObject({ canonicalCode: "DOGEUSDT", market: "CRYPTO", assetType: "crypto" });
    const run = screen.getByRole("button", { name: "运行单股分析" });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ market: "CRYPTO", subject: { stock: "DOGEUSDT", stockName: "DOGEUSDT" }, config: { strategyVersionId: 21, reportLanguage: "zh" } })));
  });

  it("keeps crypto pairs out of stock markets and clears the selection when the market changes", async () => {
    render(<MemoryRouter><AgentTaskSetupPage mode="research" /></MemoryRouter>);
    fireEvent.change(screen.getByRole("combobox", { name: "选择市场" }), { target: { value: "CRYPTO" } });
    fireEvent.click(await screen.findByRole("option", { name: /BTCUSDT/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择市场" }), { target: { value: "CN" } });
    expect(screen.getByRole("textbox", { name: "搜索股票" })).toHaveValue("");
    await screen.findByRole("option", { name: /贵州茅台/ });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索股票" }), { target: { value: "btcusdt" } });
    expect(screen.queryByRole("option", { name: /BTCUSDT/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行单股分析" })).toBeDisabled();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("keeps the embedded manual form on one run path without preparing a second default plan", async () => {
    useWorkspaceRunStore.setState({ runs: { research: { ...EMPTY_RUN_STATE, restoring: false } } });
    render(<MemoryRouter><AgentTaskSetupPage mode="research" embedded /></MemoryRouter>);
    await screen.findByRole("option", { name: /贵州茅台/ });
    expect(screen.getByRole("button", { name: "运行单股分析" })).toBeInTheDocument();
    expect(screen.queryByText("快速试用默认方案")).not.toBeInTheDocument();
    expect(api.getDefaultTaskPlan).not.toHaveBeenCalled();
  });
});
