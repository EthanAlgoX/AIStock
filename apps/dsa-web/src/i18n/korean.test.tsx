import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { UiLanguageProvider, useUiLanguage } from '../contexts/UiLanguageContext';
import { UiLanguageToggle } from '../components/i18n/UiLanguageToggle';
import { resolveInitialUiLanguage, UI_LANGUAGE_STORAGE_KEY, uiLocale } from '../utils/uiLanguage';
import { UI_TEXT } from './uiText';
import { translateKorean, withUiLanguages } from './localize';
import { getSettingsHelpContent } from '../locales/settingsHelp';
import translations from './ko.json';

function Probe() {
  const { localize, t } = useUiLanguage();
  const [value, setValue] = useState('用户原始策略 / 내 전략');
  return <><p>{localize('验证中心', 'Validation Center')}</p><p>{t('common.selectedCount', { count: 3 })}</p>
    <input aria-label="preserved input" value={value} onChange={(e) => setValue(e.target.value)} />
    <article>历史报告：维持原文，不翻译。</article></>;
}

describe('Korean UI', () => {
  it('defaults to English and preserves an explicit preference', () => {
    expect(resolveInitialUiLanguage({ navigatorLike: { language: 'ko-KR', languages: ['ko-KR', 'en'] } })).toBe('en');
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'en');
    expect(resolveInitialUiLanguage({ storage: localStorage, navigatorLike: { language: 'ko-KR', languages: ['ko-KR'] } })).toBe('en');
    expect(uiLocale('ko')).toBe('ko-KR');
  });
  it('switches all three languages without remounting or rewriting user content', () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh');
    render(<UiLanguageProvider><UiLanguageToggle /><Probe /></UiLanguageProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未保存的编辑' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ko' } });
    expect(document.documentElement.lang).toBe('ko-KR');
    expect(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe('ko');
    expect(screen.getByText('검증 센터')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('未保存的编辑');
    expect(screen.getByText('历史报告：维持原文，不翻译。')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByText('Validation Center')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh' } });
    expect(screen.getByText('验证中心')).toBeInTheDocument();
  });
  it('covers shared catalogue copy and preserves interpolation tokens', () => {
    const catalogue = translations as Record<string, string>;
    for (const source of Object.values(UI_TEXT.zh)) {
      if (/[\u3400-\u9fff]/.test(source)) expect(Object.prototype.hasOwnProperty.call(catalogue, source), source).toBe(true);
    }
    for (const [source, target] of Object.entries(catalogue)) {
      expect(target, source).not.toBe('');
      expect(target.match(/\{(?:\w+|\d+)\}/g)?.sort() || [], source).toEqual(source.match(/\{(?:\w+|\d+)\}/g)?.sort() || []);
    }
  });
  it('localizes registered option labels while preserving API values', () => {
    const result = withUiLanguages({ zh: [{ value: 'buy', label: '买入' }], en: [{ value: 'buy', label: 'Buy' }] });
    expect(result.ko[0]).toEqual({ value: 'buy', label: '매수' });
    expect(translateKorean('用户自定义名字 X9')).toBe('用户自定义名字 X9');
    const help = getSettingsHelpContent('settings.notification.report_output', undefined, 'ko');
    expect(help).not.toBeNull();
    expect(help?.summary).toMatch(/[가-힣]/);
  });
});
