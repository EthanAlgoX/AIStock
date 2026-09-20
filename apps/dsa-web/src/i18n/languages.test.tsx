import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UiLanguageProvider } from '../contexts/UiLanguageContext';
import { UiLanguageToggle } from '../components/i18n/UiLanguageToggle';
import { UiLiteral } from '../components/i18n/UiLiteral';
import { resolveInitialUiLanguage, UI_LANGUAGE_STORAGE_KEY } from '../utils/uiLanguage';
import { translateSource, withUiLanguages } from './localize';
import en from './en.json';
import ja from './ja.json';
import traditional from './zh-TW.json';
import ko from './ko.json';

describe('Five-language interface', () => {
  it('defaults to English on a first visit, regardless of browser locale', () => {
    localStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
    for (const language of ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US']) {
      expect(resolveInitialUiLanguage({ storage: localStorage, navigatorLike: { language, languages: [language] } })).toBe('en');
    }
    render(<UiLanguageProvider><UiLanguageToggle /><UiLiteral text="创建策略" /></UiLanguageProvider>);
    expect(screen.getByRole('combobox')).toHaveValue('en');
    expect(screen.getByText(translateSource('创建策略', 'en'))).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en-US');
  });
  it('switches and persists all five locales without changing source content', () => {
    render(<UiLanguageProvider><UiLanguageToggle /><article>用户报告原文</article></UiLanguageProvider>);
    expect(screen.getAllByRole('option')).toHaveLength(5);
    for (const [language, htmlLang] of [['en', 'en-US'], ['zh', 'zh-CN'], ['zh-TW', 'zh-TW'], ['ja', 'ja-JP'], ['ko', 'ko-KR']]) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: language } });
      expect(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe(language);
      expect(resolveInitialUiLanguage({ storage: localStorage })).toBe(language);
      expect(document.documentElement.lang).toBe(htmlLang);
      expect(screen.getByText('用户报告原文')).toBeInTheDocument();
    }
  });
  it('translates legacy labels with leading or trailing whitespace', () => {
    for (const [language, catalogue] of Object.entries({ en, ja, 'zh-TW': traditional, ko })) {
      for (const source of [' · 不可用', '市场阶段: ', '交易策略保存失败，请检查能力配置。 ']) {
        const target = (catalogue as Record<string, string>)[source];
        expect(translateSource(source, language)).toBe(target);
        expect(translateSource(source.trim(), language)).toBe(target.trim());
      }
    }
    for (const [language, catalogue] of Object.entries({ en, ja, 'zh-TW': traditional, ko })) {
      expect(translateSource(' · 已选 3 项', language)).toBe(' ' + catalogue[' · 已选 {0} 项'].trim().replace('{0}', '3'));
    }
    expect(translateSource('  用户自定义 X9  ', 'ko')).toBe('  用户自定义 X9  ');
  });
  it('covers registered source strings and preserves placeholder contracts', () => {
    const catalogues = [en, ja, traditional, ko] as Record<string, string>[];
    const sources = new Set(catalogues.flatMap(catalogue => Object.keys(catalogue)));
    for (const catalogue of catalogues) {
      for (const source of sources) {
        expect(Object.prototype.hasOwnProperty.call(catalogue, source), source).toBe(true);
        expect(catalogue[source]?.trim(), source).toBeTruthy();
        expect(catalogue[source]?.match(/\{(?:\w+|\d+)\}/g)?.sort() || [], source).toEqual(source.match(/\{(?:\w+|\d+)\}/g)?.sort() || []);
      }
    }
    const options = withUiLanguages({ zh: [{ value: 'buy', label: '买入' }], en: [{ value: 'buy', label: 'Buy' }] });
    expect(options.ja[0].value).toBe('buy');
    expect(options['zh-TW'][0].label).toBe('買入');
    expect(translateSource('用户自定义 X9', 'ja')).toBe('用户自定义 X9');
  });
});
