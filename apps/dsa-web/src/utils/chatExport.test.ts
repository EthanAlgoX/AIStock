import { describe, expect, it } from 'vitest';
import { formatSessionAsMarkdown } from './chatExport';
import { formatDateTime } from './format';
import { uiLocale } from './uiLanguage';
import { translateSource } from '../i18n/localize';
import type { UiLanguage } from '../i18n/uiText';

describe('Localized export and date formatting', () => {
  it.each<UiLanguage>(['zh', 'en', 'zh-TW', 'ja', 'ko'])('localizes export metadata but preserves messages in %s', language => {
    const output = formatSessionAsMarkdown([{id: '1', role: 'user', content: '请研究 AAPL'}], language);
    expect(output).toContain(`# ${translateSource('问股会话', language)}`);
    expect(output).toContain(`## ${translateSource('用户', language)}`);
    expect(output).toContain('请研究 AAPL');
    const date = '2026-09-20T10:20:00Z';
    expect(formatDateTime(date, language)).toBe(new Intl.DateTimeFormat(uiLocale(language), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(date)));
  });
});
