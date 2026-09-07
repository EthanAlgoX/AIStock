import type { ChatSessionItem } from '../api/agent';
import type { Message } from '../stores/agentChatStore';
import { extractStockCodesFromMessage } from './chatStockCode';
import { normalizeStockCode } from './stockCode';
import type { StockIndexItem } from '../types/stockIndex';

export type PersonalizedStock = {
  stock_code: string;
  stock_name: string | null;
};

export type QuickQuestion = {
  label: string;
  skill: string;
  stockContext?: PersonalizedStock;
};

const MAX_PERSONALIZED_STOCKS = 3;

const QUESTION_TEMPLATES: Array<{
  skill: string;
  createLabel: (stock: string) => string;
}> = [
  { skill: 'chan_theory', createLabel: (stock) => `用缠论分析${stock}` },
  { skill: 'wave_theory', createLabel: (stock) => `用波浪理论梳理${stock}的结构` },
  { skill: 'emotion_cycle', createLabel: (stock) => `用情绪周期评估${stock}的交易环境` },
  { skill: 'bull_trend', createLabel: (stock) => `分析${stock}的趋势与关键位置` },
  { skill: 'box_oscillation', createLabel: (stock) => `识别${stock}的箱体与突破位置` },
];

const stockNameMatches = (text: string, item: StockIndexItem): boolean => {
  const normalizedText = text.toLocaleLowerCase();
  return [item.nameZh, item.nameEn, ...(item.aliases || [])]
    .filter((name): name is string => Boolean(name && name.trim()))
    .some((name) => {
      const trimmed = name.trim();
      if (!(/[\u3400-\u9fff]/.test(trimmed) ? trimmed.length >= 2 : trimmed.length >= 3)) {
        return false;
      }
      const matchedAt = normalizedText.indexOf(trimmed.toLocaleLowerCase());
      if (matchedAt < 0) return false;

      // A listed company can share an ordinary phrase (for example “值得买”).
      // For name-only matches, require a stock-query context unless the name
      // starts the user's title; explicit stock codes are handled separately.
      const prefix = text.slice(Math.max(0, matchedAt - 16), matchedAt);
      const suffix = text.slice(matchedAt + trimmed.length, matchedAt + trimmed.length + 12);
      return matchedAt <= 3
        || /(?:分析|研究|看看|看|关注|买|卖|持有|比较|对比|评估|诊断)$/.test(prefix)
        || /^(?:股票|股价|走势|估值|基本面|财报|公司|怎么样|如何|能买吗|值不值得|适合)/.test(suffix);
    });
};

const findStockByCode = (code: string, stockIndex: StockIndexItem[]): StockIndexItem | undefined => {
  const normalizedCode = normalizeStockCode(code);
  return stockIndex.find((item) => item.active && normalizeStockCode(item.canonicalCode) === normalizedCode);
};

const getStocksFromText = (text: string, stockIndex: StockIndexItem[]): PersonalizedStock[] => {
  const matched = new Map<string, PersonalizedStock>();

  for (const code of extractStockCodesFromMessage(text)) {
    const item = findStockByCode(code, stockIndex);
    // Free-text extraction intentionally accepts short US tickers for chat.
    // A recommendation must be stricter: an unindexed ticker needs an
    // unambiguous numeric or exchange-qualified form, otherwise terms such as
    // “SK 海力士” can become a false stock suggestion.
    if (!item && !/^(?:\d{5,6}|HK\d{5}|[A-Z]{2,5}\.[A-Z]{1,2})$/i.test(code)) {
      continue;
    }
    const stockCode = item ? normalizeStockCode(item.canonicalCode) : normalizeStockCode(code);
    matched.set(stockCode, { stock_code: stockCode, stock_name: item?.nameZh || null });
  }

  for (const item of stockIndex) {
    if (!item.active || !stockNameMatches(text, item)) continue;
    const stockCode = normalizeStockCode(item.canonicalCode);
    if (!matched.has(stockCode)) {
      matched.set(stockCode, { stock_code: stockCode, stock_name: item.nameZh || null });
    }
  }

  return [...matched.values()];
};

/**
 * Builds a short, deterministic set of methods × recently researched stocks.
 * Session metadata is intentionally sufficient here: no additional history API
 * requests or LLM calls are needed just to render an empty conversation state.
 */
export const buildPersonalizedQuickQuestions = ({
  sessions,
  messages,
  stockIndex,
  availableSkillIds,
  language = 'zh',
}: {
  sessions: ChatSessionItem[];
  messages: Message[];
  stockIndex: StockIndexItem[];
  availableSkillIds: Set<string>;
  language?: 'zh' | 'en';
}): QuickQuestion[] => {
  const sources = [
    ...messages.filter((message) => message.role === 'user').map((message) => message.content),
    ...sessions.map((session) => session.title),
  ];
  const stocks: PersonalizedStock[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const stock of getStocksFromText(source, stockIndex)) {
      if (seen.has(stock.stock_code)) continue;
      seen.add(stock.stock_code);
      stocks.push(stock);
      if (stocks.length >= MAX_PERSONALIZED_STOCKS) break;
    }
    if (stocks.length >= MAX_PERSONALIZED_STOCKS) break;
  }

  const templates = QUESTION_TEMPLATES.filter((template) => availableSkillIds.has(template.skill));
  if (!stocks.length || !templates.length) return [];

  return stocks.map((stock, index) => {
    const template = templates[index % templates.length];
    const displayName = language === 'en'
      ? (stockIndex.find((item) => normalizeStockCode(item.canonicalCode) === stock.stock_code)?.nameEn || stock.stock_name || stock.stock_code)
      : (stock.stock_name || stock.stock_code);
    return {
      label: language === 'en'
        ? [
            `Analyze ${displayName} with Chan theory`,
            `Map ${displayName}'s Elliott-wave structure`,
            `Assess ${displayName}'s sentiment cycle`,
            `Review ${displayName}'s trend and key levels`,
            `Identify ${displayName}'s range and breakout levels`,
          ][QUESTION_TEMPLATES.indexOf(template)]
        : template.createLabel(displayName),
      skill: template.skill,
      stockContext: stock,
    };
  });
};
