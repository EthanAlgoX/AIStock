import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { workspaceApi, type WorkspaceRun } from "../../api/workspace";
import DefaultTaskLauncher from "./DefaultTaskLauncher";
import { workspaceRunLabel } from "../../utils/workspaceOutcome";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { RESEARCH_MARKETS, type ResearchMarket } from "../../utils/markets";
import { useStockIndex } from "../../hooks/useStockIndex";
import { areStockCodesEquivalent, normalizeStockCode, suffixMarket } from "../../utils/stockCode";
import { poolCode } from "../../utils/strategyStockPool";

export default function StockArchive({ onRunStarted }: { onRunStarted:(run:WorkspaceRun)=>void }) {
  const { localize: l, translate: tx } = useUiLanguage();
  const [params, setParams] = useSearchParams();
  const stock = normalizeStockCode(params.get("stock") || "").toUpperCase();
  const requestedMarket = RESEARCH_MARKETS.find(item => item.id === params.get("market")?.toUpperCase())?.id;
  const contextKey = JSON.stringify([stock, requestedMarket]);
  const [inputDraft, setInputDraft] = useState<{ key: string; value: string }>();
  const input = inputDraft?.key === contextKey ? inputDraft.value : stock;
  const [marketChoice, setMarketChoice] = useState<{ key: string; value: ResearchMarket }>();
  const stockIndex = useStockIndex(Boolean(stock));
  // Match canonical identities only. For example, bare 006208 remains CN;
  // the Taiwanese listing requires its .TW suffix, even if display codes match.
  const directoryMarkets = [...new Set(stockIndex.index.filter(item => areStockCodesEquivalent(item.canonicalCode, stock))
    .map(item => item.market === "BSE" ? "CN" : item.market)
    .filter((value): value is ResearchMarket => RESEARCH_MARKETS.some(item => item.id === value)))];
  const formatMarket = suffixMarket(stock) || poolCode(stock)?.market;
  const inferredMarket = directoryMarkets.length === 1 ? directoryMarkets[0] : formatMarket || "CN";
  const market = marketChoice?.key === contextKey ? marketChoice.value : requestedMarket || inferredMarket;
  const identifyingMarket = stockIndex.loading && !formatMarket && !requestedMarket && marketChoice?.key !== contextKey;
  const [result, setResult] = useState<{ stock: string; page?: {items:WorkspaceRun[];total:number}; error?: string }>();
  const page = result?.stock === stock ? result.page : undefined;
  const error = result?.stock === stock ? result.error : undefined;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    if (!stock) return;
    void workspaceApi.runHistory({stock,limit:10}).then(value => {if(live) setResult({stock, page:value});}).catch(() => {if(live) setResult({stock, error:"股票档案读取失败，请重新查询。"});});
    return () => {live=false;};
  }, [stock, refresh]);
  return <details open={Boolean(stock)} className="rounded-xl border border-border bg-card p-4">
    <summary className="cursor-pointer font-medium">{l("股票档案 · 研究、候选深研与专家讨论", "Stock archive · Research, candidate analysis and expert discussions")}</summary>
    <p className="mt-3 text-sm text-secondary-text">{l("按明确的股票代码关联原报告，不重复生成内容。历史讨论若未指定代码，不会根据文字猜测归属。", "Reports are linked by explicit stock codes without regenerating content. Discussions without a stock code are not assigned by guessing from their text.")}</p>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {event.preventDefault();if (!input.trim()) return;setResult(undefined);setRefresh(value=>value+1);const next=new URLSearchParams(params);next.set("stock",normalizeStockCode(input).toUpperCase());if (!areStockCodesEquivalent(input, stock)) next.delete("market");setParams(next);}}>
      <label className="text-sm">{l("股票代码", "Stock code")}<input required className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 block" value={input} onChange={e=>setInputDraft({ key: contextKey, value: e.target.value })} placeholder="600519 / HK00700 / AAPL" /></label>
      <button className="btn-secondary" type="submit">{l("查询档案", "Search archive")}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{l(error, "Failed to load the stock archive. Please search again.")}</p>}
    {stock && <div className="mt-4 space-y-3">
      <p className="text-sm">{stock} · {page ? l(`共 ${page.total} 次相关运行`, `${page.total} related runs`) : error ? l("读取失败", "Load failed") : l("正在读取…", "Loading…")}</p>
      {page?.items.map(run=><Link className="block text-sm text-primary hover:underline" key={run.id} to={`/runs/${run.id}`}>{run.taskSnapshot.name} · {new Date(run.createdAt).toLocaleDateString()} · {tx(workspaceRunLabel(run))}</Link>)}
      <Link className="inline-block text-sm text-primary hover:underline" to={`/runs?stock=${encodeURIComponent(stock)}`}>{l("查看全部关联记录与筛选", "View all related records and filters")}</Link>
      <label className="block text-sm">{l("新研究市场", "Market for new research")}<select value={market} onChange={e=>setMarketChoice({ key: contextKey, value: e.target.value as ResearchMarket })} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm mt-2 sm:ml-2 sm:mt-0 sm:w-auto">{RESEARCH_MARKETS.map(item => <option key={item.id} value={item.id}>{tx(item.label)}</option>)}</select></label>
      {identifyingMarket ? <p role="status" className="text-sm text-secondary-text">{tx("正在识别研究市场…")}</p> : <DefaultTaskLauncher kind="research" stock={stock} market={market} presentation="disclosure" onRunStarted={onRunStarted} />}
    </div>}
  </details>;
}
