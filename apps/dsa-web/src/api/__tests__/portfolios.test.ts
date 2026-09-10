import { expect, it, vi } from 'vitest';
import { portfoliosApi, type RuleConfig } from '../portfolios';
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../index', () => ({ default: client }));
it('uses the versioned endpoint and strips server metadata when copying an account', async () => {
  client.get.mockResolvedValue({ data: { items: [] } });
  client.post.mockResolvedValue({ data: { id: 2 } });
  await portfoliosApi.list();
  expect(client.get).toHaveBeenCalledWith('/api/v1/simulation/portfolios');
  const config = { name: 'Copy', template: 'volume_breakout', market: 'US', mode: 'paper', symbols: ['AAPL'], initialCash: 100000, maxPositions: 3, maxWeight: 0.25, lotSize: 1, commissionRate: 0.0003, sellTaxRate: 0, slippageRate: 0.001, riskFreeRate: 0, startDate: null, endDate: null } satisfies RuleConfig;
  await portfoliosApi.create({ ...config, benchmark: 'SPY', benchmarkName: 'S&P500', engineVersion: 1 } as RuleConfig);
  expect(client.post).toHaveBeenCalledWith('/api/v1/simulation/portfolios', config);
});
