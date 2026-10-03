import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleConfig, UniversePreview } from "../../../api/portfolios";
import TradingWorkspacePage from "../../../pages/TradingWorkspacePage";
import { TradingAgentConfig } from "../TradingAgentConfig";

const api = vi.hoisted(() => ({
  agentOptions: vi.fn(), holdings: vi.fn(), previewUniverse: vi.fn(),
  list: vi.fn(), definitions: vi.fn(), runtimeStatus: vi.fn(), saveDefinition: vi.fn(),
}));
vi.mock("../../../api/portfolios", async () => ({
  ...await vi.importActual("../../../api/portfolios"), portfoliosApi: api,
}));
vi.mock("../../../utils/stockIndexLoader", () => ({
  loadStockIndex: vi.fn(async () => ({ data: [], fallback: false, error: null })),
}));

const config: RuleConfig = {
  name: "预览回归", template: "agent", engine: "agent", decisionBackend: "rules",
  skillId: "high_volume_volatility_grid",
  market: "CN", symbols: [], mode: "paper", initialCash: 100000,
  maxPositions: 3, maxWeight: 0.25, lotSize: 100, commissionRate: 0.0003,
  sellTaxRate: 0, slippageRate: 0.001, riskFreeRate: 0, startDate: null, endDate: null,
};
const preview = (code: string): UniversePreview => ({
  id: 20, market: "CN", candidates: [{ code, reason: "指定股票" }],
  source: "固定范围", observedAt: "2026-10-03", coverage: "已确认",
  scope: { mode: "fixed", symbols: [code], query: "", maxCandidates: 12 },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const ignorePreview = () => {};
function ConfigHarness({ onPreview = ignorePreview }: { onPreview?: (value: UniversePreview | null) => void }) {
  const [inputText, setInputText] = useState("600519");
  return <>
    <label>外层股票输入<input value={inputText} onChange={event => setInputText(event.target.value)} /></label>
    <TradingAgentConfig config={config} inputText={inputText}
      codes={inputText === "未识别名称" ? null : [inputText]} inferredMarket="CN"
      onConfig={() => {}} onPreview={onPreview} />
  </>;
}
async function openWorkspaceConfig() {
  render(<MemoryRouter initialEntries={["/trading?view=manage"]}><TradingWorkspacePage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "配置策略" }));
  fireEvent.change(screen.getByRole("textbox", { name: "策略名称" }), { target: { value: "预览回归" } });
  const input = screen.getByRole("textbox", { name: "股票池（可选，名称或代码，最多 12 只）" });
  fireEvent.change(input, { target: { value: "600519" } });
  await screen.findByRole("option", { name: "内置网格" });
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.agentOptions.mockResolvedValue({ skills: [{ id: "high_volume_volatility_grid", name: "内置网格", description: "" }], accounts: [{ id: 1, name: "持仓账户", market: "CN" }], defaultPrompt: "" });
  api.list.mockResolvedValue([]);
  api.definitions.mockResolvedValue([]);
  api.runtimeStatus.mockResolvedValue({ configured: false, available: false });
  api.saveDefinition.mockResolvedValue({ id: 1 });
});

describe("TradingAgentConfig preview ownership", () => {
  it("ignores a failed old preview after editing the real outer input and saves a new preview", async () => {
    const old = deferred<UniversePreview>();
    api.previewUniverse.mockReturnValueOnce(old.promise).mockResolvedValueOnce(preview("000001"));
    const input = await openWorkspaceConfig();
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    expect(screen.getByRole("button", { name: "正在获取候选并按条件筛选…" })).toBeDisabled();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "000001" } });
    await act(async () => { old.reject(new Error("旧股票范围请求失败")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览股票范围" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已预览");
    expect(api.previewUniverse).toHaveBeenLastCalledWith("CN", expect.objectContaining({ symbols: ["000001"] }));
    fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
    await waitFor(() => expect(api.saveDefinition).toHaveBeenCalledWith(expect.objectContaining({
      symbols: ["000001"], universePreviewId: 20,
    })));
  });

  it("keeps the current preview failure until its real outer input changes", async () => {
    api.previewUniverse.mockRejectedValueOnce(new Error("当前股票范围请求失败"));
    const input = await openWorkspaceConfig();
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前股票范围请求失败");
    expect(screen.getByRole("button", { name: "预览股票范围" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "000001" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps an old successful preview out of the actual save action", async () => {
    const old = deferred<UniversePreview>();
    api.previewUniverse.mockReturnValueOnce(old.promise);
    const input = await openWorkspaceConfig();
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    fireEvent.change(input, { target: { value: "000001" } });
    await act(async () => { old.resolve(preview("600519")); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览股票范围" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先预览并确认股票范围");
    expect(api.saveDefinition).not.toHaveBeenCalled();
  });

  it("clears an obsolete preview validation message when the input is corrected", async () => {
    render(<ConfigHarness />);
    await screen.findByRole("option", { name: "内置网格" });
    fireEvent.change(screen.getByRole("textbox", { name: "外层股票输入" }), { target: { value: "未识别名称" } });
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先确认上方股票识别结果");
    expect(api.previewUniverse).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "外层股票输入" }), { target: { value: "000001" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves configuration loading failures when only the preview input changes", async () => {
    api.agentOptions.mockRejectedValueOnce(new Error("配置选项读取失败"));
    render(<ConfigHarness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("配置选项读取失败");
    fireEvent.change(screen.getByRole("textbox", { name: "外层股票输入" }), { target: { value: "000001" } });
    expect(screen.getByRole("alert")).toHaveTextContent("配置选项读取失败");
  });

  it("preserves holdings failures when only the preview input changes", async () => {
    api.holdings.mockRejectedValueOnce(new Error("持仓范围读取失败"));
    render(<ConfigHarness />);
    await screen.findByRole("option", { name: "内置网格" });
    fireEvent.change(screen.getByRole("combobox", { name: "范围来源" }), { target: { value: "holdings" } });
    fireEvent.change(screen.getByRole("combobox", { name: "持仓账户" }), { target: { value: "1" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("持仓范围读取失败");
    fireEvent.change(screen.getByRole("textbox", { name: "外层股票输入" }), { target: { value: "000001" } });
    expect(screen.getByRole("alert")).toHaveTextContent("持仓范围读取失败");
  });

  it("does not publish a preview after the configuration unmounts", async () => {
    const old = deferred<UniversePreview>();
    api.previewUniverse.mockReturnValueOnce(old.promise);
    const onPreview = vi.fn();
    const view = render(<ConfigHarness onPreview={onPreview} />);
    fireEvent.click(screen.getByRole("button", { name: "预览股票范围" }));
    view.unmount();
    await act(async () => { old.resolve(preview("600519")); });
    expect(onPreview).not.toHaveBeenCalledWith(expect.objectContaining({ id: 20 }));
  });
});
