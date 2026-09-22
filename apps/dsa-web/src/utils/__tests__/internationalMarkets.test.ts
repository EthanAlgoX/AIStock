import { describe, it, expect } from 'vitest';
import { RESEARCH_MARKETS, localizedStockName } from '../markets';
import { suffixMarket, normalizeStockCode } from '../stockCode';
import { validateStockCode } from '../validation';
import { translateSource } from '../../i18n/localize';

describe('International market and language contracts', () => {
  it.each([['HSBA.L','GB'],['RY.TO','CA'],['BHP.AX','AU'],['RELIANCE.NS','IN'],['SAP.DE','DE'],['AIR.PA','FR'],['2330.TW','TW'],['7203.T','JP'],['005930.KS','KR']])('routes %s without treating it as a US ticker', (code,market) => {
    expect(normalizeStockCode(code.toLowerCase())).toBe(code);
    expect(suffixMarket(code)).toBe(market);
    expect(validateStockCode(code).valid).toBe(true);
  });
  it.each(['en','ko','ja','zh-TW'])('has translated market labels in %s', language => {
    for (const {label} of RESEARCH_MARKETS) {
      const text=translateSource(label,language);
      expect(text).toBeTruthy();
      if (language==='en'||language==='ko') expect(text).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it('uses an available English company name or the code outside Chinese locales', () => {
    const stock={canonicalCode:'2330.TW',nameZh:'台積電',nameEn:'TSMC'};
    expect(localizedStockName(stock,'ko')).toBe('TSMC');
    expect(localizedStockName({...stock,nameEn:undefined},'ja')).toBe('2330.TW');
    expect(localizedStockName(stock,'zh-TW')).toBe('台積電');
  });
});
