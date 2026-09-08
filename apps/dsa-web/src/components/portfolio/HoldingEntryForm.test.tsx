import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoldingEntryForm from './HoldingEntryForm';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';

const mocks = vi.hoisted(() => ({ getAccounts: vi.fn(), createTrade: vi.fn(), createAccount: vi.fn(), index: vi.fn() }));
vi.mock('../../api/portfolio', () => ({ portfolioApi: mocks }));
vi.mock('../../hooks/useStockIndex', () => ({ useStockIndex: () => ({ index: mocks.index() }) }));
const index = [
  { market: 'CN', canonicalCode: '600519.SH', displayCode: '600519', nameZh: '贵州茅台', nameEn: 'Kweichow Moutai' },
  { market: 'HK', canonicalCode: '00700.HK', displayCode: '00700', nameZh: '腾讯控股', nameEn: 'Tencent' },
  { market: 'US', canonicalCode: 'AAPL.US', displayCode: 'AAPL', nameZh: '苹果', nameEn: 'Apple' },
];

async function enter(market: string, symbol: string) {
  render(<UiLanguageProvider><HoldingEntryForm onSaved={vi.fn()} /></UiLanguageProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save record' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Stock market'), { target: { value: market } });
  fireEvent.change(screen.getByLabelText(/^Stock code or name/), { target: { value: symbol } });
  fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText(/Price \/ opening cost per share/), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
}

describe('holding stock code contract', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
    mocks.index.mockReturnValue(index);
    mocks.getAccounts.mockResolvedValue({ accounts: [{ id: 1, name: 'Test', baseCurrency: 'CNY' }] });
    mocks.createTrade.mockResolvedValue({ id: 1 });
  });
  it.each([
    ['cn', '600519.SH', '600519'], ['cn', '600519', '600519'], ['cn', '贵州茅台', '600519'],
    ['cn', 'kweichow moutai', '600519'], ['cn', 'sh600519', '600519'], ['cn', '920748.BJ', '920748'],
    ['hk', '00700.HK', 'HK00700'], ['hk', '腾讯控股', 'HK00700'], ['hk', '700', 'HK00700'],
    ['us', 'AAPL.US', 'AAPL'], ['us', 'apple', 'AAPL'], ['us', 'BRK.B', 'BRK.B'],
  ])('normalizes %s input %s to %s', async (market, input, symbol) => {
    await enter(market, input);
    await waitFor(() => expect(mocks.createTrade).toHaveBeenCalledWith(expect.objectContaining({ market, symbol })));
    expect(mocks.createAccount).not.toHaveBeenCalled();
  });
  it('accepts qualified codes before the index loads', async () => {
    mocks.index.mockReturnValue([]); await enter('cn', '000001.SZ');
    await waitFor(() => expect(mocks.createTrade).toHaveBeenCalledWith(expect.objectContaining({ symbol: '000001' })));
  });
  it.each([['cn', '00700.HK'], ['hk', '600519.SH'], ['us', 'HK00700'], ['cn', 'unknown stock']])('keeps market validation for %s / %s', async (market, symbol) => {
    await enter(market, symbol);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a stock code matching the market');
    expect(mocks.createTrade).not.toHaveBeenCalled(); expect(mocks.createAccount).not.toHaveBeenCalled();
  });
});
