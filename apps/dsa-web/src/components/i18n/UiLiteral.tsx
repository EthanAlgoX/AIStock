import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { translateKorean } from '../../i18n/korean';

/** Localize source-code UI copy, leaving dynamic report and user content untouched. */
export function UiLiteral({ text }: { text: string }) {
  const { language } = useUiLanguage();
  return <>{language === 'ko' ? translateKorean(text) : text}</>;
}
