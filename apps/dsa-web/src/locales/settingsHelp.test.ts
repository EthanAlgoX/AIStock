import { describe, expect, it } from 'vitest';

import { getSettingsHelpContent } from './settingsHelp';
import { getFieldDescriptionZh } from '../utils/systemConfigI18n';

const flattenHelp = (help: ReturnType<typeof getSettingsHelpContent>) => [
  help?.summary,
  help?.usage,
  ...(help?.valueNotes ?? []),
  ...(help?.impact ?? []),
  ...(help?.notes ?? []),
].filter(Boolean).join(' ');

describe('JEV decision settings help', () => {
  it.each(['zh', 'en'])('keeps decision credentials separate from report routing in %s', (locale) => {
    const apiKeyHelp = getSettingsHelpContent('settings.ai_model.TYPESAFE_API_KEY', undefined, locale);
    const apiCopy = flattenHelp(apiKeyHelp);
    expect(apiKeyHelp?.title).toBe('JEV API Key');
    expect(apiCopy).toContain(locale === 'zh' ? '不生成研究报告' : 'Does not generate research reports');
    expect(apiCopy).toContain(locale === 'zh' ? '不会自动切换到 LLM' : 'without automatically switching to an LLM');

    const urlCopy = flattenHelp(getSettingsHelpContent('settings.ai_model.TYPESAFE_BASE_URL', undefined, locale));
    expect(urlCopy).toContain('HTTPS');
    expect(urlCopy).toContain('/v1');

    const modelCopy = flattenHelp(getSettingsHelpContent('settings.ai_model.TYPESAFE_MODEL', undefined, locale));
    expect(modelCopy).toContain('jev-latest');
    expect(modelCopy).toContain(locale === 'zh' ? '不会改写已有策略' : 'does not rewrite existing strategies');
  });
});

describe('Skill Outcome auto-weight settings help', () => {
  it('describes the attributable Outcome threshold in Chinese', () => {
    const help = getSettingsHelpContent(
      'settings.agent.AGENT_SKILL_AUTOWEIGHT',
      undefined,
      'zh',
    );
    const visibleCopy = flattenHelp(help);

    expect(visibleCopy).toContain('Outcome');
    expect(visibleCopy).toContain('30');
    expect(visibleCopy).toContain('1.0');
    expect(visibleCopy).toContain('不使用全局回测胜率');
    expect(visibleCopy).not.toContain('依赖回测');
    expect(getFieldDescriptionZh('AGENT_SKILL_AUTOWEIGHT')).toContain('Outcome');
  });

  it('describes the attributable Outcome threshold in English', () => {
    const help = getSettingsHelpContent(
      'settings.agent.AGENT_SKILL_AUTOWEIGHT',
      undefined,
      'en',
    );
    const visibleCopy = flattenHelp(help);

    expect(visibleCopy).toContain('Outcome');
    expect(visibleCopy).toContain('30');
    expect(visibleCopy).toContain('1.0');
    expect(visibleCopy).toContain('Global backtest win rates never substitute');
    expect(visibleCopy).not.toContain('Depends on backtest');
  });

  it('does not present Backtest as the Skill auto-weight data source', () => {
    const zhHelp = flattenHelp(getSettingsHelpContent(
      'settings.backtest.BACKTEST_ENABLED',
      undefined,
      'zh',
    ));
    const enHelp = flattenHelp(getSettingsHelpContent(
      'settings.backtest.BACKTEST_ENABLED',
      undefined,
      'en',
    ));

    expect(zhHelp).toContain('Skill Outcome');
    expect(zhHelp).toContain('不直接');
    expect(enHelp).toContain('Skill Outcome');
    expect(enHelp).toContain('does not directly');
  });
});
