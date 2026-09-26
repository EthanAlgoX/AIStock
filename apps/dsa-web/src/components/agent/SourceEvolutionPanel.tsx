import { useEffect, useState } from 'react';
import { simulationOverviewApi, type SourceEvolution } from '../../api/portfolios';
import { useUiLiteral } from '../../hooks/useUiLiteral';
import { toApiErrorMessage } from '../../api/error';

export function SourceEvolutionPanel({id}: {id: number}) {
  const t = useUiLiteral();
  const [records, setRecords] = useState<SourceEvolution[]>([]);
  const [supported, setSupported] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const result = await simulationOverviewApi.evolution(id); if (active) { setRecords(result.items); setSupported(result.supported); setLoaded(true); setError(''); } }
      catch(e) { if (active) setError(toApiErrorMessage(e)); }
      finally { if (active) timer = setTimeout(load, 5000); }
    };
    void load(); return () => { active = false; clearTimeout(timer); };
  }, [id]);
  const running = records.some(row => ['RUNNING','PENDING'].includes(row.status));
  const run = async () => {
    setBusy(true); setError('');
    try { const result = await simulationOverviewApi.evolve(id,limit/100); setRecords(result.items); }
    catch(e) { setError(toApiErrorMessage(e)); } finally { setBusy(false); }
  };
  return <section className="py-4" aria-label={t('来源策略自进化')}>
    <p className="max-w-3xl text-sm leading-6 text-secondary-text">{t('复用来源引擎与冻结样本筛选参数候选，保留训练和验证口径。最终检查是否完成会单独标记；不调用生成模型，不替换当前模拟账户。')}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">{t('回撤上限')} (%)<input className="mt-1 block w-28 rounded border border-border bg-background p-2" type="number" min={1} max={80} value={limit} onChange={e=>setLimit(Number(e.target.value))} /></label><button className="btn-secondary" disabled={!loaded || !supported || busy || running || !Number.isFinite(limit) || limit < 1 || limit > 80} onClick={() => void run()}>{t(busy || running ? '正在计算' : '运行参数实验')}</button></div>
    {loaded && !supported && <p className="mt-3 text-sm text-secondary-text">{t('此版本尚无可复核的无模型参数搜索合同，可查看回测与原始决策；不会擅自调用模型补做历史预测。')}</p>}
    {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
    {records.map(row => <details className="mt-4 border-t border-border py-3" key={row.id} open={running && row.status === 'RUNNING'}><summary className="cursor-pointer font-medium">#{row.id.slice(0,8)} · {t(row.status === 'SUCCEEDED' ? row.passed ? '检查通过' : row.candidateVersion && !row.finalChecked ? '验证候选，待最终检查' : '没有合格候选' : row.status === 'FAILED' ? '研究失败' : row.status === 'CANCELLED' ? '已取消' : '正在计算')} · {row.completed}/{row.budget}</summary>
      {row.candidateVersion && <p className="mt-3 text-sm">{t('候选版本')} · {row.candidateVersion}</p>}
      <p className="mt-2 text-xs text-secondary-text">{t('候选仅供研究，需独立模拟验证。重复使用历史样本不等于新的盲测。')}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['实验','验证夏普','累计收益','最大回撤'].map(label => <th className="p-2" key={label}>{t(label)}</th>)}</tr></thead><tbody>{row.experiments.map(ex => <tr className="border-t border-border" key={ex.ordinal}><td className="p-2">#{ex.ordinal}</td><td className="p-2">{ex.validation_metrics_json?.sharpe?.toFixed(2) ?? '—'}</td><td className="p-2">{ex.validation_metrics_json?.total_return == null ? '—' : `${(ex.validation_metrics_json.total_return*100).toFixed(2)}%`}</td><td className="p-2">{ex.validation_metrics_json?.max_drawdown == null ? '—' : `${Math.abs(ex.validation_metrics_json.max_drawdown*100).toFixed(2)}%`}</td></tr>)}</tbody></table></div>
      <details className="mt-3"><summary className="cursor-pointer text-sm text-primary">{t('查看来源评测与实验记录')}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({evaluation:row.evaluation,holdout:row.holdout,experiments:row.experiments},null,2)}</pre></details>
    </details>)}
  </section>;
}
