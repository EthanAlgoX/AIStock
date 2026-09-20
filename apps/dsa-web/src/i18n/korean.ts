import translations from './ko.json';

/** Static product copy only. Never apply this to user content or saved reports. */
const catalogue: Readonly<Record<string, string>> = translations;
const templates = Object.entries(catalogue).filter(([source]) => /\{(?:\d+|\w+)\}/.test(source)).sort(([a], [b]) => b.replace(/\{[^}]+\}/g, '').length - a.replace(/\{[^}]+\}/g, '').length).map(([source, target]) => {
  const slots: string[] = [];
  const escaped = source.split(/(\{(?:\d+|\w+)\})/).map((part) => {
    if (/^\{(?:\d+|\w+)\}$/.test(part)) { slots.push(part); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { pattern: new RegExp(`^${escaped}$`, 's'), slots, target };
});

export function translateKorean(text: string): string {
  if (text.trim() !== text && text.trim()) {
    const prefix = text.match(/^\s*/)?.[0] || '';
    const suffix = text.match(/\s*$/)?.[0] || '';
    return prefix + translateKorean(text.trim()) + suffix;
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

/** Expand existing, explicitly registered locale tables without translating IDs or keys. */
export function koreanCopy<T>(value: T): T {
  if (typeof value === 'string') return translateKorean(value) as T;
  if (Array.isArray(value)) return value.map(koreanCopy) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, koreanCopy(item)]),
  ) as T;
  return value;
}

export function withKorean<T extends { zh: unknown; en: unknown }>(value: T): T & { ko: T['zh'] } {
  return { ...value, ko: koreanCopy(value.zh) };
}
