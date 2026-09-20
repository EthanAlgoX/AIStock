import { useUiLanguage } from '../contexts/UiLanguageContext';
import { translateSource } from '../i18n/localize';

/** Adapter for legacy source-code UI labels that have no English catalogue yet. */
export function useUiLiteral() {
  const { language } = useUiLanguage();
  return (text: string) => translateSource(text, language);
}
