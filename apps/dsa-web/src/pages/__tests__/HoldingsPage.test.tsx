import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoldingsPage from '../HoldingsPage';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import type { HoldingsDashboard } from '../../api/portfolioResearch';

const api = vi.hoisted(() => ({ dashboard: vi.fn(), run: vi.fn() }));
vi.mock('../../api/portfolioResearch', () => ({ portfolioResearchApi: api }));
vi.mock('../../components/portfolio/HoldingPlanEditor', () => ({ default: () => <div>Plan editor</div> }));
vi.mock('../../components/portfolio/HoldingEntryForm', () => ({ default: () => <div>Entry form</div> }));
const data: HoldingsDashboard = { asOf: '2026-09-08', rules: { lossPct: 10, profitPct: 20, dailyMovePct: 5 }, watches: [],
  items: [{
  accountId: 1, accountName: 'Test account', stockName: 'Apple Inc.', taskId: 'task', supported: true, alerts: ['loss_review'], schedule: null,
  position: { symbol: 'AAPL', market: 'us', currency: 'USD', quantity: 10, avg_cost: 100, last_price: 89, unrealized_pnl_pct: -11, price_available: true, price_stale: false, price_date: '2026-09-08', price_source: 'history_close' },
  run: { id: 'run', status: 'completed', createdAt: '2026-09-08T08:00:00Z', error: null, currentSession: true },
  brief: { name: 'Apple', summary: 'Review the trend before reducing exposure.', action: 'hold', advice: 'Observe', trend: 'Sideways', changePct: -4, strategy: null },
}] };
const mount = () => render(<UiLanguageProvider><MemoryRouter><HoldingsPage /></MemoryRouter></UiLanguageProvider>);

describe('holdings research desk', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en'); api.dashboard.mockResolvedValue(data); api.run.mockResolvedValue({ id: 'new' }); });
  it('leads with short research and keeps settings closed, with English-only chrome', async () => {
    const view = mount();
    await screen.findByText('Review the trend before reducing exposure.');
    expect(screen.getByText('Loss threshold · review reduction')).toBeVisible();
    expect(screen.queryByText('Plan editor')).not.toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
    fireEvent.click(screen.getByRole('button', { name: 'Tracking schedule & strategy' }));
    expect(screen.getByText('Plan editor')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Full research & progress' })).toHaveAttribute('href', '/stock-research?run=run');
    expect(screen.getByRole('heading', { name: 'Apple Inc.' })).toBeVisible();
    expect(screen.getByText('AAPL · US · USD')).toBeVisible();
  });
  it('restores background state after mounting and prevents duplicate submission', async () => {
    api.dashboard.mockResolvedValue({ ...data, items: [{ ...data.items[0], run: { ...data.items[0].run, status: 'running' }, brief: null }] });
    mount();
    expect(await screen.findByRole('button', { name: 'Researching' })).toBeDisabled();
    expect(screen.getByText(/Fetching evidence and researching in the background/)).toBeVisible();
    expect(api.run).not.toHaveBeenCalled();
  });
  it('offers filter recovery rather than onboarding when holdings already exist', async () => {
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search holdings' }), {target: {value: 'missing-stock'}});
    expect(screen.getByText('No matching holdings')).toBeVisible();
    expect(screen.queryByText('Start with what you own')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Clear filters'}));
    expect(screen.getByText('Apple Inc.')).toBeVisible();
    expect(api.run).not.toHaveBeenCalled();
  });
  it('filters holdings by the displayed name as well as report name', async () => {
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search holdings' }), { target: { value: '  Apple Inc.  ' } });
    expect(screen.getByRole('heading', { name: 'Apple Inc.' })).toBeVisible();
  });
  it('separates watch filters from holding filters and restores each selection', async () => {
    api.dashboard.mockResolvedValue({ ...data, watches: [{ symbol: '600000', market: 'cn', stockName: 'Example bank', taskId: 'watch', supported: true, schedule: null, run: null, brief: null }] });
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search holdings' }), { target: { value: 'Apple' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter holdings' }), { target: { value: 'us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Watch stock briefs 1' }));
    expect(screen.getByRole('heading', { name: 'Example bank' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Apple Inc.' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter watch stocks' }), { target: { value: 'us' } });
    expect(screen.getByText('No matching watch stocks')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Example bank' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Holding briefs 1' }));
    expect(screen.getByRole('searchbox', { name: 'Search holdings' })).toHaveValue('Apple');
    expect(screen.getByRole('combobox', { name: 'Filter holdings' })).toHaveValue('us');
    expect(screen.getByRole('heading', { name: 'Apple Inc.' })).toBeVisible();
    expect(api.run).not.toHaveBeenCalled();
  });
  it('polls promptly while only a watch stock is running', async () => {
    vi.useFakeTimers();
    try {
      api.dashboard.mockResolvedValue({ ...data, items: [], watches: [{ symbol: 'AAPL', market: 'us', stockName: 'Apple', taskId: 'watch', supported: true, schedule: null, run: { ...data.items[0].run!, status: 'running' }, brief: null }] });
      mount();
      await act(async () => { await Promise.resolve(); });
      expect(api.dashboard).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.dashboard).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('offers watch onboarding without asking for holding cost', async () => {
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.click(screen.getByRole('button', { name: 'Watch stock briefs 0' }));
    expect(screen.getByText('Start with a stock you follow')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add your first watch stock' })).toBeVisible();
    expect(screen.queryByText('Start with what you own')).not.toBeInTheDocument();
  });
  it('refreshes quotes explicitly and does not immediately overwrite them with a cached read', async () => {
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }));
    await waitFor(() => expect(api.dashboard).toHaveBeenLastCalledWith(true));
    expect(api.dashboard).toHaveBeenCalledTimes(2);
  });
  it('does not hide research errors behind configuration', async () => {
    api.dashboard.mockResolvedValue({ ...data, items: [{ ...data.items[0], run: { ...data.items[0].run, status: 'failed', error: 'No market data' }, brief: null }] });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('No market data');
  });
  it('submits a holding by account and stock, not just a stock symbol', async () => {
    mount(); await screen.findByText('Apple Inc.');
    fireEvent.click(screen.getByRole('button', { name: 'Research holding' }));
    await waitFor(() => expect(api.run).toHaveBeenCalledWith(1, 'AAPL'));
  });
  it('shows a separately aggregated recommendation trajectory without changing the report summary', async () => {
    api.dashboard.mockResolvedValue({ ...data, items: [{ ...data.items[0], brief: {
      ...data.items[0].brief!, holdingRecommendation: { category: 'reduce', label: 'Reduce exposure', score: 40, basis: 'Risk limits weakened.', source: 'current_independent_report' },
      recommendationHistory: [
        { session: '2026-09-05', createdAt: '2026-09-05T08:00:00Z', category: 'hold_positive', label: 'Hold positive', score: 60 },
        { session: '2026-09-08', createdAt: '2026-09-08T08:00:00Z', category: 'reduce', label: 'Reduce exposure', score: 40 },
      ], recommendationTrend: { direction: 'falling', change: -20, sessions: 2 },
    } }] });
    mount();
    expect(await screen.findByText('Model view · Reduce exposure（40）')).toBeVisible();
    expect(screen.getByText('Holding recommendation trajectory')).toBeVisible();
    expect(screen.getByText('Aggregates completed independent reports; never used as input to the next run.')).toBeVisible();
    expect(screen.getByText('Review the trend before reducing exposure.')).toBeVisible();
  });
});

it('shows JEV confidence without the old report or full-research link', async () => {
  localStorage.setItem('dsa.uiLanguage', 'en');
  api.dashboard.mockResolvedValue({ ...data, items: [{ ...data.items[0], decisionBackend: 'jev',
    decision: { backend: 'jev', symbol: 'AAPL', scope: 'holding', category: 'hold', confidence: 0.73, model: 'jev-test', asOf: '2026-09-21' } }] });
  mount();
  expect(await screen.findByText('73.0%')).toBeVisible();
  expect(screen.queryByText('Review the trend before reducing exposure.')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Full research & progress' })).not.toBeInTheDocument();
});
