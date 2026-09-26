import { recordTime } from "../utils/portfolioTiming";
import { localizedStockName } from "../utils/markets";
import { PortfolioDetailWorkspace } from "../components/agent/PortfolioDetailWorkspace";
import { SimulationOverview } from "../components/agent/SimulationOverview";
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { strategyDraftsApi } from "../api/strategyDrafts";
import { isAxiosError } from "axios";
import { extractErrorPayloadText, toApiErrorMessage } from "../api/error";
import { useStockIndex } from "../hooks/useStockIndex";
import { resolveStrategyPool } from "../utils/strategyStockPool";
import { TradingAgentConfig } from "../components/agent/TradingAgentConfig";
import ResearchReportsWorkspace from "./ResearchReportsWorkspace";
import { AppPage, ConfirmDialog } from "../components/common";
import {
  portfoliosApi,
  type Portfolio,
  type RuleConfig,
  type StrategyDefinition,
  type UniversePreview,
} from "../api/portfolios";

const status = (p: Portfolio) =>
  p.busy
    ? "更新中"
    : p.mode === "backtest" && p.status !== "stopped" && !!p.error
      ? "历史验证中断"
    : p.status === "running"
      ? "持续模拟"
      : p.status === "paused"
        ? "已暂停交易"
        : p.status === "stopped"
          ? "已停止运行"
          : p.status === "completed"
          ? "回测完成"
          : "待运行";
const failure = (e: unknown) => {
  if (isAxiosError(e) && Array.isArray(e.response?.data?.detail)) {
    return `请检查填写内容：${extractErrorPayloadText(e.response.data.detail)}`;
  }
  return toApiErrorMessage(e);
};
const seed: RuleConfig = {
  name: "",
  template: "agent",
  engine: "agent",
  decisionBackend: "rules",
  skillId: "high_volume_volatility_grid",
  market: "CN",
  symbols: [],
  mode: "paper",
  initialCash: 100000,
  maxPositions: 3,
  maxWeight: 0.25,
  lotSize: 100,
  commissionRate: 0.0003,
  sellTaxRate: 0,
  slippageRate: 0.001,
  riskFreeRate: 0,
  gridLookbackDays: 5,
  gridMinVolumeRatio: 1.3,
  gridMinRange: 0.05,
  gridLevels: 5,
  startDate: null,
  endDate: null,
};
export default function TradingWorkspacePage() {
  const uiLiteral = useUiLiteral();
  const { language } = useUiLanguage();
  const [params, setParams] = useSearchParams();
  const legacy =
    params.get("view") === "reports" ||
    params.has("sourceRun") ||
    params.has("run");
  const id = Number(params.get("portfolio")) || null;
  const definitionId = Number(params.get("strategy")) || null;
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [definitions, setDefinitions] = useState<StrategyDefinition[]>([]);
  const definition = definitions.find((d) => d.id === definitionId);
  const [launch, setLaunch] = useState<"run" | "start" | "backtest" | null>(
    null,
  );
  const [validationCash, setValidationCash] = useState(100000);
  const [validationStart, setValidationStart] = useState("");
  const [validationEnd, setValidationEnd] = useState("");
  const [items, setItems] = useState<Portfolio[]>([]);
  const [detail, setDetail] = useState<Portfolio | null>(null);
  const [universePreview, setUniversePreview] =
    useState<UniversePreview | null>(null);
  const [universeHistory, setUniverseHistory] = useState<"frozen" | "recorded">(
    "frozen",
  );
  const [sourceQuery, setSourceQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{id: number; revision: number} | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const [draft, setDraft] = useState<RuleConfig>(seed);
  const [symbols, setSymbols] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{kind: 'definition' | 'portfolio'; id: number; name: string} | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const stockIndex = useStockIndex(creating, draft.market);
  const pool = useMemo(
    () => resolveStrategyPool(symbols, stockIndex.index),
    [symbols, stockIndex.index],
  );
  const poolMarkets = [
    ...new Set(pool.flatMap((p) => (p.stock ? [p.stock.market] : []))),
  ];
  const poolMarket = poolMarkets.length === 1 ? poolMarkets[0] : null;
  const poolLot =
    poolMarket && poolMarket !== draft.market
      ? poolMarket === "CRYPTO" ? 0.00000001 : poolMarket === "TW" ? 1000 : ["US", "KR"].includes(poolMarket) ? 1 : 100
      : draft.lotSize;
  const marketLabels = { CRYPTO: `${uiLiteral("加密货币")} · USDT`, CN: `${uiLiteral("A 股")} · CNY`, HK: `${uiLiteral("港股")} · HKD`, US: `${uiLiteral("美股")} · USD`, TW: `${uiLiteral("台股")} · TWD`, JP: `${uiLiteral("日股")} · JPY`, KR: `${uiLiteral("韩股")} · KRW` };

  useEffect(() => {
    if (legacy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const [list, selected, saved, runtime] = await Promise.all([
          portfoliosApi.list(),
          id ? portfoliosApi.detail(id) : Promise.resolve(null),
          portfoliosApi.definitions(),
          portfoliosApi.runtimeStatus?.(),
        ]);
        if (alive) {
          setRuntimeUnavailable(Boolean(runtime?.configured && !runtime.available));
          setItems(list);
          setDefinitions(saved);
          setDetail(selected);
          setLoadError("");
        }
      } catch (e) {
        if (alive) setLoadError(failure(e));
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, legacy, refresh]);
  const sourceSession = params.get("sourceSession");
  useEffect(() => {
    if (!sourceSession) return;
    let active = true;
    strategyDraftsApi.sync(sourceSession).then((source) => {
      if (!active) return;
      if (!source?.skillId || source.kind !== 'trading') {
        setError('请返回投研助理，先检查并保存当前交易策略 Skill。');
        return;
      }
      setDraft({ ...seed, name: source.draft.name || '', skillId: source.skillId, decisionBackend: 'llm' });
      setSymbols('');
      setSourceQuery(source.draft.scope || '');
      setUniversePreview(null);
      setEditing(null);
      setCreating(true);
    }).catch((e) => { if (active) setError(failure(e)); });
    return () => { active = false; };
  }, [sourceSession]);
  if (legacy)
    return (
      <>
        <div className="px-6 pt-4">
          <Link to="/trading" className="text-primary">
            <UiLiteral text={"← 返回策略运行"} /></Link>
        </div>
        <ResearchReportsWorkspace mode="trading" />
      </>
    );
  const select = (next: number, research = false) => {
    const owner = items.find((p) => p.id === next)?.definitionId;
    setParams({
      portfolio: String(next),
      ...(research ? {panel: "research"} : {}),
      ...(owner ? { strategy: String(owner) } : {}),
    });
    setLaunch(null);
    setCreating(false);
    setDetail(null);
  };
  const days = detail?.id === id ? detail.days || [] : [];
  const detailDefinition = definitions.find(d => d.id === detail?.definitionId);
  const historical = !!detailDefinition && (detail?.config.definitionRevision ?? 1) !== (detailDefinition.config.definitionRevision ?? 1);
  const editBlocked = !!definition && items.some(p => p.definitionId === definition.id &&
    (p.status === 'running' || (p.busy && p.status !== 'paused')));
  const openConfig = (config: RuleConfig, name: string) => {
    setDraft({ ...seed, ...config, name });
    setSymbols((config.universe?.scope.mode === 'custom' ? config.universe.scope.symbols : config.symbols).join(', '));
    setSourceQuery('');
    setUniversePreview(null);
    setFormRevision(x => x + 1);
    setError('');
    setLaunch(null);
    setCreating(true);
  };
  const change = <K extends keyof RuleConfig>(key: K, value: RuleConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!universePreview) {
      setError("请先预览并确认股票范围。");
      return;
    }
    const codes = universePreview.candidates.map((c) => c.code);
    if (codes.length < 1 || codes.length > 12) {
      setError(`股票池需要 1–12 个股票代码，当前填写了 ${codes.length} 个。`);
      return;
    }
    setSending(true);
    try {
      const config: RuleConfig = {
        ...draft,
        symbols: codes,
        market:
          universePreview.market,
        lotSize:
          universePreview.market !== draft.market
            ? universePreview!.market === "CRYPTO" ? 0.00000001 : universePreview!.market === "TW" ? 1000 : ["US", "KR"].includes(universePreview!.market) ? 1 : 100
            : poolLot,
        universePreviewId: universePreview?.id,
      };
      const p = editing
        ? await portfoliosApi.saveDefinition(config, editing)
        : await portfoliosApi.saveDefinition(config);
      setParams({ strategy: String(p.id) });
      setCreating(false);
      setLaunch(null);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(failure(e));
    } finally {
      setSending(false);
    }
  };
  const control = async (action: "run" | "start" | "pause" | "stop", targetId = id) => {
    if (!targetId) return;
    setSending(true);
    setError("");
    try {
      setDetail(await portfoliosApi.control(targetId, action));
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(failure(e));
    } finally {
      setSending(false);
    }
  };
  const stopDefinition = async (targetId: number) => {
    setSending(true);
    setError('');
    try {
      await portfoliosApi.stopDefinition(targetId);
      setRefresh((x) => x + 1);
    } catch (e) { setError(failure(e)); }
    finally { setSending(false); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setSending(true);
    setDeleteError('');
    try {
      if (deleteTarget.kind === 'definition') await portfoliosApi.deleteDefinition(deleteTarget.id);
      else await portfoliosApi.deletePortfolio(deleteTarget.id);
      setDeleteTarget(null);
      setDetail(null);
      setLaunch(null);
      setParams({});
      setRefresh((x) => x + 1);
    } catch (e) { setDeleteError(failure(e)); }
    finally { setSending(false); }
  };
  const inputClass =
    "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <AppPage>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-semibold"><UiLiteral text={"策略验证与运行"} /></h1>
          <p className="mt-2 text-sm text-secondary-text">
            <UiLiteral text={"先观察模拟收益，再展开策略进行回测与改进。"} /></p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!id && !definitionId && !creating && params.get('view')!=='manage' && <Link className="btn-secondary" to="/trading?view=manage"><UiLiteral text="管理策略" /></Link>}
          {(id || definitionId || creating || params.get("view")==="manage") && <Link className="btn-secondary" to="/trading?view=reports">
            <UiLiteral text={"历史研究提案"} /></Link>}
          <button
            className="btn-primary"
            onClick={() => {
              setParams({});
              setFormRevision((value) => value + 1);
              setUniversePreview(null);
              setSourceQuery('');
              setError('');
              setLaunch(null);
              setEditing(null);
              setCreating(true);
              setDraft({ ...seed, engine: "agent" });
              setSymbols("");
            }}
          >
            <UiLiteral text={"配置策略"} /></button>
        </div>
      </header>
      {(error || loadError) && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-danger p-3 text-danger"
        >
          {error || loadError}
        </p>
      )}
      {creating ? (
        <section>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold"><UiLiteral text={"配置策略方法与范围"} /></h2>
            <button
              className="btn-secondary"
              onClick={() => setCreating(false)}
            >
              <UiLiteral text={"取消"} /></button>
          </div>
          <form onSubmit={submit} className="max-w-4xl space-y-6">
            {editing && <p role="status" className="rounded-lg border border-border p-3 text-sm text-secondary-text"><UiLiteral text="正在修改已有策略。所有初始设置均可调整，请重新预览股票范围。保存后旧记录只供查看，新配置需手动启动，并按初始资金重新模拟。" /></p>}
            {sourceSession && <p role="status" className="rounded-lg border border-border p-3 text-sm text-secondary-text"><UiLiteral text={"已从投研助理载入 Skill、名称和范围描述。请核对市场、行业、资金及风险参数；表单默认值尚未由对话确认。预览范围并保存后，可选择运行一次或持续模拟。"} /></p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <UiLiteral text={"策略名称"} /><input
                  required
                  maxLength={80}
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              <h3 className="sm:col-span-2 text-lg font-semibold mt-3"><UiLiteral text={"1. 选股配置"} /></h3>
              <div className="sm:col-span-2">
                <label className="block">
                  <UiLiteral text={draft.market === "CRYPTO" ? "标的池（交易对，最多 12 个）" : "股票池（可选，名称或代码，最多 12 只）"} /><input
                    className={inputClass}
                    value={symbols}
                    onChange={(e) => setSymbols(e.target.value)}
                    placeholder={draft.market === "CRYPTO" ? "BTCUSDT, ETHUSDT, SOLUSDT" : uiLiteral("例如 贵州茅台、平安银行，或 英伟达、苹果")}
                  />
                </label>
                <p className="mt-2 text-sm text-secondary-text"><UiLiteral text={draft.market === "CRYPTO" ? "填写 USDT 现货交易对，例如 BTCUSDT、ETHUSDT；预览后保存名单。" : "可留空，直接按下方股票范围寻找候选；填写后会进一步限定范围，不会自动补入范围外的股票。"} /></p>
                <p className="mt-2 text-sm text-secondary-text">
                  {stockIndex.loading
                    ? uiLiteral("正在加载与个股研究共用的股票目录…")
                    : poolMarkets.length > 1
                      ? uiLiteral("包含多个市场，请分别创建策略账户。")
                      : poolMarket
                        ? `${uiLiteral("自动识别市场：")}${marketLabels[poolMarket]}`
                        : uiLiteral("输入名称、代码或拼音，自动识别股票和市场。多只股票用逗号或顿号分隔。")}
                </p>
                {stockIndex.fallback && (
                  <p className="mt-2 text-xs text-warning">
                    <UiLiteral text={"股票目录加载失败，名称识别暂不可用。请重试加载。"} /><button
                      type="button"
                      className="btn-secondary ml-2"
                      onClick={stockIndex.retry}
                      disabled={stockIndex.loading}
                    >
                      {stockIndex.loading ? uiLiteral("正在加载…") : uiLiteral("重新加载股票目录")}
                    </button>
                  </p>
                )}
                <div className="mt-3 space-y-2" aria-label={uiLiteral("股票识别结果")}>
                  {pool.map((p, i) => (
                    <div
                      key={`${i}-${p.query}`}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      {p.stock ? (
                        <span>
                          {p.query} → {p.stock.name} · {p.stock.code} ·{" "}
                          {marketLabels[p.stock.market]}
                          {p.stock.name === p.stock.code
                            ? uiLiteral(" · 目录未收录名称，请核对代码")
                            : ""}
                        </span>
                      ) : (
                        <>
                          <p>
                            {p.query}：
                            {p.candidates.length
                              ? uiLiteral("请选择匹配的股票")
                              : uiLiteral("尚未识别，请补全名称或代码")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {p.candidates.slice(0, 8).map((c) => (
                              <button
                                key={c.canonicalCode}
                                type="button"
                                className="btn-secondary"
                                onClick={() =>
                                  setSymbols(
                                    pool
                                      .map((item, j) =>
                                        j === i ? c.canonicalCode : item.query,
                                      )
                                      .join("、"),
                                  )
                                }
                              >
                                {localizedStockName(c, language)} · {c.canonicalCode} · {c.market}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2"><TradingAgentConfig key={`${sourceSession || "manual"}:${formRevision}`} initialQuery={sourceQuery}
                config={draft}
                inputText={symbols}
                codes={
                  pool.some((p) => !p.stock)
                    ? null
                    : pool.flatMap((p) => (p.stock ? [p.stock.code] : []))
                }
                inferredMarket={poolMarket}
                onConfig={(patch) => { if (patch.market && patch.market !== draft.market) setSymbols(patch.market === "CRYPTO" ? "BTCUSDT, ETHUSDT, SOLUSDT" : ""); setDraft((d) => ({ ...d, ...patch })); }}
                onPreview={setUniversePreview}
              /></div>
              <h3 className="sm:col-span-2 text-lg font-semibold mt-3"><UiLiteral text={"3. 运行与风控配置"} /></h3>
              <label>
                <UiLiteral text={"默认验证资金"} /><input
                  className={inputClass}
                  type="number"
                  min={1000}
                  max={100000000}
                  value={draft.initialCash}
                  onChange={(e) =>
                    change("initialCash", Number(e.target.value))
                  }
                />
              </label>
              <label>
                <UiLiteral text={"最大持仓数量"} /><input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={12}
                  value={draft.maxPositions}
                  onChange={(e) =>
                    change("maxPositions", Number(e.target.value))
                  }
                />
              </label>
            </div>
            {draft.decisionBackend !== "rules" && <label className="block"><UiLiteral text={"每次运行 Token 预算"} /><input className={inputClass} type="number" min={10000} max={500000} step={10000}
                value={draft.runTokenBudget || 100000} onChange={(e) => change("runTokenBudget", Number(e.target.value))} />
            </label>}
            <details className="border-y border-border py-4">
              <summary className="cursor-pointer font-medium">
                <UiLiteral text={"仓位、交易成本与指标假设"} /></summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["maxWeight", "单股最高建仓比例", 0.01, 1, 0.01],
                    ["lotSize", draft.market === "CRYPTO" ? "最小模拟数量" : "每手股数（港股需自行核对）", draft.market === "CRYPTO" ? 0.00000001 : 1, 10000, draft.market === "CRYPTO" ? 0.00000001 : 1],
                    ["commissionRate", "佣金比例", 0, 0.05, 0.0001],
                    ["sellTaxRate", "卖出税费比例", 0, 0.05, 0.0001],
                    ["slippageRate", "模拟滑点比例", 0, 0.05, 0.0001],
                    ["riskFreeRate", "年无风险利率", -0.1, 0.3, 0.001],
                  ] as const
                ).map(([key, label, min, max, increment]) => (
                  <label key={key} className="text-sm">
                    {uiLiteral(label)}
                    <input
                      type="number"
                      className={inputClass}
                      min={min}
                      max={max}
                      step={increment}
                      value={key === "lotSize" ? poolLot : draft[key]}
                      onChange={(e) =>
                        key === "lotSize"
                          ? setDraft((d) => ({
                              ...d,
                              market: poolMarket || d.market,
                              lotSize: Number(e.target.value),
                            }))
                          : change(key, Number(e.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <p className="text-sm leading-6 text-secondary-text">
              <UiLiteral text={draft.market === "CRYPTO" ? "加密货币按 UTC 已收盘日线运行，包含周末；保存后使用原有回测、模拟和暂停修改流程。基准为 BTC/USDT 价格收益，资金以 USDT 计价，费用和小数数量可配置。" : "按已收盘日线产生观点，下一交易日开盘价加减滑点模拟成交。暂停或停止后可修改全部配置；保存修改后重新开始模拟，旧记录保留。保存后再选择回测或模拟。基准使用同市场指数 ETF 的价格表现，不含分红。请核对税费和每手股数。"} /></p>
            <button disabled={sending} className="btn-primary">
              {sending ? uiLiteral("保存中…") : uiLiteral(editing ? "保存修改" : "保存策略")}
            </button>
          </form>
        </section>
      ) : (
        <>
        {!id && !definitionId && params.get("view")!=="manage" ? <SimulationOverview onOpen={select} onAdopt={strategy=>setParams({strategy:String(strategy)})} onResearch={next => {
          const paper = items.find(p => p.id === next);
          const backtest = items.filter(p => paper?.definitionId && p.definitionId === paper.definitionId && p.mode === 'backtest' && p.status === 'completed').sort((a,b) => Math.abs(b.id) - Math.abs(a.id))[0];
          if (paper?.config.externalRuntime || backtest) select(backtest?.id ?? next, true);
          else if (paper?.definitionId) setParams({strategy: String(paper.definitionId), panel: 'research'});
          else select(next, true);
        }} /> : <button className="btn-secondary mb-5" onClick={() => { setParams({}); setDetail(null); setLaunch(null); }}><UiLiteral text="← 返回模拟收益总览" /></button>}
        {Boolean(id || definitionId || params.get('view')==='manage') && <div className="border-t border-border pt-4">
        {!id && !definitionId && <Link className="btn-secondary mb-5 inline-flex" to="/trading?view=reports"><UiLiteral text="历史研究提案" /></Link>}
        <div className={id ? "min-w-0" : "grid gap-7 lg:grid-cols-[250px_minmax(0,1fr)]"}>
          <aside className={id ? "hidden" : undefined}>
            <h2 className="mb-3 font-semibold"><UiLiteral text={"我的策略"} /></h2>
            <label className="mb-4 block text-sm">{uiLiteral("市场")}
              <select className="mt-2 w-full rounded-lg border border-border bg-background p-2" value={marketFilter} onChange={e => setMarketFilter(e.target.value)}>
                <option value="ALL">{uiLiteral("全部市场")}</option>
                {Object.entries(marketLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {definitions.filter(d => marketFilter === "ALL" || d.config.market === marketFilter).map((d) => (
              <button
                key={d.id}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${definitionId === d.id ? "border-primary bg-primary/5" : "border-border"}`}
                onClick={() => {
                  setParams({ strategy: String(d.id) });
                  setLaunch(null);
                }}
              >
                <strong className="block">{d.name}</strong>
                <span className="mt-2 block text-xs text-secondary-text">
                  {marketLabels[d.config.market]} · {d.config.symbols.length} {uiLiteral("标的")} ·{" "}
                  {items.filter((p) => p.definitionId === d.id).length} <UiLiteral text={" 次验证"} /></span>
              </button>
            ))}
            {items.some((p) => !p.definitionId) && (
              <h3 className="mt-6 mb-3 text-sm text-secondary-text">
                <UiLiteral text={"已有独立验证记录"} /></h3>
            )}
            {loading && <p role="status"><UiLiteral text={"加载中…"} /></p>}
            {items
              .filter((p) => !p.definitionId && (marketFilter === "ALL" || p.market === marketFilter))
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => select(p.id)}
                  className={`mb-2 w-full rounded-lg border p-3 text-left ${id === p.id ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <strong className="block truncate">{p.name}</strong>
                  <span className="mt-2 block text-xs text-secondary-text">
                    {p.mode === "paper" ? uiLiteral("实时模拟") : uiLiteral("历史回测")} · {p.market}{" "}
                    · {uiLiteral(status(p))}
                  </span>
                </button>
              ))}
            {!loading && !items.length && !definitions.length && (
              <p className="text-sm text-secondary-text">
                <UiLiteral text={"尚无策略。先保存规则，再选择回测或模拟。"} /></p>
            )}
          </aside>
          <section className="min-w-0" aria-label={uiLiteral("策略详情")}>
            {runtimeUnavailable && <p role="alert" className="mb-4 text-warning"><UiLiteral text="私有运行引擎暂时不可用，本地策略仍可使用。" /></p>}
            {definition && (
              <details id="strategy-configuration" open={!id || Boolean(launch)} className="mb-5 border-b border-border pb-4">
              <summary className="cursor-pointer py-2 font-medium"><UiLiteral text="策略配置与验证账户" /> · {definition.name}</summary>
              <section
                className="mb-7 border-b border-border pb-6"
                aria-label={uiLiteral("已保存策略")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="min-w-0 break-words text-xl font-semibold">{definition.name}</h2>
                  <div className="flex flex-wrap gap-2">
                    {definition.config.engine === 'agent' && !definition.config.externalRuntime && <button className="btn-secondary" disabled={sending || editBlocked} onClick={() => {
                      setEditing({id: definition.id, revision: definition.config.definitionRevision ?? 1});
                      openConfig({ ...seed, ...definition.config }, definition.name);
                    }}><UiLiteral text="修改配置" /></button>}
                    <button className="btn-secondary" disabled={sending || !items.some(p => p.definitionId === definition.id && (p.busy || ['running', 'paused'].includes(p.status)))} onClick={() => void stopDefinition(definition.id)}>
                      <UiLiteral text="停止运行" />
                    </button>
                    <button className="btn-secondary text-danger" disabled={sending} onClick={() => { setDeleteError(''); setDeleteTarget({kind:'definition', id:definition.id, name:definition.name}); }}>
                      <UiLiteral text="删除策略" />
                    </button>
                  </div>
                </div>
                {editBlocked && !definition.config.externalRuntime && <p className="mt-3 text-sm text-secondary-text"><UiLiteral text="请先暂停或停止运行，再修改配置。" /></p>}
                {items.some(p => p.definitionId === definition.id && p.status === 'stopped') && !items.some(p => p.definitionId === definition.id && (p.busy || ['running', 'paused'].includes(p.status))) &&
                  <p role="status" className="mt-3 text-sm text-secondary-text"><UiLiteral text="已停止运行，不再自动调用模型或更新估值，待执行计划已取消；历史记录和模拟持仓保留。" /></p>}
                <p className="mt-2 text-sm text-secondary-text">
                  {definition.config.engine === "agent"
                    ? uiLiteral(definition.config.skillSnapshot?.name || "Agent 策略 Skill")
                    : uiLiteral("已下线固定规则")}{" "}
                  · {definition.config.symbols.join("、")} ·{" "}
                  {definition.config.market} · {definition.config.decisionBackend === "rules" ? uiLiteral("固定规则") : definition.config.decisionBackend === "jev" ? `JEV · ${definition.config.jevModel || ""}` : "LLM"}
                </p>
                <p className="mt-2 text-sm text-secondary-text">
                  <UiLiteral text={definition.config.externalRuntime ? "来源版本只读。历史回测按冻结样本重新计算，模拟账户独立续跑。" : "同一版配置共用最近的模拟账户，回测独立记账。修改配置后，下次运行创建新账户，旧持仓和历史保留。"} /></p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {definition.config.engine === "agent" ? <>
                  {(
                    [
                      ["backtest", "历史回测"],
                      ["run", "运行一次"],
                      ["start", "持续模拟"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      className="btn-secondary"
                      disabled={sending}
                      onClick={() => {
                        const paper = items.find(
                          (p) =>
                            p.definitionId === definition.id &&
                            (p.config.definitionRevision ?? 1) === (definition.config.definitionRevision ?? 1) &&
                            p.mode === "paper",
                        );
                        if (action !== "backtest" && paper) {
                          select(paper.id);
                          void control(action, paper.id);
                          return;
                        }
                        setLaunch(action);
                        setValidationCash(definition.config.initialCash);
                        if (definition.config.externalRuntime) {
                          setValidationStart(definition.config.sourceStartDate || "");
                          setValidationEnd(definition.config.sourceEndDate || "");
                        }
                        setError("");
                      }}
                    >
                      {uiLiteral(label)}
                    </button>
                  ))}
                  </> : <p className="text-sm text-secondary-text"><UiLiteral text={"此策略的固定规则已下线，历史记录可查看，但不能创建或继续运行。"} /></p>}
                  {!definition.config.externalRuntime && <button
                    className="btn-secondary"
                    onClick={() => {
                      setEditing(null);
                      openConfig({ ...seed, ...definition.config }, `${definition.name} · 新版本`);
                    }}
                  >
                    <UiLiteral text={"复制策略"} /></button>}
                </div>
                {launch === "backtest" &&
                  definition.config.engine === "agent" && !definition.config.externalRuntime && (
                    <div className="mt-4 border-y border-border py-4">
                      <p className="text-sm text-warning">
                        <UiLiteral text={definition.config.decisionBackend === "rules"
                          ? "规则回测：逐日使用已收盘行情生成信号，次日开盘模拟成交，不调用决策模型。每次最多处理20个交易日；固定股票池仍有事后选股偏差。"
                          : "AI 历史回放：模型可能知道后来的事件，不能等同严格规则回测。每次最多处理20个交易日，预算不足时可继续运行。"} /></p>
                      <label className="mt-3 block">
                        <UiLiteral text={"历史股票范围"} /><select
                          className={inputClass}
                          value={universeHistory}
                          onChange={(e) =>
                            setUniverseHistory(
                              e.target.value as "frozen" | "recorded",
                            )
                          }
                        >
                          <option value="frozen">
                            <UiLiteral text={"固定保存时名单（存在名单偏差）"} /></option>
                          <option value="recorded">
                            <UiLiteral text={"当日已归档范围（缺失即停止）"} /></option>
                        </select>
                      </label>
                    </div>
                  )}
                {launch && (
                  <form
                    className="mt-5 space-y-4 border-y border-border py-5"
                    aria-label={uiLiteral("验证参数")}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSending(true);
                      setError("");
                      let created: Portfolio | null = null;
                      try {
                        created = await portfoliosApi.createValidation(
                          definition.id,
                          {
                            mode: launch === "backtest" ? "backtest" : "paper",
                            initialCash: validationCash,
                            ...(definition.config.engine === "agent"
                              ? {
                                  historyMode: definition.config.decisionBackend === "rules" ? "rules" as const : "ai_replay" as const,
                                  universeHistory,
                                }
                              : {}),
                            startDate:
                              launch === "backtest" ? validationStart : null,
                            endDate:
                              launch === "backtest" ? validationEnd : null,
                          },
                        );
                        setParams({
                          strategy: String(definition.id),
                          portfolio: String(created.id),
                        });
                        setDetail(created);
                        setLaunch(null);
                                            await portfoliosApi.control(
                          created.id,
                          launch === "start" ? "start" : "run",
                        );
                      } catch (e) {
                        setError(
                          `${created ? "验证记录已保存，可在记录中重试运行。" : ""}${failure(e)}`,
                        );
                      } finally {
                        setSending(false);
                        setRefresh((x) => x + 1);
                      }
                    }}
                  >
                    <h3 className="font-semibold">
                      {launch === "backtest"
                        ? uiLiteral("历史回测参数")
                        : launch === "start"
                          ? uiLiteral("持续模拟参数")
                          : uiLiteral("单次模拟参数")}
                    </h3>
                    <p className="text-sm text-secondary-text">
                      {launch === "backtest"
                        ? uiLiteral("选择过去的日期区间（跨度最多两年），按历史日线验证规则。")
                        : uiLiteral("从今天开始模拟。运行一次只检查最新已收盘行情；持续模拟会自动检查，未收盘时等待。")}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label>
                        <UiLiteral text={"验证初始资金"} /><input
                          className={inputClass}
                          type="number"
                          required
                          min={1000}
                          max={100000000}
                          readOnly={definition.config.externalRuntime}
                          value={validationCash}
                          onChange={(e) =>
                            setValidationCash(Number(e.target.value))
                          }
                        />
                      </label>
                      {launch === "backtest" && (
                        <>
                          <label>
                            <UiLiteral text={"回测开始"} /><input
                              className={inputClass}
                              type="date"
                              required
                              readOnly={definition.config.externalRuntime}
                              value={validationStart}
                              onChange={(e) =>
                                setValidationStart(e.target.value)
                              }
                            />
                          </label>
                          <label>
                            <UiLiteral text={"回测结束"} /><input
                              className={inputClass}
                              type="date"
                              required
                              readOnly={definition.config.externalRuntime}
                              value={validationEnd}
                              onChange={(e) => setValidationEnd(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary" disabled={sending}>
                        {sending ? uiLiteral("启动中…") : uiLiteral("确认并开始验证")}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={sending}
                        onClick={() => setLaunch(null)}
                      >
                        <UiLiteral text={"取消"} /></button>
                    </div>
                  </form>
                )}
                <h3 className="mt-6 font-semibold"><UiLiteral text={"验证记录"} /></h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {items
                    .filter((p) => p.definitionId === definition.id)
                    .map((p) => (
                      <button
                        className={
                          p.id === id ? "btn-primary" : "btn-secondary"
                        }
                        key={p.id}
                        onClick={() => select(p.id)}
                      >
                        {p.mode === "backtest" ? uiLiteral("回测") : uiLiteral("模拟")} #{p.id} ·{" "}
                        {uiLiteral(status(p))}
                      </button>
                    ))}
                </div>
                {!items.some((p) => p.definitionId === definition.id) && (
                  <p className="mt-3 text-sm text-secondary-text">
                    <UiLiteral text={"尚未验证。保存策略不会自动运行或创建模拟账户。"} /></p>
                )}
              </section>
              </details>
            )}

            {detail?.id === id ? (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{detail.name}</h2>
                    <p className="mt-2 text-sm text-secondary-text">
                      {detail.mode === "paper"
                        ? uiLiteral(detail.config.externalRuntime ? "实时行情模拟" : "每日持续模拟")
                        : detail.config.decisionBackend === "rules"
                          ? uiLiteral("规则历史回测")
                          : detail.config.engine === "agent"
                          ? uiLiteral("AI 历史回放")
                          : uiLiteral("历史回测")}{" "}
                      <UiLiteral text={"· 固定版本 "} />{detail.versionId} · {uiLiteral(status(detail))}
                    </p>
                    <p className="mt-1 text-xs text-secondary-text">
                      <UiLiteral text={"观察区间："} />{recordTime(days[0]?.date || detail.config.startDate)} <UiLiteral text={" 至"} />{" "}
                      {detail.lastDate ? recordTime(detail.lastDate) : uiLiteral("等待收盘")} · {days.length} <UiLiteral text=" 条记录 ·" />{" "}
                      {detail.currency}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={sending || !(detail.busy || ['running', 'paused'].includes(detail.status))} onClick={() => void control('stop')}>
                      <UiLiteral text="停止运行" />
                    </button>
                    <button className="btn-secondary text-danger" disabled={sending} onClick={() => { setDeleteError(''); setDeleteTarget({kind:'portfolio', id:detail.id, name:detail.name}); }}>
                      <UiLiteral text="删除验证记录" />
                    </button>
                    {detail.config.engine === "agent" && <button
                      className="btn-secondary"
                      disabled={sending || detail.busy || historical}
                      onClick={() => void control("run")}
                    >
                      {detail.mode === "backtest" ? uiLiteral("运行回测") : uiLiteral("继续运行一次")}
                    </button>}
                    {detail.config.engine === "agent" && detail.mode === "paper" && (
                      <button
                        className="btn-primary"
                        disabled={sending || historical}
                        onClick={() =>
                          void control(
                            detail.status === "running" ? "pause" : "start",
                          )
                        }
                      >
                        {detail.status === "running" ? uiLiteral("暂停交易") : uiLiteral("持续运行")}
                      </button>
                    )}
                      {!detail.config.externalRuntime && <button
                        className="btn-secondary"
                        onClick={() => {
                        setEditing(null);
                        openConfig(detail.config, `${detail.name} · 新版本`);
                      }}
                    >
                      <UiLiteral text={"复制配置"} /></button>}
                  </div>
                </div>
                {historical && <p role="status" className="mb-4 text-sm text-secondary-text"><UiLiteral text="这是旧版配置的历史记录，请从策略页运行最新配置。" /></p>}
                {detail.mode === "backtest" && detail.status !== "completed" && (
                  <p role="status" className="mb-4 font-medium">
                    <UiLiteral text={detail.error && !detail.busy
                      ? "历史验证已中断，以下仅为已完成日期的部分结果，不代表完整回测。"
                      : "历史验证尚未完成，当前指标仅覆盖已记账日期。"} />
                  </p>
                )}
                {detail.error && (
                  <p
                    role="alert"
                    className="mb-4 border border-danger p-3 text-danger"
                  >
                    {detail.error} <UiLiteral text={" 已完成的日期仍保留，可修复后重试。"} /></p>
                )}
                {detail.status === "stopped" && <p role="status" className="mb-4 text-sm text-secondary-text"><UiLiteral text="已停止运行，不再自动调用模型或更新估值，待执行计划已取消；历史记录和模拟持仓保留。" /></p>}
                {detail.status === "paused" && (
                  <p className="mb-4 text-sm text-secondary-text">
                    <UiLiteral text={detail.config.externalRuntime ? "私有引擎已暂停，持仓保留；恢复后继续检查行情。" : "已暂停自动买卖；持仓保留，继续按收盘价估值。"} /></p>
                )}
                <PortfolioDetailWorkspace key={detail.id} portfolio={detail} panel={params.get('panel')}
                  onPanel={panel => setParams(previous => { const next=new URLSearchParams(previous); next.set('panel',panel); return next; })}
                  onSelect={select}
                  onAdopt={strategyId => {setParams({strategy:String(strategyId)});setRefresh(x=>x+1);}}
                  onBacktest={definition ? () => {
                    setLaunch('backtest');setValidationCash(definition.config.initialCash);
                    if(definition.config.externalRuntime){setValidationStart(definition.config.sourceStartDate||'');setValidationEnd(definition.config.sourceEndDate||'');}
                    requestAnimationFrame(()=>document.getElementById('strategy-configuration')?.scrollIntoView({block:'start'}));
                  } : undefined}
                />
              </>
            ) : definition ? null : (
              <div className="py-20 text-center">
                <h2 className="text-xl font-semibold">
                  <UiLiteral text={"选择一个策略，观察它如何运行"} /></h2>
                <p className="mt-3 text-secondary-text">
                  <UiLiteral text={"先保存策略，再选择历史回测、运行一次或持续模拟，分别积累验证记录。"} /></p>
                <button
                  className="btn-primary mt-5"
                  onClick={() => { setDraft({ ...seed, engine: "agent" }); setEditing(null); setCreating(true); }}
                >
                  <UiLiteral text={"创建新策略"} /></button>
              </div>
            )}
          </section>
        </div>
        </div>}
        </>
      )}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={`${uiLiteral(deleteTarget?.kind === 'definition' ? '删除策略' : '删除验证记录')} · ${deleteTarget?.name || ''}`}
        message={deleteError || uiLiteral(deleteTarget?.kind === 'definition'
          ? '删除后将停止该策略的所有回测和模拟，并从交易推演中移除策略及验证记录。历史账本保留供审计，界面无法恢复；已发出的模型请求可能仍会计费，但不会继续记账。'
          : '删除后将停止并移除此验证记录，不影响同策略的其他验证。历史账本保留供审计，界面无法恢复；已发出的模型请求可能仍会计费，但不会继续记账。')}
        confirmText={uiLiteral(sending ? '处理中…' : '停止并删除')}
        confirmDisabled={sending} cancelDisabled={sending} isDanger
        onConfirm={() => void remove()} onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
      />
    </AppPage>
  );
}
