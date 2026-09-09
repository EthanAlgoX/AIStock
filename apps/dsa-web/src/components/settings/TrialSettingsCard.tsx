import { useEffect, useState } from 'react';
import { UserActivityPanel } from './UserActivityPanel';
import { trialApi, type InvitationUsage } from '../../api/trial';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { trialError } from '../../utils/trialError';
import { Button, Input } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import { useAuth } from '../../contexts/AuthContext';

export function TrialSettingsCard() {
  const { multiUserEnabled } = useAuth();
  const { localize: l } = useUiLanguage();
  const [users, setUsers] = useState<InvitationUsage[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(200000);
  const [count, setCount] = useState('1');
  const [invitationIds, setInvitationIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [invitations, setInvitations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => Promise.all([trialApi.invitations(), trialApi.status()]).then(([rows, status]) => {
      if (active) { setUsers(rows); setEnabled(status.enabled); setLoaded(true); setError(undefined); }
    }).catch(err => { if (active) setError(err); });
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);
  return <SettingsSectionCard title={l('访客与试用额度', 'Visitors & trial access')} description={l('查看每个邀请码的每日消耗，随时调整每日上限。', 'Monitor daily token use per invitation and adjust daily limits at any time.')}>
    <div className="space-y-5">
      <p className="text-sm leading-6 text-secondary-text">{multiUserEnabled ? l('独立工作区已开启：受邀用户可在登录页注册或登录，拥有自己的持仓、对话、报告和配置。与访客试用共用同一份额度。', 'Private workspaces are enabled: invitees can register or sign in on the login page, with their own holdings, chats, reports and settings. The allowance is shared with visitor trials.') : l('独立工作区尚未开启。完成部署检查后设置 MULTI_USER_ENABLED=true；邀请码与现有试用账户可以继续使用。', 'Private workspaces are disabled. After deployment checks, set MULTI_USER_ENABLED=true; existing invitations and trial accounts can be reused.')}</p>
      <p className="text-sm leading-6 text-secondary-text">{enabled ? l('真实试用已开启。', 'Live trials are enabled.') : l('真实试用尚未开启。部署时设置 TRIAL_ENABLED=true 后重启服务；默认关闭以避免意外费用。', 'Live trials are disabled. Set TRIAL_ENABLED=true and restart the service to enable them. They are off by default to prevent unexpected costs.')} {l('模型沿用现有 DeepSeek 配置，可用 TRIAL_MODEL 指定；全站每日额度由 TRIAL_DAILY_TOKEN_LIMIT 控制。', 'Uses the existing DeepSeek route, optionally selected by TRIAL_MODEL. TRIAL_DAILY_TOKEN_LIMIT controls the shared daily quota.')}</p>
      <a className="inline-block text-sm text-primary underline" href="/try" target="_blank" rel="noreferrer">{l('打开访客体验页', 'Open the visitor experience')}</a>
      <form className="flex max-w-xl flex-wrap items-end gap-3" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(undefined); setInvitations([]); setInvitationIds([]);
        try { const result = await trialApi.invite(Number(count), dailyLimit); setInvitations(result.inviteCodes); setInvitationIds(result.invitationIds ?? []); setRefresh(v => v + 1); }
        catch (err) { setError(err); }
        finally { setBusy(false); }
      }}>
        <Input label={l('邀请码数量', 'Number of invitations')} type="number" required min={1} max={20} value={count} onChange={e => setCount(e.target.value)} disabled={busy} />
        <Input label={l('初始每日上限（Token）', 'Initial daily limit (tokens)')} type="number" required min={0} max={10000000} step={10000} value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} disabled={busy} />
        <Button type="submit" isLoading={busy}>{l('生成邀请码', 'Generate invitation')}</Button>
      </form>
      <p className="text-xs leading-6 text-secondary-text">{l('每个邀请码 7 天有效且只能领取一次。请分别私下发送；领取人注册时自行填写邮箱，系统不发送验证邮件。', 'Each invitation expires after 7 days and can be claimed once. Share codes privately; recipients choose their email during registration. No verification email is sent.')}</p>
      {invitations.length > 0 && <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="generated-invitations">{l('本次邀请码（离开后不再显示，请复制保存）', 'Invitations (copy now; not shown again after leaving)')}</label>
        <textarea id="generated-invitations" className="min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" value={invitations.join('\n')} readOnly onFocus={e => e.currentTarget.select()} />
        {invitationIds.length > 0 && <ol className="mt-2 list-inside list-decimal text-xs text-secondary-text">{invitationIds.map(id => <li key={id}>{l('对应邀请码编号', 'Corresponding invitation ID')}: {id}</li>)}</ol>}
      </div>}
      {error != null && <p role="alert" className="text-sm text-danger">{trialError(error, l)} <button className="underline" onClick={() => { setError(undefined); setRefresh(v => v + 1); }}>{l('重试', 'Retry')}</button></p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div><h3 className="font-medium">{l('邀请码用量与每日上限', 'Invitation usage & daily limits')}</h3><p className="mt-1 text-xs text-secondary-text">{l('UTC 每日 00:00 重置（北京时间 08:00）；每 30 秒刷新。用量包含尚未结算的预留 Token。', 'Resets at 00:00 UTC (08:00 Beijing); refreshes every 30 seconds. Usage includes unsettled token reservations.')}</p></div>
        <Button variant="secondary" onClick={() => setRefresh(v => v + 1)}>{l('刷新用量', 'Refresh usage')}</Button>
      </div>
      <div className="divide-y divide-border">{users.map(user => <InvitationQuota key={user.id} invitation={user} onSaved={() => setRefresh(v => v + 1)} />)}</div>
      {!loaded && error == null && <p role="status" className="py-4 text-sm text-secondary-text">{l('正在加载用量…', 'Loading usage…')}</p>}
      {loaded && !users.length && <p className="py-4 text-sm text-secondary-text">{l('还没有邀请码。生成后即可设置额度，领取后显示每日消耗。', 'No invitations yet. Generate a code to set its limit; daily usage appears after registration.')}</p>}

      <UserActivityPanel users={users} />
    </div>
  </SettingsSectionCard>;
}

function InvitationQuota({ invitation: row, onSaved }: { invitation: InvitationUsage; onSaved: () => void }) {
  const { localize: l } = useUiLanguage();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const value = draft ?? String(row.dailyLimit);
  const limit = Number(value);
  const valid = value !== '' && Number.isInteger(limit) && limit >= 0 && limit <= 10000000;
  const name = row.email || row.id.slice(0, 8);
  const edit = (next: string) => { setDraft(next); setSaved(false); };
  return <article className="py-5">
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="min-w-0">
        <h4 className="break-all font-medium">{name}</h4>
        <p className="mt-1 text-xs text-secondary-text">{l('邀请码编号', 'Invitation ID')} {row.id} · {row.state === 'pending' ? l('待领取', 'Unclaimed') : row.state === 'expired' ? l('已过期', 'Expired') : row.enabled ? l('使用中', 'Active') : l('已停用', 'Suspended')}</p>
        <p className="mt-4 text-sm tabular-nums">{l('今日已用', 'Used today')} <strong>{row.used.toLocaleString()}</strong> / {row.dailyLimit.toLocaleString()} Token</p>
        <progress className="mt-2 h-2 w-full accent-primary" aria-label={l('今日额度使用进度', 'Daily quota usage')} max={Math.max(1, row.dailyLimit)} value={Math.min(row.used, Math.max(1, row.dailyLimit))} />
        <p className="mt-2 text-xs text-secondary-text">{l('累计消耗', 'Lifetime usage')} {row.lifetimeUsed.toLocaleString()} Token{row.used >= row.dailyLimit && <> · {l('已达每日上限', 'Daily limit reached')}</>}</p>
      </div>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault(); if (!valid) return; setBusy(true); setError(undefined); setSaved(false);
        try { await trialApi.setDailyLimit(row.id, limit); setSaved(true); onSaved(); }
        catch (err) { setError(err); } finally { setBusy(false); }
      }}>
        <label htmlFor={'quota-' + row.id} className="block text-sm font-medium">{l('每日上限', 'Daily limit')} · {name}</label>
        <input id={'quota-' + row.id} className="min-h-11 w-full accent-primary" type="range" min={0} max={10000000} step={10000} value={valid ? limit : row.dailyLimit} disabled={busy} onChange={e => edit(e.target.value)} />
        <div className="flex flex-wrap items-end gap-3">
          <Input label={l('精确上限（Token）', 'Exact limit (tokens)')} type="number" required min={0} max={10000000} step={1} value={value} disabled={busy} onChange={e => edit(e.target.value)} />
          <Button type="submit" disabled={!valid || limit === row.dailyLimit} isLoading={busy}>{l('保存上限', 'Save limit')}</Button>
          {row.userId && <Button variant="secondary" disabled={busy} onClick={async () => {
            setBusy(true); setError(undefined);
            try { await trialApi.enable(row.userId!, !row.enabled); onSaved(); }
            catch (err) { setError(err); } finally { setBusy(false); }
          }}>{row.enabled ? l('停用', 'Suspend') : l('恢复', 'Restore')}</Button>}
        </div>
        <p className="text-xs leading-5 text-secondary-text">{l('范围 0–1,000 万。保存后对下一次调用生效；调低不扣回已用额度，0 暂停新调用。', 'Range: 0–10 million. Saved limits apply to the next call. Lowering preserves prior usage; 0 blocks new calls.')}</p>
        {saved && <p role="status" className="text-sm">{l('每日上限已保存。', 'Daily limit saved.')}</p>}
        {error != null && <p role="alert" className="text-sm text-danger">{trialError(error, l)}</p>}
      </form>
    </div>
    <details className="mt-4 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 text-primary">{l('近 7 天每日消耗', 'Daily usage · last 7 days')}</summary>
      <table className="w-full text-left tabular-nums"><thead><tr className="border-b border-border text-secondary-text"><th className="py-2">{l('日期（UTC）', 'Date (UTC)')}</th><th>Token</th><th>{l('待核实调用', 'Unverified calls')}</th></tr></thead><tbody>{row.history.map(day => <tr key={day.date} className="border-b border-border"><td className="py-2">{day.date}</td><td>{day.used.toLocaleString()}</td><td>{day.estimatedCalls}</td></tr>)}</tbody></table>
    </details>
  </article>;
}
