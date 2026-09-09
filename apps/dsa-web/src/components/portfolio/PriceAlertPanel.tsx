import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { alertsApi, type AlertReadiness } from '../../api/alerts';
import { systemConfigApi } from '../../api/systemConfig';
import { getParsedApiError } from '../../api/error';
import type { AlertRuleItem, AlertTriggerItem, AlertNotificationItem } from '../../types/alerts';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

/** An inline extension of the holding ledger: explicit thresholds, channel readiness,
 * and delivery evidence. Inherits neutral/cobalt controls; no new visual identity. */
export default function PriceAlertPanel({ symbol, accountId, cost, currency }: {
  symbol?: string; accountId?: number; cost?: number; currency?: string;
}) {
  const { localize: l, language } = useUiLanguage();
  const [status, setStatus] = useState<AlertReadiness>();
  const [rules, setRules] = useState<AlertRuleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [triggers, setTriggers] = useState<AlertTriggerItem[]>([]);
  const [notifications, setNotifications] = useState<AlertNotificationItem[]>([]);
  const [target, setTarget] = useState(symbol || '');
  const [direction, setDirection] = useState<'above' | 'below'>('below');
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState('24');
  const [channels, setChannels] = useState<string[]>([]);
  const [editing, setEditing] = useState<number>();
  const [boundAccount, setBoundAccount] = useState(accountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    const [readiness, list, history, delivery] = await Promise.all([
      alertsApi.status(), alertsApi.listRules({ target: symbol, page, pageSize: 20 }),
      alertsApi.listTriggers({ target: symbol, pageSize: 10 }),
      symbol ? Promise.resolve({ items: [] }) : alertsApi.listNotifications({ pageSize: 10 }),
    ]);
    if (id !== requestId.current) return;
    setStatus(readiness); setRules(list.items); setTotal(list.total); setTriggers(history.items);
    setNotifications(delivery.items);
  }, [symbol, page]);
  useEffect(() => {
    const refresh = () => { void load().catch(err => setError(getParsedApiError(err).message)); };
    const requests = requestId;
    refresh(); const timer = setInterval(refresh, 15000); return () => { requests.current++; clearInterval(timer); };
  }, [load]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); }
    catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(false); }
  };
  const toggleMonitor = () => act(async () => {
    const config = await systemConfigApi.getConfig();
    await systemConfigApi.update({ configVersion: config.configVersion, items: [{ key: 'AGENT_EVENT_MONITOR_ENABLED', value: status?.enabled ? 'false' : 'true' }] });
  });
  const save = () => act(async () => {
    const payload = {
      target: target.trim(), targetScope: 'single_symbol' as const, alertType: 'price_cross' as const,
      severity: 'warning' as const, parameters: { direction, price: Number(price) }, enabled: true,
      cooldownPolicy: { cooldownSeconds: Number(hours) * 3600 },
      notificationPolicy: { ...(channels.length ? { channels } : {}), report: 'price_brief', language, holdingAccountId: boundAccount },
    };
    if (editing) await alertsApi.updateRule(editing, payload); else await alertsApi.createRule(payload);
    setEditing(undefined); setBoundAccount(accountId); setTarget(symbol || ''); setPrice('');
    setNotice(l('规则已保存。上下限分别设置；后台和渠道就绪后才会发送。', 'Rule saved. Set upper and lower limits separately; delivery requires the monitor and a ready channel.'));
  });
  const edit = (rule: AlertRuleItem) => {
    setBoundAccount(rule.notificationPolicy?.holdingAccountId as number | undefined);
    setEditing(rule.id); setTarget(rule.target); setDirection(rule.parameters.direction === 'above' ? 'above' : 'below');
    setPrice(String(rule.parameters.price)); setHours(String(Number(rule.cooldownPolicy?.cooldownSeconds ?? 86400) / 3600));
    setChannels((rule.notificationPolicy?.channels as string[]) || []);
  };
  const input = 'mt-2 h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm';
  const channelLabel = (channel: string) => ({ email: l('邮件', 'Email'), feishu: l('飞书', 'Feishu'), wechat: l('企业微信', 'WeCom'), dingtalk: l('钉钉', 'DingTalk') }[channel] || channel);
  const ready = status?.enabled && status.worker.running && status.channels.length > 0;
  const eventLabel = (value: string) => ({ triggered: l('已触发', 'Triggered'), skipped: l('已跳过', 'Skipped'), degraded: l('数据不足', 'Degraded'), failed: l('检查失败', 'Failed') }[value] || value);
  const deliveryTarget = (id?: number | null) => {
    const event = triggers.find(t => t.id === id);
    return `${event?.target || l('对应事件不在最近记录中', 'Event outside recent records')} · ${l('事件', 'Trigger')} #${id ?? '—'}`;
  };
  return <section className="my-5 border-y border-border bg-hover/20 p-4 md:p-6" data-design-contract="operate: inline price alert setup; readiness before activation; explicit delivery evidence">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{l('价格告警', 'Price alerts')}{symbol ? ` · ${symbol}` : ''}</h2><p className="mt-2 max-w-[70ch] text-sm leading-6 text-secondary-text">{l('价格达到上限或下限时，通过指定渠道发送事实简报。不调用模型，不自动买卖。', 'When a price reaches an upper or lower limit, send a factual brief through your selected channels. No model calls or automatic trades.')}</p></div><Link className="min-h-11 py-2 text-sm text-primary" to="/settings?tab=notifications">{l('配置通知渠道', 'Configure channels')}</Link></div>
    <div className="my-5 flex flex-wrap items-center gap-3 border-y border-border py-3 text-sm">
      <span className={ready ? 'text-success' : 'text-warning'}>{!status ? l('正在检查后台…', 'Checking monitor…') : ready ? l(`后台检查已开启 · 每 ${status.intervalMinutes} 分钟`, `Monitor on · every ${status.intervalMinutes} min`) : status.owner !== 'web' ? l('当前 Web 无告警后台，请检查服务启动方式', 'No Web alert worker; check server startup') : status.enabled && status.worker.running ? l('后台已运行，通知渠道尚未就绪', 'Monitor running; delivery not ready') : l('后台检查未开启', 'Monitor is off')}</span>
      {status?.owner === 'web' && <button type="button" disabled={busy} onClick={() => void toggleMonitor()} className="btn-secondary">{status.enabled ? l('停用全部告警检查', 'Pause all alert checks') : l('开启后台告警', 'Enable alert monitor')}</button>}
      {status && !status.channels.length && <span className="text-warning">{l('没有可用的告警渠道，请先配置渠道及 alert 路由。', 'No alert channels available. Configure credentials and the alert route first.')}</span>}
      {status?.worker.lastError && <p role="alert" className="text-danger">{status.worker.lastError}</p>}
      {status?.worker.lastCheckedAt && <span className="text-xs text-secondary-text">{l('最近检查', 'Last checked')}: {status.worker.lastCheckedAt}</span>}
    </div>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || !status} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">{l('股票代码', 'Stock code')}<input required readOnly={!!symbol} value={target} onChange={e => setTarget(e.target.value)} placeholder="600519 / HK00700 / AAPL" className={input} /></label>
        <label className="text-sm">{l('触发方向', 'Trigger direction')}<select className={input} value={direction} onChange={e => setDirection(e.target.value as typeof direction)}><option value="below">{l('达到下限（≤）', 'At or below (≤)')}</option><option value="above">{l('达到上限（≥）', 'At or above (≥)')}</option></select></label>
        <label className="text-sm">{l('价格阈值', 'Price threshold')} {currency}<input type="number" required min="0.00000001" step="any" className={input} value={price} onChange={e => setPrice(e.target.value)} /></label>
        <label className="text-sm">{l('通知冷却（小时）', 'Notification cooldown (hours)')}<input type="number" required min="1" max="8760" step="1" className={input} value={hours} onChange={e => setHours(e.target.value)} /></label>
      </fieldset>
      {boundAccount != null && <p className="mt-3 text-xs text-secondary-text">{boundAccount === accountId && cost != null ? `${l('持仓成本', 'Holding cost')}: ${cost} ${currency || ''}. ` : ''}{l(`绑定账户 ${boundAccount}。简报会发送该账户的持仓成本，请仅选择可信渠道。清仓后该规则停止触发。`, `Bound account ${boundAccount}. Briefs include this account’s cost; select trusted channels only. Closed holdings no longer trigger this rule.`)}</p>}
      <fieldset disabled={busy} className="mt-5"><legend className="text-sm font-medium">{l('接收渠道（可多选）', 'Delivery channels (multiple)')}</legend><p className="mt-1 text-xs text-secondary-text">{l('不单独选择时，沿用设置中的全部可用告警渠道。', 'Leave unselected to use all available channels allowed by the alert route.')}</p><div className="mt-3 flex flex-wrap gap-2">{Array.from(new Set([...(status?.channels || []), ...channels])).map(ch => <label key={ch} className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm"><input type="checkbox" checked={channels.includes(ch)} onChange={e => setChannels(e.target.checked ? [...channels, ch] : channels.filter(c => c !== ch))} />{channelLabel(ch)}{!status?.channels.includes(ch) ? l(' · 不可用', ' · unavailable') : ''}</label>)}</div></fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={busy || !status}>{busy ? l('正在处理…', 'Working…') : editing ? l('保存并启用规则', 'Save & enable rule') : l('添加此阈值告警', 'Add threshold alert')}</button>{editing && <button type="button" className="btn-secondary" onClick={() => { setEditing(undefined); setBoundAccount(accountId); setTarget(symbol || ''); setPrice(''); }}>{l('取消编辑', 'Cancel edit')}</button>}<span className="text-xs text-secondary-text">{l('保存不会立即发送测试消息；条件已满足时，下次检查即可触发。', 'Saving sends no test message. If the condition is already met, the next check can trigger it.')}</span></div>
    </form>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}<button className="ml-3 underline" onClick={() => void act(load)}>{l('重试读取', 'Retry loading')}</button></p>}
    {notice && <p role="status" className="mt-4 text-sm text-primary">{notice}</p>}
    <h3 className="mb-2 mt-7 font-medium">{l('已保存规则', 'Saved rules')}</h3>
    {!rules.length && <p className="py-3 text-sm text-secondary-text">{l('还没有规则。先添加下限，再按需添加上限。', 'No rules yet. Add a lower threshold, then an upper threshold if needed.')}</p>}
    <div className="divide-y divide-border">{rules.map(rule => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{rule.target} · {rule.alertType === 'price_cross' ? `${rule.parameters.direction === 'above' ? '≥' : '≤'} ${rule.parameters.price}` : rule.alertType}</p><p className="mt-1 text-xs text-secondary-text">{rule.enabled ? l('规则启用', 'Rule enabled') : l('规则停用', 'Rule disabled')} · {rule.cooldownActive ? l('通知冷却中', 'Delivery cooling down') : l('不在冷却期', 'No active cooldown')}{rule.notificationPolicy?.holdingAccountId ? ` · ${l('账户', 'Account')} ${rule.notificationPolicy.holdingAccountId}` : ''}</p></div><div className="flex flex-wrap gap-3">{rule.alertType === 'price_cross' && <button disabled={busy} className="min-h-11 text-primary" onClick={() => edit(rule)}>{l('编辑', 'Edit')}</button>}<button disabled={busy} className="min-h-11 text-primary" onClick={() => void act(() => rule.enabled ? alertsApi.disableRule(rule.id) : alertsApi.enableRule(rule.id))}>{rule.enabled ? l('停用', 'Disable') : l('启用', 'Enable')}</button><button disabled={busy} className="min-h-11 text-primary" onClick={() => void act(async () => { const result = await alertsApi.testRule(rule.id); setNotice(`${l('仅检查，不发送', 'Check only, no delivery')}: ${result.message}`); })}>{l('检查条件', 'Check condition')}</button></div></div>)}</div>
    {total > 20 && <div className="mt-3 flex items-center gap-3 text-sm"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{l('上一页', 'Previous')}</button><span>{page} / {Math.ceil(total / 20)}</span><button className="btn-secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>{l('下一页', 'Next')}</button></div>}
    <details className="mt-5 border-t border-border pt-3">
      <summary className="cursor-pointer py-2 text-sm font-medium">{l('最近检查与发送记录', 'Recent checks & delivery records')}</summary>
      <p className="my-2 text-xs text-secondary-text">{l('触发与发送成功是两回事；这里显示最近 10 条。', 'Triggered does not mean delivered. Showing the latest 10 records.')}</p>
      {!triggers.length && <p className="py-3 text-sm text-secondary-text">{l('暂无触发或异常记录', 'No triggers or exceptions yet')}</p>}
      {triggers.map(t => <p key={t.id} className="border-t border-border py-3 text-sm">{t.target} · {eventLabel(t.status)} · {t.observedValue ?? '—'} / {t.threshold ?? '—'}<span className="mt-1 block break-words text-xs text-secondary-text">{l('事件', 'Trigger')} #{t.id} · {t.triggeredAt} · {t.reason}</span></p>)}
      {!symbol && !notifications.length && <p className="py-3 text-sm text-secondary-text">{l('暂无通知投递记录', 'No delivery attempts yet')}</p>}
      {notifications.map(n => <div key={n.id} className="border-t border-border py-3 text-sm"><p>{deliveryTarget(n.triggerId)}</p><p className="mt-1">{channelLabel(n.channel)} · {n.success ? l('已发送', 'Delivered') : l('未发送', 'Not delivered')} · {n.errorCode || '—'}</p><p className="mt-1 text-xs text-secondary-text">{n.createdAt}</p></div>)}
      {symbol && <Link to="/alerts" className="inline-block min-h-11 py-3 text-sm text-primary">{l('查看告警中心与投递结果', 'Open alert center & delivery results')}</Link>}
    </details>
  </section>;
}
