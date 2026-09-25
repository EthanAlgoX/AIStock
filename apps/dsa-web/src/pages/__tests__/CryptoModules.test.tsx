import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoSimulationProvider } from '../../components/crypto/CryptoSimulationContext';
import CryptoWorkspacePage from '../CryptoWorkspacePage';
import ScreeningWorkspacePage from '../ScreeningWorkspacePage';

const api = vi.hoisted(() => ({ market: vi.fn(), asset: vi.fn(), screen: vi.fn(), backtest: vi.fn() }));
vi.mock('../../api/crypto', () => ({ cryptoApi: api }));
vi.mock('../ResearchReportsWorkspace', () => ({ default: () => <div>Stock screening workspace</div> }));
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, LineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null }));

const result = {
  strategy: 'selection_hold', symbols: ['BTCUSDT'], source: 'binance', sampleHash: 'sample', start: 0, endExclusive: 1,
  initialCash: 10000, finalEquity: 10100, return: 0.01, maxDrawdown: -0.02, btcReturn: 0.03,
  fees: 1, slippageCost: 1, tradeCount: 1, endingCash: 5000, endingPositions: { BTCUSDT: 0.1 },
  equityCurve: [], trades: [{ time: 1, symbol: 'BTCUSDT', side: 'buy', quantity: 0.1, price: 50000, fee: 1 }],
};

describe('crypto views inside existing modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.market.mockResolvedValue({ assets: [{ symbol: 'BTCUSDT', lastPrice: 50000, changePercent24h: 1, quoteVolume24h: 1000 }], asOf: '2026-09-25T00:00:00Z' });
    api.asset.mockResolvedValue({ candles: [], metrics: null });
    api.screen.mockResolvedValue({ selected: 'BTCUSDT', signalTime: 1, ranking: [] });
    api.backtest.mockResolvedValue(result);
  });

  it('links a market pair into the existing research route', async () => {
    render(<MemoryRouter initialEntries={['/market-intelligence?asset=crypto']}><CryptoWorkspacePage section="market" /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /^(Research|研究) →$/ });
    expect(link).toHaveAttribute('href', '/stock-research?asset=crypto&symbol=BTCUSDT');
    expect(api.asset).not.toHaveBeenCalled();
  });

  it('switches the existing screening route between stock and crypto tools', async () => {
    render(<MemoryRouter initialEntries={['/screening']}><ScreeningWorkspacePage /></MemoryRouter>);
    expect(screen.getByText('Stock screening workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /^(Crypto|加密货币)$/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /Asset screening|选币策略/ })).toBeInTheDocument();
    expect(screen.queryByText('Stock screening workspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Run screen|运行选币/ }));
    await waitFor(() => expect(api.screen).toHaveBeenCalledWith(expect.arrayContaining(['BTCUSDT']), 720, 3));
  });

  it('shares a completed simulation with portfolio without querying a stock portfolio', async () => {
    render(<MemoryRouter initialEntries={['/trading?asset=crypto']}><CryptoSimulationProvider><Routes>
      <Route path="/trading" element={<CryptoWorkspacePage section="trading" />} />
      <Route path="/portfolio" element={<CryptoWorkspacePage section="holdings" />} />
    </Routes></CryptoSimulationProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^(Run backtest|运行回测)$/ }));
    await waitFor(() => expect(api.backtest).toHaveBeenCalledWith(expect.objectContaining({ symbols: expect.arrayContaining(['BTCUSDT']), strategy: 'selection_hold' })));
    expect(await screen.findByText(/cash available|可用现金/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /^(View portfolio|查看持仓管理) →$/ }));
    expect(screen.getByRole('heading', { name: /Crypto simulated holdings|加密货币模拟持仓/ })).toBeInTheDocument();
    expect(screen.getByText(/cash available|可用现金/)).toBeInTheDocument();
    expect(api.market).toHaveBeenCalledTimes(1);
  });
});
