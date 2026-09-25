import client from '../api';
import { cryptoApi } from '../api/crypto';
/**
 * useStockIndex Hook
 *
 * Manage stock index loading and state
 */

import { useState, useEffect } from 'react';
import type { StockIndexItem } from '../types/stockIndex';
import { loadStockIndex } from '../utils/stockIndexLoader';
import type { IndexLoadResult } from '../utils/stockIndexLoader';

export interface UseStockIndexResult {
  /** Stock index data */
  index: StockIndexItem[];
  /** Is loading */
  loading: boolean;
  /** Load error */
  error: Error | null;
  /** Whether fallback mode is used */
  fallback: boolean;
  /** Is loaded */
  loaded: boolean;
  retry: () => void;
}

/**
 * Stock index loading Hook
 *
 * @returns Index state and data
 */
export function useStockIndex(enabled = true, market?: string): UseStockIndexResult {
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState<StockIndexItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      const result: IndexLoadResult = { ...await loadStockIndex() };
      if (market === 'CRYPTO') {
        try {
          const response = await cryptoApi.market();
          result.data = response.assets.map(row => ({ canonicalCode: row.symbol, displayCode: row.symbol, nameZh: row.symbol, nameEn: row.symbol, market: 'CRYPTO' as const, assetType: 'crypto' as const, active: true }));
        } catch (error) {
          result.data = [];
          if (mounted) setError(error instanceof Error ? error : new Error('Spot directory unavailable'));
        }
      }
      if (market === 'TW') {
        try {
          const response = await client.get<{items:StockIndexItem[]}>('/api/v1/stocks/international-listings');
          result.data = [...result.data.filter(s => s.market !== 'TW'), ...response.data.items];
        } catch (error) {
          if (mounted) setError(error instanceof Error ? error : new Error('Stock directory unavailable'));
        }
      }

      if (mounted) {
        setIndex(result.data);
        setFallback(result.fallback);
        if (result.error) {
          setError(result.error);
        }
        setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [enabled, attempt, market]);

  return {
    retry: () => setAttempt(value => value + 1),
    index: enabled ? index : [],
    loading: enabled ? loading : false,
    error: enabled ? error : null,
    fallback: enabled ? fallback : false,  // Whether fallback
    loaded: enabled ? !loading : false,
  };
}

/**
 * Get default exported Hook
 */
export default useStockIndex;
