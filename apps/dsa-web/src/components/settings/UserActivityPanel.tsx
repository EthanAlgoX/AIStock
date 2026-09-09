import { useEffect, useState } from 'react';
import api from '../../api';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { Button, Input } from '../common';
import { trialError } from '../../utils/trialError';

type Usage = { userId: string; email: string; date: string; feature?: string; calls: number; charged: number; confirmed: number; estimated: number };
type Activity = { id: string; userId: string; requestId: string; feature: string; event: string; resource: string; status: string; durationMs: number | null; content: string | null; createdAt: string };
type Call = { id: string; userId: string; requestId: string; date: string; feature: string; model: string | null; charged: number; estimated: boolean; promptTokens: number | null; completionTokens: number | null; durationMs: number | null; error: string | null };
type Summary = { daily: Usage[]; usage: Usage[]; featureTotals: Usage[]; activity: { userId: string; date: string; feature: string; event: string; resource: string; count: number }[] };
const features: Record<string, [string, string]> = { assistant: ['投研助理', 'Assistant'], roundtable: ['专家讨论', 'Experts'], research: ['个股研究', 'Research'], screening: ['选股', 'Screening'], trading: ['交易研究', 'Trading'], holdings: ['持仓', 'Holdings'], market: ['市场情报', 'Market'], settings: ['账号与设置', 'Settings'], history: ['历史记录', 'History'], alerts: ['提醒', 'Alerts'], schedules: ['定时任务', 'Schedules'], workspace: ['工作区操作', 'Workspace'], other: ['其他', 'Other'], legacy_unknown: ['历史未分类', 'Legacy unclassified'] };
const root = '/api/v1/trial/admin';
const today = () => new Date().toISOString().slice(0, 10);

export function UserActivityPanel({ users }: { users: { userId: string | null; email: string | null }[] }) {
  const { localize: l } = useUiLanguage();
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const [user, setUser] = useState('');
  const [feature, setFeature] = useState('');
  const [requestId, setRequestId] = useState('');
  const [tab, setTab] = useState<'daily' | 'usage' | 'activity' | 'calls' | 'counts'>('daily');
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState(0);
  const [data, setData] = useState<Summary>();
  const [events, setEvents] = useState<{ items: Activity[]; total: number }>({ items: [], total: 0 });
  const [calls, setCalls] = useState<{ items: Call[]; total: number }>({ items: [], total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const label = (key: string) => features[key] ? l(...features[key]) : key;
  const account = (id: string) => id === 'owner' ? l('管理员（我）', 'Administrator (me)') : users.find(u => u.userId === id)?.email || id;
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
    setBusy(true); setError(undefined);
    const params = { start, end, user_id: user || undefined, feature: feature || undefined, request_id: requestId || undefined, offset };
    void Promise.all([api.get<Summary>(root + '/analytics', { params }), api.get<typeof events>(root + '/activity', { params }), api.get<typeof calls>(root + '/calls', { params })]).then(([a, b, c]) => {
      if (active) { setData(a.data); setEvents(b.data); setCalls(c.data); }
    }).catch(err => { if (active) setError(err); }).finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [start, end, user, feature, requestId, offset, query]);
  const control = 'min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm';
  const rows = tab === 'daily' ? data?.daily : data?.featureTotals;
  const total = tab === 'calls' ? calls.total : events.total;
  return <section className="space-y-4 border-t border-border pt-6" aria-label={l('用户行为与 Token 分析', 'User activity and token analysis')}>
    <div><h3 className="font-medium">{l('用户行为与 Token 分析', 'User activity and token analysis')}</h3><p className="mt-2 text-sm leading-6 text-secondary-text">{l('包含管理员自己。按 UTC 日期统计，与成员每日额度一致；计费用量 = 已确认 + 未确认预留。功能分类按实际任务入口归属，历史无法确认的保留为未分类。', 'Includes the administrator. UTC dates match member quotas. Charged usage = confirmed + unverified reservations. Features follow execution entry points; unknown historical attribution stays unclassified.')}</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <Input type="date" label={l('开始日期', 'Start date')} value={start} onChange={e => { setStart(e.target.value); setOffset(0); }} />
      <Input type="date" label={l('结束日期', 'End date')} value={end} onChange={e => { setEnd(e.target.value); setOffset(0); }} />
      <label className="grid gap-2 text-sm">{l('用户', 'User')}<select className={control} value={user} onChange={e => { setUser(e.target.value); setOffset(0); }}><option value="">{l('全部用户', 'All users')}</option><option value="owner">{l('管理员（我）', 'Administrator (me)')}</option>{Array.from(new Map(users.filter(u => u.userId).map(u => [u.userId!, u])).values()).map(u => <option key={u.userId} value={u.userId!}>{u.email}</option>)}</select></label>
      <label className="grid gap-2 text-sm">{l('功能', 'Feature')}<select className={control} value={feature} onChange={e => { setFeature(e.target.value); setOffset(0); }}><option value="">{l('全部功能', 'All features')}</option>{Object.keys(features).map(key => <option key={key} value={key}>{label(key)}</option>)}</select></label>
      <Button variant="secondary" onClick={() => setQuery(v => v + 1)} disabled={busy}>{l('刷新记录', 'Refresh records')}</Button>
    </div>
    <div className="flex flex-wrap gap-2">{([['daily', '用户每日用量', 'Daily usage'], ['usage', '功能累计用量', 'Feature totals'], ['counts', '页面与操作次数', 'Page and operation counts'], ['calls', '模型调用明细', 'Model calls'], ['activity', '问答与操作记录', 'Questions and activity']] as const).map(([key, zh, en]) => <Button key={key} variant={tab === key ? 'primary' : 'secondary'} onClick={() => { setTab(key); setOffset(0); }}>{l(zh, en)}</Button>)}</div>
    {error != null && <p role="alert" className="text-danger">{trialError(error, l)}</p>}
    {busy && <p role="status" className="text-sm text-secondary-text">{l('正在加载…', 'Loading…')}</p>}
    {!busy && error == null && <>
      {(tab === 'daily' || tab === 'usage') && <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><thead><tr>{[l('用户', 'User'), ...(tab === 'daily' ? [l('日期 UTC', 'Date UTC')] : []), ...(tab === 'usage' ? [l('功能', 'Feature')] : []), l('调用次数', 'Calls'), l('计费用量', 'Charged'), l('已确认', 'Confirmed'), l('未确认预留', 'Unverified')].map(h => <th key={h} className="whitespace-nowrap border-b border-border p-3">{h}</th>)}</tr></thead><tbody>{rows?.map((r, i) => <tr key={i}><td className="break-all p-3">{account(r.userId)}</td>{tab === 'daily' && <td className="whitespace-nowrap p-3">{r.date}</td>}{tab === 'usage' && <td className="p-3">{label(r.feature!)}</td>}{[r.calls, r.charged, r.confirmed, r.estimated].map((v, j) => <td key={j} className="p-3">{v.toLocaleString()}</td>)}</tr>)}</tbody></table>{!rows?.length && <p className="py-4 text-sm">{l('所选范围内没有 Token 记录。', 'No token records in this range.')}</p>}</div>}
      {tab === 'counts' && <div className="overflow-x-auto"><p className="text-sm text-secondary-text">{l('页面次数来自登录后的页面切换；操作次数为提交请求次数，含失败及重试，不等于任务成功次数。', 'Page counts track authenticated navigation. Operations count submitted requests, including failures and retries, not completed tasks.')}</p><table className="w-full text-left text-sm"><thead><tr>{['用户 / User', '日期 / Date', '功能 / Feature', '事件 / Event', '页面或操作 / Resource', '次数 / Count'].map(h => <th key={h} className="border-b border-border p-3">{h}</th>)}</tr></thead><tbody>{data?.activity.map((r, i) => <tr key={i}><td className="p-3">{account(r.userId)}</td><td className="p-3">{r.date}</td><td className="p-3">{label(r.feature)}</td><td className="p-3">{r.event}</td><td className="break-all p-3">{r.resource}</td><td className="p-3">{r.count}</td></tr>)}</tbody></table>{!data?.activity.length && <p className="py-4">{l('没有行为记录。', 'No activity records.')}</p>}</div>}
    </>}
    {(tab === 'calls' || tab === 'activity') && <>
      <Input label={l('按追踪编号筛选明细（可选）', 'Filter details by trace ID (optional)')} value={requestId} onChange={e => { setRequestId(e.target.value); setOffset(0); }} />
      {!busy && error == null && <div className="divide-y divide-border">{tab === 'calls' ? calls.items.map(c => <article key={c.userId + c.id} className="space-y-2 py-4 text-sm"><p className="break-all font-medium">{account(c.userId)} · {label(c.feature)} · {c.date} · {c.model || '—'}</p><p>{c.charged.toLocaleString()} Token · {c.estimated ? l('未确认预留', 'Unverified reservation') : l('已确认', 'Confirmed')} · {l('输入', 'Input')} {c.promptTokens ?? '—'} / {l('输出', 'Output')} {c.completionTokens ?? '—'} · {c.durationMs ?? '—'} ms</p><p className="break-all text-secondary-text">{l('追踪编号', 'Trace ID')}: {c.requestId}{c.error ? ` · ${c.error}` : ''}</p><button className="text-primary underline" onClick={() => { setRequestId(c.requestId); setTab('activity'); setOffset(0); }}>{l('查看关联问答与操作', 'View related questions and activity')}</button></article>) : events.items.map(e => <article key={e.id} className="space-y-2 py-4 text-sm"><p className="break-all font-medium">{account(e.userId)} · {label(e.feature)} · {e.event} · {e.status}</p><p className="break-all text-secondary-text">{e.createdAt} · {e.resource} · {e.durationMs ?? '—'} ms</p><p className="break-all text-secondary-text">{l('追踪编号', 'Trace ID')}: {e.requestId}</p>{e.content && <details><summary className="cursor-pointer text-primary">{l('查看内容', 'View content')}</summary><pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-6">{e.content}</pre></details>}</article>)}{total === 0 && <p className="py-4 text-sm">{l('没有匹配记录。', 'No matching records.')}</p>}</div>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>{l('上一页', 'Previous')}</Button><span className="text-sm">{total} {l('条记录', 'records')} · {Math.floor(offset / 50) + 1}</span><Button variant="secondary" disabled={busy || offset + 50 >= total} onClick={() => setOffset(v => v + 50)}>{l('下一页', 'Next')}</Button></div>
    </>}
  </section>;
}
