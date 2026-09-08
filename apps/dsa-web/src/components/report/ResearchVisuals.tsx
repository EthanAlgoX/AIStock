import type { AnalysisReport } from '../../types/analysis';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const get = (value: Record<string, unknown>, camel: string, snake: string) => value[camel] ?? value[snake];
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Plot recorded numeric fields only; prose conditions are never converted to prices. */
export function ResearchVisuals({ report }: { report: AnalysisReport }) {
  const { localize: l, language } = useUiLanguage();
  const dashboard = object(object(report.details?.rawResult).dashboard);
  const data = object(get(dashboard, 'dataPerspective', 'data_perspective'));
  const position = object(get(data, 'pricePosition', 'price_position'));
  const trend = object(get(data, 'trendStatus', 'trend_status'));
  const volume = object(get(data, 'volumeAnalysis', 'volume_analysis'));
  const current = number(report.meta.currentPrice) ?? number(get(position, 'currentPrice', 'current_price'));
  const points = [
    { label: l('报告价格', 'Report price'), value: current, current: true },
    { label: l('支撑位', 'Support'), value: number(get(position, 'supportLevel', 'support_level')), current: false },
    { label: l('阻力位', 'Resistance'), value: number(get(position, 'resistanceLevel', 'resistance_level')), current: false },
    ...['ma5', 'ma10', 'ma20'].map(key => ({ label: key.toUpperCase(), value: number(position[key]), current: false })),
  ].filter((point): point is typeof point & { value: number } => point.value !== null && point.value > 0);
  const low = points.length ? Math.min(...points.map(point => point.value)) : 0;
  const high = points.length ? Math.max(...points.map(point => point.value)) : 0;
  const padding = Math.max((high - low) * 0.15, high * 0.005);
  const coordinate = (value: number) => 12 + (high - value + padding) / (high - low + padding * 2) * 216;
  const format = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 });
  const scores = [
    { label: l('报告情绪', 'Report sentiment'), value: number(report.summary.sentimentScore) },
    { label: l('趋势评分', 'Trend score'), value: number(get(trend, 'trendScore', 'trend_score')) },
  ];
  const metrics = [
    { label: l('量比', 'Volume ratio'), value: number(get(volume, 'volumeRatio', 'volume_ratio')), suffix: '×' },
    { label: l('换手率', 'Turnover'), value: number(get(volume, 'turnoverRate', 'turnover_rate')), suffix: '%' },
    { label: l('MA5 乖离', 'MA5 deviation'), value: number(get(position, 'biasMa5', 'bias_ma5')), suffix: '%' },
  ];
  return <section aria-label={l('量价与信号概览', 'Price and signal overview')} className="border-t border-border py-6">
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-lg font-semibold">{l('量价与信号概览', 'Price and signal overview')}</h3><p className="text-xs text-secondary-text">{l('报告快照 · 非实时行情', 'Report snapshot · Not live market data')}</p></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4">{scores.map(score => {
          const valid = score.value !== null && score.value >= 0 && score.value <= 100;
          return <div key={score.label} className="min-w-0 text-center">
            <h4 className="text-sm font-medium">{score.label}</h4>
            <div {...(valid ? { role: 'meter', 'aria-label': score.label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': score.value! } : {})} className="relative mx-auto mt-3 w-full max-w-48">
              <svg viewBox="0 0 200 156" className="w-full" aria-hidden="true">
                <path d="M 28 126 A 84 84 0 1 1 172 126" pathLength="100" fill="none" stroke="currentColor" strokeWidth="10" className="text-border" />
                {valid && <path d="M 28 126 A 84 84 0 1 1 172 126" pathLength="100" fill="none" stroke="currentColor" strokeWidth="10" strokeDasharray={`${score.value} 100`} className="text-primary" />}
                <text x="100" y="96" textAnchor="middle" fill="currentColor" fontSize="38" fontWeight="600">{valid ? score.value : '—'}</text>
                <text x="100" y="119" textAnchor="middle" fill="currentColor" fontSize="12" className="text-secondary-text">/ 100</text>
                <text x="23" y="150" textAnchor="middle" fill="currentColor" fontSize="11" className="text-secondary-text">0</text>
                <text x="177" y="150" textAnchor="middle" fill="currentColor" fontSize="11" className="text-secondary-text">100</text>
              </svg>
            </div>
            {!valid && <p className="text-xs text-secondary-text">{l('报告未记录有效评分', 'No valid score recorded')}</p>}
          </div>;
        })}</div>
        <p className="mt-3 text-xs leading-5 text-secondary-text">{l('模型报告评分，不是获利概率或独立市场指数。', 'Model report scores, not profit probabilities or independent market indices.')}</p>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">{metrics.map(metric => <div key={metric.label}><dt className="text-xs text-secondary-text">{metric.label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums text-foreground">{metric.value === null ? '—' : `${format(metric.value)}${metric.suffix}`}</dd></div>)}</dl>
      </div>
      <figure className="min-w-0 p-1 sm:p-2">
        <figcaption className="mb-4 text-sm font-medium">{l('价格位置 · 均线与支撑阻力', 'Price position · Moving averages and levels')}</figcaption>
        {points.length >= 2 ? <>
          <div className="grid grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)] gap-3">
            <svg viewBox="0 0 140 240" preserveAspectRatio="none" className="h-60 w-full" aria-hidden="true">
              <rect x="24" y="12" width="44" height="216" rx="4" fill="currentColor" className="text-border" opacity="0.35" />
              <line x1="46" x2="46" y1="12" y2="228" stroke="currentColor" className="text-border" />
              {[...points].sort((a, b) => b.value - a.value).map((point, index) => <g key={point.label} className={point.current ? 'text-primary' : 'text-secondary-text'}>
                <path d={`M 46 ${coordinate(point.value)} H 76 L 118 ${(index + 0.5) * 240 / points.length} H 140`} fill="none" stroke="currentColor" strokeWidth={point.current ? 2 : 1} opacity={point.current ? 1 : 0.5} />
                <circle cx="46" cy={coordinate(point.value)} r={point.current ? 5 : 3} fill="currentColor" />
              </g>)}
            </svg>
            <dl className="flex h-60 flex-col justify-around">{[...points].sort((a, b) => b.value - a.value).map(point => <div key={point.label} className={`flex items-center justify-between gap-2 text-xs ${point.current ? 'font-semibold text-primary' : 'text-secondary-text'}`}><dt>{point.label}</dt><dd className={`tabular-nums ${point.current ? 'text-primary' : 'text-foreground'}`}>{format(point.value)}</dd></div>)}</dl>
          </div>
          <p className="mt-4 text-xs leading-5 text-secondary-text">{l('纵轴为价格，高价在上；引线展开密集点位，不代表历史走势。', 'Vertical price scale, highest first. Leader lines separate clustered levels; this is not a historical chart.')}</p>
        </> : <p className="py-8 text-sm leading-6 text-secondary-text">{l('可用的数值点位不足，暂不绘图。文字中的操作条件仍完整保留。', 'Too few numeric levels to plot. Written action conditions are preserved below.')}</p>}
      </figure>
    </div>
  </section>;
}
