import type React from 'react';
import { useState } from 'react';
import type { ParsedApiError } from '../../api/error';
import { isParsedApiError } from '../../api/error';
import { useAuth } from '../../hooks';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { Button, Input } from '../common';
import { SettingsAlert } from './SettingsAlert';
import { SettingsSectionCard } from './SettingsSectionCard';

export const ChangePasswordCard: React.FC = () => {
  const { changePassword, accountMode, role } = useAuth();
  const { t, localize: l } = useUiLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | ParsedApiError | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword.trim()) {
      setError(t('settings.changePasswordRequiredCurrent'));
      return;
    }
    if (!newPassword.trim()) {
      setError(t('settings.changePasswordRequiredNew'));
      return;
    }
    if (newPassword.length < (accountMode ? 8 : 6) || (accountMode && newPassword.length > 128)) {
      setError(accountMode ? l('密码长度须为 8–128 位。', 'Password must contain 8–128 characters.') : t('settings.changePasswordShort'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(t('login.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await changePassword(currentPassword, newPassword, newPasswordConfirm);
      if (result.success) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setNewPasswordConfirm('');
        setTimeout(() => setSuccess(false), 4000);
      } else {
        setError(result.error ?? t('settings.changePasswordFailure'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SettingsSectionCard
      title={t('settings.changePasswordTitle')}
      description={role === 'member' ? l('更新你的账户密码，保存后需要重新登录。', 'Update your account password. Sign in again after saving.') : t('settings.changePasswordDescription')}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Input
              id="change-pass-current"
              type="password"
              allowTogglePassword
              iconType="password"
              label={t('settings.changePasswordCurrent')}
              placeholder={t('settings.changePasswordCurrentPlaceholder')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-3">
            <Input
              id="change-pass-new"
              type="password"
              allowTogglePassword
              iconType="password"
              label={t('settings.changePasswordNew')}
              hint={accountMode ? l('8–128 位；修改后其他会话将失效。', '8–128 characters; other sessions will be signed out.') : t('settings.changePasswordNewHint')}
              placeholder={t('settings.changePasswordNewPlaceholder')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="space-y-3 md:max-w-md">
          <Input
            id="change-pass-confirm"
            type="password"
            allowTogglePassword
            iconType="password"
            label={t('settings.changePasswordConfirm')}
            placeholder={t('settings.changePasswordConfirmPlaceholder')}
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            disabled={isSubmitting}
            autoComplete="new-password"
          />
        </div>

        {error
          ? isParsedApiError(error)
            ? <SettingsAlert title={t('settings.changePasswordFailure')} message={error.message} variant="error" className="!mt-3" />
            : <SettingsAlert title={t('settings.changePasswordFailure')} message={error} variant="error" className="!mt-3" />
          : null}
        {success ? (
          <SettingsAlert title={t('settings.changePasswordSuccess')} message={t('settings.changePasswordSuccessMessage')} variant="success" />
        ) : null}

        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          {t('settings.changePasswordSave')}
        </Button>
      </form>
    </SettingsSectionCard>
  );
};
