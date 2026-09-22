import { expect, it, vi } from "vitest";
import { portfoliosApi, type RuleConfig } from "../portfolios";
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("../index", () => ({ default: client }));
it("uses the versioned endpoint and strips server metadata when copying an account", async () => {
  client.get.mockResolvedValue({ data: { items: [] } });
  client.post.mockResolvedValue({ data: { id: 2 } });
  await portfoliosApi.list();
  expect(client.get).toHaveBeenCalledWith("/api/v1/simulation/portfolios");
  const config = {
    name: "Copy",
    template: "agent",
    engine: "agent",
    skillId: "price",
    universePreviewId: 1,
    market: "US",
    mode: "paper",
    symbols: ["AAPL"],
    initialCash: 100000,
    maxPositions: 3,
    maxWeight: 0.25,
    lotSize: 1,
    commissionRate: 0.0003,
    sellTaxRate: 0,
    slippageRate: 0.001,
    riskFreeRate: 0,
    startDate: null,
    endDate: null,
  } satisfies RuleConfig;
  await portfoliosApi.create({
    ...config,
    benchmark: "SPY",
    benchmarkName: "S&P500",
    engineVersion: 1,
  } as RuleConfig);
  expect(client.post).toHaveBeenCalledWith(
    "/api/v1/simulation/portfolios",
    { ...config, reportLanguage: "zh" },
  );
});

it("saves Agent strategies without a validation mode or server metadata", async () => {
  client.post.mockResolvedValue({ data: { id: 3 } });
  await portfoliosApi.saveDefinition({
    name: "Saved",
    template: "agent",
    engine: "agent",
    skillId: "price",
    universePreviewId: 1,
    market: "US",
    symbols: ["AAPL"],
    mode: "backtest",
    startDate: "2025-01-01",
    endDate: "2025-02-01",
    definitionId: 99,
    benchmark: "SPY",
  } as unknown as RuleConfig);
  const payload = client.post.mock.calls.at(-1)![1];
  expect(client.post.mock.calls.at(-1)![0]).toBe(
    "/api/v1/simulation/portfolios/definitions",
  );
  expect(payload).not.toHaveProperty("mode");
  expect(payload).not.toHaveProperty("startDate");
  expect(payload).not.toHaveProperty("definitionId");
});


it.each(["saveDefinition", "create"] as const)("%s sends the selected JEV backend and sizing to the API", async (method) => {
  client.post.mockResolvedValue({ data: { id: 3 } });
  await portfoliosApi[method]({name:"JEV", template:"agent", market:"US", symbols:["AAPL"],
    decisionBackend:"jev", jevWeightStep:0.1, jevTask:{question:"Range direction?",lookbackDays:7}, jevModel:"server-frozen-version"} as RuleConfig);
  const payload = client.post.mock.calls.at(-1)![1];
  expect(payload).toMatchObject({decisionBackend:"jev", jevWeightStep:0.1, jevTask:{question:"Range direction?",lookbackDays:7}});
  expect(payload).not.toHaveProperty("jevModel");
});

it("updates only writable settings with optimistic revision control", async () => {
  client.put.mockResolvedValue({data:{id:7}});
  await portfoliosApi.saveDefinition({name:"Changed",definitionRevision:3,mode:"paper",universe:{id:9},skillSnapshot:{name:"frozen"}} as RuleConfig,{id:7,revision:3});
  expect(client.put).toHaveBeenCalledWith("/api/v1/simulation/portfolios/definitions/7",expect.objectContaining({name:"Changed",expectedRevision:3}));
  const payload=client.put.mock.calls.at(-1)![1];
  for (const field of ["definitionRevision","mode","universe","skillSnapshot"]) expect(payload).not.toHaveProperty(field);
});

it.each(["custom", "fixed", "holdings"] as const)(
  "re-previews a saved %s scope using only editable fields",
  async (mode) => {
    const inputs = {
      mode, symbols: ["688233"], accountId: 7,
      query: "半导体，成交活跃", industries: ["半导体"],
      allIndustries: false, maxCandidates: 1,
    };
    const savedScope = {
      ...inputs,
      selection: { summary: "Old selection", candidates: ["688233", "688981"] },
      rule: { industryTerms: ["半导体"], minVolatility: null, description: "Old rule" },
      reportLanguage: "en",
    };
    const snapshot = structuredClone(savedScope);
    const preview = { id: 42, scope: { ...inputs }, candidates: [{ code: "688233" }] };
    client.post.mockResolvedValueOnce({ data: preview });

    expect(await portfoliosApi.previewUniverse("CN", savedScope)).toEqual(preview);
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/v1/simulation/portfolios/universe-preview",
      { market: "CN", scope: inputs, reportLanguage: "zh" },
      { timeout: 180000 },
    );
    expect(savedScope).toEqual(snapshot);

    client.put.mockResolvedValueOnce({ data: { id: 7 } });
    await portfoliosApi.saveDefinition({
      name: "Renamed high volume strategy", universePreviewId: preview.id,
      symbols: preview.candidates.map((candidate) => candidate.code),
    } as RuleConfig, { id: 7, revision: 3 });
    expect(client.put).toHaveBeenLastCalledWith(
      "/api/v1/simulation/portfolios/definitions/7",
      expect.objectContaining({
        name: "Renamed high volume strategy", universePreviewId: 42,
        symbols: ["688233"], expectedRevision: 3,
      }),
    );
  },
);
