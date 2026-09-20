import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { strategyDraftsApi, type StrategyDraftState, type StrategyKind } from '../../api/strategyDrafts';
import { toApiErrorMessage } from '../../api/error';
import { generateUUID } from '../../utils/uuid';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const kinds: StrategyKind[] = ['research', 'screening', 'trading'];
const names = { research: ['个股研究方法', 'Research method'], screening: ['选股策略', 'Screening strategy'], trading: ['交易推演策略', 'Trading simulation strategy'] };

export default function StrategyAuthoringPanel({ sessionId, messageCount, loading, hasDiscussion, onCreated, onMode, compact = false }: {
  compact?: boolean;
  sessionId: string; messageCount: number; loading: boolean; hasDiscussion: boolean;
  onCreated: (id: string, carry: boolean) => void;
  onMode: (state: StrategyDraftState | null) => void;
}) {
  const { localize: l } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, setState] = useState<StrategyDraftState | null>(null);
  const [kind, setKind] = useState<StrategyKind>('trading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (loading) return;
    strategyDraftsApi.sync(sessionId).then((next) => {
      if (active) { setState(next); onMode(next); setError(''); }
    }).catch((e) => { if (active) setError(toApiErrorMessage(e)); });
    return () => { active = false; };
  }, [sessionId, messageCount, loading, retry, onMode]);

  const begin = async (carry: boolean) => {
    setBusy(true); setError('');
    try {
      const id = generateUUID();
      const next = await strategyDraftsApi.begin(id, kind);
      if (!mounted.current) return;
      onMode(next);
      onCreated(id, carry);
    } catch (e) { setError(toApiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const act = async (action: 'validate' | 'save') => {
    if (!state) return;
    setBusy(true); setError('');
    try {
      const next = await strategyDraftsApi[action](sessionId, state.revision);
      if (!mounted.current) return;
      setState(next); onMode(next);
    } catch (e) { setError(toApiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const disabled = busy || loading;
  const panel = <section aria-label={l('策略创建', 'Strategy authoring')} className="rounded-lg border border-border bg-card p-3 text-sm">
    {state ? <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{l(names[state.kind][0], names[state.kind][1])} · {state.draft.name || l('新策略', 'New strategy')}</strong>
        <span role="status" className="text-xs text-secondary-text">{loading ? l('正在讨论', 'Discussing') : state.publishedStrategyId ? l('已发布到交易推演', 'Published to simulation') : state.skillId ? l('已保存 Skill', 'Skill saved') : state.validated ? l('完整性检查通过', 'Completeness checked') : l('草稿', 'Draft')} · r{state.revision}</span>
      </div>
      {!!state.draft.missing?.length && <p className="mt-1 text-xs text-secondary-text">{l(`还有 ${state.draft.missing.length} 项待确认`, `${state.draft.missing.length} open questions`)}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer py-1 text-primary">{l('查看策略草稿与发布操作', 'View draft and publishing actions')}</summary>
        <div className="mt-2 max-h-[min(20dvh,8rem)] space-y-3 sm:max-h-64 overflow-y-auto pr-2">
          {(['objective', 'scope', 'method', 'risk', 'data', 'execution'] as const).map((key, i) => <div key={key}>
            <h3 className="font-medium">{l(['目标', '股票范围', '策略方法', '风险约束', '所需数据', '运行与输出'][i], ['Objective', 'Stock scope', 'Method', 'Risk constraints', 'Required data', 'Execution and output'][i])}</h3>
            <p className="whitespace-pre-wrap break-words text-secondary-text">{state.draft[key] || l('待讨论确认', 'To be discussed')}</p>
          </div>)}
          {!!state.draft.missing?.length && <div><h3 className="font-medium">{l('待确认', 'Open questions')}</h3><ul className="list-disc pl-5">{state.draft.missing.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
        </div>
        {state.error && <p role="alert" className="mt-2 text-danger">{state.error}</p>}
        <p className="my-3 text-xs leading-5 text-secondary-text">{l('继续对话可修改。这里只检查完整性；行情、交易输出与收益需在目标模块试运行验证。', 'Continue chatting to revise. This checks completeness only; verify data, trading output and performance in the target module.')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={disabled || !state.revision || !!state.error} onClick={() => void act('validate')}>{l('检查策略完整性', 'Check completeness')}</button>
          <button type="button" className="btn-primary" disabled={disabled || !state.validated || !!state.skillId} onClick={() => void act('save')}>{l('保存为 Skill', 'Save as Skill')}</button>
          {state.skillId && state.kind === 'trading' && !loading && <Link className="btn-secondary" to={state.publishedStrategyId ? `/trading?strategy=${state.publishedStrategyId}` : `/trading?sourceSession=${encodeURIComponent(sessionId)}`}>{state.publishedStrategyId ? l('查看交易推演', 'View simulation') : l('配置交易推演', 'Configure simulation')}</Link>}
          {state.skillId && <Link className="btn-secondary" to="/capabilities/skills">{l('查看技能库', 'View skills')}</Link>}
        </div>
      </details>
    </> : <div className="flex flex-wrap items-center gap-2">
      <label className="text-secondary-text" htmlFor="strategy-kind">{l('创建策略', 'Create strategy')}</label>
      <select id="strategy-kind" value={kind} onChange={(e) => setKind(e.target.value as StrategyKind)} disabled={disabled} className="input-surface min-h-11 rounded-md px-2">
        {kinds.map((item) => <option key={item} value={item}>{l(names[item][0], names[item][1])}</option>)}
      </select>
      <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void begin(false)}>{l('开始创建', 'Start authoring')}</button>
      {hasDiscussion && <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void begin(true)}>{l('将当前讨论转为策略', 'Use this discussion')}</button>}
    </div>}
    {error && <div role="alert" className="mt-2 text-danger">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry((v) => v + 1)}>{l('重新读取', 'Reload')}</button></div>}
  </section>;
  if (!compact) return panel;
  return <div ref={container} className="shrink-0">
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="chat-strategy-authoring"
      onClick={() => setOpen((value) => !value)}
      className="inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {state ? l('策略创建', 'Strategy authoring') : l('创建策略', 'Create strategy')}
      <span aria-hidden="true" className="ml-1">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div id="chat-strategy-authoring" className="absolute left-3 right-3 top-full z-30 mt-1 max-h-[60dvh] overflow-y-auto rounded-lg bg-card shadow-lg sm:right-auto sm:w-[min(36rem,calc(100vw-3rem))]">
      {panel}
    </div>}
  </div>;
}
