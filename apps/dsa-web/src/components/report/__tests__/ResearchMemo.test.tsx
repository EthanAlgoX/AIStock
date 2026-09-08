import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResearchMemo } from '../ResearchMemo';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import type { AnalysisReport } from '../../../types/analysis';

const report: AnalysisReport = {
  meta: { queryId: 'sample', stockCode: '000001', stockName: '测试公司', reportType: 'full', createdAt: '2026-09-07T12:00:00Z', currentPrice: 0, changePct: 0 },
  summary: { analysisSummary: '原始研究结论', operationAdvice: '观察', trendPrediction: '整理', sentimentScore: 0 },
  strategy: { idealBuy: '10–11，需量能确认', stopLoss: '9，收盘确认失效' },
  details: { rawResult: { dashboard: { core_conclusion: { one_sentence: '等待经营数据验证' }, signal_attribution: { strongest_bullish_signal: '现金流改善', strongest_bearish_signal: '需求下降' }, intelligence: { risk_alerts: ['库存风险'] }, phase_decision: { data_limitations: ['缺少资金流'], watch_conditions: ['检查下次财报'] } } } },
};

describe('ResearchMemo', () => {
  it('shows recorded arguments, conditions and a valid zero score without invented consensus', () => {
    render(<ResearchMemo report={report} provenance={<p>真实来源记录</p>} />);
    expect(screen.getByRole('heading', { name: '等待经营数据验证' })).toBeVisible();
    for (const text of ['原始研究结论', '现金流改善', '需求下降', '库存风险', '缺少资金流', '检查下次财报', '10–11，需量能确认', '真实来源记录']) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText('0.00')).toBeVisible();
    expect(screen.getByRole('meter', { name: '报告情绪' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText('专家一致看多')).not.toBeInTheDocument();
    for (const link of screen.getByRole('navigation', { name: '报告阅读目录' }).querySelectorAll('a')) {
      expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
    }
  });
  it('preserves unknowns and renders English controls over Chinese historical content', () => {
    localStorage.setItem('dsa.uiLanguage', 'en');
    const { unmount } = render(<UiLanguageProvider><ResearchMemo report={{ ...report, strategy: undefined, details: undefined }} provenance={null} /></UiLanguageProvider>);
    expect(screen.getByText('原始研究结论')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Report contents' })).toBeVisible();
    expect(screen.getByText('No price conditions were recorded; none are inferred.')).toBeVisible();
    expect(screen.getByText(/completeness cannot be inferred/)).toBeVisible();
    unmount();
    localStorage.removeItem('dsa.uiLanguage');
  });
});
