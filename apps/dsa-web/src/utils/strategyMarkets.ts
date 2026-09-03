import type { StrategyDataSource } from "../api/strategyWorkspace";

export const STRATEGY_MARKETS = [
  { value: "cn", label: "A 股" },
  { value: "hk", label: "港股" },
  { value: "us", label: "美股" },
] as const;

export type StrategyMarket = (typeof STRATEGY_MARKETS)[number]["value"];

export function strategyMarketLabel(market: string, language: "zh" | "en" = "zh") {
  if (language === "en") {
    return ({ cn: "China A-shares", hk: "Hong Kong", us: "US" } as Record<string, string>)[market.toLowerCase()] || market.toUpperCase();
  }
  return (
    STRATEGY_MARKETS.find((item) => item.value === market.toLowerCase())
      ?.label || market.toUpperCase()
  );
}

export function dataSourceSupportsMarket(
  source: StrategyDataSource,
  market: string,
) {
  return (
    !source.markets?.length ||
    source.markets.some((item) => item.toLowerCase() === market.toLowerCase())
  );
}

export function dataSourceMarketSummary(source: StrategyDataSource, language: "zh" | "en" = "zh") {
  return source.markets?.length
    ? source.markets.map((market) => strategyMarketLabel(market, language)).join(" / ")
    : language === "en" ? "Legacy source · no market restriction" : "历史来源 · 未限制市场";
}
