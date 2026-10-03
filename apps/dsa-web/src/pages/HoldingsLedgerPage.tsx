import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioApi } from '../api/portfolio';
import type { PortfolioTradeListItem } from '../types/portfolio';
import { AppPage, PageHeader } from '../components/common';
import HoldingEntryForm from '../components/portfolio/HoldingEntryForm';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { useUiLiteral } from '../hooks/useUiLiteral';
import { getParsedApiError } from '../api/error';

export default function HoldingsLedgerPage() {
  const { localize: l, t } = useUiLanguage();
  const tx = useUiLiteral();
  const [entryOpen, setEntryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const requestKey = `${page}:${revision}`;
  const [result, setResult] = useState<{ key: string; items: PortfolioTradeListItem[]; total: number; error?: string }>();
  const current = result?.key === requestKey ? result : undefined;
  const loading = !current;
  const items = current?.items || [];
  const error = current?.error || '';
  const total = current?.total ?? result?.total ?? 0;

  useEffect(() => {
    let mounted = true;
    void portfolioApi.listTrades({ page, pageSize: 20 })
      .then(data => { if (mounted) setResult({ key: requestKey, ...data }); })
      .catch(err => { if (mounted) setResult(previous => ({ key: requestKey, items: [], total: previous?.total ?? 0, error: getParsedApiError(err).message })); });
    return () => { mounted = false; };
  }, [page, requestKey]);

  return <AppPage className="space-y-6">
    <PageHeader title={l('持仓账本', 'Holdings ledger')}
      description={l('记录实际发生的买卖。卖出后，持仓数量与成本会重新计算。', 'Record actual buys and sells. Remaining quantities and costs are recalculated from the ledger.')}
      actions={<><Link to="/portfolio" className="btn-secondary">{l('返回持仓简报', 'Back to holding briefs')}</Link><button className="btn-primary" aria-expanded={entryOpen} aria-controls="transaction-entry" onClick={() => setEntryOpen(value => !value)}>{tx(entryOpen ? '收起交易录入' : '展开录入交易')}</button></>} />

    <div id="transaction-entry" hidden={!entryOpen}><HoldingEntryForm onSaved={() => { setEntryOpen(false); setRevision(value => value + 1); }} /></div>

    <section className="min-w-0 border-y border-border" aria-labelledby="transaction-ledger-title" aria-busy={loading}>
      <h2 id="transaction-ledger-title" className="py-4 text-lg font-semibold">{l('交易记录', 'Transactions')}</h2>
      {error && <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-danger">{error}<button className="btn-secondary" onClick={() => setRevision(value => value + 1)}>{t('common.retry')}</button></p>}
      {loading ? <p role="status" className="py-10 text-sm text-secondary-text">{t('common.loading')}</p> : <>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-border">{[l('日期', 'Date'), l('账户', 'Account'), l('股票', 'Stock'), l('方向', 'Side'), l('股数', 'Shares'), l('价格', 'Price')].map(heading => <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>{items.map(row => <tr key={row.id} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-4">{row.tradeDate}</td><td className="px-3 py-4">#{row.accountId}</td><td className="px-3 py-4">{row.symbol}</td><td className="px-3 py-4">{row.side === 'buy' ? l('买入', 'Buy') : l('卖出', 'Sell')}</td><td className="px-3 py-4 tabular-nums">{row.quantity}</td><td className="whitespace-nowrap px-3 py-4 tabular-nums">{row.price} {row.currency}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {!items.length && !error && <p className="py-8 text-sm text-secondary-text">{l('暂无交易记录', 'No transactions yet')}</p>}
      </>}
    </section>
    <nav aria-label={l('交易记录', 'Transactions')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <button className="btn-secondary" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>{l('上一页', 'Previous')}</button>
      <span>{page} / {loading || error ? '—' : Math.max(1, Math.ceil(total / 20))}</span>
      <button className="btn-secondary" disabled={loading || page * 20 >= total} onClick={() => setPage(value => value + 1)}>{l('下一页', 'Next')}</button>
    </nav>
  </AppPage>;
}
