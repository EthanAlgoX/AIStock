import apiClient from './index';
import { toCamelCase } from './utils';

export type IntelligenceMarket = 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw' | 'global';

export type IntelligenceSource = {
  id: number;
  name: string;
  sourceType: 'rss' | 'atom' | 'newsnow' | string;
  url: string;
  enabled: boolean;
  scopeType: 'symbol' | 'market' | 'sector' | string;
  scopeValue?: string | null;
  market: IntelligenceMarket | string;
  description?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastFetchedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type IntelligenceItem = {
  id: number;
  sourceId?: number | null;
  sourceName?: string | null;
  sourceType: string;
  title: string;
  summary?: string | null;
  url: string;
  source?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  scopeType: string;
  scopeValue?: string | null;
  market: IntelligenceMarket | string;
};

export type IntelligenceSourceList = {
  items: IntelligenceSource[];
  total: number;
  page: number;
  pageSize: number;
};

export type IntelligenceItemList = {
  items: IntelligenceItem[];
  total: number;
  page: number;
  pageSize: number;
};

export const intelligenceApi = {
  async listSources(params: {
    enabled?: boolean;
    market?: IntelligenceMarket;
    page?: number;
    pageSize?: number;
  } = {}): Promise<IntelligenceSourceList> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/intelligence/sources', {
      params: {
        enabled: params.enabled,
        market: params.market,
        page: params.page ?? 1,
        page_size: params.pageSize ?? 100,
      },
    });
    return toCamelCase<IntelligenceSourceList>(response.data);
  },

  async listItems(params: {
    market?: IntelligenceMarket;
    days?: number;
    page?: number;
    pageSize?: number;
  } = {}): Promise<IntelligenceItemList> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/intelligence/items', {
      params: {
        market: params.market,
        days: params.days,
        page: params.page ?? 1,
        page_size: params.pageSize ?? 50,
      },
    });
    return toCamelCase<IntelligenceItemList>(response.data);
  },
};
