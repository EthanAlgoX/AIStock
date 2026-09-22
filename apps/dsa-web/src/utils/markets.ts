import type { StockIndexItem } from '../types/stockIndex';
export const RESEARCH_MARKETS = [
  {id:'CN',label:'A 股',description:'沪深北市场'}, {id:'HK',label:'港股',description:'香港市场'},
  {id:'US',label:'美股',description:'美国市场'}, {id:'TW',label:'台股',description:'上市与上柜市场'},
  {id:'JP',label:'日股',description:'东京市场'}, {id:'KR',label:'韩股',description:'KOSPI / KOSDAQ'},
  {id:'GB',label:'英国股票',description:'London'}, {id:'CA',label:'加拿大股票',description:'Toronto'},
  {id:'AU',label:'澳大利亚股票',description:'ASX'}, {id:'IN',label:'印度股票',description:'NSE / BSE'},
  {id:'DE',label:'德国股票',description:'Xetra / Frankfurt'}, {id:'FR',label:'法国股票',description:'Euronext Paris'},
] as const;
export type ResearchMarket = typeof RESEARCH_MARKETS[number]['id'];
export function localizedStockName(stock: Pick<StockIndexItem,'canonicalCode'|'nameZh'|'nameEn'>, language: string): string {
  if (language === 'zh' || language === 'zh-TW') return stock.nameZh || stock.nameEn || stock.canonicalCode;
  return stock.nameEn || stock.canonicalCode;
}
