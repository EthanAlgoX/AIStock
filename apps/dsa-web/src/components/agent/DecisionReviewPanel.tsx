import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useEffect, useState } from "react";
import { decisionSignalsApi } from "../../api/decisionSignals";
import type { DecisionProfile, DecisionSignalItem, DecisionSignalOutcomeItem } from "../../types/decisionSignals";
import { DecisionSignalDetails } from "../decision-signals/DecisionSignalDisplay";

/** Existing report-derived signals, not invented executions of workspace proposals. */
export default function DecisionReviewPanel() {
  const { translate: tx } = useUiLanguage();
  const [items, setItems] = useState<DecisionSignalItem[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [outcomes, setOutcomes] = useState<DecisionSignalOutcomeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [profile, setProfile] = useState<DecisionProfile>("balanced");
  const [notice, setNotice] = useState("");
  const selected = items.find((item) => item.id === selectedId);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    decisionSignalsApi.list({ pageSize: 20 }).then((data) => {
      if (current) { setItems(data.items); setSelectedId((id) => data.items.some((item) => item.id === id) ? id : data.items[0]?.id); }
    }).catch(() => { if (current) setError("信号读取失败，请重试。"); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    let current = true;
    setOutcomes([]);
    setError("");
    setOutcomesLoading(Boolean(selectedId));
    if (selectedId) decisionSignalsApi.getSignalOutcomes(selectedId).then((data) => {
      if (current) setOutcomes(data.items);
    }).catch(() => { if (current) setError("后验评估读取失败，可刷新重试；不代表没有评估记录。"); }).finally(() => { if (current) setOutcomesLoading(false); });
    return () => { current = false; };
  }, [selectedId, revision]);
  const evaluate = async () => {
    if (!selected || busy || outcomesLoading) return;
    setBusy(true); setError("");
    try {
      const result = await decisionSignalsApi.runOutcomes({ signalId: selected.id, horizons: ["1d", "3d", "5d", "10d"] });
      setOutcomes(result.items);
      setNotice("后验评估已更新。窗口不足会标记无法评估；结果不是账户收益或真实成交。");
    } catch { setError("后验评估失败，请检查历史行情覆盖后重试。"); }
    finally { setBusy(false); }
  };
  const reassess = async () => {
    if (!selected?.sourceReportId || busy) return;
    setBusy(true); setError("");
    try {
      const result = await decisionSignalsApi.reassess({ sourceReportId: selected.sourceReportId, decisionProfile: profile, persist: true });
      setNotice(result.blockedReason ? `评估受阻：${result.blockedReason}` : "已保存基于原报告快照的风险偏好评估，不是账户风控审批，也没有创建订单。");
      if (result.item) { setItems((rows) => [result.item!, ...rows.filter((row) => row.id !== result.item!.id)]); setSelectedId(result.item.id); }
    } catch { setError("风险偏好评估未完成，报告可能缺少必要快照或触发策略护栏；未获下单许可。"); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 border-t border-border py-5" aria-label={tx("交易信号跟踪与复盘")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{tx("交易信号跟踪与复盘")}</h2><button type="button" className="btn-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>{tx("刷新信号")}</button></div>
    <p className="max-w-prose text-sm leading-6 text-secondary-text">{tx("最近 20 条报告衍生信号，与模拟提案分开保存。可查看来源、有效期、风险与后续表现；信号状态不代表已通过账户风控。")}</p>
    {loading && <p role="status">{tx("正在读取信号…")}</p>}
    {error && <p role="alert" className="text-sm text-warning">{tx(error)}</p>}
    {notice && <p role="status" className="text-sm">{tx(notice)}</p>}
    {!loading && !error && !items.length && <p className="text-sm text-secondary-text">{tx("暂无研究信号。完成包含有效决策信息的单股报告后，再来查看；自由文本提案不会自动变成已验证信号。")}</p>}
    {items.length > 0 && <label className="block text-sm">{tx("选择研究信号")}<select disabled={busy} value={selectedId || ""} onChange={(event) => setSelectedId(Number(event.target.value))} className="mt-2 block h-10 w-full rounded-lg border border-border bg-background px-3">{items.map((item) => <option key={item.id} value={item.id}>{item.stockName || item.stockCode} · {item.createdAt} · #{item.id}</option>)}</select></label>}
    {selected && <><DecisionSignalDetails item={selected} outcomes={outcomes} /><div className="flex flex-wrap items-end gap-3"><label className="text-sm">{tx("风险偏好")}<select disabled={busy} value={profile} onChange={(event) => setProfile(event.target.value as DecisionProfile)} className="mt-2 block h-10 rounded-lg border border-border bg-background px-3"><option value="conservative">{tx("保守")}</option><option value="balanced">{tx("均衡")}</option><option value="aggressive">{tx("激进")}</option></select></label><button type="button" className="btn-secondary" disabled={busy || !selected.sourceReportId} onClick={() => void reassess()}>{tx("保存风险偏好评估")}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => void evaluate()}>{tx("更新后验评估")}</button></div></>}
  </section>;
}
