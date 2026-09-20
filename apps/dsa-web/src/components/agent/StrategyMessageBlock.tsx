import { translateKorean } from '../../i18n/korean';
import { isValidElement, type ReactNode } from 'react';
import { ChartCodeBlock } from '../report/ChartCodeBlock';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

/** Keep the original model payload inspectable without dominating the conversation. */
export function StrategyMessageBlock({ children }: { children?: ReactNode }) {
  const { language } = useUiLanguage();
  if (isValidElement<{ className?: string; children?: ReactNode }>(children)
    && children.props.className === 'language-strategy-draft') {
    return <details className="my-3 rounded border border-border p-3">
      <summary className="cursor-pointer text-sm text-secondary-text">{language === 'ko' ? translateKorean('策略草稿已输出 · 查看原始内容') : (language === 'zh' ? '策略草稿已输出 · 查看原始内容' : 'Strategy draft output · inspect original')}</summary>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{children}</pre>
    </details>;
  }
  return <ChartCodeBlock>{children}</ChartCodeBlock>;
}
