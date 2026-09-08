import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResearchVisuals } from '../ResearchVisuals';
import type { AnalysisReport } from '../../../types/analysis';

describe('ResearchVisuals', () => {
  it.each(['snake', 'camel'])('plots stored %s numeric values without extracting prose prices', variant => {
    const snake = variant === 'snake';
    const report = {
      meta: { queryId: 'visual', stockCode: 'TEST', stockName: 'Test', reportType: 'full', createdAt: '', currentPrice: 101 }, summary: { analysisSummary: '', operationAdvice: '', trendPrediction: '', sentimentScore: 52 },
      strategy: { stopLoss: '88, only after confirmation' },
      details: { rawResult: { dashboard: { [snake ? 'data_perspective' : 'dataPerspective']: {
        [snake ? 'price_position' : 'pricePosition']: { ma5: 99, [snake ? 'support_level' : 'supportLevel']: 98 },
        [snake ? 'trend_status' : 'trendStatus']: { [snake ? 'trend_score' : 'trendScore']: 55 },
      } } } },
    } as AnalysisReport;
    render(<ResearchVisuals report={report} />);
    expect(screen.getByText('101')).toBeVisible();
    expect(screen.getByText('99')).toBeVisible();
    expect(screen.getByText('98')).toBeVisible();
    expect(screen.queryByText('88')).not.toBeInTheDocument();
    expect(screen.getByRole('meter', { name: '趋势评分' })).toHaveAttribute('aria-valuenow', '55');
  });
  it('does not plot missing levels or convert invalid scores to zero', () => {
    render(<ResearchVisuals report={{ meta: {}, summary: { sentimentScore: 150 } } as AnalysisReport} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText(/可用的数值点位不足/)).toBeVisible();
  });
  it('preserves score endpoints and renders coincident prices without invalid coordinates', () => {
    const { container } = render(<ResearchVisuals report={{
      meta: { currentPrice: 100 }, summary: { sentimentScore: 0 },
      details: { rawResult: { dashboard: { data_perspective: {
        price_position: { ma5: 100, ma10: 100, ma20: -1, support_level: '90', resistance_level: Number.NaN },
        trend_status: { trend_score: 100 },
      } } } },
    } as unknown as AnalysisReport} />);
    expect(screen.getByRole('meter', { name: '报告情绪' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('meter', { name: '趋势评分' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByText('MA20')).not.toBeInTheDocument();
    expect(screen.queryByText('支撑位')).not.toBeInTheDocument();
    const dots = [...container.querySelectorAll('figure circle')];
    expect(dots).toHaveLength(3);
    expect(new Set(dots.map(dot => dot.getAttribute('cy'))).size).toBe(1);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
