import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import JevResearchResult from './JevResearchResult';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import type { PortfolioDecision } from '../../api/portfolioResearch';

beforeEach(() => localStorage.setItem('dsa.uiLanguage', 'en'));
it.each([['holding', 'buy', 'Buy'], ['watch', 'bullish', 'Bullish']] as const)('renders %s classification directly without a report link', (scope, category, label) => {
  const decision: PortfolioDecision = { backend: 'jev', symbol: 'AAPL', category, confidence: 0.73,
    probabilities: {}, model: 'jev-test', asOf: '2026-09-21', source: 'fixture', scope };
  render(<UiLanguageProvider><JevResearchResult decision={decision} /></UiLanguageProvider>);
  expect(screen.getByText(`JEV · ${label}`)).toBeVisible();
  expect(screen.getByText('73.0%')).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('does not turn missing classification into a neutral decision', () => {
  render(<UiLanguageProvider><JevResearchResult /></UiLanguageProvider>);
  expect(screen.getByText(/No JEV classification yet/)).toBeVisible();
  expect(screen.queryByText(/0.0%/)).not.toBeInTheDocument();
});
