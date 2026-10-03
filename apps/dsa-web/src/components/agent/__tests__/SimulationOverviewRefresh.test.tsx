import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Portfolio, SimulationCurve } from "../../../api/portfolios";
import { SimulationOverview } from "../SimulationOverview";

const api = vi.hoisted(() => ({ overview: vi.fn(), detail: vi.fn() }));
vi.mock("../../../api/portfolios", () => ({
  simulationOverviewApi: { get: api.overview },
  portfoliosApi: { detail: api.detail },
}));
// Keep the actual overview and inline loader/state. Replace only the leaf
// workspace so its account/panel callbacks and returned records are observable.
vi.mock("../PortfolioDetailWorkspace", () => ({
  PortfolioDetailWorkspace: ({ portfolio, panel, onPanel, onSelect }: {
    portfolio: Portfolio;
    panel: string;
    onPanel: (panel: string) => void;
    onSelect: (id: number) => void;
  }) => <div>
    <p data-testid="detail-account">Account {portfolio.id}</p>
    <p data-testid="detail-panel">{panel}</p>
    <button onClick={() => onPanel("decisions")}>Decision panel</button>
    <button onClick={() => onSelect(9)}>Related account</button>
    {portfolio.executionLedger?.map(record => <p key={record.id}>{record.reason}</p>)}
  </div>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const row: SimulationCurve = {
  id: 1, name: "Live strategy", market: "US", status: "running", error: false,
  externalRuntime: false, initialCash: 10000, currency: "USD", observations: 0,
  cumulativeReturn: null, maxDrawdown: null, lastDate: null, curve: [],
};
const overview = (value = row) => ({ items: [value], runtime: { configured: false, available: false } });
const portfolio = (id = 1, reason = "Previously recorded trade"): Portfolio => ({
  id, name: `Account ${id}`, market: "US", mode: "paper", status: "running",
  lastDate: "2026-10-03T12:00:00Z", error: null, busy: false, versionId: 1,
  nextCheck: "2026-10-03T12:30:00Z", currency: "USD",
  config: {
    name: "Fixture", template: "agent", market: "US", symbols: ["AAPL"], mode: "paper",
    initialCash: 10000, maxPositions: 5, maxWeight: .2, lotSize: 1,
    commissionRate: 0, sellTaxRate: 0, slippageRate: 0, riskFreeRate: 0,
    startDate: null, endDate: null,
  },
  executionLedger: [{ id: reason, timestamp: "2026-10-03T12:00:00Z", code: "AAPL",
    side: "buy", quantity: 2, price: 10, fee: 0, reason, status: "filled" }],
});

async function mountExpanded() {
  const view = render(<SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /Live strategy/ }));
  await act(async () => {});
  return view;
}

describe("simulation overview and inline detail refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("dsa.uiLanguage", "zh");
    api.overview.mockResolvedValue(overview());
    api.detail.mockImplementation(async (id: number) => portfolio(id));
  });
  afterEach(() => {
    // Unmount before restoring timers so both real loader effects cancel their
    // polling handles and stop publishing loading changes.
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("refreshes both requests once, waits for the selected detail and preserves view choices", async () => {
    await mountExpanded();
    fireEvent.click(screen.getByRole("button", { name: "Related account" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Decision panel" }));
    fireEvent.change(screen.getByRole("combobox", { name: "市场" }), { target: { value: "US" } });
    fireEvent.change(screen.getByRole("combobox", { name: "曲线范围" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "包含暂停和停止的账户" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示可用基准" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /在收益曲线中显示/ }));
    const newOverview = deferred<ReturnType<typeof overview>>();
    const newDetail = deferred<Portfolio>();
    api.overview.mockReturnValueOnce(newOverview.promise);
    api.detail.mockReturnValueOnce(newDetail.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.detail).toHaveBeenCalledTimes(3);
    expect(api.detail).toHaveBeenLastCalledWith(9);
    const busy = screen.getByRole("button", { name: "刷新中..." });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.detail).toHaveBeenCalledTimes(3);
    await act(async () => newOverview.resolve(overview({ ...row, cumulativeReturn: .15 })));
    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled();
    expect(screen.getByText("Previously recorded trade")).toBeInTheDocument();
    await act(async () => newDetail.resolve(portfolio(9, "Newly recorded trade")));
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    expect(screen.getByText("Newly recorded trade")).toBeInTheDocument();
    expect(screen.queryByText("Previously recorded trade")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Live strategy/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("detail-account")).toHaveTextContent("Account 9");
    expect(screen.getByTestId("detail-panel")).toHaveTextContent("decisions");
    expect(screen.getByRole("button", { name: "返回模拟账户" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "市场" })).toHaveValue("US");
    expect(screen.getByRole("combobox", { name: "曲线范围" })).toHaveValue("7");
    expect(screen.getByRole("checkbox", { name: "包含暂停和停止的账户" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "显示可用基准" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /在收益曲线中显示/ })).not.toBeChecked();
  });

  it("retains previous overview/detail on failure and retries without collapsing the account", async () => {
    await mountExpanded();
    fireEvent.click(screen.getByRole("button", { name: "Decision panel" }));
    const failedOverview = deferred<ReturnType<typeof overview>>();
    const failedDetail = deferred<Portfolio>();
    api.overview.mockReturnValueOnce(failedOverview.promise);
    api.detail.mockReturnValueOnce(failedDetail.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await act(async () => {
      failedOverview.reject(new Error("Overview unavailable"));
      failedDetail.reject(new Error("Detail unavailable"));
    });
    expect(screen.getByText(/Overview unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Detail unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Previously recorded trade")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Live strategy/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    api.overview.mockResolvedValueOnce(overview({ ...row, cumulativeReturn: .2 }));
    api.detail.mockResolvedValueOnce(portfolio(1, "Recovered trade"));
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await act(async () => {});
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Recovered trade")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("detail-panel")).toHaveTextContent("decisions");
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
  });

  it("refreshes the overview without requesting unopened details", async () => {
    render(<SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()} />);
    await act(async () => {});
    const pending = deferred<ReturnType<typeof overview>>();
    api.overview.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.detail).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled();
    await act(async () => pending.resolve(overview()));
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    expect(api.detail).not.toHaveBeenCalled();
  });

  it("allows manual recovery after the initial overview fails without loading details", async () => {
    api.overview.mockRejectedValueOnce(new Error("Initial overview failed"));
    render(<SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Initial overview failed");
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Live strategy/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.detail).not.toHaveBeenCalled();
  });

  it("releases a collapsed pending detail without letting its late response release the new account", async () => {
    api.overview.mockResolvedValue({ ...overview(), items: [row, { ...row, id: 2, name: "Other strategy" }] });
    const oldDetail = deferred<Portfolio>();
    const newDetail = deferred<Portfolio>();
    api.detail.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(newDetail.promise);
    await mountExpanded();
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Live strategy/ }));
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Other strategy/ }));
    expect(api.detail.mock.calls).toEqual([[1], [2]]);
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled();
    await act(async () => oldDetail.resolve(portfolio(1, "Late old-account trade")));
    expect(screen.queryByText("Late old-account trade")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-account")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled();
    await act(async () => newDetail.resolve(portfolio(2, "Current account trade")));
    expect(screen.getByTestId("detail-account")).toHaveTextContent("Account 2");
    expect(screen.getByText("Current account trade")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
  });

  it("keeps both 30-second polls and cancels timers and late responses after unmount", async () => {
    const view = await mountExpanded();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.detail).toHaveBeenCalledTimes(2);
    const pendingOverview = deferred<ReturnType<typeof overview>>();
    const pendingDetail = deferred<Portfolio>();
    api.overview.mockReturnValueOnce(pendingOverview.promise);
    api.detail.mockReturnValueOnce(pendingDetail.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    view.unmount();
    await act(async () => {
      pendingOverview.resolve(overview());
      pendingDetail.resolve(portfolio(1, "Late trade"));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(api.overview).toHaveBeenCalledTimes(3);
    expect(api.detail).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Late trade")).not.toBeInTheDocument();
  });
});
