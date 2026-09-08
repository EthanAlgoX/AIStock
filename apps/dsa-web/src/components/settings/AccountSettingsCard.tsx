import { useState } from 'react';
import { authApi } from '../../api/auth';
import { useAuth } from '../../hooks';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { Input, Button } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import { accountErrorMessage } from '../../utils/accountError';

export function AccountSettingsCard() {
  const { email, refreshStatus } = useAuth();
  const { localize: l } = useUiLanguage();
  const [nextEmail, setNextEmail] = useState(email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  return <SettingsSectionCard title={l('管理员账户', 'Administrator account')} description={l('一个实例只有一个管理员。邮箱仅用于登录，未进行邮件验证。', 'This instance has one administrator. Email is a login identifier and is not email-verified.')}>
    <form className="max-w-lg space-y-4" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(undefined); setSaved(false);
      try { await authApi.changeEmail(nextEmail, password); setPassword(''); setSaved(true); await refreshStatus(); }
      catch (err) { setError(err); }
      finally { setBusy(false); }
    }}>
      <Input label={l('登录邮箱', 'Login email')} type="email" autoComplete="username" required maxLength={254} value={nextEmail} onChange={e => setNextEmail(e.target.value)} disabled={busy} />
      <Input label={l('当前密码', 'Current password')} type="password" autoComplete="current-password" required allowTogglePassword value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      <p className="text-sm text-secondary-text">{l('修改邮箱需要验证当前密码，并使其他会话失效。登录保护不能通过网页关闭。', 'Changing email requires your current password and signs out other sessions. Login protection cannot be disabled from the web.')}</p>
      {error != null && <p role="alert" className="text-sm text-danger">{accountErrorMessage(error, l)}</p>}
      {saved && <p role="status" className="text-sm text-success">{l('邮箱已更新。', 'Email updated.')}</p>}
      <Button type="submit" isLoading={busy} disabled={nextEmail.trim().toLowerCase() === email}>{l('保存邮箱', 'Save email')}</Button>
    </form>
  </SettingsSectionCard>;
}
