import type React from 'react';
import { Languages } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiLanguage } from '../../i18n/uiText';
import { cn } from '../../utils/cn';

type UiLanguageToggleVariant = 'default' | 'nav' | 'rail';
interface UiLanguageToggleProps {
  variant?: UiLanguageToggleVariant;
  collapsed?: boolean;
  wrapperClassName?: string;
  triggerClassName?: string;
  triggerActiveClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
}

export const UiLanguageToggle: React.FC<UiLanguageToggleProps> = ({
  variant = 'default', collapsed = false, wrapperClassName, triggerClassName,
  triggerActiveClassName, iconClassName, labelClassName,
}) => {
  const { language, setLanguage, t } = useUiLanguage();
  return <div className={cn('relative flex items-center gap-1', variant === 'rail' && 'w-full', wrapperClassName)}>
    {!collapsed && <Languages aria-hidden="true" className={cn('pointer-events-none absolute left-2 h-4 w-4 text-secondary-text', iconClassName)} />}
    <select value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)}
      aria-label={t('language.toggle')} title={t('language.uiLanguage')}
      className={cn('min-h-11 max-w-full rounded-lg border border-border bg-card py-2 pr-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', triggerClassName, triggerActiveClassName, labelClassName, collapsed ? 'pl-2' : 'pl-8')}>

      <option value="en" lang="en">English</option>
      <option value="zh" lang="zh-CN">简体中文</option>
      <option value="zh-TW" lang="zh-TW">繁體中文</option>
      <option value="ja" lang="ja">日本語</option>
      <option value="ko" lang="ko">한국어</option>
    </select>
  </div>;
};
