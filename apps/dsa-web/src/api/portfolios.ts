import client from "./index";
import { getRuntimeInitialLanguage } from "../utils/uiLanguage";
export type UniverseScope = {
  mode: "fixed" | "holdings" | "custom";
  symbols: string[];
  accountId?: number;
  query: string;
  industries?: string[];
  allIndustries?: boolean;
  maxCandidates: number;
  candidateRanking?: "balanced" | "volume_volatility";
};
export type UniversePreview = {
  market: "CN" | "HK" | "US" | "TW" | "JP" | "KR" | "CRYPTO";
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
  coverageStats?: { directoryCount: number; eligibleCount: number; modelCount: number; monthlyEvidenceCount: number; sampled: boolean; ranking?: "volume_volatility"; evaluatedCount?: number; validCount?: number; missingCount?: number; asOf?: string };
  scope: UniverseScope & { rule?: { description: string } };
};
export type AgentOptions = {
  decisionModels?: { id: "llm" | "jev" | "rules"; available: boolean; model?: string }[];
  skills: { id: string; name: string; description: string }[];
  accounts: { id: number; name: string; market: string }[];
  defaultPrompt: string;
};
export type JevTaskConfig = {
  question?: string;
  criteria?: { buy?: string; sell?: string; hold?: string };
  background?: string;
  lookbackDays?: number;
};
export type RuleConfig = {
  externalRuntime?: boolean;
  sourceStartDate?: string;
  sourceEndDate?: string;
  timeframe?: string;
  evaluationKind?: string;
  reportLanguage?: string;
  definitionRevision?: number;
  jevTask?: JevTaskConfig;
  decisionBackend?: "llm" | "jev" | "rules";
  ruleVersion?: string;
  jevWeightStep?: number;
  jevModel?: string;
  engine?: "agent";
  skillId?: string;
  systemPrompt?: string;
  universePreviewId?: number;
  scopeRefresh?: "snapshot" | "daily" | "weekly";
  runTokenBudget?: number;
  universe?: UniversePreview;
  skillSnapshot?: { name: string; digest: string };
  name: string;
  template: "agent";
  market: "CN" | "US" | "HK" | "TW" | "JP" | "KR" | "CRYPTO";
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
  cryptoLookbackDays?: number;
  cryptoRebalanceDays?: number;
  cryptoAllocation?: number;
  cryptoTopN?: number;
  gridLookbackDays?: number;
  gridMinVolumeRatio?: number;
  gridMinRange?: number;
  gridLevels?: number;
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
  decisionBackend?: "jev" | "rules";
  decision?: "buy" | "sell" | "hold";
  probabilities?: Record<"buy" | "sell" | "hold", number>;
  confidence?: number;
  targetWeight?: number;
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
  timing?: PortfolioTiming | null;
  executionLedger?: SimulationExecution[] | null;
  executionCoverage?: {source: string; sourceCount: number | null; returnedCount: number} | null;
  externalEvidence?: {recomputedAt?: string; sourceUpdatedAt: string; sourceBacktest: string; tradeCount?: number; fees?: number; slippage?: number; positions?: unknown; trades: unknown[]; decisions: unknown[]; lastClosedBar?: string; feedStatus?: string; modelEvaluation?: string};
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
  evaluation?: {
    protocolId: string; sampleHash: string | null; cohortKey: string;
    firstDate: string | null; lastDate: string | null; samples: number; complete: boolean | null;
    capitalMode: string; markPrice: string; filledOrders: number; rejectedOrders: number;
    feesPaid: number; slippagePaid: number; averageExposure: number | null;
    benchmarkPriceReturn: number | null; excessVsBenchmark: number | null;
  };
  comparisons?: {
    id: number;
    name: string;
    mode: string;
    startDate: string | null;
    endDate: string | null;
    samples: number;
    metrics: Record<string, number | null>;
    comparable?: boolean;
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
  runtimeStatus: async () => (await client.get<{configured: boolean; available: boolean}>(`${root}/runtime-status`)).data,
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
        {
          market,
          // Saved previews contain derived selection/rule metadata. Only send
          // editable inputs so re-previewing recomputes the candidate selection.
          scope: {
            mode: scope.mode,
            symbols: scope.symbols,
            accountId: scope.accountId,
            query: scope.query,
            industries: scope.industries,
            allIndustries: scope.allIndustries,
            maxCandidates: scope.maxCandidates,
            ...(scope.candidateRanking ? { candidateRanking: scope.candidateRanking } : {}),
          },
          reportLanguage: getRuntimeInitialLanguage(),
        },
        { timeout: 360000 },
      )
    ).data,
  stopDefinition: async (id: number) =>
    (await client.post(`${root}/definitions/${id}/stop`)).data,
  deleteDefinition: async (id: number) =>
    (await client.delete(`${root}/definitions/${id}`)).data,
  deletePortfolio: async (id: number) =>
    (await client.delete(`${root}/${id}`)).data,
  definitions: async () =>
    (await client.get<{ items: StrategyDefinition[] }>(`${root}/definitions`))
      .data.items,
  saveDefinition: async (config: RuleConfig, editing?: { id: number; revision: number }) => {
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
      cryptoLookbackDays, cryptoRebalanceDays, cryptoAllocation, cryptoTopN,
      gridLookbackDays,
      gridMinVolumeRatio,
      gridMinRange,
      gridLevels,
    } = config;
    const data = {
      reportLanguage: getRuntimeInitialLanguage(),
      engine: "agent",
      decisionBackend: config.decisionBackend,
      jevWeightStep: config.jevWeightStep,
      jevTask: config.jevTask,
      skillId: config.skillId,
      systemPrompt: config.systemPrompt,
      universePreviewId: config.universePreviewId,
      scopeRefresh: config.scopeRefresh,
      runTokenBudget: config.runTokenBudget,
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
      cryptoLookbackDays, cryptoRebalanceDays, cryptoAllocation, cryptoTopN,
      gridLookbackDays,
      gridMinVolumeRatio,
      gridMinRange,
      gridLevels,
    };
    return editing
      ? (await client.put<StrategyDefinition>(`${root}/definitions/${editing.id}`, { ...data, expectedRevision: editing.revision })).data
      : (await client.post<StrategyDefinition>(`${root}/definitions`, data)).data;
  },
  createValidation: async (id: number, options: ValidationOptions) =>
    (
      await client.post<Portfolio>(
        `${root}/definitions/${id}/validations`,
        options,
      )
    ).data,
  list: async () => (await client.get<{ items: Portfolio[] }>(root)).data.items,
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
      cryptoLookbackDays, cryptoRebalanceDays, cryptoAllocation, cryptoTopN,
      gridLookbackDays,
      gridMinVolumeRatio,
      gridMinRange,
      gridLevels,
      startDate,
      endDate,
      skillId,
      systemPrompt,
      universePreviewId,
      scopeRefresh,
      runTokenBudget,
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
        cryptoLookbackDays, cryptoRebalanceDays, cryptoAllocation, cryptoTopN,
        gridLookbackDays,
        gridMinVolumeRatio,
        gridMinRange,
        gridLevels,
        startDate,
        endDate,
        engine: "agent",
        reportLanguage: getRuntimeInitialLanguage(),
        decisionBackend: config.decisionBackend,
        jevWeightStep: config.jevWeightStep,
        jevTask: config.jevTask,
        skillId,
        systemPrompt,
        universePreviewId,
        scopeRefresh,
        runTokenBudget,
      })
    ).data;
  },
  control: async (id: number, action: "run" | "start" | "pause" | "stop") =>
    (await client.post<Portfolio>(`${root}/${id}/control`, { action })).data,
};

export type ResearchMetrics = {sharpe: number | null; cumulativeReturn: number; maxDrawdown: number; filledOrders: number};
export type PortfolioResearch = {
  id: number; sourceId: number; candidateDefinitionId: number | null; accepted: boolean;
  sampleHash: string; finalReason: string; bestIndex: number | null;
  windows: Record<string, {start: string; end: string; samples: number}>;
  baseline: Record<string, ResearchMetrics>; final: ResearchMetrics | null;
  experiments: {field: string; before: number; after: number; reason: string; train: ResearchMetrics; validation: ResearchMetrics}[];
};
export const portfolioResearchApi = {
  list: async (id: number) => (await client.get<{items: PortfolioResearch[]}>(`${root}/${id}/research`)).data.items,
  create: async (id: number, maxDrawdown: number) => (await client.post<PortfolioResearch>(`${root}/${id}/research`, {maxDrawdown, budget: 12})).data,
  adopt: async (id: number) => (await client.post<{id: number}>(`${root}/research/${id}/adopt`)).data,
};

export type SimulationCurve = {
  timing?: PortfolioTiming | null;
  id: number; definitionId?: number; name: string; market: RuleConfig['market']; status: string;
  error: boolean; externalRuntime: boolean; initialCash: number; currency: string;
  cumulativeReturn: number | null; maxDrawdown: number | null; lastDate: string | null; observations: number;
  curve: {time: string; value: number; benchmark: number | null}[];
};
export type SourceEvolution = {
  id: string; status: string; completed: number; budget: number; createdAt: string; passed: boolean; finalChecked: boolean;
  candidateVersion?: string; evaluation: Record<string, unknown>; holdout: Record<string, unknown>;
  experiments: {ordinal: number; change_json: unknown; validation_metrics_json: {sharpe?: number; total_return?: number; max_drawdown?: number}; decision: string; reason: string}[];
};
export const simulationOverviewApi = {
  get: async () => (await client.get<{items: SimulationCurve[]; runtime: {configured: boolean; available: boolean}}>(`${root}/overview`)).data,
  evolution: async (id: number) => (await client.get<{supported: boolean; items: SourceEvolution[]}>(`${root}/${id}/evolution`)).data,
  evolve: async (id: number, maxDrawdown: number) => (await client.post<{supported: boolean; items: SourceEvolution[]}>(`${root}/${id}/evolution`, {budget: 12, maxDrawdown})).data,
};

export type SimulationExecution = {
  id: string; timestamp: string; code: string; side: 'buy' | 'sell'; quantity: number;
  price: number | null; fee: number | null; reason: string; status: string;
};


export type PortfolioTiming = {
  signalTimeframe: string;
  valuation: 'live_quote' | 'bar_close';
  execution: 'quote_simulation' | 'next_open';
  timezone: 'UTC' | 'market';
  granularity: 'observation' | 'bar' | 'trading_day';
};
