import { uiLocale } from '../utils/uiLanguage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { usageApi, type UsageDashboard, type UsageModelBreakdown, type UsagePeriod } from '../api/usage';
import type { ParsedApiError } from '../api/error';
import { ApiErrorAlert, AppPage, EmptyState, PageHeader } from '../components/common';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiLanguage, UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';
import { useUiLiteral } from '../hooks/useUiLiteral';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const PERIOD_OPTIONS: UsagePeriod[] = ['today', 'month', 'all'];

const PERIOD_LABEL_KEYS: Record<UsagePeriod, UiTextKey> = {
  today: 'usage.period.today',
  month: 'usage.period.month',
  all: 'usage.period.all',
};

const CALL_TYPE_LABEL_KEYS: Record<string, UiTextKey> = {
  analysis: 'usage.callType.analysis',
  agent: 'usage.callType.agent',
  market_review: 'usage.callType.marketReview',
  strategy_run: 'usage.callType.strategyRun',
};

function getLocale(language: UiLanguage): string {
  return uiLocale(language);
}

function formatNumber(value: number | null | undefined, language: UiLanguage): string {
  return new Intl.NumberFormat(getLocale(language)).format(value ?? 0);
}

function formatDateTime(value: string, language: UiLanguage): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(getLocale(language), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getCallTypeLabel(callType: string, t: Translate): string {
  const key = CALL_TYPE_LABEL_KEYS[callType];
  return key ? t(key) : t('usage.callType.unknown', { type: callType || '-' });
}

function buildParsedError(error: unknown, t: Translate): ParsedApiError {
  if (error && typeof error === 'object' && 'parsedError' in error) {
    const parsedError = (error as { parsedError?: ParsedApiError }).parsedError;
    if (parsedError) {
      return parsedError;
    }
  }

  const message = error instanceof Error ? error.message : t('usage.error.message');
  return {
    title: t('usage.error.title'),
    message,
    rawMessage: message,
    category: 'http_error',
  };
}

const ModelUsageRow: React.FC<{ model: UsageModelBreakdown; language: UiLanguage; t: Translate }> = ({ model, language, t }) => {
  return (
    <li className="min-w-0 border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{model.model}</h3>
        <p className="text-xs text-secondary-text">{t('usage.calls', { count: formatNumber(model.calls, language) })}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4">
        {[[t('usage.totalTokens'), model.totalTokens], ['Prompt', model.promptTokens], ['Completion', model.completionTokens], [t('usage.maxSingleCall'), model.maxTotalTokens]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-secondary-text">{label}</dt><dd className="mt-1 break-words font-medium tabular-nums">{formatNumber(Number(value), language)}</dd></div>)}
      </dl>
    </li>
  );
};

const TokenUsagePage: React.FC = () => {
  const { language, t } = useUiLanguage();
  const tx = useUiLiteral();
  const [period, setPeriod] = useState<UsagePeriod>('month');
  const [dashboard, setDashboard] = useState<UsageDashboard | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);

  const loadDashboard = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setError(null);
    try {
      const data = await usageApi.getDashboard({ period, limit: 50 });
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setDashboard(data);
    } catch (err) {
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setError(buildParsedError(err, t));
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [period, t]);

  useEffect(() => {
    void loadDashboard();
    return () => {
      requestSeqRef.current += 1;
    };
  }, [loadDashboard]);

  const largestCallTypeTotal = useMemo(() => {
    return Math.max(...(dashboard?.byCallType.map((item) => item.totalTokens) ?? [0]), 1);
  }, [dashboard]);

  const hasPartialTokenDetail = Boolean(
    dashboard && dashboard.totalPromptTokens + dashboard.totalCompletionTokens !== dashboard.totalTokens,
  );

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t('usage.eyebrow')}
          title={t('usage.title')}
          description={t('usage.description')}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap gap-1 border-b border-border">
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPeriod(option)}
                    aria-pressed={period === option}
                    className={cn(
                      'min-h-11 border-b-2 px-3 py-2 text-sm transition-colors',
                      period === option
                        ? 'border-primary font-medium text-primary'
                        : 'border-transparent text-secondary-text hover:text-foreground'
                    )}
                  >
                    {t(PERIOD_LABEL_KEYS[option])}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => void loadDashboard()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                {t('usage.refresh')}
              </button>
            </div>
          )}
        />

        {error ? <ApiErrorAlert error={error} actionLabel={t('common.retry')} onAction={() => void loadDashboard()} /> : null}

        {loading && !dashboard ? (
          <p role="status" className="border-y border-border py-10 text-sm text-secondary-text">{t('common.loading')}</p>
        ) : null}

        {dashboard ? (
          <>
            {loading && <p role="status" className="text-sm text-secondary-text">{tx('正在更新，暂时保留上次数据。')}</p>}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 sm:grid-cols-4" aria-busy={loading}>
              {[
                [t('usage.totalTokens'), dashboard.totalTokens, t('usage.dateRange', { from: dashboard.fromDate, to: dashboard.toDate })],
                [t('usage.totalCalls'), dashboard.totalCalls, t('usage.totalCallsHint')],
                [t('usage.promptTokens'), dashboard.totalPromptTokens, t('usage.promptTokensHint')],
                [t('usage.completionTokens'), dashboard.totalCompletionTokens, t('usage.completionTokensHint')],
              ].map(([label, value, hint]) => <div key={label} className="min-w-0"><dt className="text-xs text-secondary-text">{label}</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{formatNumber(Number(value), language)}</dd><p className="mt-2 text-xs leading-5 text-secondary-text">{hint}</p></div>)}
            </dl>
            <div className="space-y-2 text-xs leading-6 text-secondary-text">
              <p><strong className="font-medium">{t('usage.attributionTitle')}: </strong>{t('usage.attributionDescription', { attributed: formatNumber(dashboard.attributedCalls, language), unattributed: formatNumber(dashboard.unattributedCalls, language) })}</p>
              {hasPartialTokenDetail && <p className="text-warning"><strong className="font-medium">{t('usage.partialCoverageTitle')}: </strong>{t('usage.partialCoverageDescription', { detailed: formatNumber(dashboard.totalPromptTokens + dashboard.totalCompletionTokens, language), total: formatNumber(dashboard.totalTokens, language) })}</p>}
            </div>

            {dashboard.totalCalls === 0 ? (
              <EmptyState title={t('usage.emptyTitle')} description={t('usage.emptyDescription')} />
            ) : (
              <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
                <section className="min-w-0 space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{t('usage.modelUsage')}</h2>
                    <p className="mt-1 text-sm text-secondary-text">{t('usage.modelUsageDescription')}</p>
                  </div>
                  <ul className="border-y border-border" aria-label={t('usage.modelUsage')}>
                    {dashboard.byModel.map((model) => (
                      <ModelUsageRow key={model.model} model={model} language={language} t={t} />
                    ))}
                  </ul>
                </section>

                <section className="space-y-4">
                  <h2 className="text-lg font-semibold text-foreground">{t('usage.callTypeTitle')}</h2>
                  <p className="text-sm text-secondary-text">{t('usage.breakdown')}</p>
                    <div className="space-y-4 border-y border-border py-4">
                      {dashboard.byCallType.map((item) => (
                        <div key={item.callType}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">{getCallTypeLabel(item.callType, t)}</span>
                            <span className="text-secondary-text">{formatNumber(item.totalTokens, language)} tokens</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border/70">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.max(4, (item.totalTokens / largestCallTypeTotal) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-secondary-text">
                            {t('usage.callTypeDetail', {
                              calls: formatNumber(item.calls, language),
                              prompt: formatNumber(item.promptTokens, language),
                              completion: formatNumber(item.completionTokens, language),
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                </section>
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t('usage.recentCalls')}</h2>
                  <p className="mt-1 text-sm text-secondary-text">{t('usage.recentCallsDescription')}</p>
                </div>
                <Clock3 className="h-5 w-5 text-secondary-text" />
              </div>
              <div className="min-w-0 border-y border-border">
                <div className="max-w-full overflow-x-auto">
                  <table className="min-w-full divide-y divide-border/70 text-sm" aria-label={t('usage.recentCalls')}>
                    <thead className="text-left text-xs text-secondary-text">
                      <tr>
                        <th className="px-4 py-3 font-medium">{t('usage.table.time')}</th>
                        <th className="px-4 py-3 font-medium">{t('usage.table.type')}</th>
                        <th className="px-4 py-3 font-medium">{t('usage.table.model')}</th>
                        <th className="px-4 py-3 font-medium">{t('usage.table.source')}</th>
                        <th className="px-4 py-3 text-right font-medium">Prompt</th>
                        <th className="px-4 py-3 text-right font-medium">Completion</th>
                        <th className="px-4 py-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {dashboard.recentCalls.length ? dashboard.recentCalls.map((item) => (
                        <tr key={item.id} className="hover:bg-hover/60">
                          <td className="whitespace-nowrap px-4 py-3 text-secondary-text">{formatDateTime(item.calledAt, language)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">{getCallTypeLabel(item.callType, t)}</td>
                          <td className="min-w-56 px-4 py-3">
                            <div className="max-w-[18rem] truncate font-medium text-foreground">{item.model}</div>
                            {item.stockCode ? <div className="text-xs text-secondary-text">{item.stockCode}</div> : null}
                          </td>
                          <td className="min-w-48 px-4 py-3">
                            {item.strategyVersionId ? (
                              <div className="space-y-0.5">
                                <div className="font-medium text-foreground">
                                  {t('usage.strategyVersion', { version: item.strategyVersionId })}
                                </div>
                                {item.strategyRunId ? (
                                  <div className="text-xs text-secondary-text">
                                    {t('usage.strategyRun', { run: item.strategyRunId })}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-xs text-secondary-text">{t('usage.compatibilitySource')}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-secondary-text">{formatNumber(item.promptTokens, language)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-secondary-text">{formatNumber(item.completionTokens, language)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-foreground">{formatNumber(item.totalTokens, language)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-secondary-text">{t('usage.noRecentCalls')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppPage>
  );
};

export default TokenUsagePage;
