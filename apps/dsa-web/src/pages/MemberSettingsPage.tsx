import { useEffect, useState } from 'react';
import apiClient from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { AppPage, PageHeader, Button } from '../components/common';
import { ChangePasswordCard } from '../components/settings/ChangePasswordCard';
import { SettingsSectionCard } from '../components/settings/SettingsSectionCard';
import { accountErrorMessage } from '../utils/accountError';

export default function MemberSettingsPage() {
  const { email, quota, refreshStatus } = useAuth();
  const { localize: l, language } = useUiLanguage();
  useEffect(() => { document.title = l('我的账户', 'My account') + ' - AI Stock'; }, [l]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    apiClient.get('/api/v1/workspace/notification-settings').then(({ data }) => {
      if (active) setEnabled(Boolean(data.enabled));
    }).catch(err => { if (active) setError(err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const number = (value: number) => new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US').format(value);
  return <AppPage className="max-w-4xl">
    <PageHeader title={l('我的账户', 'My account')} description={l('管理你的私有投研工作区。平台密钥和服务器设置由管理员维护。', 'Manage your private research workspace. Platform credentials and server settings are managed by the administrator.')} />
    <div className="mt-7 space-y-6">
      <SettingsSectionCard title={l('私有工作区', 'Private workspace')} description={l('持仓、对话、专家配置和研究报告不会与其他账户共享。', 'Holdings, chats, expert settings and research reports are not shared with other accounts.')}>
        <p className="break-all text-sm">{email}</p>
        <p className="mt-3 text-sm leading-6 text-secondary-text">{l('需要修改邮箱或恢复账户时，请联系部署管理员。', 'Contact the deployment administrator to change your email or recover your account.')}</p>
      </SettingsSectionCard>
      <SettingsSectionCard title={l('试用额度', 'Trial allowance')} description={l('累计 20 万输入与输出 Token。所有专家与主持总结共享额度，不按天重置。', '200,000 lifetime input and output tokens. All experts and moderator summaries share this allowance; it does not reset daily.')}>
        {quota ? <p className="text-sm tabular-nums">{l('已用', 'Used')} {number(quota.used)} / {number(quota.limit)} · {l('剩余', 'Remaining')} {number(quota.remaining)}</p> : <p className="text-sm text-secondary-text">{l('暂未获取额度。', 'Allowance is not available yet.')}</p>}
        <Button variant="secondary" className="mt-4" onClick={() => void refreshStatus()}>{l('刷新额度', 'Refresh allowance')}</Button>
      </SettingsSectionCard>
      <SettingsSectionCard title={l('个人通知', 'Personal notifications')} description={l('邮件只发送到你的受邀邮箱，不使用管理员或其他用户的收件地址。需要平台已配置发件服务。', 'Emails go only to your invited email, never to the administrator or another user. The platform must have an email delivery service configured.')}>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={enabled} disabled={loading || saving} onChange={event => { setEnabled(event.target.checked); setSaved(false); }} />
          <span>{l('接收我的研究与持仓告警邮件', 'Receive my research and portfolio alert emails')}</span>
        </label>
        {error != null && <p role="alert" className="mt-3 text-sm text-danger">{accountErrorMessage(error, l)} <button className="underline" onClick={() => { setError(undefined); setLoading(true); setRevision(value => value + 1); }}>{l('重试', 'Retry')}</button></p>}
        {saved && <p role="status" className="mt-3 text-sm text-secondary-text">{l('通知偏好已保存。', 'Notification preference saved.')}</p>}
        <Button className="mt-4" disabled={loading || error != null} isLoading={saving} onClick={async () => {
          setSaving(true); setError(undefined); setSaved(false);
          try { await apiClient.put('/api/v1/workspace/notification-settings', { enabled }); setSaved(true); }
          catch (err) { setError(err); }
          finally { setSaving(false); }
        }}>{l('保存通知偏好', 'Save notification preference')}</Button>
      </SettingsSectionCard>
      <ChangePasswordCard />
    </div>
  </AppPage>;
}
