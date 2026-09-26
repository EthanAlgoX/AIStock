import { useState } from 'react';
import type { Portfolio, SimulationExecution } from '../../api/portfolios';
import { useUiLiteral } from '../../hooks/useUiLiteral';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

export function PortfolioExecutionLedger({portfolio}: {portfolio: Portfolio}) {
  const t = useUiLiteral();
  const { language } = useUiLanguage();
  const [limit, setLimit] = useState(10);
  const [side, setSide] = useState('all');
  const external = Boolean(portfolio.config.externalRuntime);
  const available = !external || Array.isArray(portfolio.executionLedger);
  const records: SimulationExecution[] = external ? portfolio.executionLedger ?? [] : (portfolio.days ?? []).flatMap(day => day.trades.filter(trade => trade.status === 'filled').map((trade,index) => ({...trade,id:`${day.date}-${index}`,timestamp:day.date})));
  const filtered = records.filter(row => side === 'all' || row.side === side).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
  const latest = portfolio.days?.at(-1);
  const fmt = (value: number | null | undefined, precision = 2) => value == null ? '—' : value.toLocaleString(language,{maximumFractionDigits:precision});
  const incomplete = portfolio.executionCoverage?.sourceCount != null && portfolio.executionCoverage.sourceCount !== records.length;
  return <section className="my-6 border-y border-border py-5" aria-label={t('模拟成交记录')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t(portfolio.mode === 'backtest' ? '回测成交记录' : '模拟成交记录')} · {records.length}</h3><label className="text-sm">{t('交易方向')}<select className="ml-2 rounded border border-border bg-background p-2" value={side} onChange={e => {setSide(e.target.value);setLimit(10);}}><option value="all">{t('全部')}</option><option value="buy">{t('买入')}</option><option value="sell">{t('卖出')}</option></select></label></div>
    <p className="mt-2 max-w-4xl text-sm leading-6 text-secondary-text">{t('这里展示整个模拟账户的成交，不限于最新估值时点。收益包含持仓估值变化；没有新成交时，收益仍可能变化。')}</p>
    <dl className="my-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[
      [t('净资产'),fmt(latest?.equity)], [t('可用现金'),fmt(latest?.cash)],
      [t('持仓市值'),fmt(latest?.marketValue)], [t('持仓数量'),latest ? String(latest.holdings.length) : '—'],
    ].map(([label,value]) => <div key={label}><dt className="text-secondary-text">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>)}</dl>
    {external && <p className="mb-3 text-xs text-secondary-text">{t('包含来源账户导入的模拟成交，导入后由服务器独立续跑。单笔费用未提供时留空，累计费用见来源记录。')}</p>}
    {incomplete && <p role="status" className="mb-3 text-sm text-warning">{t('来源成交计数与可用明细不一致，以下仅展示已保存的成交证据。')}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[external ? '成交时间（UTC）' : '成交日期','标的','交易方向','数量','成交价','费用',external ? '原因（来源原文）' : '原因'].map(label => <th className="whitespace-nowrap p-2" key={label}>{t(label)}</th>)}</tr></thead><tbody>{filtered.slice(0,limit).map(row => <tr className="border-t border-border" key={row.id}>
      <td className="whitespace-nowrap p-2">{row.timestamp}</td><td className="p-2">{row.code}</td><td className="p-2">{t(row.side === 'buy' ? '买入' : '卖出')}</td><td className="p-2 tabular-nums">{fmt(row.quantity,8)}</td><td className="p-2 tabular-nums">{fmt(row.price,8)}</td><td className="p-2 tabular-nums">{fmt(row.fee,8)}</td><td className="min-w-48 p-2 text-secondary-text">{t(row.reason)}</td>
    </tr>)}</tbody></table></div>
    {!filtered.length && <p className="py-4 text-sm text-secondary-text">{t(!available ? '模拟成交明细暂未提供，不能据此判断没有交易。' : records.length ? '当前筛选下没有模拟成交。' : '模拟账本尚无已确认成交。')}</p>}
    {filtered.length > limit && <button className="btn-secondary mt-3" onClick={() => setLimit(n => n+50)}>{t('显示更多交易')}</button>}
  </section>;
}
