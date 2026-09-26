import type { Portfolio, PortfolioTiming } from "../api/portfolios";

// Native portfolios have a fixed daily engine. Private legacy data remains unknown
// until the runtime supplies its contract; a 1h signal is not a 1h valuation.
export function portfolioTiming(portfolio: Portfolio): PortfolioTiming | null {
  return (
    portfolio.timing ??
    (portfolio.config.externalRuntime
      ? null
      : {
          signalTimeframe: "1d",
          valuation: "bar_close",
          execution: "next_open",
          timezone: portfolio.market === "CRYPTO" ? "UTC" : "market",
          granularity: "trading_day",
        })
  );
}
export function signalLabel(timeframe?: string) {
  return timeframe === "1d"
    ? "日级决策"
    : timeframe === "1h"
      ? "小时级决策"
      : timeframe === "tick"
        ? "逐笔决策"
        : "决策周期待确认";
}
export function valuationLabel(valuation?: string) {
  return valuation === "live_quote"
    ? "实时报价估值"
    : valuation === "bar_close"
      ? "收盘估值"
      : "估值频率待确认";
}

/** Keep date-only records intact; only explicitly zoned timestamps become UTC. */
export function recordTime(value?: string | null) {
  if (!value) return "—";
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 19).replace("T", " ") + " UTC"
    : value;
}
