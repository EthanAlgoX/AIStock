import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoldingsPage from '../HoldingsPage';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import type { HoldingsDashboard } from '../../api/portfolioResearch';

const api = vi.hoisted(() => ({ dashboard: vi.fn(), run: vi.fn() }));
vi.mock('../../api/portfolioResearch', () => ({ portfolioResearchApi: api }));
vi.mock('../../components/portfolio/HoldingPlanEditor', () => ({ default: () => <div>Plan editor</div> }));
vi.mock('../../components/portfolio/HoldingEntryForm', () => ({ default: () => <div>Entry form</div> }));
const data: HoldingsDashboard = { asOf: '2026-09-08', rules: { lossPct: 10, profitPct: 20, dailyMovePct: 5 }, items: [{
  accountId: 1, accountName: 'Test account', taskId: 'task', supported: true, alerts: ['loss_review'], schedule: null,
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
    fireEvent.click(screen.getByRole('button', { name: 'Daily plan & strategy' }));
    expect(screen.getByText('Plan editor')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Full research & progress' })).toHaveAttribute('href', '/stock-research?run=run');
  });
  it('restores background state after mounting and prevents duplicate submission', async () => {
    api.dashboard.mockResolvedValue({ ...data, items: [{ ...data.items[0], run: { ...data.items[0].run, status: 'running' }, brief: null }] });
    mount();
    expect(await screen.findByRole('button', { name: 'Researching' })).toBeDisabled();
    expect(screen.getByText(/Fetching evidence and researching in the background/)).toBeVisible();
    expect(api.run).not.toHaveBeenCalled();
  });
  it('refreshes quotes explicitly and does not immediately overwrite them with a cached read', async () => {
    mount(); await screen.findByText('Apple');
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
    mount(); await screen.findByText('Apple');
    fireEvent.click(screen.getByRole('button', { name: 'Research holding' }));
    await waitFor(() => expect(api.run).toHaveBeenCalledWith(1, 'AAPL'));
  });
});
