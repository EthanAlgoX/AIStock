import { describe, expect, it } from 'vitest';
import type { StockIndexItem } from '../types/stockIndex';
import { buildPersonalizedQuickQuestions } from './personalizedQuickQuestions';

const stockIndex = [
  { canonicalCode: '688981.SH', displayCode: '688981', nameZh: '中芯国际', aliases: ['SMIC'], market: 'CN', assetType: 'stock', active: true },
  { canonicalCode: 'HK01211', displayCode: '01211', nameZh: '比亚迪股份', aliases: ['比亚迪'], market: 'HK', assetType: 'stock', active: true },
  { canonicalCode: '600519.SH', displayCode: '600519', nameZh: '贵州茅台', aliases: ['茅台'], market: 'CN', assetType: 'stock', active: true },
] satisfies StockIndexItem[];

describe('buildPersonalizedQuickQuestions', () => {
  it('uses recent consulted stocks and rotates through available analysis methods', () => {
    const questions = buildPersonalizedQuickQuestions({
      messages: [],
      sessions: [
        { session_id: 'latest', title: '研究中芯国际 688981 的估值', message_count: 2, created_at: null, last_active: null },
        { session_id: 'older', title: '比亚迪现在适合买入吗？', message_count: 2, created_at: null, last_active: null },
      ],
      stockIndex: [...stockIndex],
      availableSkillIds: new Set(['chan_theory', 'wave_theory']),
    });

    expect(questions).toEqual([
      expect.objectContaining({ label: '用缠论分析中芯国际', skill: 'chan_theory', stockContext: { stock_code: '688981', stock_name: '中芯国际' } }),
      expect.objectContaining({ label: '用波浪理论梳理比亚迪股份的结构', skill: 'wave_theory', stockContext: { stock_code: 'HK01211', stock_name: '比亚迪股份' } }),
    ]);
  });

  it('uses current user messages before older session titles and removes duplicate stocks', () => {
    const questions = buildPersonalizedQuickQuestions({
      messages: [{ id: 'current', role: 'user', content: '继续研究贵州茅台 600519' }],
      sessions: [{ session_id: 'older', title: '用缠论看茅台', message_count: 2, created_at: null, last_active: null }],
      stockIndex: [...stockIndex],
      availableSkillIds: new Set(['chan_theory']),
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual(expect.objectContaining({ stockContext: { stock_code: '600519', stock_name: '贵州茅台' } }));
  });

  it('returns no personalized prompts when history has no recognizable stock or method', () => {
    expect(buildPersonalizedQuickQuestions({
      messages: [],
      sessions: [{ session_id: 'plain', title: '聊聊市场情绪', message_count: 2, created_at: null, last_active: null }],
      stockIndex: [...stockIndex],
      availableSkillIds: new Set(['chan_theory']),
    })).toEqual([]);
  });

  it('does not mistake an ordinary phrase for a company with the same name', () => {
    const questions = buildPersonalizedQuickQuestions({
      messages: [],
      sessions: [{ session_id: 'plain', title: '分析海力士是否值得买入', message_count: 2, created_at: null, last_active: null }],
      stockIndex: [...stockIndex, { canonicalCode: '300785.SZ', displayCode: '300785', nameZh: '值得买', aliases: [], market: 'CN', assetType: 'stock', active: true }],
      availableSkillIds: new Set(['chan_theory']),
    });

    expect(questions).toEqual([]);
  });

  it('does not treat an unindexed short ticker inside a company name as a stock', () => {
    expect(buildPersonalizedQuickQuestions({
      messages: [],
      sessions: [{ session_id: 'plain', title: '比较 SK海力士 与美光的存储业务', message_count: 2, created_at: null, last_active: null }],
      stockIndex: [...stockIndex],
      availableSkillIds: new Set(['chan_theory']),
    })).toEqual([]);
  });
});
