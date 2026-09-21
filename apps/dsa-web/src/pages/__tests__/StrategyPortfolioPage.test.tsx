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
const stockState = vi.hoisted(() => ({ loading: false }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  control: vi.fn(),
  create: vi.fn(),
  definitions: vi.fn(),
  saveDefinition: vi.fn(),
  createValidation: vi.fn(),
  agentOptions: vi.fn(),
  previewUniverse: vi.fn(),
  holdings: vi.fn(),
}));
vi.mock("../../api/portfolios", () => ({ portfoliosApi: api }));
vi.mock("../../hooks/useStockIndex", () => ({
  useStockIndex: () => ({
    loading: stockState.loading,
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
  template: "agent",
  engine: "agent",
  skillSnapshot: { name: "价格策略", digest: "test" },
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
  stockState.loading = false;
  api.list.mockResolvedValue([detail]);
  api.definitions.mockResolvedValue([]);
  api.agentOptions.mockResolvedValue({skills:[{id:"price",name:"价格策略",description:"依据日线"}],accounts:[],defaultPrompt:"交易"});
  api.detail.mockResolvedValue(detail);
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
        historyMode: "ai_replay",
        universeHistory: "frozen",
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
  fireEvent.change(screen.getByLabelText("交易决策模型"), {target:{value:"jev"}});
  fireEvent.change(screen.getByLabelText("每次调仓比例（账户权益 %）"), {target:{value:"10"}});
  fireEvent.change(screen.getByLabelText("判断问题"), {target:{value:"判断区间方向"}});
  fireEvent.change(screen.getByLabelText("买入判定条件"), {target:{value:"放量且区间偏低"}});
  fireEvent.change(screen.getByLabelText("行情观察天数"), {target:{value:"7"}});
  fireEvent.change(screen.getByLabelText("补充背景材料"), {target:{value:"偏好低换手"}});
  expect(screen.queryByText('交易 System Prompt')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("策略名称"), {target:{value:"Agent试验"}});
  fireEvent.change(screen.getByLabelText("股票池（可选，名称或代码，最多 12 只）"), {target:{value:"英伟达"}});
  fireEvent.change(screen.getByLabelText("范围来源"), {target:{value:"fixed"}});
  fireEvent.click(screen.getByRole("button", {name:"预览股票范围"}));
  await screen.findByLabelText("范围预览");
  fireEvent.click(screen.getByRole("button", {name:"保存策略"}));
  await waitFor(() => expect(api.saveDefinition).toHaveBeenCalledWith(expect.objectContaining({engine:"agent",decisionBackend:"jev",jevWeightStep:0.1,jevTask:{question:"判断区间方向",criteria:{buy:"放量且区间偏低"},lookbackDays:7,background:"偏好低换手"},skillId:"price",universePreviewId:9,market:"US",symbols:["NVDA"]})));
  expect(api.createValidation).not.toHaveBeenCalled();
});


it("saves a scope-only strategy with an empty optional pool while the name catalog is loading", async () => {
  stockState.loading = true;
  api.previewUniverse.mockResolvedValue({id:10,market:"CN",candidates:[{code:"688981",reason:"半导体行业"}],scope:{mode:"custom",symbols:[],query:"",industries:["半导体"]},source:"fixture",observedAt:"2026-09-11"});
  api.saveDefinition.mockResolvedValue({id:3,name:"行业策略",config:{...config,engine:"agent"}});
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name:"配置策略"}));
  await screen.findByRole("option", {name:"价格策略"});
  const poolInput = screen.getByLabelText("股票池（可选，名称或代码，最多 12 只）");
  expect(poolInput).not.toBeRequired();
  expect(poolInput).toHaveValue("");
  expect(screen.getByLabelText("范围来源")).toHaveValue("fixed");
  fireEvent.change(screen.getByLabelText("范围来源"), {target:{value:"custom"}});
  fireEvent.click(screen.getByRole("checkbox", {name:"半导体"}));
  fireEvent.change(screen.getByLabelText("策略 Skill"), {target:{value:"price"}});
  fireEvent.change(screen.getByLabelText("策略名称"), {target:{value:"行业策略"}});
  fireEvent.click(screen.getByRole("button", {name:"预览股票范围"}));
  await screen.findByLabelText("范围预览");
  expect(api.previewUniverse).toHaveBeenCalledWith("CN", expect.objectContaining({mode:"custom",symbols:[],query:"",industries:["半导体"]}));
  fireEvent.click(screen.getByRole("button", {name:"保存策略"}));
  await waitFor(() => expect(api.saveDefinition).toHaveBeenCalledWith(expect.objectContaining({engine:"agent",universePreviewId:10,symbols:["688981"]})));
  expect(api.createValidation).not.toHaveBeenCalled();
});


it("does not widen a holdings scope when its optional stock restriction has no intersection", async () => {
  api.agentOptions.mockResolvedValue({skills:[{id:"price",name:"价格策略"}],accounts:[{id:1,name:"美股持仓",market:"US"}],defaultPrompt:"交易"});
  api.holdings.mockResolvedValue([{symbol:"NVDA",quantity:1}]);
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name:"配置策略"}));
  await screen.findByRole("option", {name:"价格策略"});
  fireEvent.change(screen.getByLabelText("范围来源"), {target:{value:"holdings"}});
  fireEvent.change(screen.getByLabelText("持仓账户"), {target:{value:"1"}});
  fireEvent.click(await screen.findByRole("checkbox", {name:/NVDA/}));
  fireEvent.change(screen.getByLabelText("股票池（可选，名称或代码，最多 12 只）"), {target:{value:"苹果"}});
  fireEvent.click(screen.getByRole("button", {name:"预览股票范围"}));
  await screen.findByText(/填写的股票与所选持仓没有交集/);
  expect(api.previewUniverse).not.toHaveBeenCalled();
});

it('imports an assistant skill into the existing configuration without starting a run', async () => {
  const { strategyDraftsApi } = await import('../../api/strategyDrafts');
  const sync = vi.spyOn(strategyDraftsApi, 'sync').mockResolvedValue({
    sessionId: 'draft', kind: 'trading', revision: 1, validated: true, skillId: 'price', error: null,
    draft: { name: '对话网格', scope: '中市值以上、成交活跃且波动较大' },
  });
  render(<MemoryRouter initialEntries={['/trading?sourceSession=draft']}><TradingWorkspacePage /></MemoryRouter>);
  expect(await screen.findByDisplayValue('对话网格')).toBeInTheDocument();
  expect(await screen.findByDisplayValue('中市值以上、成交活跃且波动较大')).toBeInTheDocument();
  expect(screen.getByDisplayValue('按行业与条件筛选')).toBeInTheDocument();
  expect(api.saveDefinition).not.toHaveBeenCalled();
  expect(api.createValidation).not.toHaveBeenCalled();
  expect(api.control).not.toHaveBeenCalled();
  sync.mockRestore();
});

it("configures JEV separately from report generation and shows allocation sizing", async () => {
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "配置策略" }));
  const select = await screen.findByLabelText("交易决策模型");
  expect(select).toHaveValue("llm");
  fireEvent.change(select, { target: { value: "jev" } });
  expect(screen.getByLabelText("每次调仓比例（账户权益 %）")).toHaveValue(5);
  fireEvent.change(screen.getByLabelText("每次调仓比例（账户权益 %）"), { target: { value: "10" } });
  expect(screen.getByLabelText("每次调仓比例（账户权益 %）")).toHaveValue(10);
  expect(await screen.findByText("请先在设置 → AI 模型中配置 JEV API Key。")).toBeVisible();
});

it("renders JEV categories and probabilities without a fabricated explanation", async () => {
  const jev = { ...structuredClone(detail), days: [{ ...structuredClone(detail.days[0]), opinions: [] as import("../../api/portfolios").Opinion[] }] };
  jev.days![0].opinions = [{code:"600519", stance:"neutral", held:true, reason:"not a model explanation",
    decisionBackend:"jev", decision:"hold", confidence:0.8, targetWeight:0.1,
    probabilities:{buy:0.1,sell:0.05,hold:0.85}}];
  api.list.mockResolvedValue([jev]);
  api.detail.mockResolvedValue(jev);
  render(<MemoryRouter initialEntries={["/trading?portfolio=1"]}><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", {name:"每日观点"}));
  expect(await screen.findByText(/85.0%/)).toBeVisible();
  expect(screen.getByText(/仅决策结果，无模型解释/)).toBeVisible();
  expect(screen.queryByText("not a model explanation")).not.toBeInTheDocument();
});

it('resets the confirmed universe when starting another strategy from an open form', async () => {
  api.previewUniverse.mockResolvedValue({id:10,market:'CN',candidates:[{code:'688981',reason:'半导体行业'}],scope:{mode:'custom',symbols:[],query:''},source:'fixture',observedAt:'2026-09-11'});
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', {name:'配置策略'}));
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('范围来源'), {target:{value:'custom'}});
  fireEvent.click(screen.getByRole('button', {name:'预览股票范围'}));
  await screen.findByLabelText('范围预览');
  fireEvent.click(screen.getByRole('button', {name:'配置策略'}));
  expect(screen.getByLabelText('范围来源')).toHaveValue('fixed');
  expect(screen.queryByLabelText('范围预览')).not.toBeInTheDocument();
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('策略名称'), {target:{value:'新策略'}});
  fireEvent.change(screen.getByLabelText('策略 Skill'), {target:{value:'price'}});
  fireEvent.click(screen.getByRole('button', {name:'保存策略'}));
  expect(await screen.findByText('请先预览并确认股票范围。')).toBeVisible();
  expect(api.saveDefinition).not.toHaveBeenCalled();
});

it('ignores a preview response from a discarded strategy form', async () => {
  let resolve!: (value: unknown) => void;
  api.previewUniverse.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', {name:'配置策略'}));
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('范围来源'), {target:{value:'custom'}});
  fireEvent.click(screen.getByRole('button', {name:'预览股票范围'}));
  fireEvent.click(screen.getByRole('button', {name:'取消'}));
  fireEvent.click(screen.getByRole('button', {name:'配置策略'}));
  await act(async () => resolve({id:10,market:'CN',candidates:[{code:'688981'}],scope:{mode:'custom'},source:'fixture'}));
  expect(screen.queryByLabelText('范围预览')).not.toBeInTheDocument();
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('策略名称'), {target:{value:'新策略'}});
  fireEvent.change(screen.getByLabelText('策略 Skill'), {target:{value:'price'}});
  fireEvent.click(screen.getByRole('button', {name:'保存策略'}));
  expect(await screen.findByText('请先预览并确认股票范围。')).toBeVisible();
  expect(api.saveDefinition).not.toHaveBeenCalled();
});

it('invalidates the previous approval when previewing again fails', async () => {
  api.previewUniverse.mockResolvedValueOnce({id:10,market:'CN',candidates:[{code:'688981',reason:'半导体行业'}],scope:{mode:'custom'},source:'fixture'});
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', {name:'配置策略'}));
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('范围来源'), {target:{value:'custom'}});
  fireEvent.click(screen.getByRole('button', {name:'预览股票范围'}));
  await screen.findByLabelText('范围预览');
  api.previewUniverse.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', {name:'预览股票范围'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'预览股票范围'})).toBeEnabled());
  expect(screen.queryByLabelText('范围预览')).not.toBeInTheDocument();
  await screen.findByRole('option', {name:'价格策略'});
  fireEvent.change(screen.getByLabelText('策略名称'), {target:{value:'新策略'}});
  fireEvent.change(screen.getByLabelText('策略 Skill'), {target:{value:'price'}});
  fireEvent.click(screen.getByRole('button', {name:'保存策略'}));
  expect(await screen.findByText('请先预览并确认股票范围。')).toBeVisible();
  expect(api.saveDefinition).not.toHaveBeenCalled();
});

it("defaults new strategies to the grid skill and restores it when starting a fresh form", async () => {
  api.agentOptions.mockResolvedValue({skills:[
    {id:"price",name:"价格策略",description:"依据日线"},
    {id:"high_volume_volatility_grid",name:"高量高波动网格",description:"每日收盘网格"},
  ],accounts:[],defaultPrompt:"交易"});
  render(<MemoryRouter><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name:"配置策略"}));
  await screen.findByRole("option", {name:"高量高波动网格"});
  await waitFor(() => expect(screen.getByLabelText("策略 Skill")).toHaveValue("high_volume_volatility_grid"));
  expect(screen.getByLabelText("观察周期（交易日）")).toHaveValue(5);
  expect(screen.getByLabelText("最低成交量倍数")).toHaveValue(1.3);
  expect(screen.getByLabelText(/最低区间波动率/)).toHaveValue(0.05);
  expect(screen.getByLabelText("网格档数")).toHaveValue(5);
  fireEvent.change(screen.getByLabelText("策略 Skill"), {target:{value:"price"}});
  expect(screen.getByLabelText("策略 Skill")).toHaveValue("price");
  fireEvent.click(screen.getByRole("button", {name:"配置策略"}));
  await waitFor(() => expect(screen.getByLabelText("策略 Skill")).toHaveValue("high_volume_volatility_grid"));
  expect(api.saveDefinition).not.toHaveBeenCalled();
  expect(api.createValidation).not.toHaveBeenCalled();
});
