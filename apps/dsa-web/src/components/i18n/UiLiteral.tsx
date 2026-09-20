import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { translateSource } from '../../i18n/localize';

/** Localize source-code UI copy, leaving dynamic report and user content untouched. */
export function UiLiteral({ text }: { text: string }) {
  const { language } = useUiLanguage();
  return <>{translateSource(text, language)}</>;
}
