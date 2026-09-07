import type { UiLanguage } from './uiText';
import { WORKSPACE_TEXT } from './workspaceText';

/** Translate registered UI copy only; never rewrite arbitrary saved reports. */
export function translateWorkspaceText(text: string, language: UiLanguage, ...values: Array<string | number>): string {
  const template = language === 'en' && Object.prototype.hasOwnProperty.call(WORKSPACE_TEXT, text)
    ? WORKSPACE_TEXT[text] : text;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}
