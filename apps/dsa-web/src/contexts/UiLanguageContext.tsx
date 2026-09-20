import { translateSource } from '../i18n/localize';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatUiText, UI_TEXT, type UiLanguage, type UiTextKey, type UiTextParams } from '../i18n/uiText';
import { getRuntimeInitialLanguage, getUiLanguageStorage, persistUiLanguage, uiLocale } from '../utils/uiLanguage';
import { translateWorkspaceText } from '../i18n/translateWorkspaceText';

type UiLanguageContextValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (key: UiTextKey, params?: UiTextParams) => string;
  /**
   * Selects page-local copy while newer product surfaces are migrated into the
   * shared catalogue. Keeping the selection in the language context makes
   * every caller reactive and avoids independent language state per page.
   */
  localize: (zh: string, en: string) => string;
  translate: (text: string, ...values: Array<string | number>) => string;
};

const fallbackContext: UiLanguageContextValue = {
  language: 'en',
  setLanguage: () => undefined,
  t: (key, params) => formatUiText(UI_TEXT.en[key], params),
  localize: (_zh, en) => en,
  translate: (text, ...values) => translateWorkspaceText(text, 'en', ...values),
};

const UiLanguageContext = createContext<UiLanguageContextValue | null>(null);

export const UiLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<UiLanguage>(getRuntimeInitialLanguage);

  const setLanguage = useCallback((nextLanguage: UiLanguage) => {
    setLanguageState(nextLanguage);
    persistUiLanguage(getUiLanguageStorage(), nextLanguage);
  }, []);

  const translate = useCallback((text: string, ...values: Array<string | number>) => (
    translateWorkspaceText(text, language, ...values)
  ), [language]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = uiLocale(language);
    }
  }, [language]);

  const value = useMemo<UiLanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => formatUiText(UI_TEXT[language][key], params),
    localize: (zh, en) => (language === 'en' ? en : translateSource(zh, language)),
    translate,
  }), [language, setLanguage, translate]);

  return (
    <UiLanguageContext.Provider value={value}>
      {children}
    </UiLanguageContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- useUiLanguage is a hook, co-located for context access
export function useUiLanguage(): UiLanguageContextValue {
  const context = useContext(UiLanguageContext);
  const language = getRuntimeInitialLanguage();
  const fallback = useMemo<UiLanguageContextValue>(() => ({ ...fallbackContext, language,
    t: (key, params) => formatUiText(UI_TEXT[language][key], params),
    localize: (zh, en) => language === 'en' ? en : translateSource(zh, language),
    translate: (text, ...values) => translateWorkspaceText(text, language, ...values),
  }), [language]);
  return context ?? fallback;
}
