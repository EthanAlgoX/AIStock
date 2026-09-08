import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioApi } from '../api/portfolio';
import type { PortfolioTradeListItem } from '../types/portfolio';
import { AppPage, PageHeader } from '../components/common';
import HoldingEntryForm from '../components/portfolio/HoldingEntryForm';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { getParsedApiError } from '../api/error';

export default function HoldingsLedgerPage() {
  const { localize: l } = useUiLanguage();
  const [items, setItems] = useState<PortfolioTradeListItem[]>([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let mounted = true; portfolioApi.listTrades({ page, pageSize: 20 }).then(r => { if (mounted) { setItems(r.items); setTotal(r.total); setError(''); } }).catch(e => { if (mounted) setError(getParsedApiError(e).message); }); return () => { mounted = false; }; }, [page, revision]);
  return <AppPage><PageHeader title={l('持仓账本', 'Holdings ledger')} description={l('记录实际发生的买卖。卖出后，持仓数量与成本会重新计算。', 'Record actual buys and sells. Remaining quantities and costs are recalculated from the ledger.')} actions={<Link to="/portfolio" className="btn-secondary">{l('返回持仓简报', 'Back to holding briefs')}</Link>} />
    <HoldingEntryForm onSaved={() => setRevision(revision + 1)} />
    <h2 className="my-5 text-lg font-semibold">{l('交易记录', 'Transactions')}</h2>{error && <p role="alert">{error}<button className="ml-2 text-primary underline" onClick={() => setRevision(revision + 1)}>{l('重试', 'Retry')}</button></p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border">{[l('日期', 'Date'), l('账户', 'Account'), l('股票', 'Stock'), l('方向', 'Side'), l('股数', 'Shares'), l('价格', 'Price')].map(h => <th className="whitespace-nowrap p-3 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{items.map(row => <tr key={row.id} className="border-b border-border/60"><td className="whitespace-nowrap p-3">{row.tradeDate}</td><td className="p-3">#{row.accountId}</td><td className="p-3">{row.symbol}</td><td className="p-3">{row.side === 'buy' ? l('买入', 'Buy') : l('卖出', 'Sell')}</td><td className="p-3 tabular-nums">{row.quantity}</td><td className="whitespace-nowrap p-3 tabular-nums">{row.price} {row.currency}</td></tr>)}</tbody></table></div>
    {!items.length && !error && <p className="py-6 text-secondary-text">{l('暂无交易记录', 'No transactions yet')}</p>}
    <div className="mt-5 flex items-center gap-4"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{l('上一页', 'Previous')}</button><span className="text-sm">{page} / {Math.max(1, Math.ceil(total / 20))}</span><button className="btn-secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>{l('下一页', 'Next')}</button></div>
  </AppPage>;
}
