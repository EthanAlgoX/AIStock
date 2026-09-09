import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FlaskConical, LockKeyhole } from 'lucide-react';
import { UiLanguageToggle } from '../components/i18n/UiLanguageToggle';
import { Button, Input } from '../components/common';
import { ReportMarkdownBody } from '../components/report/ReportMarkdownBody';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { trialApi, type TrialKind, type TrialRun, type TrialStatus } from '../api/trial';
import { trialError } from '../utils/trialError';

export default function TrialPage() {
  const { localize: l, language } = useUiLanguage();
  const [kind, setKind] = useState<TrialKind>('assistant');
  const [status, setStatus] = useState<TrialStatus>();
  const [runs, setRuns] = useState<TrialRun[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [enroll, setEnroll] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [topic, setTopic] = useState('');
  const [stock, setStock] = useState('');
  const [experts, setExperts] = useState<string[]>([]);
  const [mode, setMode] = useState<'independent' | 'debate'>('independent');
  const [demoStep, setDemoStep] = useState(1);
  const [strategy, setStrategy] = useState('quality');
  const [quantity, setQuantity] = useState('100');
  const [cost, setCost] = useState('100');
  const [alert, setAlert] = useState(false);
  const tabs: [TrialKind, string][] = [['assistant', l('投研助理', 'Assistant')], ['roundtable', l('专家圆桌', 'Roundtable')], ['research', l('个股研究', 'Stock research')], ['screening', l('策略选股', 'Screening')], ['trading', l('交易推演', 'Trade simulation')], ['holdings', l('持仓管理', 'Portfolio')]];
  const names: Record<string, string> = { 'warren-buffett': l('巴菲特视角', 'Buffett lens'), 'charlie-munger': l('芒格视角', 'Munger lens'), 'peter-lynch': l('彼得·林奇视角', 'Lynch lens'), summary: l('主持人总结', 'Moderator summary') };
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await trialApi.status();
        const history = next.user ? await trialApi.runs() : [];
        if (mounted) { setStatus(next); setRuns(history); }
      } catch (err) { if (mounted) setError(err); }
      finally { if (mounted) timer = setTimeout(() => void load(), 4000); }
    };
    void load();
    return () => { mounted = false; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { document.title = l('体验 AI Stock', 'Explore AI Stock'); }, [l]);
  const user = status?.user;
  const demoReports = [
    { role: names['warren-buffett'], content: l('**结论：先验证现金流，再讨论便宜。**\n\n演示企业“云杉科技”的收入增长不等于股东回报。应核查经营现金流、维护性资本支出及客户留存；缺少这些数据时，不给出目标价。', '**Conclusion: verify cash flow before calling it cheap.**\n\nRevenue growth at fictional Cedar Systems is not the same as shareholder returns. Review operating cash flow, maintenance capital spending and retention. Without those inputs, no target price is justified.') },
    { role: names['charlie-munger'], content: l('**反方意见：现金流稳定也可能掩盖客户集中风险。**\n\n需要补充最大客户收入占比与替代产品信息。若增长依赖单一客户，即使估值低，也不能直接视为安全边际。', '**Counterargument: stable cash flow can hide customer concentration.**\n\nCheck the largest customer’s revenue share and substitute products. Growth dependent on one customer can undermine an apparently low valuation.') },
    { role: names.summary, content: l('**汇总：进入观察名单，不把演示数字当作买入信号。**\n\n- 共识：验证现金创造能力。\n- 分歧：客户集中是否足以否定投资逻辑。\n- 下一步：补齐现金流与客户结构，分别检验两种观点。', '**Summary: watchlist, not a buy signal from demo numbers.**\n\n- Agreement: verify cash generation.\n- Disagreement: whether customer concentration breaks the thesis.\n- Next: compare cash flow and customer structure to test both views.') },
  ];
  const resetIdentityView = () => { setRuns([]); setStatus(undefined); setRefresh(v => v + 1); };

  return <main className="min-h-screen bg-background px-5 py-7 text-foreground md:px-10">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <Link to="/try" className="text-xl font-semibold tracking-tight">AI Stock</Link>
        <div className="flex items-center gap-4"><Link className="text-sm text-secondary-text hover:text-primary" to="/login">{l('管理员登录', 'Admin sign in')}</Link><UiLanguageToggle /></div>
      </header>
      <div className="py-10 md:py-14">
        <div className="mb-3 flex items-center gap-2 text-sm text-primary"><FlaskConical size={18} aria-hidden />{l('无需注册的产品体验', 'Explore without signing up')}</div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{l('从一个问题，看懂你的投研工作区。', 'One question. A whole research workspace.')}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-secondary-text">{l('先浏览演示报告，再用独立试用身份提出自己的问题。演示不会读取真实账户，也不会消耗模型额度。', 'Explore example reports, then ask your own questions with a separate trial identity. Demos never read real accounts or spend model tokens.')}</p>
      </div>
      <nav aria-label={l('体验功能', 'Demo features')} className="flex flex-wrap gap-2 border-b border-border pb-4">{tabs.map(([id, label]) => <button key={id} aria-pressed={kind === id} onClick={() => { setKind(id); setDemoStep(1); }} className={`min-h-11 rounded-lg px-4 text-sm ${kind === id ? 'bg-primary text-primary-foreground' : 'text-secondary-text hover:bg-hover'}`}>{label}</button>)}</nav>
      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_280px]" aria-label={l('演示工作区', 'Demo workspace')}>
        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{tabs.find(([id]) => id === kind)?.[1]}</h2><span className="rounded-md bg-hover px-3 py-1 text-xs text-secondary-text">{l('演示数据 · 非实时分析', 'Demo data · not live research')}</span></div>
          {kind === 'roundtable' ? <>
            <p className="mb-5 text-sm text-secondary-text">{l('讨论话题：云杉科技的增长值得付出更高估值吗？以下为预设讨论回放，不是正在运行的 Agent。', 'Topic: does Cedar Systems deserve a growth premium? This is a scripted replay, not live Agents.')}</p>
            {demoReports.slice(0, demoStep).map(r => <article key={r.role} className="border-t border-border py-5"><h3 className="mb-3 text-sm font-semibold text-primary">{r.role}</h3><ReportMarkdownBody content={r.content} allowImages={false} /></article>)}
            <button className="btn-secondary mt-4" onClick={() => setDemoStep(v => v === 3 ? 1 : v + 1)}>{demoStep === 3 ? l('重新回放', 'Replay again') : l('查看下一条发言', 'Show next contribution')}</button>
          </> : kind === 'screening' ? <>
            <label className="block text-sm">{l('演示策略', 'Demo strategy')}<select className="ml-3 rounded-lg border border-border bg-background p-2" value={strategy} onChange={e => setStrategy(e.target.value)}><option value="quality">{l('质量优先', 'Quality first')}</option><option value="momentum">{l('趋势优先', 'Trend first')}</option></select></label>
            <div className="mt-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-secondary-text"><th className="py-3">{l('虚构候选', 'Fictional candidate')}</th><th>{l('筛选依据', 'Screening rationale')}</th><th>{l('主要风险', 'Main risk')}</th></tr></thead><tbody>{(strategy === 'quality' ? ['A', 'B'] : ['B', 'A']).map((id, i) => <tr key={id} className="border-b border-border"><td className="py-4 pr-4">DEMO-{id}</td><td className="pr-4">{strategy === 'quality' ? l('现金流质量待复核', 'Cash-flow quality to verify') : l('价量趋势待确认', 'Price-volume trend to confirm')}</td><td>{i ? l('周期波动', 'Cyclical exposure') : l('客户集中', 'Concentration')}</td></tr>)}</tbody></table></div>
            <p className="mt-5 text-sm leading-6 text-secondary-text">{l('候选排序只是演示交互。真实试用可以讨论筛选逻辑，但不执行全市场扫描。', 'Ordering only demonstrates the interaction. Live trials can discuss screening logic but do not scan the full market.')}</p>
          </> : kind === 'holdings' ? <>
            <h3 className="mb-4 font-medium">DEMO-A · {l('云杉科技（虚构）', 'Cedar Systems (fictional)')}</h3>
            <div className="grid grid-cols-2 gap-4"><Input label={l('演示股数', 'Demo shares')} type="number" min={0} max={100000} value={quantity} onChange={e => setQuantity(e.target.value)} /><Input label={l('每股成本', 'Cost per share')} type="number" min={0} max={100000} value={cost} onChange={e => setCost(e.target.value)} /></div>
            <p className="mt-5 text-sm">{l('虚构参考价格：112；演示浮动盈亏：', 'Fictional reference price: 112; illustrative P/L: ')}<strong className="tabular-nums">{Number.isFinite(Number(quantity) * Number(cost)) ? ((112 - Number(cost)) * Number(quantity)).toLocaleString(language, {maximumFractionDigits:2}) : '—'}</strong></p>
            <label className="mt-5 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={alert} onChange={e => setAlert(e.target.checked)} />{l('开启演示预警', 'Enable demo alert')}</label>
            <p role="status" className="text-sm leading-6 text-secondary-text">{alert ? l('演示预警已选择；不会保存到持仓、创建定时任务或发送通知。', 'Demo alert selected. No portfolio record, scheduled task or notification is created.') : l('这些输入仅保留在当前页面，刷新后重置。', 'These inputs stay on this page only and reset on refresh.')}</p>
          </> : <>
            {kind === 'assistant' && <div className="mb-5 flex flex-wrap gap-2">{[l('用现金流研究云杉科技', 'Review Cedar Systems cash flow'), l('找出最强的反方证据', 'Find the strongest counterargument')].map((q, i) => <button key={q} className="btn-secondary text-sm" onClick={() => setDemoStep(i + 1)}>{q}</button>)}</div>}
            {(kind === 'research' || kind === 'trading') && <figure className="mb-6 border-y border-border py-5">
              <figcaption className="mb-3 text-sm text-secondary-text">{l('虚构价格路径 · 仅演示可视化', 'Fictional price path · visualization example only')}</figcaption>
              <svg viewBox="0 0 640 160" role="img" aria-label={l('虚构价格从 100 波动至 112，不是行情或回测', 'Fictional price moves from 100 to 112; not market data or a backtest')} className="h-40 w-full"><path d="M20 130 H620 M20 80 H620 M20 30 H620" fill="none" stroke="currentColor" className="text-border" /><polyline points="20,130 120,105 220,115 320,65 420,85 520,45 620,30" fill="none" stroke="currentColor" strokeWidth="3" className="text-primary" /><text x="20" y="155" fill="currentColor" className="text-secondary-text" fontSize="12">100</text><text x="595" y="20" fill="currentColor" className="text-secondary-text" fontSize="12">112</text></svg>
            </figure>}
            <ReportMarkdownBody allowImages={false} content={kind === 'trading' ? l('## 条件化交易方案\n\n**等待确认，而不是立即买入。**\n\n| 环节 | 需要确认 |\n| --- | --- |\n| 入场 | 趋势突破是否伴随成交量支持 |\n| 风控 | 可承受损失、跳空和流动性 |\n| 退出 | 原始判断失效，而非机械追涨杀跌 |\n\n演示不生成真实订单；真实试用也不执行回测或下单。', '## Conditional trading plan\n\n**Wait for confirmation, rather than buying immediately.**\n\n| Stage | Check |\n| --- | --- |\n| Entry | Whether a breakout has volume support |\n| Risk | Loss budget, gaps and liquidity |\n| Exit | Invalidation of the original thesis |\n\nThe demo creates no real orders. Live trials also do not execute backtests or trades.') : demoReports[kind === 'assistant' ? demoStep - 1 : 2].content} />
          </>}
        </div>
        <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"><h3 className="font-semibold">{l('从报告到行动之前', 'Before acting on a report')}</h3><p className="mt-3 text-sm leading-7 text-secondary-text">{l('先看证据与日期，再看反方观点，最后检查风险与失效条件。这里没有真实持仓、收益承诺或自动买卖。', 'Read the evidence and dates, consider opposing views, then check risks and invalidation conditions. No real holdings, return promises or automatic trades are involved.')}</p><a href="#live-trial" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-primary">{l('试试自己的问题', 'Try your own question')}<ArrowRight size={16} aria-hidden /></a></aside>
      </section>

      <section id="live-trial" className="border-t border-border py-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{l('限额真实试用', 'Live research trial')}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{l('每个受邀用户一次性 200,000 Token，输入、输出及专家调用合并计算。受限研究不等于完整工作流：不访问个人数据、不扫描全市场、不运行回测、不下单。', 'Each invited user gets 200,000 lifetime tokens shared across input, output and experts. Limited research is not the full workflow: no personal data, market-wide scans, backtests or orders.')}</p></div>{user && <button className="btn-secondary" onClick={async () => { try { await trialApi.logout(); resetIdentityView(); } catch (err) { setError(err); } }}>{l('退出试用账户', 'Sign out of trial')}</button>}</div>
        {error != null && <p role="alert" className="mt-4 text-sm text-danger">{trialError(error, l)} <button className="underline" onClick={() => { setError(undefined); setRefresh(v => v + 1); }}>{l('重试', 'Retry')}</button></p>}
        {!user ? <details className="mt-6 max-w-lg rounded-xl border border-border p-5"><summary className="cursor-pointer font-medium">{l('领取邀请码额度 / 试用登录', 'Claim an invitation / trial sign in')}</summary><p className="mt-3 text-sm leading-6 text-secondary-text">{l('邀请码由部署管理员发放并绑定邮箱，不是管理员注册凭证。没有邀请码也可以继续浏览上方演示。', 'Invites are issued by the deployment administrator and bound to an email, not administrator setup tokens. Without one, you can still explore the demo above.')}</p>
          <form className="mt-4 space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(undefined); try { await trialApi.authenticate(enroll, email, password, invite); setPassword(''); setInvite(''); resetIdentityView(); } catch (err) { setError(err); } finally { setBusy(false); } }}>
            <Input label={l('试用邮箱', 'Trial email')} type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
            <Input label={l('试用密码', 'Trial password')} type="password" required minLength={8} maxLength={128} autoComplete={enroll ? 'new-password' : 'current-password'} allowTogglePassword value={password} onChange={e => setPassword(e.target.value)} />
            {enroll && <Input label={l('邀请码', 'Invitation code')} type="password" required autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} />}
            <Button type="submit" isLoading={busy}>{enroll ? l('领取并登录', 'Claim & sign in') : l('登录试用', 'Sign in to trial')}</Button><button type="button" className="ml-4 text-sm text-primary" onClick={() => setEnroll(!enroll)}>{enroll ? l('已有试用账户', 'Already enrolled') : l('使用邀请码', 'Use invitation')}</button>
          </form></details> : <>
          <div className="my-6 flex flex-wrap gap-x-8 gap-y-2 rounded-lg bg-hover px-4 py-3 text-sm"><span className="break-all">{user.email}</span><strong className="tabular-nums">{l('剩余', 'Remaining')} {user.remaining.toLocaleString()} / 200,000</strong><span className="text-secondary-text">{l('一次性额度，不每日重置', 'Lifetime quota, no daily reset')}</span></div>
          <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(undefined); try { await trialApi.run({requestId: crypto.randomUUID(),kind,topic,stock,language,experts,mode}); setRefresh(v => v + 1); } catch (err) { setError(err); } finally { setBusy(false); } }}>
            <label className="block text-sm font-medium">{l('你的研究问题', 'Your research question')}<textarea required minLength={2} maxLength={2000} rows={3} value={topic} onChange={e => setTopic(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm" /></label>
            <div className="flex flex-wrap items-end gap-5"><Input label={l('股票代码（可选，拉取公开历史行情）', 'Stock code (optional, public price history)')} value={stock} maxLength={20} pattern="[A-Za-z0-9.]*" onChange={e => setStock(e.target.value)} />
              <fieldset><legend className="mb-2 text-sm">{l('独立专家（最多两位）', 'Independent experts (up to two)')}</legend><div className="flex flex-wrap gap-3">{Object.entries(names).filter(([id]) => id !== 'summary').map(([id, name]) => <label key={id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={experts.includes(id)} disabled={!experts.includes(id) && experts.length >= 2} onChange={() => setExperts(v => v.includes(id) ? v.filter(k => k !== id) : [...v, id])} />{name}</label>)}</div></fieldset>
              <label className="text-sm">{l('协作方式', 'Collaboration')}<select className="ml-2 rounded-lg border border-border bg-background p-2" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="independent">{l('独立分析后汇总', 'Independent reports + summary')}</option><option value="debate">{l('一轮交叉反驳后汇总', 'One cross-review + summary')}</option></select></label>
            </div>
            <p className="text-xs leading-6 text-secondary-text">{l('每次调用预留输入上界和最多 2,048 输出 Token，按实际用量结算。用量缺失或超时可能保留预扣额度。切换页面不取消后台运行。', 'Each call reserves an input upper bound plus up to 2,048 output tokens, then settles actual usage. Missing usage or timeouts may retain the reservation. Navigation does not cancel background work.')}</p>
            <Button type="submit" isLoading={busy} disabled={!status?.enabled || !user.remaining || Boolean(user.activeRun)}>{user.activeRun ? l('后台运行中…', 'Running in background…') : l('运行真实研究', 'Run live research')}</Button>
          </form>
          {!status?.enabled && <p className="mt-3 flex items-center gap-2 text-sm text-secondary-text"><LockKeyhole size={16} aria-hidden />{l('管理员尚未开启真实试用。', 'Live trials have not been enabled by the administrator.')}</p>}
          <div className="mt-8 space-y-6"><h3 className="font-semibold">{l('我的试用记录', 'My trial history')}</h3>{!runs.length && <p className="text-sm text-secondary-text">{l('运行后的研究会保存在这里。', 'Your research will appear here after a run.')}</p>}{runs.map(run => <details key={run.id} open={['running', 'processing'].includes(run.status)} className="rounded-xl border border-border p-5"><summary className="cursor-pointer break-words font-medium">{run.topic}<span className="ml-3 text-xs text-secondary-text">{run.status === 'completed' ? l('已完成', 'Completed') : ['running', 'processing'].includes(run.status) ? l('运行中', 'Running') : l('已停止', 'Stopped')}</span></summary>{run.error && <p className="mt-4 text-sm text-danger">{trialError(run.error, l)}</p>}{run.events.map((event, i) => <article key={i} className="mt-5 border-t border-border pt-5"><h4 className="mb-3 text-sm font-semibold text-primary">{names[event.role.split(':')[0]] || l('研究 Agent', 'Research Agent')}{event.role.endsWith(':review') ? l(' · 交叉评审', ' · Cross-review') : ''}</h4><ReportMarkdownBody content={event.content} allowImages={false} /></article>)}</details>)}</div>
        </>}
      </section>
    </div>
  </main>;
}
