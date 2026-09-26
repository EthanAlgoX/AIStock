import { useEffect, useState } from 'react';
import { portfolioResearchApi, type Portfolio, type PortfolioResearch } from '../../api/portfolios';
import { useUiLiteral } from '../../hooks/useUiLiteral';
import { toApiErrorMessage } from '../../api/error';

const reasons: Record<string, string> = {
  passed: '检查通过', no_candidate: '没有合格候选', invalid_score: '夏普无法计算',
  no_trades: '没有成交', drawdown_limit: '超过回撤上限', no_improvement: '夏普提升不足', train_regression: '训练表现退化',
};
const fields: Record<string, string> = {
  cryptoLookbackDays: '观察周期', cryptoRebalanceDays: '调仓间隔', cryptoAllocation: '投入比例', cryptoTopN: '成交额候选数',
  gridLookbackDays: '观察周期', gridMinVolumeRatio: '最低量比', gridMinRange: '最低区间波动', gridLevels: '网格层数',
};
export function PortfolioResearchPanel({portfolio, onAdopt}: {portfolio: Portfolio; onAdopt: (id: number) => void}) {
  const t = useUiLiteral();
  const [records, setRecords] = useState<PortfolioResearch[]>([]);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    portfolioResearchApi.list(portfolio.id).then(rows => { if (active) setRecords(rows); })
      .catch(e => { if (active) setError(toApiErrorMessage(e)); });
    return () => { active = false; };
  }, [portfolio.id]);
  const eligible = portfolio.status === 'completed' && (portfolio.days?.length ?? 0) >= 100
    && (portfolio.config.scopeRefresh ?? 'snapshot') === 'snapshot';
  const run = async () => {
    setBusy(true); setError('');
    try {
      const result = await portfolioResearchApi.create(portfolio.id, limit / 100);
      setRecords(old => [result, ...old.filter(row => row.id !== result.id)]);
    } catch(e) { setError(toApiErrorMessage(e)); } finally { setBusy(false); }
  };
  const fmt = (n: number | null, percent = false) => n == null ? '—' : `${(n * (percent ? 100 : 1)).toFixed(2)}${percent ? '%' : ''}`;
  return <section className="my-6 border-b border-border pb-5" aria-label={t('参数优化')}>
    <h3 className="font-semibold">{t('参数优化')}</h3>
    <p className="mt-2 max-w-3xl text-sm text-secondary-text">{t('复用冻结行情，按时间分为 60% 训练、20% 验证、20% 最终检查。自动尝试单参数变化，不调用模型；通过后另存候选，不替换运行策略。')}</p>
    <p className="mt-2 text-xs text-secondary-text">{t('最终检查属于历史样本，反复研究后不再是盲测。每段重新投入初始资金，费用和规则保持一致；仍需未来模拟验证。')}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">{t('回撤上限')} (%)<input type="number" min="1" max="80" value={limit} onChange={e => setLimit(Number(e.target.value))} className="mt-1 block w-28 rounded border border-border bg-background p-2" /></label>
      <button className="btn-secondary" disabled={busy || !eligible || limit < 1 || limit > 80} onClick={() => void run()}>{t(busy ? '正在计算' : '运行参数实验')}</button>
    </div>
    {!eligible && <p className="mt-2 text-sm text-secondary-text">{t('请先完成至少 100 个交易日的固定候选池规则回测。')}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {records.map(record => <details key={record.id} className="mt-4 border-t border-border pt-3" open={records[0].id === record.id}>
      <summary className="cursor-pointer text-sm font-medium">#{record.id} · {t(reasons[record.finalReason] || '没有合格候选')}</summary>
      <p className="mt-2 text-xs text-secondary-text">{t('行情样本指纹')} · {record.sampleHash.slice(0, 12)}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['评测阶段', '日期', '基线夏普', '候选夏普', '最大回撤'].map(x => <th className="p-2" key={x}>{t(x)}</th>)}</tr></thead><tbody>{Object.entries(record.windows).map(([key, window]) => {
        const candidate = key === 'final' ? record.final : record.bestIndex == null ? null : record.experiments[record.bestIndex][key as 'train' | 'validation'];
        return <tr className="border-t border-border" key={key}><td className="p-2">{t({train:'训练', validation:'验证', final:'最终检查'}[key] || key)}</td><td className="p-2 whitespace-nowrap">{window.start} — {window.end}</td><td className="p-2">{fmt(record.baseline[key].sharpe)}</td><td className="p-2">{fmt(candidate?.sharpe ?? null)}</td><td className="p-2">{fmt(candidate?.maxDrawdown ?? null, true)}</td></tr>;
      })}</tbody></table></div>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['参数', '变化', '验证夏普', '结果'].map(x => <th className="p-2" key={x}>{t(x)}</th>)}</tr></thead><tbody>{record.experiments.map((row, i) => <tr className="border-t border-border" key={i}><td className="p-2">{t(fields[row.field] || row.field)}</td><td className="p-2">{row.before} → {row.after}</td><td className="p-2">{fmt(row.validation.sharpe)}</td><td className="p-2">{t(reasons[row.reason])}</td></tr>)}</tbody></table></div>
      {record.accepted && <button className="btn-secondary mt-3" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { const result = await portfolioResearchApi.adopt(record.id); onAdopt(result.id); }
        catch(e) { setError(toApiErrorMessage(e)); } finally { setBusy(false); }
      }}>{t(record.candidateDefinitionId ? '查看候选策略' : '另存候选策略')}</button>}
    </details>)}
  </section>;
}
