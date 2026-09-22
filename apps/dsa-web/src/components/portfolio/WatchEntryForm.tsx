import ResearchBackendSelect from './ResearchBackendSelect';
import { useState } from 'react';
import { portfolioResearchApi } from '../../api/portfolioResearch';
import { useStockIndex } from '../../hooks/useStockIndex';
import { normalizeStockCode } from '../../utils/stockCode';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { getParsedApiError } from '../../api/error';

export default function WatchEntryForm({ onSaved }: { onSaved: () => void }) {
  const { localize: l } = useUiLanguage();
  const { index } = useStockIndex();
  const [market, setMarket] = useState<'cn' | 'hk' | 'us'>('cn');
  const [symbol, setSymbol] = useState('');
  const [backend, setBackend] = useState<'llm' | 'jev'>('llm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const entered = symbol.trim().toUpperCase();
      const matched = index.find(stock => stock.market.toLowerCase() === market && [stock.canonicalCode, stock.displayCode, stock.nameZh, stock.nameEn].some(value => value?.trim().toUpperCase() === entered));
      let code = normalizeStockCode(matched?.canonicalCode || entered).toUpperCase();
      if (market === 'us') code = code.replace(/\.US$/, '');
      if (market === 'hk' && /^(HK)?\d{1,5}$/.test(code)) code = `HK${code.replace(/^HK/, '').padStart(5, '0')}`;
      if (!(market === 'cn' ? /^\d{6}$/.test(code) : market === 'hk' ? /^HK\d{5}$/.test(code) : /^[A-Z][A-Z0-9.-]{0,14}$/.test(code) && !/^HK\d+$/.test(code))) throw new Error(l('请输入匹配市场的股票代码，或从列表中选择。', 'Enter a stock code matching the market, or choose from the list.'));
      await portfolioResearchApi.createWatch({ symbol: code, market, decisionBackend: backend });
      setSymbol(''); onSaved();
    } catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(false); }
  };
  const input = 'mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground';
  return <form onSubmit={event => void submit(event)} className="my-5 border-y border-border bg-hover/20 p-4 md:p-6">
    <h2 className="font-semibold">{l('添加关注股票', 'Add a watch stock')}</h2>
    <p className="mt-2 text-sm leading-6 text-secondary-text">{l('关注股票可以独立研究、按周期自动跟踪并保留评分轨迹。它不属于账本，研究不会读取成本或数量，也不会给出持仓操作建议。', 'Watch stocks support independent research, scheduled tracking, and score history. They are not ledger positions, so research never reads cost or quantity and does not give holding actions.')}</p>
    <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">{l('股票市场', 'Stock market')}<select value={market} onChange={e => { setMarket(e.target.value as typeof market); setSymbol(''); }} className={input}><option value="cn">{l('A 股', 'China A')}</option><option value="hk">{l('港股', 'Hong Kong')}</option><option value="us">{l('美股', 'US')}</option></select></label>
      <label className="text-sm">{l('股票代码或名称', 'Stock code or name')}<input required list="watch-symbols" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder={{ cn: '600519', hk: 'HK00700', us: 'AAPL' }[market]} className={input} /><datalist id="watch-symbols">{index.filter(stock => stock.market.toLowerCase() === market && `${stock.canonicalCode} ${stock.nameZh}`.toLowerCase().includes(symbol.toLowerCase())).slice(0, 20).map(stock => <option key={stock.canonicalCode} value={stock.canonicalCode}>{stock.nameZh}</option>)}</datalist></label>
      <ResearchBackendSelect value={backend} onChange={setBackend} watch />
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    <button type="submit" disabled={busy} className="btn-primary mt-5">{busy ? l('正在添加…', 'Adding…') : l('添加关注股票', 'Add watch stock')}</button>
  </form>;
}
