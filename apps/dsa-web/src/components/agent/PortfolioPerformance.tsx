import { simulationTimeTicks } from "../../utils/simulationTimeAxis";
import { simulationPercentTickFormatter } from "../../utils/simulationPercentAxis";
import { useMemo, useState } from "react";
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
import type { Portfolio } from "../../api/portfolios";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useUiLiteral } from "../../hooks/useUiLiteral";
import { portfolioTiming } from "../../utils/portfolioTiming";

export function PortfolioPerformance({ portfolio }: { portfolio: Portfolio }) {
  const t = useUiLiteral();
  const { language } = useUiLanguage();
  const [metric, setMetric] = useState("return");
  const [period, setPeriod] = useState(0);
  const timing = portfolioTiming(portfolio);
  const external = Boolean(portfolio.config.externalRuntime);
  const evidence = portfolio.externalEvidence;
  const data = useMemo(() => {
    let peak = portfolio.config.initialCash;
    const rows: Array<{time:number;value:number|null;benchmark:number|null}> = [];
    for (const day of portfolio.days ?? []) {
      if (!Number.isFinite(Date.parse(day.date))) continue;
      if (Number.isFinite(day.equity)) peak = Math.max(peak, day.equity);
      const sourceReturns = external && ('sourceReturn' in day || evidence?.performanceBasis === 'unit_nav');
      const sourceDrawdowns = external && (sourceReturns || 'sourceDrawdown' in day);
      const value = metric === 'return'
        ? sourceReturns
          ? day.sourceReturn != null && Number.isFinite(day.sourceReturn) ? day.sourceReturn * 100 : null
          : portfolio.config.initialCash > 0 && Number.isFinite(day.equity) ? (day.equity / portfolio.config.initialCash - 1) * 100 : null
        : sourceDrawdowns
          ? day.sourceDrawdown != null && Number.isFinite(day.sourceDrawdown) ? day.sourceDrawdown * 100 : null
          : peak > 0 && Number.isFinite(day.equity) ? (day.equity / peak - 1) * 100 : null;
      if (day.breakBefore && rows.length) rows.push({time: rows.at(-1)!.time,value:null,benchmark:null});
      rows.push({
        time: Date.parse(day.date),
        value,
        benchmark:
          metric === "return" && day.benchmarkReturn != null && Number.isFinite(day.benchmarkReturn)
            ? day.benchmarkReturn * 100
            : null,
      });
    }
    const cutoff =
      period && rows.length ? rows.at(-1)!.time - period * 86400000 : -Infinity;
    return rows.filter((row) => row.time >= cutoff);
  }, [portfolio.days, portfolio.config.initialCash, metric, period, external, evidence?.performanceBasis]);
  const formatPercentTick = useMemo(() => simulationPercentTickFormatter((function* () {
    for (const point of data) { yield point.value; yield point.benchmark; }
  })(), language), [data, language]);
  const fmt = (n: number | null | undefined, percent = false) =>
    n == null || !Number.isFinite(n)
      ? "—"
      : `${(n * (percent ? 100 : 1)).toLocaleString(language, { maximumFractionDigits: 2 })}${percent ? "%" : ""}`;
  const metrics = [
    ["cumulativeReturn", "累计收益", true],
    ["maxDrawdown", "最大回撤", true],
    ["annualizedReturn", "年化收益", true],
    ["sharpe", "夏普比率", false],
  ] as const;
  return (
    <section aria-label={t("策略表现")} className="py-5">
      <dl className="grid grid-cols-2 gap-5 border-b border-border pb-5 sm:grid-cols-4">
        {metrics.map(([key, label, percent]) => (
          <div key={key}>
            <dt className="text-sm text-secondary-text">{t(label)}</dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">
              {fmt(
                timing?.valuation === "live_quote" &&
                  ["annualizedReturn", "sharpe"].includes(key)
                  ? null
                  : portfolio.metrics?.[key],
                percent,
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            aria-pressed={metric === "return"}
            onClick={() => setMetric("return")}
          >
            {t("收益曲线")}
          </button>
          <button
            className="btn-secondary"
            aria-pressed={metric === "drawdown"}
            onClick={() => setMetric("drawdown")}
          >
            {t("回撤曲线")}
          </button>
        </div>
        <label className="text-sm">
          {t("曲线范围")}
          <select
            className="ml-2 rounded border border-border bg-background p-2"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={0}>{t("全部记录")}</option>
            <option value={7}>{t("最近 7 天")}</option>
            <option value={30}>{t("最近 30 天")}</option>
          </select>
        </label>
      </div>
      {data.some(row => row.value != null) ? (
        <div
          className="h-80 w-full overflow-hidden sm:h-96"
          role="img"
          aria-label={t(metric === "return" ? "收益曲线" : "回撤曲线")}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ left: 0, right: 16, top: 10, bottom: 10 }}
            >
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                ticks={simulationTimeTicks(data.map((point) => point.time))}
                      interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(time) =>
                  new Date(time).toLocaleDateString(language, {
                    month: "2-digit",
                    day: "2-digit",
                    ...(timing?.granularity !== "trading_day"
                      ? { hour: "2-digit" as const, minute: "2-digit" as const }
                      : {}),
                    timeZone: "UTC",
                  })
                }
              />
              <YAxis
                width={62}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={formatPercentTick}
              />
              <Tooltip
                labelFormatter={(time) =>
                  timing?.granularity === "trading_day"
                    ? new Date(Number(time)).toLocaleDateString(language, {
                        timeZone: "UTC",
                      })
                    : `${new Date(Number(time)).toLocaleString(language, { timeZone: "UTC" })} UTC`
                }
                formatter={(n) => `${Number(n).toFixed(3)}%`}
                contentStyle={{
                  background: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  maxWidth: 220,
                }}
              />
              <ReferenceLine
                y={0}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
              />
              <Line
                dataKey="value"
                name={t(
                  metric === "drawdown"
                    ? "回撤曲线"
                    : portfolio.mode === "paper"
                      ? "模拟收益"
                      : "回测收益",
                )}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={data.filter(row => row.value != null).length === 1 || data.some(row => row.value == null)}
                connectNulls={false}
                isAnimationActive={false}
              />
              {metric === "return" &&
                data.some((row) => row.benchmark != null) && (
                  <Line
                    dataKey="benchmark"
                    name={t(portfolio.config.benchmarkName || "基准")}
                    stroke="#b18de0"
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-16 text-center text-secondary-text">
          {t("尚无有效估值记录。")}
        </p>
      )}
      <p className="mt-3 text-xs leading-5 text-secondary-text">
        {t(
          external
            ? "按来源实际记录时间展示，筛选区间不重设收益起点；缺失指标不补零。"
            : "按实际记录时间展示；筛选区间不重设收益起点。最大回撤使用完整账本高点，缺失指标不补零。",
        )}
      </p>
      {external && evidence?.performanceBasis === 'unit_nav' && <p className="mt-2 text-xs text-secondary-text">{t('来源收益使用单位净值，不按账户金额或外部资金流重新计算。')}</p>}
      {external && evidence?.metricsScope === 'account_lifetime' && evidence.curveScope === 'selected_run' && <p className="mt-2 text-xs text-secondary-text">{t('指标覆盖账户累计历史；曲线仅覆盖当前运行批次。')}</p>}
      {external && evidence?.metricsScope === 'full_backtest' && evidence.curveScope === 'full_backtest' && <p className="mt-2 text-xs text-secondary-text">{t('指标与曲线覆盖来源完整回测，下采样仅影响展示。')}</p>}
      {timing?.valuation === "live_quote" && (
        <p className="mt-2 text-xs text-secondary-text">
          {t("实时报价记录不是等间隔收益样本，不在此推算年化收益或夏普。")}
        </p>
      )}
    </section>
  );
}
