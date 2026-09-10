import client from "./index";
export type UniverseScope = {
  mode: "fixed" | "holdings" | "custom";
  symbols: string[];
  accountId?: number;
  query: string;
  maxCandidates: number;
};
export type UniversePreview = {
  market: "CN" | "HK" | "US";
  id: number;
  candidates: {
    code: string;
    name?: string;
    reason: string;
    industry?: string;
  }[];
  source: string;
  observedAt: string;
  coverage: string;
  scope: UniverseScope & { rule?: { description: string } };
};
export type AgentOptions = {
  skills: { id: string; name: string; description: string }[];
  accounts: { id: number; name: string; market: string }[];
  defaultPrompt: string;
};
export type RuleConfig = {
  engine?: "rule" | "agent";
  skillId?: string;
  systemPrompt?: string;
  universePreviewId?: number;
  scopeRefresh?: "snapshot" | "daily" | "weekly";
  runTokenBudget?: number;
  universe?: UniversePreview;
  skillSnapshot?: { name: string; digest: string };
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
  universe?: UniversePreview;
  usage?: { tokens: number; model: string };
  validationLabel?: string;
};
export type Portfolio = {
  id: number;
  definitionId?: number | null;
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
  agentCalls?: {id:number;status:string;model:string;answer:string;input:unknown;error?:string;usage:Record<string,number>;createdAt:string}[];
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
export type StrategyDefinition = {
  id: number;
  name: string;
  config: Omit<RuleConfig, "mode" | "startDate" | "endDate">;
};
export type ValidationOptions = {
  mode: "paper" | "backtest";
  initialCash: number;
  startDate: string | null;
  endDate: string | null;
  historyMode?: "rules" | "ai_replay";
  universeHistory?: "frozen" | "recorded";
};
const root = "/api/v1/simulation/portfolios";
export const portfoliosApi = {
  agentOptions: async () =>
    (await client.get<AgentOptions>(`${root}/agent-options`)).data,
  holdings: async (id: number) =>
    (
      await client.get<{ items: { symbol: string; quantity: number }[] }>(
        `${root}/holdings/${id}`,
      )
    ).data.items,
  previewUniverse: async (market: string, scope: UniverseScope) =>
    (
      await client.post<UniversePreview>(
        `${root}/universe-preview`,
        { market, scope },
        { timeout: 180000 },
      )
    ).data,
  definitions: async () =>
    (await client.get<{ items: StrategyDefinition[] }>(`${root}/definitions`))
      .data.items,
  saveDefinition: async (config: RuleConfig) => {
    const {
      name,
      template,
      market,
      symbols,
      initialCash,
      maxPositions,
      maxWeight,
      lotSize,
      commissionRate,
      sellTaxRate,
      slippageRate,
      riskFreeRate,
    } = config;
    const agentFields =
      config.engine === "agent"
        ? {
            engine: config.engine,
            skillId: config.skillId,
            systemPrompt: config.systemPrompt,
            universePreviewId: config.universePreviewId,
            scopeRefresh: config.scopeRefresh,
            runTokenBudget: config.runTokenBudget,
          }
        : {};
    return (
      await client.post<StrategyDefinition>(`${root}/definitions`, {
        ...agentFields,
        name,
        template,
        market,
        symbols,
        initialCash,
        maxPositions,
        maxWeight,
        lotSize,
        commissionRate,
        sellTaxRate,
        slippageRate,
        riskFreeRate,
      })
    ).data;
  },
  createValidation: async (id: number, options: ValidationOptions) =>
    (
      await client.post<Portfolio>(
        `${root}/definitions/${id}/validations`,
        options,
      )
    ).data,
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
