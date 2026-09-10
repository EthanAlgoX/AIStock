import client from "./index";
export type RuleConfig = {
  name: string;
  template: string;
  market: "CN" | "US" | "HK";
  symbols: string[];
  mode: "paper" | "backtest";
  initialCash: number;
  maxPositions: number;
  maxWeight: number;
  lotSize: number;
  commissionRate: number;
  sellTaxRate: number;
  slippageRate: number;
  riskFreeRate: number;
  startDate: string | null;
  endDate: string | null;
  benchmarkName?: string;
  benchmark?: string;
};
export type Holding = {
  code: string;
  quantity: number;
  averageCost: number;
  price: number;
  marketValue: number;
  unrealizedPnl: number;
};
export type Opinion = {
  code: string;
  stance: "bullish" | "bearish" | "neutral";
  reason: string;
  held: boolean;
};
export type PaperTrade = {
  code: string;
  side: "buy" | "sell";
  quantity: number;
  price: number | null;
  fee: number;
  reason: string;
  signalDate: string;
  status: string;
};
export type PortfolioDay = {
  date: string;
  equity: number;
  cash: number;
  marketValue: number;
  dailyReturn: number;
  benchmarkReturn: number | null;
  holdings: Holding[];
  opinions: Opinion[];
  trades: PaperTrade[];
  workspaceRunId?: string;
  paused?: boolean;
  replayed?: boolean;
  recordedAt?: string;
};
export type Portfolio = {
  id: number;
  name: string;
  market: string;
  mode: "paper" | "backtest";
  status: string;
  lastDate: string | null;
  error: string | null;
  busy: boolean;
  versionId: number;
  config: RuleConfig;
  nextCheck: string;
  currency?: string;
  comparisons?: {
    id: number;
    name: string;
    mode: string;
    startDate: string | null;
    endDate: string | null;
    samples: number;
    metrics: Record<string, number | null>;
  }[];
  metrics?: Record<string, number | null>;
  days?: PortfolioDay[];
};
const root = "/api/v1/simulation/portfolios";
export const portfoliosApi = {
  list: async () => (await client.get<{ items: Portfolio[] }>(root)).data.items,
  templates: async () =>
    (
      await client.get<{
        items: { id: string; name: string; description: string }[];
      }>(`${root}/templates`)
    ).data.items,
  detail: async (id: number) =>
    (await client.get<Portfolio>(`${root}/${id}`)).data,
  create: async (config: RuleConfig) => {
    // Detail responses also contain immutable server metadata; never send it as input.
    const {
      name,
      template,
      market,
      symbols,
      mode,
      initialCash,
      maxPositions,
      maxWeight,
      lotSize,
      commissionRate,
      sellTaxRate,
      slippageRate,
      riskFreeRate,
      startDate,
      endDate,
    } = config;
    return (
      await client.post<Portfolio>(root, {
        name,
        template,
        market,
        symbols,
        mode,
        initialCash,
        maxPositions,
        maxWeight,
        lotSize,
        commissionRate,
        sellTaxRate,
        slippageRate,
        riskFreeRate,
        startDate,
        endDate,
      })
    ).data;
  },
  control: async (id: number, action: "run" | "start" | "pause") =>
    (await client.post<Portfolio>(`${root}/${id}/control`, { action })).data,
};
