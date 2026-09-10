import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { extractErrorPayloadText, toApiErrorMessage } from "../api/error";
import { useStockIndex } from "../hooks/useStockIndex";
import { resolveStrategyPool } from "../utils/strategyStockPool";
import ResearchReportsWorkspace from "./ResearchReportsWorkspace";
import { AppPage } from "../components/common";
import { AnalysisChart } from "../components/report/AnalysisChart";
import {
  portfoliosApi,
  type Portfolio,
  type RuleConfig,
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
  template: "volume_breakout",
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
  const [params, setParams] = useSearchParams();
  const legacy =
    params.get("view") === "reports" ||
    params.has("sourceRun") ||
    params.has("run");
  const id = Number(params.get("portfolio")) || null;
  const [items, setItems] = useState<Portfolio[]>([]);
  const [templates, setTemplates] = useState<
    { id: string; name: string; description: string }[]
  >([]);
  const [detail, setDetail] = useState<Portfolio | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<RuleConfig>(seed);
  const [symbols, setSymbols] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
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
        const [list, catalog, selected] = await Promise.all([
          portfoliosApi.list(),
          portfoliosApi.templates(),
          id ? portfoliosApi.detail(id) : Promise.resolve(null),
        ]);
        if (alive) {
          setItems(list);
          setTemplates(catalog);
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
  if (legacy)
    return (
      <>
        <div className="px-6 pt-4">
          <Link to="/trading" className="text-primary">
            ← 返回策略运行
          </Link>
        </div>
        <ResearchReportsWorkspace mode="trading" />
      </>
    );
  const select = (next: number) => {
    setParams({ portfolio: String(next) });
    setCreating(false);
    setDate("");
    setDetail(null);
  };
  const days = detail?.id === id ? detail.days || [] : [];
  const latest = days.at(-1);
  const selected = days.find((d) => d.date === date) || latest;
  const change = <K extends keyof RuleConfig>(key: K, value: RuleConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (stockIndex.loading) {
      setError("股票目录正在加载，请稍后创建。");
      return;
    }
    const unresolved = pool.find((p) => !p.stock);
    if (unresolved) {
      setError(`请确认“${unresolved.query}”对应的股票；从下方匹配结果选择。`);
      return;
    }
    if (poolMarkets.length > 1) {
      setError("识别到多个市场；每个策略账户使用同一市场，请分别创建账户。");
      return;
    }
    const codes = [
      ...new Set(pool.flatMap((p) => (p.stock ? [p.stock.code] : []))),
    ];
    if (codes.length < 1 || codes.length > 12) {
      setError(`股票池需要 1–12 个股票代码，当前填写了 ${codes.length} 个。`);
      return;
    }
    setSending(true);
    try {
      const p = await portfoliosApi.create({
        ...draft,
        symbols: codes,
        market: poolMarket || draft.market,
        lotSize: poolLot,
      });
      select(p.id);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(failure(e));
    } finally {
      setSending(false);
    }
  };
  const control = async (action: "run" | "start" | "pause") => {
    if (!id) return;
    setSending(true);
    setError("");
    try {
      setDetail(await portfoliosApi.control(id, action));
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(failure(e));
    } finally {
      setSending(false);
    }
  };
  const visible = days.slice(-windowSize);
  const inputClass =
    "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <AppPage>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-semibold">策略验证与运行</h1>
          <p className="mt-2 text-sm text-secondary-text">
            历史回测与每日模拟，持续跟踪每一笔决策。
          </p>
        </div>
        <div className="flex gap-3">
          <Link className="btn-secondary" to="/trading?view=reports">
            历史研究提案
          </Link>
          <button
            className="btn-primary"
            onClick={() => {
              setCreating(true);
              setDraft(seed);
              setSymbols("");
            }}
          >
            配置策略
          </button>
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
            <h2 className="text-xl font-semibold">从规则模板开始</h2>
            <button
              className="btn-secondary"
              onClick={() => setCreating(false)}
            >
              取消
            </button>
          </div>
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {templates.map((t) => (
              <button
                type="button"
                key={t.id}
                aria-pressed={draft.template === t.id}
                className={`rounded-lg border p-4 text-left ${draft.template === t.id ? "border-primary bg-primary/5" : "border-border"}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    template: t.id,
                    name: d.name || t.name,
                  }))
                }
              >
                <strong>{t.name}</strong>
                <p className="mt-2 text-sm leading-6 text-secondary-text">
                  {t.description}
                </p>
                <span className="mt-3 block text-xs text-secondary-text">
                  固定规则 · 日线决策
                </span>
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="max-w-4xl space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                策略名称
                <input
                  required
                  maxLength={80}
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              <label>
                验证方式
                <select
                  className={inputClass}
                  value={draft.mode}
                  onChange={(e) =>
                    change("mode", e.target.value as RuleConfig["mode"])
                  }
                >
                  <option value="paper">持续模拟（从今天开始）</option>
                  <option value="backtest">历史回测（独立账户）</option>
                </select>
              </label>
              <div className="sm:col-span-2">
                <label className="block">
                  股票池（名称或代码，最多 12 只）
                  <input
                    required
                    className={inputClass}
                    value={symbols}
                    onChange={(e) => setSymbols(e.target.value)}
                    placeholder="例如 贵州茅台、平安银行，或 英伟达、苹果"
                  />
                </label>
                <p className="mt-2 text-sm text-secondary-text">
                  {stockIndex.loading
                    ? "正在加载与个股研究共用的股票目录…"
                    : poolMarkets.length > 1
                      ? "包含多个市场，请分别创建策略账户。"
                      : poolMarket
                        ? `自动识别市场：${marketLabels[poolMarket]}`
                        : "输入名称、代码或拼音，自动识别股票和市场。多只股票用逗号或顿号分隔。"}
                </p>
                {stockIndex.fallback && (
                  <p className="mt-2 text-xs text-warning">
                    股票目录暂时使用降级数据；未找到名称时可输入完整股票代码。
                  </p>
                )}
                <div className="mt-3 space-y-2" aria-label="股票识别结果">
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
                            ? " · 目录未收录名称，请核对代码"
                            : ""}
                        </span>
                      ) : (
                        <>
                          <p>
                            {p.query}：
                            {p.candidates.length
                              ? "请选择匹配的股票"
                              : "尚未识别，请补全名称或代码"}
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
              <label>
                初始模拟资金
                <input
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
                最大持仓数量
                <input
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
              {draft.mode === "backtest" && (
                <>
                  <label>
                    回测开始
                    <input
                      required
                      type="date"
                      className={inputClass}
                      value={draft.startDate || ""}
                      onChange={(e) => change("startDate", e.target.value)}
                    />
                  </label>
                  <label>
                    回测结束
                    <input
                      required
                      type="date"
                      className={inputClass}
                      value={draft.endDate || ""}
                      onChange={(e) => change("endDate", e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <details className="border-y border-border py-4">
              <summary className="cursor-pointer font-medium">
                仓位、交易成本与指标假设
              </summary>
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
                    {label}
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
              按已收盘日线产生观点，下一交易日开盘价加减滑点模拟成交。参数保存后固定；修改参数请创建新账户。基准使用同市场指数
              ETF 的价格表现，不含分红。请核对税费和每手股数。
            </p>
            <button disabled={sending} className="btn-primary">
              {sending ? "保存中…" : "创建策略账户"}
            </button>
          </form>
        </section>
      ) : (
        <div className="grid gap-7 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside>
            <h2 className="mb-3 font-semibold">我的策略账户</h2>
            {loading && <p role="status">加载中…</p>}
            {items.map((p) => (
              <button
                key={p.id}
                onClick={() => select(p.id)}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${id === p.id ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <strong className="block truncate">{p.name}</strong>
                <span className="mt-2 block text-xs text-secondary-text">
                  {p.mode === "paper" ? "实时模拟" : "历史回测"} · {p.market} ·{" "}
                  {status(p)}
                </span>
              </button>
            ))}
            {!loading && !items.length && (
              <p className="text-sm text-secondary-text">
                尚无策略账户。选择模板，开始验证。
              </p>
            )}
          </aside>
          <section className="min-w-0" aria-label="策略详情">
            {detail?.id === id ? (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{detail.name}</h2>
                    <p className="mt-2 text-sm text-secondary-text">
                      {detail.mode === "paper" ? "每日持续模拟" : "历史回测"} ·
                      固定版本 {detail.versionId} · {status(detail)}
                    </p>
                    <p className="mt-1 text-xs text-secondary-text">
                      观察区间：{days[0]?.date || detail.config.startDate} 至{" "}
                      {detail.lastDate || "等待收盘"} · {days.length} 个交易日 ·{" "}
                      {detail.currency}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-secondary"
                      disabled={sending || detail.busy}
                      onClick={() => void control("run")}
                    >
                      运行一次
                    </button>
                    {detail.mode === "paper" && (
                      <button
                        className="btn-primary"
                        disabled={sending}
                        onClick={() =>
                          void control(
                            detail.status === "running" ? "pause" : "start",
                          )
                        }
                      >
                        {detail.status === "running" ? "暂停交易" : "持续运行"}
                      </button>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setDraft({
                          ...detail.config,
                          name: `${detail.name} · 新版本`,
                        });
                        setSymbols(detail.config.symbols.join(", "));
                        setCreating(true);
                      }}
                    >
                      复制配置
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setDraft({
                          ...detail.config,
                          name: `${detail.name} · ${detail.mode === "paper" ? "回测" : "模拟"}`,
                          mode: detail.mode === "paper" ? "backtest" : "paper",
                          startDate: null,
                          endDate: null,
                        });
                        setSymbols(detail.config.symbols.join(", "));
                        setCreating(true);
                      }}
                    >
                      {detail.mode === "paper" ? "回测此配置" : "创建实时模拟"}
                    </button>
                  </div>
                </div>
                {detail.error && (
                  <p
                    role="alert"
                    className="mb-4 border border-danger p-3 text-danger"
                  >
                    {detail.error} 已完成的日期仍保留，可修复后重试。
                  </p>
                )}
                {detail.status === "paused" && (
                  <p className="mb-4 text-sm text-secondary-text">
                    已暂停自动买卖；持仓保留，继续按收盘价估值。
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 xl:grid-cols-4">
                  {metricLabels.map(([key, label, percent]) => (
                    <div key={key}>
                      <dt className="text-xs text-secondary-text">{label}</dt>
                      <dd className="mt-2 text-xl font-semibold tabular-nums">
                        {fmt(detail.metrics?.[key], percent)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs leading-5 text-secondary-text">
                  年化指标至少需要 20
                  个记账交易日；夏普在零波动、卡玛在零回撤时不定义。当日收益对应最近估值日。收益已扣配置费用与滑点。
                </p>
                <section className="mt-6 border-b border-border pb-5">
                  <h3 className="font-semibold">同配置的历史与模拟验证</h3>
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
                                    ? "历史回测"
                                    : "实时模拟"}{" "}
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
                      尚无同配置的
                      {detail.mode === "paper" ? "历史回测" : "实时模拟"}
                      。使用上方按钮创建，两种验证分别保留账户与日期范围。
                    </p>
                  )}
                </section>
                {days.length ? (
                  <>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">业绩走势</h3>
                      <select
                        aria-label="曲线范围"
                        className="rounded border border-border bg-background p-2 text-sm"
                        value={windowSize}
                        onChange={(e) => setWindowSize(Number(e.target.value))}
                      >
                        <option value={30}>最近 30 个交易日</option>
                        <option value={120}>最近 120 个交易日</option>
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
                            {label}
                          </button>
                        ))}
                      </div>
                      {tab !== "holdings" && (
                        <label className="text-sm">
                          查看日期{" "}
                          <select
                            className="rounded border border-border bg-background p-2"
                            aria-label="查看日期"
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
                          净资产 {fmt(latest?.equity)} · 可用现金{" "}
                          {fmt(latest?.cash)} · 持仓市值{" "}
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
                          <p className="py-5 text-secondary-text">当前空仓。</p>
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
                                {o.stance === "bullish"
                                  ? "看好"
                                  : o.stance === "bearish"
                                    ? "看淡"
                                    : "中性"}
                              </span>
                              {o.held && (
                                <span className="text-xs text-secondary-text">
                                  当日持仓
                                </span>
                              )}
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
                              {o.reason}
                            </p>
                          </article>
                        ))}
                        <p className="py-3 text-xs text-secondary-text">
                          观点由固定价格规则生成，不冒充专家或模型判断；每个股票池成员每天都有记录。
                        </p>
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
                                  {t.side === "buy" ? "买入" : "卖出"}
                                </td>
                                <td className="p-3">{t.quantity}</td>
                                <td className="p-3">{fmt(t.price)}</td>
                                <td className="p-3">{fmt(t.fee)}</td>
                                <td className="p-3 whitespace-nowrap">
                                  {t.signalDate}
                                </td>
                                <td className="min-w-64 p-3 leading-6">
                                  {t.status === "filled"
                                    ? "模拟成交"
                                    : "未成交"}{" "}
                                  · {t.reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!selected?.trades.length && (
                          <p className="py-5 text-secondary-text">
                            当日无买卖。查看每日观点了解持有、等待或暂停原因。
                          </p>
                        )}
                      </div>
                    )}
                    {selected?.replayed && (
                      <p className="mt-3 text-xs text-warning">
                        此日期在恢复运行时补记，属于规则历史回放，不计作当时在线决策的证明。
                      </p>
                    )}
                    {selected?.workspaceRunId && (
                      <Link
                        className="mt-5 inline-block text-sm text-primary"
                        to={`/runs/${selected.workspaceRunId}`}
                      >
                        查看对应任务与运行 →
                      </Link>
                    )}
                  </>
                ) : (
                  <div className="py-16 text-center">
                    <h3 className="text-lg font-medium">尚无已记账交易日</h3>
                    <p className="mt-3 text-sm text-secondary-text">
                      点击运行一次或持续运行；尚未收盘时会等待行情。首日形成观点，下一交易日才可能成交。
                    </p>
                  </div>
                )}
                <details className="mt-7 border-t border-border py-4">
                  <summary className="cursor-pointer font-medium">
                    策略规则、指标口径与边界
                  </summary>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-secondary-text">
                    <p>
                      {
                        templates.find((t) => t.id === detail.config.template)
                          ?.description
                      }
                    </p>
                    <p>
                      股票池：{detail.config.symbols.join("、")}。最大持仓{" "}
                      {detail.config.maxPositions} 只；单股建仓上限{" "}
                      {fmt(detail.config.maxWeight, true)}
                      。当前版本不可修改。佣金{" "}
                      {fmt(detail.config.commissionRate, true)}，卖出税费{" "}
                      {fmt(detail.config.sellTaxRate, true)}，滑点{" "}
                      {fmt(detail.config.slippageRate, true)}。
                    </p>
                    <p>
                      区间换手率 = 买卖成交额总和 ÷ 2 ÷ 平均净资产。年化收益按
                      252 个交易日复利折算；夏普使用日超额收益与样本标准差；卡玛
                      = 年化收益 ÷ 最大回撤，无风险利率{" "}
                      {fmt(detail.config.riskFreeRate, true)}。
                    </p>
                    <p>
                      使用日线价格进行简化撮合，不模拟盘口、部分成交、涨跌停排队及分红配股。基准
                      ETF
                      存在跟踪误差。历史回测与实时模拟分别记账，不拼接收益曲线。行情缺失会中止当日记账。
                    </p>
                  </div>
                </details>
              </>
            ) : (
              <div className="py-20 text-center">
                <h2 className="text-xl font-semibold">
                  选择一个策略，观察它如何运行
                </h2>
                <p className="mt-3 text-secondary-text">
                  先回测，再创建同配置的实时模拟账户，分别积累验证记录。
                </p>
                <button
                  className="btn-primary mt-5"
                  onClick={() => setCreating(true)}
                >
                  浏览规则模板
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </AppPage>
  );
}
