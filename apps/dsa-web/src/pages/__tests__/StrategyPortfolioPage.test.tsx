import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import TradingWorkspacePage from "../TradingWorkspacePage";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  templates: vi.fn(),
  detail: vi.fn(),
  control: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../../api/portfolios", () => ({ portfoliosApi: api }));
const config = {
  name: "动量试验",
  template: "volume_breakout",
  market: "CN",
  symbols: ["600519"],
  initialCash: 100000,
  maxPositions: 3,
  maxWeight: 0.25,
  riskFreeRate: 0,
  benchmarkName: "沪深300 ETF",
};
const detail = {
  id: 1,
  name: "动量试验",
  config,
  mode: "paper",
  status: "paused",
  versionId: 2,
  market: "CN",
  lastDate: "2026-09-10",
  metrics: { dailyReturn: 0, cumulativeReturn: 0, sharpe: null },
  days: [
    {
      date: "2026-09-10",
      equity: 100000,
      cash: 90000,
      marketValue: 10000,
      dailyReturn: 0,
      benchmarkReturn: 0,
      holdings: [
        {
          code: "600519",
          quantity: 100,
          averageCost: 100,
          price: 100,
          marketValue: 10000,
          unrealizedPnl: 0,
        },
      ],
      opinions: [
        {
          code: "600519",
          stance: "bullish",
          reason: "突破过去高点，拟继续持有",
          held: true,
        },
      ],
      trades: [],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([detail]);
  api.detail.mockResolvedValue(detail);
  api.templates.mockResolvedValue([
    { id: "volume_breakout", name: "量价突破", description: "突破条件" },
  ]);
});
it("shows real zero metrics, daily opinions and current positions without invented trades", async () => {
  render(
    <MemoryRouter initialEntries={["/trading?portfolio=1"]}>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  await screen.findByText("累计收益");
  expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  expect(screen.getByText(/当日无买卖/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "每日观点" }));
  expect(screen.getByText("突破过去高点，拟继续持有")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "当前持仓" }));
  expect(screen.getByRole("cell", { name: "600519" })).toBeVisible();
  expect(screen.getByRole("link", { name: "历史研究提案" })).toHaveAttribute(
    "href",
    "/trading?view=reports",
  );
});
it("creates explicit fixed configuration without auto trading", async () => {
  api.create.mockResolvedValue({ ...detail, id: 2 });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "规则验证" },
  });
  fireEvent.change(screen.getByLabelText("固定股票池（最多 12 个代码）"), {
    target: { value: "600519, 601318" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建策略账户" }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "规则验证",
        symbols: ["600519", "601318"],
        mode: "paper",
      }),
    ),
  );
  expect(api.control).not.toHaveBeenCalled();
});
