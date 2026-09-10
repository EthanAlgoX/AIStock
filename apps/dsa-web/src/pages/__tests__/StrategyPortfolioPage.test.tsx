import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import TradingWorkspacePage from "../TradingWorkspacePage";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  templates: vi.fn(),
  detail: vi.fn(),
  control: vi.fn(),
  create: vi.fn(),
  definitions: vi.fn(),
  saveDefinition: vi.fn(),
  createValidation: vi.fn(),
  agentOptions: vi.fn(),
  previewUniverse: vi.fn(),
}));
vi.mock("../../api/portfolios", () => ({ portfoliosApi: api }));
vi.mock("../../hooks/useStockIndex", () => ({
  useStockIndex: () => ({
    loading: false,
    fallback: false,
    index: [
      {
        canonicalCode: "NVDA",
        displayCode: "NVDA",
        nameZh: "英伟达",
        aliases: ["英伟达公司"],
        market: "US",
        assetType: "stock",
        active: true,
      },
      {
        canonicalCode: "AAPL",
        displayCode: "AAPL",
        nameZh: "苹果",
        market: "US",
        assetType: "stock",
        active: true,
      },
    ],
  }),
}));
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
  api.definitions.mockResolvedValue([]);
  api.agentOptions.mockResolvedValue({skills:[{id:"price",name:"价格策略",description:"依据日线"}],accounts:[],defaultPrompt:"交易"});
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
  api.saveDefinition.mockResolvedValue({ ...detail, id: 2 });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("执行方式"), {target:{value:"rule"}});
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "规则验证" },
  });
  fireEvent.change(screen.getByLabelText("股票池（名称或代码，最多 12 只）"), {
    target: { value: "600519, 601318" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
  await waitFor(() =>
    expect(api.saveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "规则验证",
        symbols: ["600519", "601318"],
        mode: "paper",
      }),
    ),
  );
  expect(screen.queryByLabelText("验证方式")).not.toBeInTheDocument();
  expect(api.createValidation).not.toHaveBeenCalled();
  expect(api.control).not.toHaveBeenCalled();
});

async function submitDraft() {
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("执行方式"), {target:{value:"rule"}});
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "验证" },
  });
  fireEvent.change(screen.getByLabelText("股票池（名称或代码，最多 12 只）"), {
    target: { value: "600519" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
}
it("retains the server domain error across successful background polls", async () => {
  api.saveDefinition.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 422,
      data: {
        error: "http_error",
        message: "请配置 1–12 个同市场股票代码",
        detail: null,
      },
    },
  });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  await submitDraft();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请配置 1–12 个同市场股票代码",
  );
  const count = api.list.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5100));
  });
  expect(api.list.mock.calls.length).toBeGreaterThan(count);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "请配置 1–12 个同市场股票代码",
  );
  expect(screen.getByLabelText("策略名称")).toHaveValue("验证");
}, 10000);
it("shows field validation details instead of a generic connection error", async () => {
  api.saveDefinition.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 422,
      data: {
        error: "validation_error",
        message: "请求参数验证失败",
        detail: [
          {
            loc: ["body", "initialCash"],
            msg: "Input should be greater than or equal to 1000",
          },
        ],
      },
    },
  });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  await submitDraft();
  expect(await screen.findByRole("alert")).toHaveTextContent("initialCash");
  expect(screen.getByRole("alert")).toHaveTextContent("1000");
});
it("validates pool limits before posting and accepts Chinese separators", async () => {
  api.saveDefinition.mockResolvedValue({ ...detail, id: 2 });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("执行方式"), {target:{value:"rule"}});
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "验证" },
  });
  const input = screen.getByLabelText("股票池（名称或代码，最多 12 只）");
  fireEvent.change(input, {
    target: {
      value: Array.from({ length: 13 }, (_, i) => String(600000 + i)).join(
        "、",
      ),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
  expect(screen.getByRole("alert")).toHaveTextContent("当前填写了 13 个");
  expect(api.saveDefinition).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "600519、601318；600519" } });
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
  await waitFor(() =>
    expect(api.saveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ symbols: ["600519", "601318"] }),
    ),
  );
});

it("recognizes names and automatically uses the US market and lot size", async () => {
  api.saveDefinition.mockResolvedValue({ ...detail, id: 2 });
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("执行方式"), {target:{value:"rule"}});
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "美股验证" },
  });
  fireEvent.change(screen.getByLabelText("股票池（名称或代码，最多 12 只）"), {
    target: { value: "英伟达、苹果" },
  });
  expect(screen.getByText("自动识别市场：美股 · USD")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
  await waitFor(() =>
    expect(api.saveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ["NVDA", "AAPL"],
        market: "US",
        lotSize: 1,
      }),
    ),
  );
});
it("blocks mixed markets before account creation", async () => {
  render(
    <MemoryRouter>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByLabelText("执行方式"), {target:{value:"rule"}});
  await screen.findByText("量价突破");
  fireEvent.change(screen.getByLabelText("策略名称"), {
    target: { value: "混合" },
  });
  fireEvent.change(screen.getByLabelText("股票池（名称或代码，最多 12 只）"), {
    target: { value: "英伟达、600519" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
  expect(screen.getByRole("alert")).toHaveTextContent("多个市场");
  expect(api.saveDefinition).not.toHaveBeenCalled();
});

it.each([
  ["历史回测", "backtest", "run"],
  ["运行一次", "paper", "run"],
  ["持续模拟", "paper", "start"],
])(
  "launches %s only after confirming validation parameters",
  async (label, mode, action) => {
    api.definitions.mockResolvedValue([{ id: 7, name: "已保存规则", config }]);
    api.createValidation.mockResolvedValue({
      ...detail,
      id: 8,
      definitionId: 7,
      mode,
    });
    api.control.mockResolvedValue({ ...detail, id: 8, definitionId: 7, mode });
    render(
      <MemoryRouter initialEntries={["/trading?strategy=7"]}>
        <TradingWorkspacePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "已保存规则" });
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(api.createValidation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("验证初始资金"), {
      target: { value: "200000" },
    });
    if (mode === "backtest") {
      fireEvent.change(screen.getByLabelText("回测开始"), {
        target: { value: "2025-02-10" },
      });
      fireEvent.change(screen.getByLabelText("回测结束"), {
        target: { value: "2025-02-14" },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "确认并开始验证" }));
    await waitFor(() =>
      expect(api.createValidation).toHaveBeenCalledWith(7, {
        mode,
        initialCash: 200000,
        startDate: mode === "backtest" ? "2025-02-10" : null,
        endDate: mode === "backtest" ? "2025-02-14" : null,
      }),
    );
    await waitFor(() => expect(api.control).toHaveBeenCalledWith(8, action));
  },
);

it("continues the existing simulation when switching to continuous mode", async () => {
  api.definitions.mockResolvedValue([{ id: 7, name: "已保存规则", config }]);
  api.list.mockResolvedValue([{ ...detail, definitionId: 7 }]);
  api.control.mockResolvedValue({ ...detail, definitionId: 7 });
  render(
    <MemoryRouter initialEntries={["/trading?strategy=7"]}>
      <TradingWorkspacePage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "已保存规则" });
  fireEvent.click(screen.getByRole("button", { name: "持续模拟" }));
  await waitFor(() => expect(api.control).toHaveBeenCalledWith(1, "start"));
  expect(api.createValidation).not.toHaveBeenCalled();
});

it("saves the selected Agent Skill and approved universe without launching", async () => {
  api.previewUniverse.mockResolvedValue({id:9,market:"US",candidates:[{code:"NVDA",reason:"用户指定"}],scope:{mode:"fixed",symbols:["NVDA"]},source:"specified",observedAt:"2026-09-10"});
  api.saveDefinition.mockResolvedValue({id:2,name:"Agent试验",config:{...config,engine:"agent"}});
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name:"配置策略"}));
  await screen.findByRole("option", {name:"价格策略"});
  fireEvent.change(screen.getByLabelText("策略 Skill"), {target:{value:"price"}});
  fireEvent.change(screen.getByLabelText("策略名称"), {target:{value:"Agent试验"}});
  fireEvent.change(screen.getByLabelText("股票池（名称或代码，最多 12 只）"), {target:{value:"英伟达"}});
  fireEvent.click(screen.getByRole("button", {name:"预览范围与筛选依据"}));
  await screen.findByLabelText("范围预览");
  fireEvent.click(screen.getByRole("button", {name:"保存策略"}));
  await waitFor(() => expect(api.saveDefinition).toHaveBeenCalledWith(expect.objectContaining({engine:"agent",skillId:"price",universePreviewId:9,market:"US",symbols:["NVDA"]})));
  expect(api.createValidation).not.toHaveBeenCalled();
});
