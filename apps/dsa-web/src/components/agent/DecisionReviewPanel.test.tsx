import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UiLanguageProvider } from "../../contexts/UiLanguageContext";
import DecisionReviewPanel from "./DecisionReviewPanel";

const api = vi.hoisted(() => ({ list: vi.fn(), getSignalOutcomes: vi.fn(), runOutcomes: vi.fn(), reassess: vi.fn() }));
vi.mock("../../api/decisionSignals", () => ({ decisionSignalsApi: api }));
const signal = { id: 7, stockCode: "600519", market: "cn", sourceType: "analysis", sourceReportId: 11,
  action: "hold", triggerSource: "web", status: "active", planQuality: "partial", reason: "等待证据", createdAt: "2026-09-07T00:00:00" };

describe("DecisionReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ items: [signal] });
    api.getSignalOutcomes.mockResolvedValue({ items: [] });
    api.runOutcomes.mockResolvedValue({ items: [], evaluated: 0 });
    api.reassess.mockResolvedValue({ item: signal, created: false });
  });
  it("uses persisted signal IDs and report snapshots, not workspace proposal IDs", async () => {
    render(<UiLanguageProvider><DecisionReviewPanel /></UiLanguageProvider>);
    await screen.findByRole("button", { name: "更新后验评估" });
    await waitFor(() => expect(api.getSignalOutcomes).toHaveBeenCalledWith(7));
    fireEvent.click(screen.getByRole("button", { name: "更新后验评估" }));
    await waitFor(() => expect(api.runOutcomes).toHaveBeenCalledWith({ signalId: 7, horizons: ["1d", "3d", "5d", "10d"] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存风险偏好评估" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存风险偏好评估" }));
    await waitFor(() => expect(api.reassess).toHaveBeenCalledWith({ sourceReportId: 11, decisionProfile: "balanced", persist: true }));
    expect(await screen.findByText(/没有创建订单/)).toBeVisible();
  });
  it("does not turn a load failure into an empty successful signal list", async () => {
    api.list.mockRejectedValue(new Error("offline"));
    render(<UiLanguageProvider><DecisionReviewPanel /></UiLanguageProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("信号读取失败");
    expect(screen.queryByText(/暂无研究信号/)).not.toBeInTheDocument();
  });
});
