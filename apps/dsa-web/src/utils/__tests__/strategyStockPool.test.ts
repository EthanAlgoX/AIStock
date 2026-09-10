import { expect, it } from "vitest";
import { resolveStrategyPool } from "../strategyStockPool";
import type { StockIndexItem } from "../../types/stockIndex";
const stocks: StockIndexItem[] = [
  {
    canonicalCode: "600519.SH",
    displayCode: "600519",
    nameZh: "贵州茅台",
    aliases: ["茅台"],
    pinyinAbbr: "gzmt",
    market: "CN",
    assetType: "stock",
    active: true,
  },
  {
    canonicalCode: "NVDA",
    displayCode: "NVDA",
    nameZh: "英伟达",
    nameEn: "NVIDIA Corporation",
    market: "US",
    assetType: "stock",
    active: true,
  },
  {
    canonicalCode: "00700.HK",
    displayCode: "00700",
    nameZh: "腾讯控股",
    aliases: ["腾讯"],
    market: "HK",
    assetType: "stock",
    active: true,
  },
  {
    canonicalCode: "000001.SZ",
    displayCode: "000001",
    nameZh: "平安银行",
    market: "CN",
    assetType: "stock",
    active: true,
  },
  {
    canonicalCode: "601318.SH",
    displayCode: "601318",
    nameZh: "中国平安",
    market: "CN",
    assetType: "stock",
    active: true,
  },
];
it("reuses name, alias, pinyin and code matching across markets", () => {
  expect(
    resolveStrategyPool("茅台、gzmt、腾讯、英伟达", stocks).map(
      (p) => p.stock?.code,
    ),
  ).toEqual(["600519", "600519", "HK00700", "NVDA"]);
  expect(resolveStrategyPool("NVIDIA Corporation", stocks)[0].stock?.code).toBe(
    "NVDA",
  );
  expect(
    resolveStrategyPool("600519.SH 00700.HK nvda", stocks).map(
      (p) => p.stock?.market,
    ),
  ).toEqual(["CN", "HK", "US"]);
});
it("requires a choice for ambiguous names and does not guess unknown names", () => {
  const [p] = resolveStrategyPool("平安", stocks);
  expect(p.stock).toBeNull();
  expect(p.candidates).toHaveLength(2);
  expect(resolveStrategyPool("不知道的公司", stocks)[0].stock).toBeNull();
});
