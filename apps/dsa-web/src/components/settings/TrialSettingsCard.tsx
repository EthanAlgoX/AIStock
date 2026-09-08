import { useEffect, useState } from 'react';
import { trialApi, type TrialUser } from '../../api/trial';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { trialError } from '../../utils/trialError';
import { Button, Input } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import { useAuth } from '../../contexts/AuthContext';

export function TrialSettingsCard() {
  const { multiUserEnabled } = useAuth();
  const { localize: l } = useUiLanguage();
  const [users, setUsers] = useState<TrialUser[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([trialApi.users(), trialApi.status()]).then(([rows, status]) => {
      if (active) { setUsers(rows); setEnabled(status.enabled); }
    }).catch(err => { if (active) setError(err); });
    return () => { active = false; };
  }, [refresh]);
  return <SettingsSectionCard title={l('访客与试用额度', 'Visitors & trial access')} description={l('演示无需登录；真实研究采用独立邀请身份，每人终身累计 200,000 Token。', 'Demos need no login. Live research uses separate invited identities with 200,000 lifetime tokens each.')}>
    <div className="space-y-5">
      <p className="text-sm leading-6 text-secondary-text">{multiUserEnabled ? l('独立工作区已开启：受邀用户可在登录页注册或登录，拥有自己的持仓、对话、报告和配置。与访客试用共用同一份额度。', 'Private workspaces are enabled: invitees can register or sign in on the login page, with their own holdings, chats, reports and settings. The allowance is shared with visitor trials.') : l('独立工作区尚未开启。完成部署检查后设置 MULTI_USER_ENABLED=true；邀请码与现有试用账户可以继续使用。', 'Private workspaces are disabled. After deployment checks, set MULTI_USER_ENABLED=true; existing invitations and trial accounts can be reused.')}</p>
      <p className="text-sm leading-6 text-secondary-text">{enabled ? l('真实试用已开启。', 'Live trials are enabled.') : l('真实试用尚未开启。部署时设置 TRIAL_ENABLED=true 后重启服务；默认关闭以避免意外费用。', 'Live trials are disabled. Set TRIAL_ENABLED=true and restart the service to enable them. They are off by default to prevent unexpected costs.')} {l('模型沿用现有 DeepSeek 配置，可用 TRIAL_MODEL 指定；全站每日额度由 TRIAL_DAILY_TOKEN_LIMIT 控制。', 'Uses the existing DeepSeek route, optionally selected by TRIAL_MODEL. TRIAL_DAILY_TOKEN_LIMIT controls the shared daily quota.')}</p>
      <a className="inline-block text-sm text-primary underline" href="/try" target="_blank" rel="noreferrer">{l('打开访客体验页', 'Open the visitor experience')}</a>
      <form className="flex max-w-xl flex-wrap items-end gap-3" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(undefined); setInvitation('');
        try { const result = await trialApi.invite(email); setInvitation(result.inviteCode); setRefresh(v => v + 1); }
        catch (err) { setError(err); }
        finally { setBusy(false); }
      }}>
        <Input label={l('邀请邮箱', 'Invite email')} type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        <Button type="submit" isLoading={busy}>{l('生成邀请码', 'Generate invitation')}</Button>
      </form>
      <p className="text-xs leading-6 text-secondary-text">{l('邀请码 7 天有效，请私下发送给对应用户；系统不自动发邮件，也不验证邮箱归属。已领取的邮箱不会再次获得额度。', 'Invitations expire in 7 days. Share privately with the intended user; no automatic email or email verification is provided. Enrolled emails cannot receive another grant.')}</p>
      {invitation && <Input label={l('本次邀请码（离开后不再显示，请复制保存）', 'Invitation (copy now; not shown again after leaving)')} value={invitation} readOnly onFocus={e => e.target.select()} />}
      {error != null && <p role="alert" className="text-sm text-danger">{trialError(error, l)} <button className="underline" onClick={() => { setError(undefined); setRefresh(v => v + 1); }}>{l('重试', 'Retry')}</button></p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-3 text-left font-medium">{l('受邀用户', 'Invited users')}</caption><thead><tr className="border-b border-border text-secondary-text"><th className="py-3 pr-4">{l('邮箱', 'Email')}</th><th className="pr-4">{l('已用 / 总额', 'Used / total')}</th><th className="pr-4">{l('状态', 'Status')}</th><th>{l('操作', 'Action')}</th></tr></thead><tbody>{users.map(user => <tr key={user.id} className="border-b border-border"><td className="max-w-xs break-all py-4 pr-4">{user.email}</td><td className="whitespace-nowrap pr-4 tabular-nums">{user.used.toLocaleString()} / {user.limit.toLocaleString()}</td><td className="pr-4">{!user.enabled ? l('已停用', 'Suspended') : user.enrolled ? l('已领取', 'Enrolled') : l('待领取', 'Invited')}</td><td><button disabled={busy} className="min-h-11 text-primary disabled:opacity-50" onClick={async () => { setBusy(true); setError(undefined); try { await trialApi.enable(user.id, !user.enabled); setRefresh(v => v + 1); } catch (err) { setError(err); } finally { setBusy(false); } }}>{user.enabled ? l('停用', 'Suspend') : l('恢复', 'Restore')}</button></td></tr>)}</tbody></table>{!users.length && <p className="py-4 text-sm text-secondary-text">{l('尚未邀请试用用户。', 'No trial users invited yet.')}</p>}</div>
    </div>
  </SettingsSectionCard>;
}
