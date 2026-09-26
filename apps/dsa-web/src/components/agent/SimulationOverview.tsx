import { InlinePortfolioDetails } from "./InlinePortfolioDetails";
import { signalLabel } from "../../utils/portfolioTiming";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  simulationOverviewApi,
  type SimulationCurve,
} from "../../api/portfolios";
import { useUiLiteral } from "../../hooks/useUiLiteral";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { toApiErrorMessage } from "../../api/error";

const colors = [
  "#7587ff",
  "#13a98b",
  "#e29235",
  "#db6f96",
  "#8b90a3",
  "#469fcb",
  "#b18de0",
  "#a3993a",
  "#dc7657",
  "#55a69d",
  "#c495ba",
  "#909ee0",
];
export function SimulationOverview({
  onOpen,
  onResearch,
  onAdopt,
}: {
  onOpen: (id: number) => void;
  onResearch: (id: number) => void;
  onAdopt: (id: number) => void;
}) {
  const t = useUiLiteral();
  const { language } = useUiLanguage();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rows, setRows] = useState<SimulationCurve[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [market, setMarket] = useState("ALL");
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);
  const [benchmark, setBenchmark] = useState(false);
  const [windowDays, setWindowDays] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await simulationOverviewApi.get();
        if (active) {
          setRows(result.items);
          setLoaded(true);
          setUnavailable(
            result.runtime.configured && !result.runtime.available,
          );
          setError("");
        }
      } catch (e) {
        if (active) setError(toApiErrorMessage(e));
      } finally {
        if (active) timer = setTimeout(load, 30000);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const filtered = rows
    .filter(
      (row) =>
        (all || row.status === "running") &&
        (market === "ALL" || row.market === market),
    )
    .sort((a, b) => {
      const aReturn = a.cumulativeReturn;
      const bReturn = b.cumulativeReturn;
      const aKnown = typeof aReturn === "number" && Number.isFinite(aReturn);
      const bKnown = typeof bReturn === "number" && Number.isFinite(bReturn);
      if (aKnown && bKnown) return bReturn - aReturn || a.id - b.id;
      return Number(bKnown) - Number(aKnown) || a.id - b.id;
    });
  const visible = filtered.filter((row) => !hidden.includes(row.id));
  const data = useMemo(() => {
    const times = new Map<number, Record<string, number>>();
    const latest = Math.max(
      0,
      ...visible.flatMap((row) => row.curve.map((p) => Date.parse(p.time))),
    );
    const cutoff = windowDays ? latest - windowDays * 86400000 : -Infinity;
    for (const row of visible)
      for (const point of row.curve) {
        const time = Date.parse(point.time);
        if (!Number.isFinite(time) || time < cutoff) continue;
        const record = times.get(time) ?? { time };
        record[`r${row.id}`] = point.value * 100;
        if (point.benchmark != null)
          record[`b${row.id}`] = point.benchmark * 100;
        times.set(time, record);
      }
    return [...times.values()].sort((a, b) => a.time - b.time);
  }, [visible, windowDays]);
  const pct = (n: number | null) =>
    n == null
      ? "—"
      : `${(n * 100).toLocaleString(language, { maximumFractionDigits: 2 })}%`;
  const markets: Record<string, string> = {
    CN: "A 股",
    HK: "港股",
    US: "美股",
    CRYPTO: "加密货币",
    JP: "日股",
    KR: "韩股",
    TW: "台股",
  };
  return (
    <section className="mb-8" aria-label={t("模拟收益总览")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("正在模拟的策略收益")}</h2>
          <p className="mt-2 text-sm text-secondary-text">
            {t("每 30 秒更新。只展示模拟账本，不拼接历史回测。")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            {t("市场")}
            <select
              className="ml-2 rounded border border-border bg-background p-2"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option value="ALL">{t("全部市场")}</option>
              {Object.entries(markets).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("曲线范围")}
            <select
              className="ml-2 rounded border border-border bg-background p-2"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              {[
                [0, "全部记录"],
                [7, "最近 7 天"],
                [30, "最近 30 天"],
              ].map(([n, label]) => (
                <option key={n} value={n}>
                  {t(String(label))}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {(error || unavailable) && (
        <p role="alert" className="mt-3 text-warning">
          {t("更新失败时保留上次数据，请查看更新时间。")}{" "}
          {error || t("私有运行引擎暂时不可用，本地策略仍可使用。")}
        </p>
      )}
      {!loaded && !error && (
        <p role="status" className="py-16 text-secondary-text">
          {t("加载中…")}
        </p>
      )}
      {loaded && (
        <>
          <div className="mt-5 border-y border-border py-4">
            <div className="mb-4 flex flex-wrap items-center gap-5 text-sm">
              <span>
                {t("模拟账户")} · {filtered.length}
              </span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setAll(e.target.checked)}
                />
                {t("包含暂停和停止的账户")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={benchmark}
                  onChange={(e) => setBenchmark(e.target.checked)}
                />
                {t("显示可用基准")}
              </label>
            </div>
            {data.length ? (
              <div
                className="h-80 w-full overflow-hidden sm:h-96"
                role="img"
                aria-label={t("模拟收益对比曲线")}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 15, right: 15, bottom: 10, left: 0 }}
                  >
                    <CartesianGrid
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      type="number"
                      dataKey="time"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      tickCount={5}
                      tick={{
                        fontSize: 11,
                        fill: "hsl(var(--muted-foreground))",
                      }}
                      tickFormatter={(n) =>
                        new Date(n).toLocaleDateString(language, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })
                      }
                      minTickGap={50}
                    />
                    <YAxis
                      tick={{
                        fontSize: 11,
                        fill: "hsl(var(--muted-foreground))",
                      }}
                      tickFormatter={(n) => `${n.toFixed(1)}%`}
                      width={62}
                    />
                    <Tooltip
                      labelFormatter={(n) =>
                        `${new Date(Number(n)).toLocaleString(language, { timeZone: "UTC" })} UTC`
                      }
                      formatter={(n) => `${Number(n).toFixed(3)}%`}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                        maxWidth: 240,
                        whiteSpace: "normal",
                      }}
                    />
                    <ReferenceLine
                      y={0}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                    />
                    {visible.map((row) => (
                      <Line
                        key={row.id}
                        dataKey={`r${row.id}`}
                        name={row.name}
                        stroke={
                          colors[
                            rows.findIndex((r) => r.id === row.id) %
                              colors.length
                          ]
                        }
                        strokeWidth={2}
                        dot={data.length === 1}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    {benchmark &&
                      visible
                        .filter((row) =>
                          row.curve.some((p) => p.benchmark != null),
                        )
                        .map((row) => (
                          <Line
                            key={`b${row.id}`}
                            dataKey={`b${row.id}`}
                            name={`${row.name} · ${t("基准")}`}
                            stroke={
                              colors[
                                rows.findIndex((r) => r.id === row.id) %
                                  colors.length
                              ]
                            }
                            strokeDasharray="5 5"
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-secondary-text">
                {t(
                  filtered.length
                    ? "等待有效模拟观测，尚无收益曲线。"
                    : "当前筛选下没有正在模拟的策略。",
                )}
              </p>
            )}
            <p className="mt-3 max-w-4xl text-xs leading-5 text-secondary-text">
              {t(
                "收益率以各账户初始资金计算，共用 UTC 时间轴；启动日期、币种和观察周期可能不同，仅供运行对照。缺失基准不补造；曲线保留局部极值，完整记录在详情中。",
              )}
            </p>
          </div>
          <div className="mt-6 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {t("模拟策略")} · {filtered.length}
            </h2>
            <p className="text-xs text-secondary-text">
              {t("点击策略展开详情")}
            </p>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {filtered.map((row) => (
              <article key={row.id}>
                <div className="flex items-start gap-3 py-4 sm:items-center">
                  <input
                    className="mt-1 shrink-0 sm:mt-0"
                    type="checkbox"
                    aria-label={`${t("在收益曲线中显示")} · ${row.name}`}
                    checked={!hidden.includes(row.id)}
                    onChange={() =>
                      setHidden((old) =>
                        old.includes(row.id)
                          ? old.filter((id) => id !== row.id)
                          : [...old, row.id],
                      )
                    }
                  />
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 text-left sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]"
                    aria-expanded={expanded === row.id}
                    aria-controls={`simulation-detail-${row.id}`}
                    onClick={() =>
                      setExpanded(expanded === row.id ? null : row.id)
                    }
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-semibold">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background:
                              colors[
                                rows.findIndex((r) => r.id === row.id) %
                                  colors.length
                              ],
                          }}
                        />
                        <span className="break-words">{row.name}</span>
                      </span>
                      <span className="mt-1 block text-xs text-secondary-text">
                        {t(markets[row.market])} ·{" "}
                        {t(signalLabel(row.timing?.signalTimeframe))} ·{" "}
                        {t(
                          row.error
                            ? "等待行情或处理异常"
                            : row.status === "running"
                              ? "持续模拟"
                              : row.status === "paused"
                                ? "已暂停交易"
                                : "已停止运行",
                        )}
                      </span>
                    </span>
                    <span className="col-start-1 row-start-2 flex gap-6 text-sm sm:contents">
                      <span>
                        <span className="text-xs text-secondary-text">
                          {t("累计收益")}
                        </span>
                        <span className="mt-1 block font-semibold tabular-nums">
                          {pct(row.cumulativeReturn)}
                        </span>
                      </span>
                      <span>
                        <span className="text-xs text-secondary-text">
                          {t("最大回撤")}
                        </span>
                        <span className="mt-1 block tabular-nums">
                          {pct(row.maxDrawdown)}
                        </span>
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="col-start-2 row-start-1 text-lg text-secondary-text sm:col-start-4"
                    >
                      {expanded === row.id ? "−" : "+"}
                    </span>
                  </button>
                </div>
                {expanded === row.id && (
                  <div
                    id={`simulation-detail-${row.id}`}
                    role="region"
                    aria-label={row.name}
                    className="min-w-0 border-t border-border sm:pl-7"
                  >
                    <InlinePortfolioDetails
                      key={row.id}
                      id={row.id}
                      onManage={onOpen}
                      onResearch={onResearch}
                      onAdopt={onAdopt}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
