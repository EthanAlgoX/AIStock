import apiClient from './index';

export type CryptoTicker = { symbol: string; lastPrice: number; changePercent24h: number; quoteVolume24h: number; high24h: number; low24h: number };
export type CryptoCandle = { time: number; open: number; high: number; low: number; close: number; baseVolume: number; quoteVolume: number };
export type CryptoScreen = { selected: string; ranking: { symbol: string; quoteVolume: number; volatility: number }[]; candidates: { symbol: string; quoteVolume: number; volatility: number }[]; lookbackHours: number; signalTime: number };
export type CryptoBacktest = { strategy: string; symbols: string[]; source: string; sampleHash: string; start: number; endExclusive: number; initialCash: number; finalEquity: number; return: number; maxDrawdown: number; btcReturn: number | null; fees: number; slippageCost: number; tradeCount: number; endingCash: number; endingPositions: Record<string, number>; equityCurve: { time: number; equity: number }[]; trades: { time: number; symbol: string; side: string; quantity: number; price: number; fee: number }[] };

export const cryptoApi = {
  market: async () => (await apiClient.get<{ assets: CryptoTicker[]; asOf: string; source: string }>('/api/v1/crypto/market')).data,
  asset: async (symbol: string) => (await apiClient.get<{ symbol: string; metrics: { periodReturn: number; hourlyVolatility: number | null; quoteTurnover: number; periodHigh: number; periodLow: number }; candles: CryptoCandle[] }>('/api/v1/crypto/assets/' + symbol)).data,
  screen: async (symbols: string[], lookbackHours: number, topN: number) => (await apiClient.post<CryptoScreen>('/api/v1/crypto/screen', { symbols, lookbackHours, topN })).data,
  backtest: async (request: { symbols: string[]; strategy: string; startDate: string; endDate: string; initialCash: number; feeRate: number; slippageRate: number; allocation: number; lookbackHours: number; topN: number; rebalanceHours: number }) => (await apiClient.post<CryptoBacktest>('/api/v1/crypto/backtest', request, { timeout: 90000 })).data,
};
