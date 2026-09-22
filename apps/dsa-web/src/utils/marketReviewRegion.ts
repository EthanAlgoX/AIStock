import type { MarketReviewRegion } from '../types/analysis';

export type { MarketReviewRegion };

export const MARKET_REVIEW_REGION_ORDER: readonly MarketReviewRegion[] = ['cn', 'hk', 'us', 'jp', 'kr', 'tw', 'gb', 'ca', 'au', 'in', 'de', 'fr'];

export function serializeMarketReviewRegions(regions: readonly MarketReviewRegion[]): string {
  const ordered = MARKET_REVIEW_REGION_ORDER.filter((region) => regions.includes(region));
  const legacyBoth = ['cn', 'hk', 'us', 'jp', 'kr'];
  return ordered.length === legacyBoth.length && legacyBoth.every((region) => ordered.includes(region as MarketReviewRegion))
    ? 'both' : ordered.join(',');
}
