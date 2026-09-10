import type { StockIndexItem, StockSuggestion } from "../types/stockIndex";
import { searchStocks } from "./searchStocks";
import { normalizeStockCode } from "./stockCode";

export type PoolStock = {
  code: string;
  name: string;
  market: "CN" | "HK" | "US";
};
export function poolCode(code: string): PoolStock | null {
  const normalized = normalizeStockCode(code)
    .toUpperCase()
    .replace(/\.US$/, "");
  const market = /^\d{6}$/.test(normalized)
    ? "CN"
    : /^HK\d{5}$/.test(normalized)
      ? "HK"
      : /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(normalized)
        ? "US"
        : null;
  return market ? { code: normalized, name: normalized, market } : null;
}
export function resolveStrategyPool(input: string, index: StockIndexItem[]) {
  // Reuse the research/autocomplete catalog and matching algorithm. Preserve exact English names containing spaces.
  index = index.filter(
    (s) => s.assetType !== "index" && poolCode(s.canonicalCode),
  );
  const exactName = (q: string) =>
    index.filter(
      (s) =>
        s.active &&
        [s.nameZh, s.nameEn, ...(s.aliases || [])].some(
          (n) => n?.toLowerCase() === q.toLowerCase(),
        ),
    );
  const parts = input
    .split(/[,，、;；\n]+/)
    .flatMap((s) =>
      exactName(s.trim()).length ? [s.trim()] : s.trim().split(/\s+/),
    )
    .filter(Boolean);
  return parts.map((query) => {
    const names = exactName(query);
    const hits: StockSuggestion[] = names.length
      ? names.map((s) => ({
          ...s,
          matchType: "exact",
          matchField: "name",
          score: 98,
        }))
      : searchStocks(query, index, { limit: 20 });
    const exact = hits.filter((s) => s.matchType === "exact");
    const choices = exact.length ? exact : hits;
    const candidates = [
      ...new Map(choices.map((s) => [s.canonicalCode, s])).values(),
    ];
    const matched = candidates.length === 1 ? candidates[0] : undefined;
    // Do not reinterpret an ambiguous name/pinyin as a US ticker.
    const stock = matched
      ? poolCode(matched.canonicalCode)
      : !candidates.length
        ? poolCode(query)
        : null;
    return {
      query,
      stock: stock ? { ...stock, name: matched?.nameZh || stock.name } : null,
      candidates,
    };
  });
}
