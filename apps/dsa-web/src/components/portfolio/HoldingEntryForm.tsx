import { useEffect, useState } from 'react';
import { portfolioApi } from '../../api/portfolio';
import type { PortfolioAccountItem } from '../../types/portfolio';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { getParsedApiError } from '../../api/error';
import { useStockIndex } from '../../hooks/useStockIndex';

export default function HoldingEntryForm({ onSaved }: { onSaved: () => void }) {
  const { localize: l } = useUiLanguage();
  const [accounts, setAccounts] = useState<PortfolioAccountItem[]>([]);
  const [accountId, setAccountId] = useState('new');
  const [accountName, setAccountName] = useState('');
  const [market, setMarket] = useState<'cn' | 'hk' | 'us'>('cn');
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [tradeDate, setTradeDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [uid, setUid] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const { index } = useStockIndex();
  const currency = { cn: 'CNY', hk: 'HKD', us: 'USD' }[market];
  const load = () => portfolioApi.getAccounts().then(result => { setAccounts(result.accounts); if (result.accounts.length) setAccountId(String(result.accounts[0].id)); setLoaded(true); setError(''); }).catch(err => setError(getParsedApiError(err).message));
  useEffect(() => { void load(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const matched = index.find(s => s.market.toLowerCase() === market && [s.canonicalCode.toUpperCase(), s.displayCode.toUpperCase(), s.nameZh].includes(symbol.trim().toUpperCase()));
      let code = matched?.canonicalCode || symbol.trim().toUpperCase();
      if (market === 'hk' && /^(HK)?\d{1,5}$/.test(code)) code = `HK${code.replace(/^HK/, '').padStart(5, '0')}`;
      if (!(market === 'cn' ? /^\d{6}$/.test(code) : market === 'hk' ? /^HK\d{5}$/.test(code) : /^[A-Z][A-Z0-9.-]{0,14}$/.test(code))) throw new Error(l('请输入匹配市场的股票代码，或从股票列表中选择。', 'Enter a stock code matching the market, or choose a stock from the list.'));
      let id = Number(accountId);
      if (accountId === 'new') {
        const created = await portfolioApi.createAccount({ name: accountName.trim(), market, baseCurrency: currency });
        id = created.id; setAccounts([...accounts, created]); setAccountId(String(id));
      }
      await portfolioApi.createTrade({ accountId: id, symbol: code, market, currency, tradeDate, side, quantity: Number(quantity), price: Number(price), tradeUid: uid });
      setUid(crypto.randomUUID()); setSymbol(''); setQuantity(''); setPrice(''); onSaved();
    } catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(false); }
  };
  const input = 'mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground';
  return <form onSubmit={event => void submit(event)} className="my-5 border-y border-border bg-hover/20 p-4 md:p-6">
    <h2 className="font-semibold">{l('录入持仓 / 交易记录', 'Record a holding / transaction')}</h2>
    <p className="mt-2 text-sm leading-6 text-secondary-text">{l('初次录入可用现有股数与平均成本记一笔买入。后续买卖请继续记流水，不要重复录入余额。这里只记账，不向券商下单；未补资金流水时不用于计算可用资金。', 'For an opening position, record a buy using current shares and average cost. Then record actual buys/sells, not repeated balances. This is bookkeeping, not a broker order. Cash availability requires complete cash records.')}</p>
    <fieldset disabled={busy || !loaded} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">{l('账户', 'Account')}<select className={input} value={accountId} onChange={e => setAccountId(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.baseCurrency}</option>)}<option value="new">{l('新建账户', 'New account')}</option></select></label>
      {accountId === 'new' && <label className="text-sm">{l('账户名称', 'Account name')}<input required maxLength={80} value={accountName} onChange={e => setAccountName(e.target.value)} className={input} /></label>}
      <label className="text-sm">{l('股票市场', 'Stock market')}<select value={market} onChange={e => { setMarket(e.target.value as typeof market); setSymbol(''); }} className={input}><option value="cn">{l('A 股 · CNY', 'China A · CNY')}</option><option value="hk">{l('港股 · HKD', 'Hong Kong · HKD')}</option><option value="us">{l('美股 · USD', 'US · USD')}</option></select></label>
      <label className="text-sm">{l('股票代码或名称', 'Stock code or name')}<input required list="holding-symbols" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder={{ cn: '600519', hk: 'HK00700', us: 'AAPL' }[market]} className={input} /><datalist id="holding-symbols">{index.filter(s => s.market.toLowerCase() === market && `${s.canonicalCode} ${s.nameZh}`.toLowerCase().includes(symbol.toLowerCase())).slice(0, 20).map(s => <option key={s.canonicalCode} value={s.canonicalCode}>{s.nameZh}</option>)}</datalist></label>
      <label className="text-sm">{l('记录类型', 'Record type')}<select value={side} onChange={e => setSide(e.target.value as typeof side)} className={input}><option value="buy">{l('买入 / 初始持仓', 'Buy / opening holding')}</option><option value="sell">{l('卖出 / 减少持仓', 'Sell / reduce holding')}</option></select></label>
      <label className="text-sm">{l('股数', 'Shares')}<input type="number" required min="0.00000001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className={input} /></label>
      <label className="text-sm">{l('每股价格 / 初始成本', 'Price / opening cost per share')} · {currency}<input type="number" required min="0.00000001" step="any" value={price} onChange={e => setPrice(e.target.value)} className={input} /></label>
      <label className="text-sm">{l('记账日期', 'Record date')}<input type="date" required value={tradeDate} onChange={e => setTradeDate(e.target.value)} className={input} /></label>
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}{!loaded && <button type="button" className="ml-3 underline" onClick={() => void load()}>{l('重试', 'Retry')}</button>}</p>}
    <button type="submit" disabled={busy || !loaded} className="btn-primary mt-5">{busy ? l('正在保存…', 'Saving…') : l('保存记录', 'Save record')}</button>
  </form>;
}
