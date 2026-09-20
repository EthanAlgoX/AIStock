import ko from './ko.json';
import ja from './ja.json';
import en from './en.json';
import traditional from './zh-TW.json';

/** Static product copy only. Never apply this to user content or saved reports. */
const catalogues: Record<string, Readonly<Record<string, string>>> = { ko, ja, en, 'zh-TW': traditional };
function makeTranslator(catalogue: Readonly<Record<string, string>>) {
const templates = Object.entries(catalogue).filter(([source]) => /\{(?:\d+|\w+)\}/.test(source)).sort(([a], [b]) => b.replace(/\{[^}]+\}/g, '').length - a.replace(/\{[^}]+\}/g, '').length).map(([source, target]) => {
  const slots: string[] = [];
  const escaped = source.split(/(\{(?:\d+|\w+)\})/).map((part) => {
    if (/^\{(?:\d+|\w+)\}$/.test(part)) { slots.push(part); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { pattern: new RegExp(`^${escaped}$`, 's'), slots, target };
});

function translate(text: string): string {
  if (text.trim() !== text && text.trim()) {
    const prefix = text.match(/^\s*/)?.[0] || '';
    const suffix = text.match(/\s*$/)?.[0] || '';
    return prefix + translate(text.trim()) + suffix;
  }
  if (Object.prototype.hasOwnProperty.call(catalogue, text)) return catalogue[text];
  if (!/[\u3400-\u9fff]/.test(text)) return text;
  for (const { pattern, slots, target } of templates) {
    const match = pattern.exec(text);
    if (match) return target.replace(/\{(?:\d+|\w+)\}/g, (slot) => {
      const index = slots.indexOf(slot);
      return index < 0 ? slot : match[index + 1];
    });
  }
  return text;
}

return translate;
}
const translators = Object.fromEntries(Object.entries(catalogues).map(([lang, values]) => [lang, makeTranslator(values)]));
export function translateSource(text: string, language: string): string {
  return translators[language]?.(text) ?? text;
}
export const translateKorean = (text: string) => translateSource(text, 'ko');

/** Expand explicitly registered static locale tables, preserving IDs and keys. */
export function localizedCopy<T>(value: T, language: string): T {
  if (typeof value === 'string') return translateSource(value, language) as T;
  if (Array.isArray(value)) return value.map((item) => localizedCopy(item, language)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, localizedCopy(item, language)]),
  ) as T;
  return value;
}
export function withUiLanguages<T extends { zh: unknown; en: unknown }>(value: T): T & { ko: T['zh']; ja: T['zh']; 'zh-TW': T['zh'] } {
  return { ko: localizedCopy(value.zh, 'ko'), ja: localizedCopy(value.zh, 'ja'), 'zh-TW': localizedCopy(value.zh, 'zh-TW'), ...value };
}
