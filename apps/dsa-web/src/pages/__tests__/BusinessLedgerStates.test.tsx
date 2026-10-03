import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { workspaceRunFixture, workspaceTaskFixture } from '../../testWorkspaceFixtures';
import TaskRunsPage from '../TaskRunsPage';
import HoldingsLedgerPage from '../HoldingsLedgerPage';

const api = vi.hoisted(() => ({ runHistory: vi.fn(), listSchedules: vi.fn(), listTrades: vi.fn(), getAccounts: vi.fn() }));
vi.mock('../../api/workspace', () => ({ workspaceApi: api }));
vi.mock('../../api/portfolio', () => ({ portfolioApi: api }));
vi.mock('../../hooks/useStockIndex', () => ({ useStockIndex: () => ({ index: [] }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mount(page: ReactNode) {
  return render(<UiLanguageProvider><MemoryRouter>{page}</MemoryRouter></UiLanguageProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('dsa.uiLanguage', 'en');
  api.listSchedules.mockResolvedValue([]);
  api.getAccounts.mockResolvedValue({ accounts: [] });
});

describe('business ledger request states', () => {
  it('shows pending run history without an empty onboarding claim', async () => {
    const request = deferred<{ items: ReturnType<typeof workspaceRunFixture>[]; total: number; statusCounts: Record<string, number> }>();
    api.runHistory.mockReturnValue(request.promise);
    mount(<TaskRunsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('No matching run records')).not.toBeInTheDocument();
    await act(async () => request.resolve({ items: [], total: 0, statusCounts: {} }));
    expect(screen.getByText('No matching run records')).toBeVisible();
  });

  it('provides explicit retry for a failed run read and restores saved records', async () => {
    api.runHistory.mockRejectedValueOnce(new Error('offline'));
    mount(<TaskRunsPage />);
    await screen.findByRole('alert');
    expect(screen.queryByText('No matching run records')).not.toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Task run status summary' });
    expect(within(summary).queryByText('0')).not.toBeInTheDocument();
    expect(within(summary).getAllByText('—')).toHaveLength(3);
    api.runHistory.mockResolvedValue({ items: [workspaceRunFixture(workspaceTaskFixture({ name: 'Saved research' }))], total: 1, statusCounts: { completed: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Saved research');
    expect(api.runHistory).toHaveBeenCalledTimes(2);
  });

  it('waits for transactions and never presents a failed read as an empty ledger', async () => {
    const request = deferred<{ items: []; total: number }>();
    api.listTrades.mockReturnValueOnce(request.promise);
    mount(<HoldingsLedgerPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    await act(async () => request.reject(new Error('offline')));
    await screen.findByRole('alert');
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    api.listTrades.mockResolvedValue({ items: [], total: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No transactions yet');
    expect(api.listTrades).toHaveBeenCalledTimes(2);
  });

  it('loads the requested transaction page before showing its rows', async () => {
    const pageTwo = deferred<{ items: Array<{ id: number; accountId: number; symbol: string; side: string; quantity: number; price: number; currency: string; tradeDate: string }>; total: number }>();
    api.listTrades.mockResolvedValueOnce({ items: [{ id: 1, accountId: 1, symbol: 'AAPL', side: 'buy', quantity: 2, price: 100, currency: 'USD', tradeDate: '2026-10-01' }], total: 21 })
      .mockReturnValueOnce(pageTwo.promise);
    mount(<HoldingsLedgerPage />);
    await screen.findByText('AAPL');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.listTrades).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    await act(async () => pageTwo.resolve({ items: [{ id: 2, accountId: 1, symbol: 'MSFT', side: 'buy', quantity: 1, price: 200, currency: 'USD', tradeDate: '2026-10-02' }], total: 21 }));
    expect(screen.getByText('MSFT')).toBeVisible();
  });
});
