import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppPage, PageHeader } from '../components/common';
import { Link, useSearchParams } from 'react-router-dom';
import AssetClassTabs from '../components/crypto/AssetClassTabs';
import { useCryptoSimulation } from '../components/crypto/CryptoSimulationContext';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { cryptoApi, type CryptoBacktest, type CryptoCandle, type CryptoScreen, type CryptoTicker } from '../api/crypto';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const number = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

export default function CryptoWorkspacePage({ section }: { section: 'market' | 'research' | 'screening' | 'trading' | 'holdings' }) {
  const [params] = useSearchParams();
  const { result: latestBacktest, setResult } = useCryptoSimulation();
  const { localize: l, language } = useUiLanguage();
  const [market, setMarket] = useState<CryptoTicker[]>([]);
  const [symbol, setSymbol] = useState(() => { const requested = params.get('symbol'); return requested && /^[A-Z0-9]{2,20}USDT$/.test(requested) ? requested : 'BTCUSDT'; });
  const availablePairs = useMemo(() => [...new Set([...PAIRS, symbol, ...market.map(row => row.symbol)])], [market, symbol]);
  const [candles, setCandles] = useState<CryptoCandle[]>([]);
  const [metrics, setMetrics] = useState<{ periodReturn: number; hourlyVolatility: number | null; quoteTurnover: number; periodHigh: number; periodLow: number } | null>(null);
  const [symbols, setSymbols] = useState<string[]>(PAIRS);
  const [strategy, setStrategy] = useState('selection_hold');
  const [startDate, setStartDate] = useState(day(-30));
  const [endDate, setEndDate] = useState(day(0));
  const [screen, setScreen] = useState<CryptoScreen | null>(null);
  const [backtest, setBacktest] = useState<CryptoBacktest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [asOf, setAsOf] = useState('');
  const chart = useMemo(() => candles.filter((_, i) => i % 6 === 0).map(c => ({ time: new Date(c.time).toLocaleDateString(language), value: c.close })), [candles, language]);
  useEffect(() => {
    let active = true;
    if (section === 'holdings') return;
    void cryptoApi.market().then(result => { if (active) { setMarket(result.assets); setAsOf(result.asOf); } }).catch(() => { if (active) setError(l('现货行情暂时无法获取，请稍后重试。', 'Spot market data is unavailable. Please retry later.')); });
    return () => { active = false; };
  }, [l, section]);
  useEffect(() => {
    let active = true;
    if (section !== 'research') return;
    setCandles([]);
    setMetrics(null);
    void cryptoApi.asset(symbol).then(result => { if (active) { setCandles(result.candles); setMetrics(result.metrics); } }).catch(() => { if (active) setError(l('小时线暂时无法获取，请核对交易对或稍后重试。', 'Hourly candles are unavailable. Check the pair or retry later.')); });
    return () => { active = false; };
  }, [symbol, l, section]);
  const runScreen = async () => { setBusy('screen'); setError(''); try { setScreen(await cryptoApi.screen(symbols, 720, Math.min(3, symbols.length))); } catch { setError(l('选币失败：所选交易对可能缺少完整历史行情，或数据源暂时不可用。', 'Screen failed: a selected pair may lack complete history, or the data source is unavailable.')); } finally { setBusy(''); } };
  const runBacktest = async () => { setBusy('backtest'); setError(''); try { const result = await cryptoApi.backtest({ symbols, strategy, startDate, endDate, initialCash: 10000, feeRate: .001, slippageRate: .0005, allocation: .5, lookbackHours: 720, topN: Math.min(3, symbols.length), rebalanceHours: 168 }); setBacktest(result); setResult(result); } catch { setError(l('回测失败：请核对日期与交易对，并确保有完整的历史小时线。', 'Backtest failed: check the dates and pairs, and ensure complete historical hourly candles are available.')); } finally { setBusy(''); } };
  const toggle = (pair: string) => { setSymbols(current => current.includes(pair) ? (current.length === 1 ? current : current.filter(s => s !== pair)) : (current.length >= 5 ? current : availablePairs.filter(s => current.includes(s) || s === pair))); setScreen(null); setBacktest(null); };
  const titles = { market: l('加密货币市场雷达', 'Crypto market radar'), research: l('币种研究', 'Asset research'), screening: l('选币策略', 'Asset screening'), trading: l('加密货币交易推演', 'Crypto trading simulation'), holdings: l('加密货币模拟持仓', 'Crypto simulated holdings') };
  const descriptions = { market: l('查看 USDT 现货的 24 小时行情。', 'View rolling 24-hour USDT spot prices.'), research: l('研究币种的已完成小时线及价格波动。', 'Study completed hourly candles and price volatility.'), screening: l('根据成交额和波动率筛选现货交易对。', 'Screen spot pairs by turnover and volatility.'), trading: l('用固定规则回测；只模拟成交，不连接交易账户。', 'Replay fixed rules; fills are simulated and never connect to an exchange account.'), holdings: l('查看本次登录期间最近一次回测的期末模拟持仓。', 'Review ending simulated positions from the latest backtest in this session.') };
  const shownBacktest = section === 'holdings' ? latestBacktest : backtest;
  return <AppPage>
    <AssetClassTabs />
    <PageHeader eyebrow="Binance Spot · USDT" title={titles[section]} description={descriptions[section]} />
    {error && <div role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
    {(section === 'market' || section === 'research') && <div className="mt-6 grid gap-5">
      {section === 'market' && <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{l('市场雷达', 'Market radar')}</h2>
        <p className="mt-1 text-xs text-secondary-text">{l('币安现货 · 24 小时滚动行情 · USDT 报价', 'Binance Spot · rolling 24-hour data · USDT quoted')} {asOf && `· ${new Date(asOf).toLocaleString(language)}`}</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-secondary-text"><th className="py-2">{l('交易对', 'Pair')}</th><th>{l('价格', 'Price')}</th><th>24h %</th><th>{l('成交额 USDT', 'Turnover USDT')}</th><th>{l('操作', 'Action')}</th></tr></thead><tbody>{market.map(row => <tr key={row.symbol} className="border-b border-border/50"><td className="py-2 font-medium">{row.symbol}</td><td>{number(row.lastPrice, 6)}</td><td className={row.changePercent24h >= 0 ? 'text-green-600' : 'text-red-600'}>{number(row.changePercent24h)}%</td><td>{number(row.quoteVolume24h, 0)}</td><td><Link className="text-primary hover:underline" to={`/stock-research?asset=crypto&symbol=${row.symbol}`}>{l('研究', 'Research')} →</Link></td></tr>)}</tbody></table></div>
      </section>}
      {section === 'research' && <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{l('币种研究', 'Asset research')}</h2><select className="rounded-lg border border-border bg-background px-3 py-2" value={symbol} onChange={e => setSymbol(e.target.value)} aria-label={l('选择交易对', 'Select pair')}>{availablePairs.map(pair => <option key={pair}>{pair}</option>)}</select></div>
        <p className="mt-1 text-xs text-secondary-text">{l('近 7 天已完成的小时线收盘价', 'Completed hourly closes over the last 7 days')}</p>
        {metrics && <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div><dt className="text-secondary-text">{l('区间收益', 'Period return')}</dt><dd className="mt-1 font-semibold">{number(metrics.periodReturn * 100)}%</dd></div><div><dt className="text-secondary-text">{l('小时波动率', 'Hourly volatility')}</dt><dd className="mt-1 font-semibold">{metrics.hourlyVolatility == null ? '—' : `${number(metrics.hourlyVolatility * 100, 3)}%`}</dd></div><div><dt className="text-secondary-text">{l('区间成交额', 'Period turnover')}</dt><dd className="mt-1 font-semibold">{number(metrics.quoteTurnover, 0)} USDT</dd></div><div><dt className="text-secondary-text">{l('区间高／低', 'Period high / low')}</dt><dd className="mt-1 font-semibold">{number(metrics.periodHigh, 6)} / {number(metrics.periodLow, 6)}</dd></div></dl>}
        <div className="mt-5 h-56" role="img" aria-label={`${symbol} ${l('收盘价走势', 'closing price chart')}`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><XAxis dataKey="time" minTickGap={35} fontSize={11} /><YAxis domain={['auto', 'auto']} fontSize={11} width={65} /><Tooltip /><Line dataKey="value" type="monotone" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        <p className="mt-2 text-xs text-secondary-text">{l('数据源：币安公开现货 K 线。收盘价与成交额均来自已完成的 K 线。', 'Source: public Binance Spot candles. Closing price and turnover use completed candles only.')}</p>
      </section>}
    </div>}
    {(section === 'screening' || section === 'trading') && <div className="mt-5 grid gap-5">
      {section === 'screening' && <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{l('选币策略', 'Asset screening')}</h2>
        <p className="mt-1 text-sm text-secondary-text">{l('固定候选池：先按过去 720 小时 USDT 成交额选前三，再挑小时收益波动率最高的一只。', 'Fixed universe: rank by past 720-hour USDT turnover, take the top three, then select the highest hourly return volatility.')}</p>
        <div className="mt-4 flex flex-wrap gap-2">{availablePairs.map(pair => <label key={pair} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm"><input type="checkbox" checked={symbols.includes(pair)} disabled={!!busy || (!symbols.includes(pair) && symbols.length >= 5)} onChange={() => toggle(pair)} />{pair}</label>)}</div>
        <button type="button" disabled={!!busy} className="btn-primary mt-4" onClick={() => void runScreen()}>{busy === 'screen' ? l('筛选中…', 'Screening…') : l('运行选币', 'Run screen')}</button>
        {screen && <div className="mt-4 text-sm"><p className="font-semibold">{l('选中：', 'Selected: ')}{screen.selected}</p><p className="mt-1 text-xs text-secondary-text">{l('信号截止：', 'Signal cutoff: ')}{new Date(screen.signalTime).toLocaleString(language)}</p><ol className="mt-2 space-y-1">{screen.ranking.map(row => <li key={row.symbol}>{row.symbol} · {l('成交额', 'turnover')} {number(row.quoteVolume, 0)} USDT · {l('波动率', 'volatility')} {number(row.volatility * 100, 3)}%</li>)}</ol><Link className="mt-3 inline-block text-primary hover:underline" to={`/stock-research?asset=crypto&symbol=${screen.selected}`}>{l('研究选中币种', 'Research selected asset')} →</Link></div>}
      </section>}
      {section === 'trading' && <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{l('交易策略回测', 'Strategy backtest')}</h2>
        <p className="mt-1 text-sm text-secondary-text">{l('仅现货做多；前一根已收盘 K 线产生信号，下一根开盘成交。默认 10,000 USDT，手续费 0.1%，滑点 0.05%。', 'Long-only spot. Signals use the previous completed candle; orders fill at the next open. Defaults: 10,000 USDT, 0.1% fee, 0.05% slippage.')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs">{l('策略', 'Strategy')}<select className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" value={strategy} onChange={e => { setStrategy(e.target.value); setBacktest(null); }}><option value="selection_hold">{l('高量高波动轮换', 'High-volume/high-volatility rotation')}</option><option value="equal_weight">{l('等权再平衡', 'Equal-weight rebalance')}</option><option value="btc_half">{l('半仓比特币', 'Half-capital Bitcoin')}</option></select></label><label className="text-xs">{l('开始 UTC', 'Start UTC')}<input className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setBacktest(null); }} /></label><label className="text-xs">{l('结束 UTC（不含）', 'End UTC (exclusive)')}<input className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setBacktest(null); }} /></label></div>
        <fieldset className="mt-4"><legend className="text-xs font-medium">{l('候选交易对', 'Candidate pairs')}</legend><div className="mt-2 flex flex-wrap gap-2">{availablePairs.map(pair => <label key={pair} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm"><input type="checkbox" checked={symbols.includes(pair)} disabled={!!busy || (!symbols.includes(pair) && symbols.length >= 5)} onChange={() => toggle(pair)} />{pair}</label>)}</div></fieldset>
        <button type="button" disabled={!!busy} className="btn-primary mt-4" onClick={() => void runBacktest()}>{busy === 'backtest' ? l('回测中…', 'Backtesting…') : l('运行回测', 'Run backtest')}</button>
        {backtest && <div className="mt-4"><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><p>{l('策略收益', 'Strategy return')}<strong className="block text-lg">{number(backtest.return * 100)}%</strong></p><p>{l('最大回撤', 'Max drawdown')}<strong className="block text-lg">{number(backtest.maxDrawdown * 100)}%</strong></p><p>{l('BTC 同期收益', 'BTC period return')}<strong className="block text-lg">{backtest.btcReturn == null ? '—' : `${number(backtest.btcReturn * 100)}%`}</strong></p><p>{l('期末资产', 'Final equity')}<strong className="block">{number(backtest.finalEquity)} USDT</strong></p><p>{l('交易笔数', 'Trades')}<strong className="block">{backtest.tradeCount}</strong></p><p>{l('手续费＋滑点', 'Fees + slippage')}<strong className="block">{number(backtest.fees + backtest.slippageCost)} USDT</strong></p></div><div className="mt-4 h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={backtest.equityCurve}><XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleDateString(language)} minTickGap={35} fontSize={11} /><YAxis domain={['auto', 'auto']} fontSize={11} width={65} /><Tooltip labelFormatter={v => new Date(Number(v)).toLocaleString(language)} /><Line dataKey="equity" type="monotone" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div><p className="mt-2 break-all text-xs text-secondary-text">{l('行情样本 SHA-256：', 'Market sample SHA-256: ')}{backtest.sampleHash}</p></div>}
      </section>}
    </div>}
    {section === 'holdings' && !shownBacktest && <section className="mt-5 rounded-xl border border-border bg-card p-5 text-sm"><p>{l('本次登录尚无加密货币回测结果。请先在交易推演运行回测。', 'No crypto backtest in this session. Run a backtest in Trading simulation first.')}</p><Link className="mt-3 inline-block text-primary hover:underline" to="/trading?asset=crypto">{l('前往交易推演', 'Go to trading simulation')} →</Link></section>}
    {(section === 'trading' || section === 'holdings') && shownBacktest && <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{l('模拟持仓与成交', 'Simulated positions and fills')}</h2>{section === 'trading' && <Link className="text-sm text-primary hover:underline" to="/portfolio?asset=crypto">{l('查看持仓管理', 'View portfolio')} →</Link>}</div>
      <p className="mt-1 text-xs text-secondary-text">{l('期末未强制平仓；数量为可分割的现货单位，所有交易共享 USDT 现金。', 'No forced close at the end; positions use fractional spot units and share one USDT cash balance.')}</p>
      <p className="mt-3 text-sm">USDT {l('可用现金', 'cash available')}: {number(shownBacktest.endingCash)}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">{Object.entries(shownBacktest.endingPositions).filter(([, quantity]) => quantity > 1e-8).map(([pair, quantity]) => <span className="rounded-lg border border-border px-3 py-2" key={pair}>{pair}: {number(quantity, 8)}</span>)}</div>
      <div className="mt-4 max-h-56 overflow-auto text-sm">{shownBacktest.trades.length ? shownBacktest.trades.map((trade, i) => <p className="border-t border-border/60 py-2" key={`${trade.time}-${trade.symbol}-${i}`}>{new Date(trade.time).toLocaleString(language)} · {trade.side === 'buy' ? l('买入', 'Buy') : l('卖出', 'Sell')} {trade.symbol} · {number(trade.quantity, 8)} @ {number(trade.price, 6)} · {l('手续费', 'Fee')} {number(trade.fee, 4)} USDT</p>) : <p>{l('没有成交', 'No fills')}</p>}</div>
    </section>}
  </AppPage>;
}
