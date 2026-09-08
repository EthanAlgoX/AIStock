import { useUiLanguage } from '../../contexts/UiLanguageContext';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Recorded scores and allocations, never inferred returns or portfolio holdings. */
export function DecisionReportVisuals({ data, kind }: { data: Record<string, unknown>; kind: 'screening' | 'trading' }) {
  const { localize: l, language } = useUiLanguage();
  const screening = kind === 'screening';
  const rows = (Array.isArray(data.candidates) ? data.candidates : Array.isArray(data.actions) ? data.actions : []).map(record);
  const format = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 });
  const counts = [
    [l('扫描范围', 'Scanned universe'), data.snapshot_count ?? data.snapshotCount],
    [l('过滤后', 'After filtering'), data.after_filter_count ?? data.afterFilterCount],
    [l('最终候选', 'Final candidates'), rows.length],
  ];
  return <section aria-label={screening ? l('选股结果概览', 'Screening result overview') : l('提案仓位对照', 'Proposed allocation comparison')} className="my-6 rounded-xl border border-border p-4 sm:p-6 text-foreground">
    {screening && <ol className="mb-6 grid grid-cols-3 gap-3 border-b border-border pb-5">{counts.map(([label, value]) => <li key={String(label)}><p className="text-xs text-secondary-text">{String(label)}</p><p className="mt-2 text-xl font-semibold tabular-nums">{finite(value) && value >= 0 ? format(value) : '—'}</p></li>)}</ol>}
    <h4 className="text-base font-semibold text-foreground">{screening ? l('候选评分对照', 'Candidate score comparison') : l('提案仓位对照', 'Proposed allocation comparison')}</h4>
    <p className="mt-2 text-xs leading-6 text-secondary-text">{screening ? l('保持策略返回顺序。评分为 0–100 的策略内部评分，不代表收益率。', 'Original strategy order. Scores use a 0–100 strategy scale, not returns.') : l('每项独立展示占权益的建议比例，不相加推断持仓或剩余现金；不代表已经建仓。', 'Each proposed equity weight is shown separately; no holdings or cash balance are inferred. These are not executed positions.')}</p>
    <div className="mt-5 space-y-5">{rows.map((row, index) => {
      const value = screening ? row.score : row.position_pct_of_equity ?? row.positionPctOfEquity ?? row.targetWeightPercent;
      const valid = finite(value) && value >= 0 && value <= 100;
      const name = String(row.name || row.symbol || row.code || row.ticker || row.stock || l(`标的 ${index + 1}`, `Instrument ${index + 1}`));
      return <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_3.5rem] items-center gap-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{name}</p><p className="text-xs text-secondary-text">{String(row.code || row.symbol || row.ticker || '')}</p></div>{valid ? <div role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2.5 overflow-hidden rounded-full bg-border"><div className="h-full bg-primary" style={{ width: `${value}%` }} /></div> : <p className="text-xs text-secondary-text">{l('未记录有效数值', 'No valid value recorded')}</p>}<span className="text-right tabular-nums">{valid ? `${format(value)}${screening ? '' : '%'}` : '—'}</span></div>;
    })}</div>
    {!rows.length && <p className="mt-4 text-sm text-secondary-text">{screening ? l('本次没有符合条件的候选。', 'No candidates matched this run.') : l('本次未列出操作提案。', 'No actions were proposed.')}</p>}
  </section>;
}
