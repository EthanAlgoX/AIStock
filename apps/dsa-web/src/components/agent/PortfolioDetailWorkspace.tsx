import { useState } from "react";
import { Link } from "react-router-dom";
import type { Portfolio } from "../../api/portfolios";
import { useUiLiteral } from "../../hooks/useUiLiteral";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import {
  recordTime,
  portfolioTiming,
  signalLabel,
  valuationLabel,
} from "../../utils/portfolioTiming";
import { PortfolioExecutionLedger } from "./PortfolioExecutionLedger";
import { PortfolioPerformance } from "./PortfolioPerformance";
import { PortfolioResearchPanel } from "./PortfolioResearchPanel";
import { SourceEvolutionPanel } from "./SourceEvolutionPanel";
import { PortfolioRunExplanation } from "./PortfolioRunExplanation";

const panels = [
  ["performance", "表现"],
  ["executions", "成交与持仓"],
  ["decisions", "决策记录"],
  ["research", "回测与进化"],
  ["evidence", "口径与证据"],
] as const;
type Props = {
  compact?: boolean;
  portfolio: Portfolio;
  panel: string | null;
  onPanel: (panel: string) => void;
  onAdopt: (id: number) => void;
  onSelect: (id: number) => void;
  onBacktest?: () => void;
};
const objectRows = (value: unknown[]) =>
  value.filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === "object",
  );
export function PortfolioDetailWorkspace({
  compact = false,
  portfolio: p,
  panel,
  onPanel,
  onAdopt,
  onSelect,
  onBacktest,
}: Props) {
  const t = useUiLiteral();
  const { language } = useUiLanguage();
  const [date, setDate] = useState("");
  const active = panels.some(([key]) => key === panel) ? panel : "performance";
  const timing = portfolioTiming(p);
  const external = Boolean(p.config.externalRuntime);
  const latest = p.days?.at(-1);
  const selected = p.days?.find((day) => day.date === date) ?? latest;
  const fmt = (value: number | null | undefined, percent = false) =>
    value == null
      ? "—"
      : `${(value * (percent ? 100 : 1)).toLocaleString(language, { maximumFractionDigits: percent ? 2 : 8 })}${percent ? "%" : ""}`;
  const snapshotKnown = !external || p.externalEvidence?.positions != null;
  const decisions = objectRows(p.externalEvidence?.decisions ?? []);
  const roundTrips = objectRows(p.externalEvidence?.trades ?? []);
  const rejects = (p.days ?? []).flatMap((day) =>
    day.trades
      .filter((row) => row.status !== "filled")
      .map((row) => ({ ...row, date: day.date })),
  );
  return (
    <div>
      {!compact || active === "evidence" ? (
        <>
          <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 text-sm lg:grid-cols-4">
            <div>
              <dt className="text-secondary-text">{t("决策节奏")}</dt>
              <dd className="mt-1 font-medium">
                {t(signalLabel(timing?.signalTimeframe))}
                {timing?.signalTimeframe &&
                !["1d", "1h", "tick"].includes(timing.signalTimeframe)
                  ? ` · ${timing.signalTimeframe}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-text">{t("估值方式")}</dt>
              <dd className="mt-1 font-medium">
                {t(valuationLabel(timing?.valuation))}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-text">{t("成交规则")}</dt>
              <dd className="mt-1">
                {t(
                  timing?.execution === "quote_simulation"
                    ? "按观测报价模拟成交"
                    : timing?.execution === "next_open"
                      ? "下一根 K 线开盘成交"
                      : "成交规则待确认",
                )}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-text">{t("最新估值")}</dt>
              <dd className="mt-1 break-words tabular-nums">
                {recordTime(p.lastDate)}
              </dd>
            </div>
          </dl>
          <p className="my-3 max-w-4xl text-sm leading-6 text-secondary-text">
            {t(
              timing?.valuation === "live_quote"
                ? "决策按信号周期触发，期间用实时报价更新持仓价值；每次估值不等于一次决策或成交。"
                : timing?.signalTimeframe === "1d"
                  ? "按交易日组织记录：收盘形成决策，后续交易日开盘模拟成交，成交在该日记账后显示。"
                  : timing
                    ? "按已收盘 K 线组织记录；决策、成交与估值分别保留原始时间。"
                    : "来源尚未提供完整周期合同，保留原始时间，不按日线解释。",
            )}
          </p>
        </>
      ) : (
        <p className="mb-3 text-xs text-secondary-text">
          {t(valuationLabel(timing?.valuation))} · {recordTime(p.lastDate)}
        </p>
      )}
      <nav
        role="tablist"
        aria-label={t("策略详情栏目")}
        className="flex gap-1 overflow-x-auto border-b border-border"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const index = buttons.indexOf(e.target as HTMLButtonElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                  buttons.length;
          e.preventDefault();
          buttons[next].focus();
          buttons[next].click();
        }}
      >
        {panels.map(([key, label]) => (
          <button
            type="button"
            role="tab"
            id={`portfolio-tab-${key}`}
            aria-controls="portfolio-panel"
            aria-selected={active === key}
            tabIndex={active === key ? 0 : -1}
            key={key}
            onClick={() => onPanel(key)}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm ${active === key ? "border-primary font-semibold text-primary" : "border-transparent text-secondary-text"}`}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      <div
        id="portfolio-panel"
        role="tabpanel"
        aria-labelledby={`portfolio-tab-${active}`}
      >
        {active === "performance" && <PortfolioPerformance portfolio={p} />}
        {active === "executions" && (
          <div className="py-5">
            <h3 className="font-semibold">
              {t(p.mode === "paper" ? "当前持仓" : "期末持仓")}
            </h3>
            <p className="mt-2 text-xs text-secondary-text">
              {recordTime(latest?.date)} · {p.currency}{" "}
              {external && t("仅显示来源提供的当前快照，不重建缺失历史持仓。")}
            </p>
            {!!latest?.holdings.length && (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "标的",
                        "数量",
                        "含费用成本",
                        "估值价格",
                        "市值",
                        "浮动盈亏",
                      ].map((x) => (
                        <th className="p-2" key={x}>
                          {t(x)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {latest?.holdings.map((h) => (
                      <tr key={h.code} className="border-t border-border">
                        <td className="p-2">{h.code}</td>
                        {[
                          h.quantity,
                          h.averageCost,
                          h.price,
                          h.marketValue,
                          h.unrealizedPnl,
                        ].map((n, i) => (
                          <td className="p-2 tabular-nums" key={i}>
                            {fmt(n)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!latest?.holdings.length && (
              <p className="py-4 text-sm text-secondary-text">
                {t(
                  !latest || !snapshotKnown
                    ? "持仓快照暂未提供。"
                    : "当前空仓。",
                )}
              </p>
            )}
            {p.mode === "paper" || !external ? (
              <PortfolioExecutionLedger portfolio={p} />
            ) : (
              <SourceBacktestTrades rows={roundTrips} />
            )}
            {!!rejects.length && (
              <section className="mt-5">
                <h3 className="font-semibold">{t("未成交与拒单")}</h3>
                {rejects.map((r, i) => (
                  <p className="mt-2 text-sm" key={i}>
                    {r.date} · {r.code} · {r.reason}
                  </p>
                ))}
              </section>
            )}
          </div>
        )}
        {active === "decisions" && (
          <div className="py-5">
            <h3 className="font-semibold">
              {t(
                timing?.signalTimeframe === "1d"
                  ? "日级决策"
                  : timing?.signalTimeframe === "1h"
                    ? "小时级决策"
                    : "决策记录",
              )}
            </h3>
            {external ? (
              <>
                <p className="mt-2 text-sm text-secondary-text">
                  {t("最近决策保留来源时间与原文；HOLD 或许可指令不等于成交。")}
                </p>
                {p.externalEvidence?.lastClosedBar && (
                  <p className="mt-2 text-sm">
                    {t("最近信号 K 线")} · {p.externalEvidence.lastClosedBar}
                  </p>
                )}
                <div className="mt-4 divide-y divide-border">
                  {[...decisions].reverse().map((row, i) => (
                    <article key={i} className="py-3 text-sm">
                      <p className="font-medium">
                        {String(row.timestamp ?? "—")} ·{" "}
                        {String(row.symbol ?? "—")} ·{" "}
                        {t(
                          (
                            {
                              BUY: "买入",
                              SELL: "卖出",
                              HOLD: "不动",
                              ALLOW: "允许",
                              PAUSE: "暂停",
                            } as Record<string, string>
                          )[String(row.action)] ?? String(row.action ?? "—"),
                        )}
                      </p>
                      <p className="mt-2 text-secondary-text">
                        {String(row.reason ?? "—")}
                      </p>
                    </article>
                  ))}
                </div>
                {!decisions.length && (
                  <p className="py-5 text-secondary-text">
                    {t("尚无已保存的决策记录。")}
                  </p>
                )}
              </>
            ) : (
              <>
                <label className="mt-3 block text-sm">
                  {t("查看日期")}
                  <select
                    className="ml-2 rounded border border-border bg-background p-2"
                    value={selected?.date || ""}
                    onChange={(e) => setDate(e.target.value)}
                  >
                    {[...(p.days ?? [])].reverse().map((day) => (
                      <option key={day.date}>{day.date}</option>
                    ))}
                  </select>
                </label>
                <div className="mt-4 divide-y divide-border">
                  {selected?.opinions.map((o) => (
                    <article key={o.code} className="py-4 text-sm">
                      <p className="font-medium">
                        {o.code} ·{" "}
                        {t(
                          o.decisionBackend === "jev"
                            ? o.decision === "buy"
                              ? "买入"
                              : o.decision === "sell"
                                ? "卖出"
                                : "不动"
                            : o.stance === "bullish"
                              ? "看好"
                              : o.stance === "bearish"
                                ? "看淡"
                                : "中性",
                        )}{" "}
                        · {t("目标仓位")} {fmt(o.targetWeight, true)}
                      </p>
                      {o.decisionBackend === "jev" ? (
                        <>
                          <p className="mt-2">
                            JEV · {t("置信度")} {fmt(o.confidence, true)}
                          </p>
                          <p className="mt-2 flex flex-wrap gap-3">
                            {(["buy", "sell", "hold"] as const).map((key) => (
                              <span key={key}>
                                {t(
                                  key === "buy"
                                    ? "买入"
                                    : key === "sell"
                                      ? "卖出"
                                      : "不动",
                                )}{" "}
                                {o.probabilities?.[key] == null
                                  ? "—"
                                  : `${(o.probabilities[key] * 100).toFixed(1)}%`}
                              </span>
                            ))}
                          </p>
                          <p className="mt-2 text-secondary-text">
                            {t(
                              "仅决策结果，无模型解释。目标仓位已应用调仓比例和账户约束，实际成交请查看交易记录。",
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 text-secondary-text">{o.reason}</p>
                      )}
                    </article>
                  ))}
                </div>
                {!selected?.opinions.length && (
                  <p className="py-5 text-secondary-text">
                    {t("尚无已保存的决策记录。")}
                  </p>
                )}
                {selected?.workspaceRunId && (
                  <Link
                    className="text-sm text-primary"
                    to={`/runs/${selected.workspaceRunId}`}
                  >
                    {t("查看对应任务与运行 →")}
                  </Link>
                )}
                {selected?.universe && (
                  <details className="mt-4">
                    <summary className="cursor-pointer">
                      {t("当日范围、决策与 Token")}
                    </summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(
                        { universe: selected.universe, usage: selected.usage },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </>
            )}
            {!!p.agentCalls?.length && (
              <details className="mt-5 border-t border-border pt-4">
                <summary className="cursor-pointer">
                  {t("Agent 调用记录（含未成交和失败，最近20次）")}
                </summary>
                {p.agentCalls.map((call) => (
                  <details className="mt-3" key={call.id}>
                    <summary className="cursor-pointer text-sm">
                      {call.createdAt} · {call.model} · {call.status}
                    </summary>
                    <p className="text-sm text-danger">{call.error}</p>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {call.answer}
                    </pre>
                    <details>
                      <summary>{t("本次输入与 Prompt")}</summary>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(call.input, null, 2)}
                      </pre>
                    </details>
                  </details>
                ))}
              </details>
            )}
          </div>
        )}
        {active === "research" && (
          <div className="py-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold">{t("历史验证与参数研究")}</h3>
              <button
                className="btn-secondary"
                disabled={!onBacktest}
                onClick={onBacktest}
              >
                {t("历史回测")}
              </button>
            </div>
            <p className="my-3 text-sm text-secondary-text">
              {t(
                "研究与运行账户分开记账。候选通过检查后仍需独立模拟，不替换当前账户。",
              )}
            </p>
            {external ? (
              <SourceEvolutionPanel key={p.id} id={p.id} />
            ) : p.mode === "backtest" &&
              p.config.decisionBackend === "rules" ? (
              <PortfolioResearchPanel
                key={p.id}
                portfolio={p}
                onAdopt={onAdopt}
              />
            ) : (
              <p className="py-4 text-secondary-text">
                {t("请先在本策略下完成固定规则回测，再进入参数优化。")}
              </p>
            )}
            {!!p.comparisons?.length && (
              <div className="mt-5 space-y-2">
                <h4 className="font-medium">{t("同配置的历史与模拟验证")}</h4>
                {p.comparisons.map((row) => (
                  <button
                    className="btn-secondary block"
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                  >
                    #{row.id} ·{" "}
                    {t(row.mode === "paper" ? "实时模拟" : "历史回测")} ·{" "}
                    {row.startDate} — {row.endDate} ·{" "}
                    {fmt(row.metrics.cumulativeReturn, true)} ·{" "}
                    {t(row.comparable ? "同口径" : "样本或资金口径不同")}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {active === "evidence" && (
          <div className="space-y-5 py-5">
            {!external && <PortfolioRunExplanation portfolio={p} />}
            {p.externalEvidence && (
              <section>
                <h3 className="font-semibold">{t("来源与运行记录")}</h3>
                <p className="mt-2 text-sm text-secondary-text">
                  {t(
                    p.mode === "paper"
                      ? "已导入来源账户的前向记录，服务器独立续跑；与原站后续结果可能不同。"
                      : "来源仅提供期末持仓，较早观测点没有持仓快照，不代表当时空仓。交易计数可能按完整往返统计，原始记录见下方。",
                  )}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt>{t("来源交易笔数")}</dt>
                    <dd>{p.externalEvidence.tradeCount ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("手续费")}</dt>
                    <dd>{fmt(p.externalEvidence.fees)}</dd>
                  </div>
                </dl>
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm">
                    {t("原始持仓、交易与决策记录（保留来源语言和字段）")}
                  </summary>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(p.externalEvidence, null, 2)}
                  </pre>
                </details>
              </section>
            )}
            {p.evaluation && (
              <section>
                <h3 className="font-semibold">{t("资金与样本核对")}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  {[
                    ["评测口径", p.evaluation.protocolId],
                    ["行情样本指纹", p.evaluation.sampleHash],
                    ["手续费与交易税", p.evaluation.feesPaid],
                    ["滑点成本", p.evaluation.slippagePaid],
                    [
                      "实际成交 / 拒单",
                      `${p.evaluation.filledOrders} / ${p.evaluation.rejectedOrders}`,
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{t(String(label))}</dt>
                      <dd className="mt-1 break-all">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <details>
              <summary className="cursor-pointer font-medium">
                {t("查看完整策略配置")}
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(p.config, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBacktestTrades({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useUiLiteral();
  const roundTrips = rows.filter(
    (row) => row.entry != null || row.exit != null,
  );
  const fills = rows.filter((row) => row.entry == null && row.exit == null);
  const groups = [
    {
      rows: roundTrips,
      columns: [
        ["symbol", "标的"],
        ["entry", "入场时间"],
        ["exit", "出场时间"],
        ["qty", "数量"],
        ["pnl", "盈亏"],
      ],
    },
    {
      rows: fills,
      columns: [
        ["symbol", "标的"],
        ["timestamp", "成交时间（UTC）"],
        ["side", "方向"],
        ["qty", "数量"],
        ["price", "成交价"],
        ["fee", "手续费"],
      ],
    },
  ];
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="font-semibold">{t("来源回测交易记录")}</h3>
      <p className="mt-2 text-sm text-secondary-text">
        {t(
          "来源可能记录完整往返交易，不能当作逐笔成交；这里只显示来源提供的最近记录。",
        )}
      </p>
      {groups
        .filter((group) => group.rows.length)
        .map((group, index) => (
          <div key={index} className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {group.columns.map(([key, label]) => (
                    <th className="p-2" key={key}>
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {group.columns.map(([key]) => (
                      <td className="whitespace-nowrap p-2" key={key}>
                        {row[key] == null
                          ? "—"
                          : key === "side"
                            ? t(
                                String(row[key]).toLowerCase() === "buy"
                                  ? "买入"
                                  : String(row[key]).toLowerCase() === "sell"
                                    ? "卖出"
                                    : String(row[key]),
                              )
                            : String(row[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {!rows.length && (
        <p className="py-4 text-sm text-secondary-text">
          {t("来源未提供可展示的成交明细。")}
        </p>
      )}
    </section>
  );
}
