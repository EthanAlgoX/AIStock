import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { DefaultTaskPlan } from "../../api/workspace";
import StockArchive from "./StockArchive";

const { runHistory, getDefaultTaskPlan } = vi.hoisted(() => ({ runHistory: vi.fn(), getDefaultTaskPlan: vi.fn() }));
vi.mock("../../api/workspace", () => ({ workspaceApi: { runHistory, getDefaultTaskPlan } }));

beforeEach(() => {
  vi.resetAllMocks();
  runHistory.mockResolvedValue({ items: [], total: 0 });
  getDefaultTaskPlan.mockImplementation(async (_kind, market, stock): Promise<DefaultTaskPlan> => ({
    policyVersion: "starter-v1", strategyName: "单股研究", skillNames: [], teamName: "", expertCount: 0,
    reasons: [], warnings: [], notice: "使用真实数据与模型，可能产生调用费用。",
    task: { kind: "research", name: "股票档案研究", market, objective: "研究证据与风险", subject: { stock }, config: {}, capabilities: { skillIds: [], toolIds: [], dataSourceIds: [], mcpIds: [], expertIds: [], expertTeamIds: [] } },
  }));
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

it.each([{ market: "JP", stock: "7203.T" }, { market: "CRYPTO", stock: "BTCUSDT" }])("plans archive research for $market without replacing the selected stock", async ({ market, stock }) => {
  render(<MemoryRouter initialEntries={[`/?stock=${stock}`]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  const selector = screen.getByRole("combobox", { name: "新研究市场" });
  expect(selector.querySelector(`option[value="${market}"]`)).not.toBeNull();
  fireEvent.change(selector, { target: { value: market } });
  await waitFor(() => expect(getDefaultTaskPlan).toHaveBeenLastCalledWith("research", market, stock));
});
