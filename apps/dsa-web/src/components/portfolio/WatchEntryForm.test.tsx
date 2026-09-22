import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import WatchEntryForm from './WatchEntryForm';
const api = vi.hoisted(() => ({ createWatch: vi.fn() }));
vi.mock('../../api/portfolioResearch', () => ({ portfolioResearchApi: api }));
vi.mock('../../hooks/useStockIndex', () => ({ useStockIndex: () => ({ index: [] }) }));
beforeEach(() => { localStorage.setItem('dsa.uiLanguage', 'en'); vi.clearAllMocks(); api.createWatch.mockResolvedValue({}); });
it('saves JEV without invoking research and explains watch categories', async () => {
  const saved = vi.fn();
  render(<UiLanguageProvider><WatchEntryForm onSaved={saved} /></UiLanguageProvider>);
  fireEvent.change(screen.getByLabelText('Stock code or name'), { target: { value: '600519' } });
  fireEvent.change(screen.getByLabelText('Analysis model'), { target: { value: 'jev' } });
  expect(screen.getByText(/Bullish, Bearish or Neutral/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add watch stock' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.createWatch).toHaveBeenCalledWith({ symbol: '600519', market: 'cn', decisionBackend: 'jev' });
});
