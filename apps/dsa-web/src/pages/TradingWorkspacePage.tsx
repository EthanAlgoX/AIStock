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
import { AnalysisChart } from "../components/report/AnalysisChart";
import {
  portfoliosApi,
  type Portfolio,
  type RuleConfig,
  type StrategyDefinition,
  type UniversePreview,
} from "../api/portfolios";

const fmt = (v: number | null | undefined, percent = false) =>
  v == null
    ? "—"
    : `${(v * (percent ? 100 : 1)).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${percent ? "%" : ""}`;
const status = (p: Portfolio) =>
  p.busy
    ? "更新中"
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
const metricLabels = [
  ["cumulativeReturn", "累计收益", true],
  ["dailyReturn", "当日收益", true],
  ["annualizedReturn", "年化收益", true],
  ["maxDrawdown", "最大回撤", true],
  ["annualizedVolatility", "年化波动率", true],
  ["turnover", "区间换手率", true],
  ["sharpe", "夏普比率", false],
  ["calmar", "卡玛比率", false],
] as const;

export default function TradingWorkspacePage() {
  const uiLiteral = useUiLiteral();
  const [params, setParams] = useSearchParams();
  const legacy =
    params.get("view") === "reports" ||
    params.has("sourceRun") ||
    params.has("run");
  const id = Number(params.get("portfolio")) || null;
  const definitionId = Number(params.get("strategy")) || null;
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
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{kind: 'definition' | 'portfolio'; id: number; name: string} | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [date, setDate] = useState("");
  const [tab, setTab] = useState("trades");
  const [windowSize, setWindowSize] = useState(120);
  const [refresh, setRefresh] = useState(0);
  const stockIndex = useStockIndex(creating);
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
      ? poolMarket === "US"
        ? 1
        : 100
      : draft.lotSize;
  const marketLabels = { CN: "A 股 · CNY", HK: "港股 · HKD", US: "美股 · USD" };

  useEffect(() => {
    if (legacy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const [list, selected, saved] = await Promise.all([
          portfoliosApi.list(),
          id ? portfoliosApi.detail(id) : Promise.resolve(null),
          portfoliosApi.definitions(),
        ]);
        if (alive) {
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
      setDraft({ ...seed, name: source.draft.name || '', skillId: source.skillId });
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
  const select = (next: number) => {
    const owner = items.find((p) => p.id === next)?.definitionId;
    setParams({
      portfolio: String(next),
      ...(owner ? { strategy: String(owner) } : {}),
    });
    setLaunch(null);
    setCreating(false);
    setDate("");
    setDetail(null);
  };
  const days = detail?.id === id ? detail.days || [] : [];
  const latest = days.at(-1);
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
  const selected = days.find((d) => d.date === date) || latest;
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
            ? universePreview!.market === "US"
              ? 1
              : 100
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
  const visible = days.slice(-windowSize);
  const inputClass =
    "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <AppPage>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-semibold"><UiLiteral text={"策略验证与运行"} /></h1>
          <p className="mt-2 text-sm text-secondary-text">
            <UiLiteral text={"历史回测与每日模拟，持续跟踪每一笔决策。"} /></p>
        </div>
        <div className="flex gap-3">
          <Link className="btn-secondary" to="/trading?view=reports">
            <UiLiteral text={"历史研究提案"} /></Link>
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
                  <UiLiteral text={"股票池（可选，名称或代码，最多 12 只）"} /><input
                    className={inputClass}
                    value={symbols}
                    onChange={(e) => setSymbols(e.target.value)}
                    placeholder={uiLiteral("例如 贵州茅台、平安银行，或 英伟达、苹果")}
                  />
                </label>
                <p className="mt-2 text-sm text-secondary-text"><UiLiteral text={"可留空，直接按下方股票范围寻找候选；填写后会进一步限定范围，不会自动补入范围外的股票。"} /></p>
                <p className="mt-2 text-sm text-secondary-text">
                  {stockIndex.loading
                    ? uiLiteral("正在加载与个股研究共用的股票目录…")
                    : poolMarkets.length > 1
                      ? uiLiteral("包含多个市场，请分别创建策略账户。")
                      : poolMarket
                        ? uiLiteral(`自动识别市场：${marketLabels[poolMarket]}`)
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
                                {c.nameZh} · {c.canonicalCode} · {c.market}
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
                onConfig={(patch) => setDraft((d) => ({ ...d, ...patch }))}
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
            <label className="block"><UiLiteral text={"每次运行 Token 预算"} /><input className={inputClass} type="number" min={10000} max={500000} step={10000}
                value={draft.runTokenBudget || 100000} onChange={(e) => change("runTokenBudget", Number(e.target.value))} />
            </label>
            <details className="border-y border-border py-4">
              <summary className="cursor-pointer font-medium">
                <UiLiteral text={"仓位、交易成本与指标假设"} /></summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["maxWeight", "单股最高建仓比例", 0.01, 1, 0.01],
                    ["lotSize", "每手股数（港股需自行核对）", 1, 10000, 1],
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
              <UiLiteral text={"按已收盘日线产生观点，下一交易日开盘价加减滑点模拟成交。暂停或停止后可修改全部配置；保存修改后重新开始模拟，旧记录保留。保存后再选择回测或模拟。基准使用同市场指数 ETF 的价格表现，不含分红。请核对税费和每手股数。"} /></p>
            <button disabled={sending} className="btn-primary">
              {sending ? uiLiteral("保存中…") : uiLiteral(editing ? "保存修改" : "保存策略")}
            </button>
          </form>
        </section>
      ) : (
        <div className="grid gap-7 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside>
            <h2 className="mb-3 font-semibold"><UiLiteral text={"我的策略"} /></h2>
            {definitions.map((d) => (
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
                  {d.config.market} · {d.config.symbols.length} <UiLiteral text={" 只股票 ·"} />{" "}
                  {items.filter((p) => p.definitionId === d.id).length} <UiLiteral text={" 次验证"} /></span>
              </button>
            ))}
            {items.some((p) => !p.definitionId) && (
              <h3 className="mt-6 mb-3 text-sm text-secondary-text">
                <UiLiteral text={"已有独立验证记录"} /></h3>
            )}
            {loading && <p role="status"><UiLiteral text={"加载中…"} /></p>}
            {items
              .filter((p) => !p.definitionId)
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
            {definition && (
              <section
                className="mb-7 border-b border-border pb-6"
                aria-label={uiLiteral("已保存策略")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="min-w-0 break-words text-xl font-semibold">{definition.name}</h2>
                  <div className="flex flex-wrap gap-2">
                    {definition.config.engine === 'agent' && <button className="btn-secondary" disabled={sending || editBlocked} onClick={() => {
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
                {editBlocked && <p className="mt-3 text-sm text-secondary-text"><UiLiteral text="请先暂停或停止运行，再修改配置。" /></p>}
                {items.some(p => p.definitionId === definition.id && p.status === 'stopped') && !items.some(p => p.definitionId === definition.id && (p.busy || ['running', 'paused'].includes(p.status))) &&
                  <p role="status" className="mt-3 text-sm text-secondary-text"><UiLiteral text="已停止运行，不再自动调用模型或更新估值，待执行计划已取消；历史记录和模拟持仓保留。" /></p>}
                <p className="mt-2 text-sm text-secondary-text">
                  {definition.config.engine === "agent"
                    ? definition.config.skillSnapshot?.name || "Agent 策略 Skill"
                    : uiLiteral("已下线固定规则")}{" "}
                  · {definition.config.symbols.join("、")} ·{" "}
                  {definition.config.market} · {definition.config.decisionBackend === "jev" ? `JEV · ${definition.config.jevModel || ""}` : "LLM"}
                </p>
                <p className="mt-2 text-sm text-secondary-text">
                  <UiLiteral text={"同一版配置共用最近的模拟账户，回测独立记账。修改配置后，下次运行创建新账户，旧持仓和历史保留。"} /></p>
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
                        setError("");
                      }}
                    >
                      {uiLiteral(label)}
                    </button>
                  ))}
                  </> : <p className="text-sm text-secondary-text"><UiLiteral text={"此策略的固定规则已下线，历史记录可查看，但不能创建或继续运行。"} /></p>}
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setEditing(null);
                      openConfig({ ...seed, ...definition.config }, `${definition.name} · 新版本`);
                    }}
                  >
                    <UiLiteral text={"复制策略"} /></button>
                </div>
                {launch === "backtest" &&
                  definition.config.engine === "agent" && (
                    <div className="mt-4 border-y border-border py-4">
                      <p className="text-sm text-warning">
                        <UiLiteral text={"AI 历史回放：模型可能知道后来的事件，不能等同严格规则回测。每次最多处理20个交易日，预算不足时可继续运行。"} /></p>
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
                                  historyMode: "ai_replay" as const,
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
                        setDate("");
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
            )}

            {detail?.id === id ? (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{detail.name}</h2>
                    <p className="mt-2 text-sm text-secondary-text">
                      {detail.mode === "paper"
                        ? uiLiteral("每日持续模拟")
                        : detail.config.engine === "agent"
                          ? uiLiteral("AI 历史回放")
                          : uiLiteral("历史回测")}{" "}
                      <UiLiteral text={"· 固定版本 "} />{detail.versionId} · {uiLiteral(status(detail))}
                    </p>
                    <p className="mt-1 text-xs text-secondary-text">
                      <UiLiteral text={"观察区间："} />{days[0]?.date || detail.config.startDate} <UiLiteral text={" 至"} />{" "}
                      {detail.lastDate || "等待收盘"} · {days.length} <UiLiteral text={" 个交易日 ·"} />{" "}
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
                      <button
                        className="btn-secondary"
                        onClick={() => {
                        setEditing(null);
                        openConfig(detail.config, `${detail.name} · 新版本`);
                      }}
                    >
                      <UiLiteral text={"复制配置"} /></button>
                  </div>
                </div>
                {historical && <p role="status" className="mb-4 text-sm text-secondary-text"><UiLiteral text="这是旧版配置的历史记录，请从策略页运行最新配置。" /></p>}
                {!!detail.agentCalls?.length && <details className="mb-5 border-y border-border py-4"><summary className="cursor-pointer"><UiLiteral text={"Agent 调用记录（含未成交和失败，最近20次）"} /></summary>{detail.agentCalls.map(c=><details key={c.id} className="mt-3"><summary className="cursor-pointer text-sm">{c.createdAt} · {c.model} · {c.usage.total_tokens ?? "未知"} Token · {c.status === "rejected" ? uiLiteral("计划未通过校验") : c.status === "failed" ? uiLiteral("调用失败") : uiLiteral("已收到回答，成交见账本")}</summary>{c.error && <p className="mt-2 text-sm text-danger">{c.error}</p>}<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{c.answer}</pre><details><summary className="cursor-pointer text-xs"><UiLiteral text={"本次输入与 Prompt"} /></summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(c.input,null,2)}</pre></details></details>)}</details>}
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
                    <UiLiteral text={"已暂停自动买卖；持仓保留，继续按收盘价估值。"} /></p>
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 xl:grid-cols-4">
                  {metricLabels.map(([key, label, percent]) => (
                    <div key={key}>
                      <dt className="text-xs text-secondary-text">{uiLiteral(label)}</dt>
                      <dd className="mt-2 text-xl font-semibold tabular-nums">
                        {fmt(detail.metrics?.[key], percent)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs leading-5 text-secondary-text">
                  <UiLiteral text={"年化指标至少需要 20 个记账交易日；夏普在零波动、卡玛在零回撤时不定义。当日收益对应最近估值日。收益已扣配置费用与滑点。"} /></p>
                <section className="mt-6 border-b border-border pb-5">
                  <h3 className="font-semibold"><UiLiteral text={"同配置的历史与模拟验证"} /></h3>
                  {detail.comparisons?.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr>
                            {[
                              "账户",
                              "观察区间",
                              "交易日",
                              "累计收益",
                              "最大回撤",
                            ].map((x) => (
                              <th key={x} className="p-2">
                                {x}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.comparisons.map((c) => (
                            <tr className="border-t border-border" key={c.id}>
                              <td className="p-2">
                                <button
                                  className="text-primary"
                                  onClick={() => select(c.id)}
                                >
                                  {c.mode === "backtest"
                                    ? uiLiteral("历史回测")
                                    : uiLiteral("实时模拟")}{" "}
                                  · {c.name}
                                </button>
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {c.startDate || "—"} — {c.endDate || "—"}
                              </td>
                              <td className="p-2">{c.samples}</td>
                              <td className="p-2">
                                {fmt(c.metrics.cumulativeReturn, true)}
                              </td>
                              <td className="p-2">
                                {fmt(c.metrics.maxDrawdown, true)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-secondary-text">
                      <UiLiteral text={"尚无同配置的"} />{detail.mode === "paper" ? uiLiteral("历史回测") : uiLiteral("实时模拟")}
                      <UiLiteral text={"。在所属策略中选择另一种验证；旧记录可先复制配置并保存为策略。"} /></p>
                  )}
                </section>
                {days.length ? (
                  <>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold"><UiLiteral text={"业绩走势"} /></h3>
                      <select
                        aria-label={uiLiteral("曲线范围")}
                        className="rounded border border-border bg-background p-2 text-sm"
                        value={windowSize}
                        onChange={(e) => setWindowSize(Number(e.target.value))}
                      >
                        <option value={30}><UiLiteral text={"最近 30 个交易日"} /></option>
                        <option value={120}><UiLiteral text={"最近 120 个交易日"} /></option>
                      </select>
                    </div>
                    <AnalysisChart
                      chart={{
                        version: 1,
                        type: "line",
                        title: "累计收益与基准对比",
                        source: `每日净值账本；${detail.config.benchmarkName}`,
                        basis: "scenario",
                        unit: "%",
                        series: [
                          {
                            key: "v0",
                            name:
                              detail.mode === "paper" ? "模拟收益" : "回测收益",
                          },
                          {
                            key: "v1",
                            name: detail.config.benchmarkName || "基准",
                          },
                        ],
                        data: visible.map((d) => ({
                          label: d.date,
                          v0: (d.equity / detail.config.initialCash - 1) * 100,
                          v1:
                            d.benchmarkReturn == null
                              ? null
                              : d.benchmarkReturn * 100,
                        })),
                      }}
                    />
                    <AnalysisChart
                      chart={{
                        version: 1,
                        type: "bar",
                        title: "每日收益率",
                        source: "每日模拟净值变化，非实盘",
                        basis: "scenario",
                        unit: "%",
                        series: [{ key: "v0", name: "每日收益" }],
                        data: visible.map((d) => ({
                          label: d.date,
                          v0: d.dailyReturn * 100,
                        })),
                      }}
                    />
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["trades", "每日买卖"],
                          ["holdings", "当前持仓"],
                          ["opinions", "每日观点"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            aria-pressed={tab === key}
                            className={
                              tab === key ? "btn-primary" : "btn-secondary"
                            }
                            onClick={() => setTab(key)}
                          >
                            {uiLiteral(label)}
                          </button>
                        ))}
                      </div>
                      {tab !== "holdings" && (
                        <label className="text-sm">
                          <UiLiteral text={"查看日期"} />{" "}
                          <select
                            className="rounded border border-border bg-background p-2"
                            aria-label={uiLiteral("查看日期")}
                            value={selected?.date || ""}
                            onChange={(e) => setDate(e.target.value)}
                          >
                            {[...days].reverse().map((d) => (
                              <option key={d.date}>{d.date}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {tab === "holdings" ? (
                      <>
                        <p className="mb-3 text-sm text-secondary-text">
                          <UiLiteral text={"净资产 "} />{fmt(latest?.equity)} <UiLiteral text={" · 可用现金"} />{" "}
                          {fmt(latest?.cash)} <UiLiteral text={" · 持仓市值"} />{" "}
                          {fmt(latest?.marketValue)}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr>
                                {[
                                  "股票",
                                  "数量",
                                  "含费用成本",
                                  "估值价格",
                                  "市值",
                                  "浮动盈亏",
                                ].map((x) => (
                                  <th className="p-3" key={x}>
                                    {x}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {latest?.holdings.map((h) => (
                                <tr
                                  key={h.code}
                                  className="border-t border-border"
                                >
                                  <td className="p-3">{h.code}</td>
                                  {[
                                    h.quantity,
                                    h.averageCost,
                                    h.price,
                                    h.marketValue,
                                    h.unrealizedPnl,
                                  ].map((v, i) => (
                                    <td className="p-3 tabular-nums" key={i}>
                                      {fmt(v)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!latest?.holdings.length && (
                          <p className="py-5 text-secondary-text"><UiLiteral text={"当前空仓。"} /></p>
                        )}
                      </>
                    ) : tab === "opinions" ? (
                      <div className="divide-y divide-border">
                        {selected?.opinions.map((o) => (
                          <article key={o.code} className="py-4">
                            <div className="flex gap-3 font-medium">
                              <span>{o.code}</span>
                              <span
                                className={
                                  o.stance === "bullish"
                                    ? "text-success"
                                    : o.stance === "bearish"
                                      ? "text-danger"
                                      : "text-secondary-text"
                                }
                              >
                                {o.decisionBackend === "jev"
                                  ? uiLiteral(o.decision === "buy" ? "买入" : o.decision === "sell" ? "卖出" : "不动")
                                  : o.stance === "bullish"
                                  ? uiLiteral("看好")
                                  : o.stance === "bearish"
                                    ? uiLiteral("看淡")
                                    : uiLiteral("中性")}
                              </span>
                              {o.held && (
                                <span className="text-xs text-secondary-text">
                                  <UiLiteral text={"当日持仓"} /></span>
                              )}
                            </div>
                            {o.decisionBackend === "jev" ? (
                              <div className="mt-2 space-y-2 text-sm text-secondary-text">
                                <p>JEV · {uiLiteral("置信度")} {((o.confidence ?? 0) * 100).toFixed(1)}% · {uiLiteral("目标仓位")} {((o.targetWeight ?? 0) * 100).toFixed(1)}%</p>
                                <p className="flex flex-wrap gap-x-4 gap-y-1">
                                  {(["buy", "sell", "hold"] as const).map((key) => <span key={key}>
                                    {uiLiteral(key === "buy" ? "买入" : key === "sell" ? "卖出" : "不动")} {((o.probabilities?.[key] ?? 0) * 100).toFixed(1)}%
                                  </span>)}
                                </p>
                                <p><UiLiteral text="仅决策结果，无模型解释。目标仓位已应用调仓比例和账户约束，实际成交请查看交易记录。" /></p>
                              </div>
                            ) : <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{o.reason}</p>}
                          </article>
                        ))}
                        <p className="py-3 text-xs text-secondary-text">
                          <UiLiteral text={"观点由保存时冻结的 Agent Skill 生成；每个股票池成员每天都有记录。"} /></p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr>
                              {[
                                "股票／方向",
                                "数量",
                                "成交价",
                                "费用",
                                "信号日",
                                "状态／原因",
                              ].map((x) => (
                                <th className="p-3" key={x}>
                                  {x}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selected?.trades.map((t, i) => (
                              <tr
                                key={i}
                                className="border-t border-border align-top"
                              >
                                <td className="p-3 whitespace-nowrap">
                                  {t.code} ·{" "}
                                  {t.side === "buy" ? uiLiteral("买入") : uiLiteral("卖出")}
                                </td>
                                <td className="p-3">{t.quantity}</td>
                                <td className="p-3">{fmt(t.price)}</td>
                                <td className="p-3">{fmt(t.fee)}</td>
                                <td className="p-3 whitespace-nowrap">
                                  {t.signalDate}
                                </td>
                                <td className="min-w-64 p-3 leading-6">
                                  {t.status === "filled"
                                    ? uiLiteral("模拟成交")
                                    : uiLiteral("未成交")}{" "}
                                  · {t.reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!selected?.trades.length && (
                          <p className="py-5 text-secondary-text">
                            <UiLiteral text={"当日无买卖。查看每日观点了解持有、等待或暂停原因。"} /></p>
                        )}
                      </div>
                    )}
                    {selected?.replayed && (
                      <p className="mt-3 text-xs text-warning">
                        <UiLiteral text={"此日期在恢复运行时补记，属于规则历史回放，不计作当时在线决策的证明。"} /></p>
                    )}
                    {selected?.workspaceRunId && (
                      <Link
                        className="mt-5 inline-block text-sm text-primary"
                        to={`/runs/${selected.workspaceRunId}`}
                      >
                        <UiLiteral text={"查看对应任务与运行 →"} /></Link>
                    )}
                  </>
                ) : (
                  <div className="py-16 text-center">
                    <h3 className="text-lg font-medium"><UiLiteral text={"尚无已记账交易日"} /></h3>
                    <p className="mt-3 text-sm text-secondary-text">
                      <UiLiteral text={"点击运行一次或持续运行；尚未收盘时会等待行情。首日形成观点，下一交易日才可能成交。"} /></p>
                  </div>
                )}
                {selected?.universe && (
                  <details className="mt-5 border-y border-border py-4">
                    <summary className="cursor-pointer">
                      <UiLiteral text={"当日范围、决策与 Token"} /></summary>
                    <p className="mt-3 text-sm">
                      {selected.validationLabel} ·{" "}
                      {selected.usage
                        ? `${selected.usage.model} · ${selected.usage.tokens} Token`
                        : uiLiteral("本日无模型决策")}
                    </p>
                    <p className="mt-2 text-xs text-secondary-text">
                      {selected.universe.coverage} · {selected.universe.source}{" "}
                      · {selected.universe.observedAt}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {selected.universe.candidates.map((c) => (
                        <li key={c.code} className="text-sm">
                          {c.code}：{c.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <details className="mt-7 border-t border-border py-4">
                  <summary className="cursor-pointer font-medium">
                    <UiLiteral text={"策略规则、指标口径与边界"} /></summary>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-secondary-text">
                    <p>
                      {detail.config.engine === "agent"
                        ? uiLiteral(`${detail.config.skillSnapshot?.name || "Agent 策略 Skill"}：使用保存时冻结的 Skill、交易指令和范围生成每日目标仓位，并由程序风控与模拟账本执行。`)
                        : uiLiteral("固定规则策略已下线；此处仅保留历史账本与指标供查看。")}
                    </p>
                    <p>
                      <UiLiteral text={"股票池："} />{detail.config.symbols.join("、")}<UiLiteral text={"。最大持仓"} />{" "}
                      {detail.config.maxPositions} <UiLiteral text={" 只；单股建仓上限"} />{" "}
                      {fmt(detail.config.maxWeight, true)}
                      <UiLiteral text={"。当前版本不可修改。佣金"} />{" "}
                      {fmt(detail.config.commissionRate, true)}<UiLiteral text={"，卖出税费"} />{" "}
                      {fmt(detail.config.sellTaxRate, true)}<UiLiteral text={"，滑点"} />{" "}
                      {fmt(detail.config.slippageRate, true)}。
                    </p>
                    <p>
                      <UiLiteral text={"区间换手率 = 买卖成交额总和 ÷ 2 ÷ 平均净资产。年化收益按 252 个交易日复利折算；夏普使用日超额收益与样本标准差；卡玛 = 年化收益 ÷ 最大回撤，无风险利率"} />{" "}
                      {fmt(detail.config.riskFreeRate, true)}。
                    </p>
                    <p>
                      <UiLiteral text={"使用日线价格进行简化撮合，不模拟盘口、部分成交、涨跌停排队及分红配股。基准 ETF 存在跟踪误差。历史回测与实时模拟分别记账，不拼接收益曲线。行情缺失会中止当日记账。"} /></p>
                  </div>
                </details>
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
