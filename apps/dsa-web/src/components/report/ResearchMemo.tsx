import { useId, type ReactNode } from 'react';
import type { AnalysisReport } from '../../types/analysis';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { ReportMarkdownBody } from './ReportMarkdownBody';
import { ShareImageButton } from './ShareImageButton';
import { getMarketPhaseSummaryLabel, getPartialBarLabel } from '../../utils/marketPhase';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const words = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const lines = (value: unknown): string[] => Array.isArray(value) ? value.map(words).filter(Boolean) : words(value) ? [words(value)] : [];
const field = (value: Record<string, unknown>, camel: string, snake: string) => value[camel] ?? value[snake];

/** A reading surface over stored report evidence; never synthesizes research claims. */
export function ResearchMemo({ report, provenance }: { report: AnalysisReport; provenance: ReactNode }) {
  const { localize: l, language } = useUiLanguage();
  const id = useId();
  const { meta, summary, strategy, details } = report;
  const raw = record(details?.rawResult);
  const dashboard = record(raw.dashboard);
  const core = record(field(dashboard, 'coreConclusion', 'core_conclusion'));
  const attribution = record(field(dashboard, 'signalAttribution', 'signal_attribution'));
  const intelligence = record(dashboard.intelligence);
  const phase = record(field(dashboard, 'phaseDecision', 'phase_decision'));
  const support = [...new Set([
    ...lines(field(attribution, 'strongestBullishSignal', 'strongest_bullish_signal')),
    ...lines(field(intelligence, 'positiveCatalysts', 'positive_catalysts')),
  ])];
  const challenges = [...new Set([
    ...lines(field(attribution, 'strongestBearishSignal', 'strongest_bearish_signal')),
    ...lines(field(intelligence, 'riskAlerts', 'risk_alerts')),
  ])];
  const limitations = lines(field(phase, 'dataLimitations', 'data_limitations'));
  const watch = lines(field(phase, 'watchConditions', 'watch_conditions'));
  const thesis = words(field(core, 'oneSentence', 'one_sentence'));
  const narrative = record(details);
  const chapters = [
    [l('基本面研究', 'Fundamental research'), field(narrative, 'fundamentalAnalysis', 'fundamental_analysis')],
    [l('技术与量价', 'Technical and volume analysis'), field(narrative, 'technicalAnalysis', 'technical_analysis')],
    [l('事件与催化', 'Events and catalysts'), field(narrative, 'newsSummary', 'news_summary')],
    [l('风险与失效条件', 'Risks and invalidation'), field(narrative, 'riskWarning', 'risk_warning')],
  ].filter(([, content]) => words(content));
  const levels = [
    [l('首选观察区', 'Primary entry reference'), strategy?.idealBuy],
    [l('备选观察区', 'Secondary entry reference'), strategy?.secondaryBuy],
    [l('风险退出条件', 'Risk exit reference'), strategy?.stopLoss],
    [l('目标与兑现条件', 'Target and exit reference'), strategy?.takeProfit],
  ].filter(([, value]) => words(value));
  const dateValue = meta.createdAt || meta.marketPhaseSummary?.marketLocalTime;
  const date = dateValue ? new Date(dateValue) : null;
  const dateLabel = date && Number.isFinite(date.getTime()) ? date.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : l('报告未记录时间', 'Report time not recorded');
  const phaseLabel = getMarketPhaseSummaryLabel(meta.marketPhaseSummary, language);
  const partialLabel = meta.marketPhaseSummary?.isPartialBar === true ? getPartialBarLabel(language) : null;
  const sectionClass = 'scroll-mt-24 border-t border-border py-7 sm:py-9';
  const evidenceList = (items: string[]) => items.length ? <ul className="divide-y divide-border/60">{items.map((item, index) => <li key={index} className="py-3 first:pt-0 last:pb-0"><ReportMarkdownBody content={item} /></li>)}</ul> : <p className="text-sm leading-7 text-secondary-text">{l('报告未单独列出这一项，请结合研究正文判断。', 'This report does not list this evidence separately. Refer to the research narrative.')}</p>;

  return <article className="research-memo min-w-0 text-foreground [&_.home-markdown-prose]:text-secondary-text [&_.home-markdown-prose_p]:leading-7" aria-label={l('投研备忘录', 'Research memorandum')}>
    {/* THESIS: conclusions with inspectable counterevidence, not a sentiment dashboard.
        OWN-WORLD: incumbent neutral surfaces, cobalt navigation, divided document.
        STORY: understand the claim, inspect its limits, then review conditions.
        FIRST VIEWPORT: stock masthead, thesis and evidence; compact source margin.
        FORM: approved A memorandum with B evidence comparison; semantic HTML. */}
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pb-5 sm:gap-5 sm:pb-6">
      <div className="min-w-0"><p className="mb-2 text-xs font-medium text-secondary-text">InvestCrew · {l('投研备忘录', 'Research memorandum')}</p><h2 className="break-words text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">{meta.stockName || meta.stockCode}</h2><p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary-text"><span>{meta.stockCode}</span><span>{dateLabel}</span></p></div>
      <div className="flex items-start gap-4"><div className="max-w-28 text-right sm:max-w-none"><p className="text-xs text-secondary-text">{l('报告价格快照', 'Report price snapshot')}</p><p className="mt-1 text-xl sm:text-2xl font-semibold tabular-nums text-foreground">{typeof meta.currentPrice === 'number' && Number.isFinite(meta.currentPrice) ? meta.currentPrice.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</p>{typeof meta.changePct === 'number' && Number.isFinite(meta.changePct) && <p className="mt-1 text-sm tabular-nums text-secondary-text">{meta.changePct > 0 ? '+' : ''}{meta.changePct.toFixed(2)}%</p>}</div><ShareImageButton recordId={meta.id} reportTitle={`${meta.stockName || meta.stockCode}-${meta.stockCode}`} reportLanguage={language} /></div>
    </header>
    {(phaseLabel || partialLabel || limitations.length > 0) && <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs leading-6 text-secondary-text">{phaseLabel && <span>{phaseLabel}</span>}{partialLabel && <span className="text-warning">{partialLabel}</span>}{limitations.length > 0 && <a href={`#${id}-boundaries`} className="text-primary underline underline-offset-4">{l(`报告记录了 ${limitations.length} 项数据限制`, `${limitations.length} data limitations recorded`)}</a>}</div>}
    <nav aria-label={l('报告阅读目录', 'Report contents')} className="flex flex-wrap gap-x-6 border-t border-border text-sm">
      {[["conclusion", l('研究结论', 'Conclusion')], ["evidence", l('证据对照', 'Evidence')], ["conditions", l('观察与行动条件', 'Conditions')], ["sources", l('来源与运行记录', 'Sources and run record')]].map(([key, label]) => <a key={key} href={`#${id}-${key}`} className="inline-flex min-h-11 items-center text-secondary-text hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{label}</a>)}
    </nav>
    <div className="grid min-w-0 gap-x-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        <section id={`${id}-conclusion`} className={sectionClass}>
          <p className="mb-3 text-sm font-medium text-secondary-text">{l('核心判断', 'Research thesis')}</p>
          <h3 className="max-w-[32ch] text-2xl font-semibold leading-snug tracking-tight text-foreground sm:text-3xl">{thesis || summary.operationAdvice || l('研究摘要', 'Research summary')}</h3>
          <div className="mt-5 max-w-[75ch] text-base leading-8"><ReportMarkdownBody content={summary.analysisSummary || l('报告未提供研究摘要。', 'No research summary was recorded.')} /></div>
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">{[[l('行动倾向', 'Action view'), summary.operationAdvice], [l('趋势判断', 'Trend view'), summary.trendPrediction], [l('适用周期', 'Time horizon'), field(core, 'timeSensitivity', 'time_sensitivity')]].filter(([, value]) => words(value)).map(([label, value]) => <div key={String(label)}><dt className="text-xs text-secondary-text">{String(label)}</dt><dd className="mt-1 text-foreground">{words(value)}</dd></div>)}</dl>
        </section>
        <section id={`${id}-evidence`} className={sectionClass}>
          <h3 className="text-lg font-semibold">{l('证据对照', 'Evidence comparison')}</h3><p className="mt-2 text-xs leading-6 text-secondary-text">{l('以下为原报告记录的判断依据，不代表独立核验或专家共识。', 'These are the report’s recorded arguments, not independent verification or expert consensus.')}</p>
          <div className="mt-6 grid gap-6 md:grid-cols-2"><section className="min-w-0"><h4 className="mb-4 text-sm font-semibold">{l('正向信号与催化', 'Positive signals and catalysts')}</h4>{evidenceList(support)}</section><section className="min-w-0 md:border-l md:border-border md:pl-6"><h4 className="mb-4 text-sm font-semibold">{l('负向信号与风险', 'Negative signals and risks')}</h4>{evidenceList(challenges)}</section></div>
        </section>
        {chapters.map(([label, content]) => <section key={String(label)} className={sectionClass}><h3 className="mb-4 text-lg font-semibold">{String(label)}</h3><ReportMarkdownBody content={words(content)} /></section>)}
        <section id={`${id}-conditions`} className={sectionClass}>
          <h3 className="text-lg font-semibold">{l('观察与行动条件', 'Observation and action conditions')}</h3><p className="mt-2 text-xs leading-6 text-secondary-text">{l('保留报告中的价格、前提与失效条件；不是实时信号或已执行订单。', 'Prices, prerequisites, and invalidation conditions are preserved from the report; these are not live signals or executed orders.')}</p>
          {levels.length ? <dl className="mt-5 divide-y divide-border">{levels.map(([label, value]) => <div key={label} className="grid gap-2 py-4 sm:grid-cols-[150px_minmax(0,1fr)]"><dt className="text-sm text-secondary-text">{label}</dt><dd className="min-w-0 text-sm leading-7"><ReportMarkdownBody content={value!} /></dd></div>)}</dl> : <p className="mt-5 text-sm text-secondary-text">{l('本报告未提供价格条件，不补造点位。', 'No price conditions were recorded; none are inferred.')}</p>}
          {watch.length > 0 && <div className="mt-6"><h4 className="mb-4 text-sm font-semibold">{l('下一次研究要回答的问题', 'Questions for the next review')}</h4>{evidenceList(watch)}</div>}
        </section>
      </div>
      <aside id={`${id}-boundaries`} aria-label={l('研究边界', 'Research boundaries')} className="min-w-0 scroll-mt-24 border-t border-border py-7 xl:border-l xl:pl-6">
        <h3 className="text-sm font-semibold">{l('研究边界', 'Research boundaries')}</h3><p className="mt-3 text-xs leading-6 text-secondary-text">{l('历史报告不随行情自动更新。资料缺失不等于没有风险。', 'Historical reports do not update with the market. Missing information does not mean no risk.')}</p>
        {!!details?.belongBoards?.length && <div className="mt-5 text-xs leading-6"><h4 className="font-medium">{l('相关板块', 'Related sectors')}</h4><p className="mt-2 text-secondary-text">{details.belongBoards.map(board => board.name).filter(Boolean).join(' · ')}</p></div>}
        <div className="mt-6 border-t border-border pt-5"><h4 className="mb-3 text-sm font-medium">{l('已记录的数据限制', 'Recorded data limitations')}</h4>{limitations.length ? evidenceList(limitations) : <p className="text-xs leading-6 text-secondary-text">{l('未单独记录。请查看来源与运行诊断，不据此推断数据完整。', 'Not separately recorded. Review sources and diagnostics; completeness cannot be inferred.')}</p>}</div>
        {typeof summary.sentimentScore === 'number' && Number.isFinite(summary.sentimentScore) && summary.sentimentScore >= 0 && summary.sentimentScore <= 100 && <details className="mt-6 border-t border-border pt-4 text-xs"><summary className="cursor-pointer py-2 text-secondary-text">{l('辅助情绪指标', 'Supplementary sentiment indicator')}</summary><p className="mt-2 tabular-nums">{summary.sentimentScore} / 100</p><p className="mt-2 leading-6 text-secondary-text">{l('模型报告评分，不是获利概率，也不是独立市场恐慌指数。', 'A model report score, not a profit probability or an independent market fear index.')}</p></details>}
      </aside>
    </div>
    <section id={`${id}-sources`} className={sectionClass}><h3 className="mb-4 text-lg font-semibold">{l('来源与运行记录', 'Sources and run record')}</h3>{provenance}</section>
  </article>;
}
