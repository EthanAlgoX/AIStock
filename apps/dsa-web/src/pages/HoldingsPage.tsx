import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, Settings2, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { AppPage, PageHeader } from '../components/common';
import { portfolioResearchApi, type HoldingItem, type HoldingsDashboard } from '../api/portfolioResearch';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import HoldingPlanEditor from '../components/portfolio/HoldingPlanEditor';
import HoldingEntryForm from '../components/portfolio/HoldingEntryForm';
import PriceAlertPanel from '../components/portfolio/PriceAlertPanel';
import { getParsedApiError } from '../api/error';

const active = (item: HoldingItem) => ['queued', 'running'].includes(item.run?.status || '');
const keyOf = (item: HoldingItem) => `${item.accountId}:${item.position.symbol}`;
const number = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

function HoldingNumbers({ item }: { item: HoldingItem }) {
  const { localize: l } = useUiLanguage();
  const p = item.position;
  return <><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-secondary-text">{l('平均成本', 'Average cost')}</dt><dd className="mt-1 tabular-nums">{number(p.avg_cost)}</dd></div><div><dt className="text-xs text-secondary-text">{l('参考价', 'Reference price')}</dt><dd className="mt-1 tabular-nums">{p.price_available ? number(p.last_price) : '—'}</dd></div></dl>
    <p className="mt-3 text-sm">{l('浮动收益', 'Unrealized return')} <strong className="ml-2 tabular-nums">{p.price_available ? number(p.unrealized_pnl_pct) : '—'}{p.price_available && p.unrealized_pnl_pct != null ? '%' : ''}</strong></p>
    <p className="mt-2 text-xs text-secondary-text">{p.price_date || l('无行情日期', 'No price date')}{p.price_stale ? l(' · 历史价格', ' · stale price') : ''}</p></>;
}

/** THESIS: holdings lead to short, evidence-linked decisions, not another report wall.
 * OWN-WORLD: existing neutral/cobalt desk, divided rows and semantic risk labels.
 * STORY: scan exposure and freshness, review exceptions, run or schedule research.
 * FIRST VIEWPORT: title/actions, compact status strip, full-width holding briefs.
 * FORM: user-specified concise ledger; settings expand inline, no new visual identity.
 */
export default function HoldingsPage() {
  const { localize: l } = useUiLanguage();
  const [data, setData] = useState<HoldingsDashboard>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState('');
  const [alertEditing, setAlertEditing] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const id = ++requestId.current;
    try {
      const next = await portfolioResearchApi.dashboard(refresh);
      if (id === requestId.current) { setData(next); setError(''); }
    } catch (err) { if (id === requestId.current) setError(getParsedApiError(err).message); }
  }, []);
  useEffect(() => { const counter = requestId; void load(); return () => { counter.current++; }; }, [load]);
  const hasActive = data?.items.some(active);
  useEffect(() => {
    if (busy) return;
    const timer = setTimeout(() => void load(), hasActive ? 5000 : 30000);
    return () => clearTimeout(timer);
  }, [data, hasActive, busy, load]);
  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key); setError(''); setNotice('');
    try { await action(); await load(); }
    catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(''); }
  };
  const runAll = async () => {
    const targets = (data?.items || []).filter(item => item.supported && !active(item));
    const failures: string[] = [];
    for (const item of targets) {
      try { await portfolioResearchApi.run(item.accountId, item.position.symbol); }
      catch { failures.push(item.position.symbol); }
    }
    if (failures.length) setNotice(l(`部分持仓未能提交：${failures.join('、')}。请逐只重试查看原因。`, `Some holdings could not be submitted: ${failures.join(', ')}. Retry individually for details.`));
  };
  const labels: Record<string, string> = {
    price_unverified: l('行情待更新 · 暂不判断', 'Price unverified · no action'),
    loss_review: l('成本亏损触线 · 复核减仓条件', 'Loss threshold · review reduction'),
    profit_review: l('盈利触线 · 复核止盈条件', 'Profit threshold · review profit-taking'),
    sharp_rise: l('大幅上涨 · 检查追高风险', 'Sharp rise · check overextension'),
    sharp_fall: l('大幅下跌 · 优先复核风险', 'Sharp fall · prioritize risk review'),
  };
  const states: Record<string, string> = { queued: l('排队中', 'Queued'), running: l('研究中', 'Researching'), completed: l('研究完成', 'Complete'), failed: l('研究失败', 'Failed'), cancelled: l('已取消', 'Cancelled') };
  const items = (data?.items || []).filter(item => (filter === 'all' || (filter === 'risk' ? item.alerts.some(a => a !== 'price_unverified') : item.position.market === filter)) && `${item.position.symbol} ${item.brief?.name || ''} ${item.accountName}`.toLowerCase().includes(query.toLowerCase()));

  return <AppPage data-design-contract="operate: holdings brief ledger; neutral/cobalt; evidence before configuration">
    <PageHeader title={l('持仓管理', 'Portfolio')} description={l('把研究放回你的持仓中。先看风险与今日简报，需要时再展开完整研究。', 'Research in the context of what you own. Scan risks and daily briefs, then open the full evidence when needed.')}
      actions={<><button className="btn-secondary" onClick={() => setEntryOpen(!entryOpen)} aria-expanded={entryOpen}><Plus size={16} aria-hidden />{l('录入持仓', 'Add holding')}</button><button className="btn-primary" disabled={!!busy || !data?.items.some(i => i.supported && !active(i))} onClick={() => void act('all', runAll)}>{busy === 'all' ? l('正在提交…', 'Submitting…') : l('研究全部持仓', 'Research all holdings')}</button></>} />
    <div className="my-4 flex flex-wrap items-center justify-between gap-3 text-xs text-secondary-text">
      <p>{l('研究调用真实模型，可能产生费用。建议仅供人工复核，不会自动下单。', 'Research uses real models and may incur costs. Suggestions require human review; no orders are placed.')}</p>
      <Link className="text-primary hover:underline" to="/portfolio/ledger">{l('账户与交易流水', 'Accounts & transactions')} <ArrowUpRight className="inline h-3 w-3" aria-hidden /></Link>
    </div>
    <Link to="/alerts" className="inline-block min-h-11 py-2 text-sm text-primary">{l('告警中心 · 配置上下限与通知渠道', 'Alert center · thresholds & delivery channels')}</Link>
    {entryOpen && <HoldingEntryForm onSaved={() => { setEntryOpen(false); setNotice(l('持仓已更新。要接收价格提醒吗？点击对应股票的“设置价格告警”，配置上下限与渠道。', 'Holding updated. Want price alerts? Open “Set price alerts” on the stock to choose thresholds and channels.')); void load(); }} />}
    {error && <div role="alert" className="my-4 rounded-lg border border-danger/30 p-4 text-sm"><p>{error}</p><button className="mt-2 text-primary underline" onClick={() => void load()}>{l('重试读取', 'Retry loading')}</button></div>}
    {notice && <p role="status" className="my-4 text-sm text-warning">{notice}</p>}
    <section aria-label={l('持仓概览', 'Portfolio overview')} className="my-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-border py-4 text-sm">
      <p><strong className="mr-2 text-lg tabular-nums">{data?.items.length ?? '—'}</strong>{l('笔持仓', 'holdings')}</p>
      <p><strong className="mr-2 text-lg tabular-nums">{data?.items.filter(i => i.alerts.some(a => a !== 'price_unverified')).length ?? '—'}</strong>{l('项风险复核', 'risk reviews')}</p>
      <p><strong className="mr-2 text-lg tabular-nums">{data?.items.filter(i => i.schedule?.enabled).length ?? '—'}</strong>{l('项每日跟踪', 'daily plans')}</p>
      <button className="ml-auto flex min-h-11 items-center gap-2 text-primary disabled:opacity-50" disabled={!!busy} onClick={() => { setBusy('refresh'); void load(true).finally(() => setBusy('')); }}><RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />{l('刷新行情', 'Refresh prices')}</button>
    </section>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h2 className="mr-auto text-lg font-semibold">{l('持仓简报', 'Holding briefs')}</h2>
      <label className="sr-only" htmlFor="holding-search">{l('搜索持仓', 'Search holdings')}</label><input id="holding-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={l('股票或账户', 'Stock or account')} className="h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-sm" />
      <select aria-label={l('筛选持仓', 'Filter holdings')} value={filter} onChange={e => setFilter(e.target.value)} className="h-11 rounded-lg border border-border bg-background px-3 text-sm"><option value="all">{l('全部市场', 'All markets')}</option><option value="risk">{l('需要复核', 'Needs review')}</option><option value="cn">{l('A 股', 'China A')}</option><option value="hk">{l('港股', 'Hong Kong')}</option><option value="us">{l('美股', 'US')}</option></select>
    </div>
    {!data && !error && <p role="status" className="py-12 text-secondary-text">{l('正在读取持仓…', 'Loading holdings…')}</p>}
    {data && !items.length && <div className="border-y border-border py-14"><h3 className="text-lg font-medium">{data.items.length ? l('没有匹配的持仓', 'No matching holdings') : l('从你已经持有的股票开始', 'Start with what you own')}</h3><p className="mt-3 max-w-[65ch] text-sm leading-7 text-secondary-text">{l('录入股票、数量和成本后，这里会显示成本风险，并可以生成每日短简报。默认使用综合研究，不要求选择 Skill 或专家。', 'Add a stock, quantity and cost to review cost-related risks and generate short daily briefs. Balanced research works without selecting Skills or experts.')}</p><button className="btn-secondary mt-5" onClick={() => setEntryOpen(true)}>{l('录入第一笔持仓', 'Add a holding')}</button></div>}
    <div className="divide-y divide-border border-t border-border">
      {items.map(item => {
        const p = item.position, key = keyOf(item);
        return <article key={key} className="py-4 lg:py-6" aria-label={`${item.brief?.name || p.symbol} ${item.accountName}`}>
          <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_190px]">
            <div><h3 className="break-words text-lg font-semibold">{item.brief?.name || p.symbol}</h3><p className="mt-1 text-xs text-secondary-text">{p.symbol} · {p.market.toUpperCase()} · {p.currency}</p><p className="mt-2 text-xs text-secondary-text">{item.accountName} · {number(p.quantity)} {l('股', 'shares')}</p>
              <div className="hidden lg:block"><HoldingNumbers item={item} /></div>
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap gap-2">{item.alerts.map(alert => <span key={alert} className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 px-2 py-1 text-xs text-warning"><ShieldAlert size={13} aria-hidden />{labels[alert] || alert}</span>)}{!item.alerts.length && <span className="text-xs text-secondary-text">{l('未触发价格阈值 · 不代表无风险', 'No price threshold triggered · not risk-free')}</span>}</div>
              {item.brief ? <><p className="text-sm font-medium">{!item.run?.currentSession ? l('历史观点 · 需更新后再判断', 'Historical view · update before acting') : !p.price_available || p.price_stale ? l('行情待核实 · 以下观点仅供复核', 'Price unverified · review-only commentary') : l('模型观点', 'Model view')}{(item.brief.advice || item.brief.action) ? ` · ${item.brief.advice || item.brief.action}` : ''}</p><p className="mt-2 whitespace-pre-line break-words text-sm leading-7 text-secondary-text">{item.brief.summary || l('未提供摘要，请查看完整研究。', 'No summary provided. Open the full research.')}</p><p className="mt-3 text-xs text-secondary-text">{l('报告生成于', 'Generated')} {item.run?.createdAt ? new Date(item.run.createdAt).toLocaleString() : '—'} · {item.run?.currentSession ? l('最近交易时段运行，数据时点见完整报告', 'Latest-session run; see report for evidence dates') : l('历史研究，需更新后再判断', 'Historical research; refresh before acting')}</p></> : <p className="text-sm leading-7 text-secondary-text">{active(item) ? l('正在后台获取数据并研究。你可以切换页面，完成后回来查看。', 'Fetching evidence and researching in the background. You can leave this page and return later.') : l('尚无持仓研究。运行后将展示简短结论、趋势和风险；完整证据保存在个股研究中。', 'No holding research yet. Run a review for a short conclusion, trend and risks; full evidence remains in stock research.')}</p>}
              {item.run?.error && <p role="alert" className="mt-3 break-words text-sm text-danger">{item.run.error}</p>}
              {!item.supported && <p className="mt-3 text-sm text-warning">{l('该市场支持记账，暂不支持自动研究。', 'Bookkeeping is available; automated research is not supported for this market.')}</p>}
              <details className="mt-3 lg:hidden"><summary className="cursor-pointer py-2 text-sm text-secondary-text">{l('持仓成本与价格明细', 'Holding cost & price details')}</summary><HoldingNumbers item={item} /></details>
            </div>
            <div className="flex flex-wrap items-start gap-2 lg:flex-col">
              <button className="btn-secondary w-full" disabled={!!busy || active(item) || !item.supported} onClick={() => void act(key, () => portfolioResearchApi.run(item.accountId, p.symbol))}>{active(item) ? states[item.run!.status] : l('研究这只持仓', 'Research holding')}</button>
              <button className="flex min-h-11 items-center gap-2 text-sm text-primary" aria-expanded={alertEditing === key} onClick={() => setAlertEditing(alertEditing === key ? '' : key)}><ShieldAlert size={15} aria-hidden />{l('设置价格告警', 'Set price alerts')}</button>
              <button className="flex min-h-11 items-center gap-2 text-sm text-secondary-text hover:text-primary" disabled={!item.supported} aria-expanded={editing === key} onClick={() => setEditing(editing === key ? '' : key)}><Settings2 size={15} aria-hidden />{l('每日跟踪与策略', 'Daily plan & strategy')}</button>
              {item.run && <Link className="inline-flex min-h-11 items-center gap-1 text-sm text-primary" to={`/stock-research?run=${item.run.id}`}>{l('完整研究与进度', 'Full research & progress')}<ArrowUpRight size={14} aria-hidden /></Link>}
              <p className="text-xs leading-5 text-secondary-text">{item.schedule?.enabled ? `${l('每日', 'Daily')} ${item.schedule.runAt} · ${item.schedule.timezone}` : l('自动跟踪未开启', 'Daily tracking is off')}</p>
            </div>
          </div>
          {editing === key && <HoldingPlanEditor item={item} onSaved={() => { setEditing(''); void load(); }} />}
          {alertEditing === key && <PriceAlertPanel key={key} symbol={p.symbol} accountId={item.accountId} cost={p.avg_cost ?? undefined} currency={p.currency} />}
        </article>;
      })}
    </div>
  </AppPage>;
}
