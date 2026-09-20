import { useUiLanguage } from '../contexts/UiLanguageContext';
import { translateKorean } from '../i18n/korean';

/** Adapter for legacy source-code UI labels that have no English catalogue yet. */
export function useUiLiteral() {
  const { language } = useUiLanguage();
  return (text: string) => language === 'ko' ? translateKorean(text) : text;
}
