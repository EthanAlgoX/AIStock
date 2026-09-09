import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { workspaceApi, type WorkspaceRun } from "../../api/workspace";
import DefaultTaskLauncher from "./DefaultTaskLauncher";
import { workspaceRunLabel } from "../../utils/workspaceOutcome";

export default function StockArchive({ onRunStarted }: { onRunStarted:(run:WorkspaceRun)=>void }) {
  const [params, setParams] = useSearchParams();
  const stock = params.get("stock") || "";
  const [input, setInput] = useState(stock);
  const [market, setMarket] = useState("CN");
  const [page, setPage] = useState<{items:WorkspaceRun[];total:number}>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (!stock) return;
    void workspaceApi.runHistory({stock,limit:10}).then(value => {if(live) {setPage(value);setError("");}}).catch(() => {if(live) setError("股票档案读取失败，请重新查询。");});
    return () => {live=false;};
  }, [stock]);
  return <details open={Boolean(stock)} className="rounded-xl border border-border bg-card p-4">
    <summary className="cursor-pointer font-medium">股票档案 · 研究、候选深研与专家讨论</summary>
    <p className="mt-3 text-sm text-secondary-text">按明确的股票代码关联原报告，不重复生成内容。历史讨论若未指定代码，不会根据文字猜测归属。</p>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {event.preventDefault();setPage(undefined);const next=new URLSearchParams(params);next.set("stock",input.trim().toUpperCase());setParams(next);}}>
      <label className="text-sm">股票代码<input required className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm mt-1 block" value={input} onChange={e=>setInput(e.target.value)} placeholder="600519 / HK00700 / AAPL" /></label>
      <button className="btn-secondary" type="submit">查询档案</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {stock && <div className="mt-4 space-y-3">
      <p className="text-sm">{stock} · {page ? `共 ${page.total} 次相关运行` : "正在读取…"}</p>
      {page?.items.map(run=><Link className="block text-sm text-primary hover:underline" key={run.id} to={`/runs/${run.id}`}>{run.taskSnapshot.name} · {new Date(run.createdAt).toLocaleDateString()} · {workspaceRunLabel(run)}</Link>)}
      <Link className="inline-block text-sm text-primary hover:underline" to={`/runs?stock=${encodeURIComponent(stock)}`}>查看全部关联记录与筛选</Link>
      <label className="block text-sm">新研究市场<select value={market} onChange={e=>setMarket(e.target.value)} className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm ml-2"><option value="CN">A 股</option><option value="HK">港股</option><option value="US">美股</option></select></label>
      <DefaultTaskLauncher kind="research" stock={stock} market={market} onRunStarted={onRunStarted} />
    </div>}
  </details>;
}
