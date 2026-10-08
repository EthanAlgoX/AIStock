import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  sourceRuntimeApi, type SourceBacktest, type SourceCandidatePreview, type SourceEligibility,
  type SourceOperation, type SourceResearch, type SourceResearchPlan, type SourceRuntimeStatus,
  type SourceStrategy, type SourceTask, type SourceVersion,
} from '../../api/portfolios';
import { toApiErrorMessage } from '../../api/error';
import { useUiLiteral } from '../../hooks/useUiLiteral';
import { recordTime } from '../../utils/portfolioTiming';

type RequestSpec = { requestId: string; versionId: string; kind: SourceOperation['kind']; sourceBacktestId?: string; budget?: number; authoritativeUnknownSeen?: boolean };
const unresolved = (status: SourceOperation['status']) => ['PENDING', 'RUNNING', 'UNKNOWN'].includes(status);
const marketPriority: Record<string, number> = { US: 0, HK: 1, CN: 2, CRYPTO: 3 };
const cancellableTaskTypes = new Set(['EVOLUTION', 'BRIDGE_RESEARCH']);
const requestStorageKey = () => `dsa.source-runtime-request.${localStorage.getItem('investcrew.activeIdentity') || 'owner'}`;
function readPendingRequest(): RequestSpec | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(requestStorageKey()) || 'null');
    return saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.requestId)
      && /^[A-Za-z0-9_-]{1,80}$/.test(saved.versionId)
      && (saved.kind === 'candidate-paper' || (saved.kind === 'research' && /^[A-Za-z0-9_-]{1,80}$/.test(saved.sourceBacktestId)
        && Number.isInteger(saved.budget) && saved.budget >= 1 && saved.budget <= 16)) ? saved : null;
  } catch { return null; }
}
const unknownOperation = (spec: RequestSpec): SourceOperation => ({ requestId: spec.requestId, versionId: spec.versionId, kind: spec.kind, status: 'UNKNOWN', taskId: null, portfolioId: null, resultId: null, error: null, reused: false });
function persistPendingRequest(spec: RequestSpec) {
  try { sessionStorage.setItem(requestStorageKey(), JSON.stringify(spec)); } catch { /* Keep the same request in memory when browser storage is disabled. */ }
}
function matchingReceipt(spec: RequestSpec, receipt: SourceOperation): SourceOperation {
  if (receipt.requestId !== spec.requestId || receipt.kind !== spec.kind || receipt.versionId !== spec.versionId
    || (receipt.kind === 'candidate-paper' && receipt.status === 'SUCCEEDED' && (!Number.isInteger(receipt.portfolioId) || receipt.portfolioId! >= 0))) {
    throw new Error('来源回执与当前请求不匹配，请检查来源任务。');
  }
  return receipt;
}
const statuses: Record<string, string> = {
  PENDING: '等待运行', RUNNING: '正在运行', SUCCEEDED: '已完成', FAILED: '运行失败', CANCELLED: '已取消', UNKNOWN: '请求状态待确认',
  active: '计划运行中', paused: '计划已暂停', completed: '计划已完成', failed: '计划失败',
};
function Eligibility({ title, value }: { title: string; value: SourceEligibility }) {
  const t = useUiLiteral();
  return <div className="min-w-0 border-l-2 border-border pl-3">
    <h4 className="text-sm font-medium">{t(title)} · {t(value.available && value.eligible === true ? '具备资格' : value.available && value.eligible === false ? '不具备资格' : '资格待确认')}</h4>
    <p className="mt-1 break-words text-sm text-secondary-text">{value.reason || t(Object.keys(value.evidence).length ? '查看资格证据' : '来源尚未提供资格依据。')}</p>
    {value.policyId && <p className="mt-1 break-all text-xs text-secondary-text">{t('资格政策')} · {value.policyId}</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">{t('查看资格证据')}</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(value.evidence, null, 2)}</pre></details>
  </div>;
}

/** The source owns evaluations and accounts; this workspace only uses its declared bridge contract. */
export function SourceRuntimeWorkspace({ strategyId, versionId, onSelection, onAdopt }: {
  strategyId: number | null; versionId: string | null;
  onSelection: (strategy: number, version: string | null) => void; onAdopt: (id: number) => void;
}) {
  const t = useUiLiteral();
  const [runtime, setRuntime] = useState<SourceRuntimeStatus | null>(null);
  const [strategies, setStrategies] = useState<SourceStrategy[]>([]);
  const [initialStrategyId, setInitialStrategyId] = useState<number | null>(null);
  const [versions, setVersions] = useState<SourceVersion[]>([]);
  const [backtests, setBacktests] = useState<SourceBacktest[]>([]);
  const [research, setResearch] = useState<SourceResearch[]>([]);
  const [tasks, setTasks] = useState<SourceTask[]>([]);
  const [plans, setPlans] = useState<SourceResearchPlan[]>([]);
  const [preview, setPreview] = useState<SourceCandidatePreview | null>(null);
  const [selectedBacktest, setSelectedBacktest] = useState('');
  const [budget, setBudget] = useState(12);
  const [intervalHours, setIntervalHours] = useState(24);
  const [maxRuns, setMaxRuns] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [savedRequest] = useState(readPendingRequest);
  const [requestSpec, setRequestSpec] = useState<RequestSpec | null>(savedRequest);
  const [operation, setOperation] = useState<SourceOperation | null>(savedRequest ? unknownOperation(savedRequest) : null);
  const [requestError, setRequestError] = useState('');
  const [missingReceipt, setMissingReceipt] = useState(false);
  const receiptHistory = useRef({ requestId: savedRequest?.requestId ?? null, authoritativeUnknownSeen: savedRequest?.authoritativeUnknownSeen === true });
  const rememberReceipt = useCallback((spec: RequestSpec, receipt: SourceOperation) => {
    const checked = matchingReceipt(spec, receipt);
    const previouslyUnknown = receiptHistory.current.requestId === spec.requestId && receiptHistory.current.authoritativeUnknownSeen;
    const saved = { ...spec, authoritativeUnknownSeen: previouslyUnknown || spec.authoritativeUnknownSeen === true || checked.status === 'UNKNOWN' };
    receiptHistory.current = { requestId: spec.requestId, authoritativeUnknownSeen: saved.authoritativeUnknownSeen };
    persistPendingRequest(saved);
    setRequestSpec(saved); setOperation(checked);
  }, []);
  const capabilities = runtime?.capabilities;
  const readable = Boolean(runtime?.available && capabilities?.contractVersion === 'quantevo.ai-stock.v1' && capabilities.operations.read);
  const writable = readable && !error && !selectionError && !previewError && Boolean(capabilities?.asyncRequests && capabilities.idempotentRequests);
  const selectedStrategy = strategies.find(row => row.id === (strategyId ?? initialStrategyId));
  const selectedVersion = versionId ? versions.find(row => row.id === versionId) : versions.find(row => row.current) ?? versions[0];
  const currentVersions = selectedStrategy && versions.every(row => row.strategyId === selectedStrategy.id) ? versions : [];
  const version = selectedVersion && currentVersions.includes(selectedVersion) ? selectedVersion : null;
  const selectedSourceId = selectedStrategy?.id;
  const selectedVersionId = version?.id;
  const candidate = preview?.versionId === version?.id && preview?.strategyId === selectedSourceId ? preview : null;
  const samples = backtests.filter(row => row.versionId === version?.id);
  const sample = samples.find(row => row.id === selectedBacktest);
  const periodic = capabilities?.periodicResearch;
  const pending = operation && unresolved(operation.status);
  const budgetValid = Number.isInteger(budget) && budget >= 1 && budget <= Math.min(16, periodic?.maxBudgetPerCycle ?? 16);
  const canResearch = writable && capabilities?.operations.research && version?.current && version.researchSupported
    && sample?.complete === true && sample.researchSupported && budgetValid && !pending && !busy;
  const canPaper = writable && capabilities?.operations.candidatePaper && version?.executionSupported
    && candidate?.paperEligibility.available && candidate.paperEligibility.eligible === true && !pending && !busy;
  const intervalSeconds = intervalHours * 3600;
  const minimumInterval = Math.max(3600, periodic?.minIntervalSeconds ?? Infinity);
  const maximumCycles = Math.min(20, periodic?.maxCycles ?? 0);
  const planValid = periodic?.modelCalls === false && Number.isInteger(intervalSeconds) && intervalSeconds >= minimumInterval
    && Number.isInteger(maxRuns) && maxRuns >= 1 && maxRuns <= maximumCycles;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const status = await sourceRuntimeApi.capabilities();
        if (!active) return;
        setRuntime(status);
        if (status.available && status.capabilities?.contractVersion === 'quantevo.ai-stock.v1' && status.capabilities.operations.read) {
          const [catalog, jobs, savedPlans] = await Promise.all([
            sourceRuntimeApi.strategies(), sourceRuntimeApi.tasks(),
            status.capabilities.periodicResearch?.supported ? sourceRuntimeApi.plans() : Promise.resolve([]),
          ]);
          if (active) {
            const ordered = [...catalog].sort((a, b) => (marketPriority[a.market] ?? 4) - (marketPriority[b.market] ?? 4));
            setStrategies(ordered); setInitialStrategyId(previous => previous ?? ordered[0]?.id ?? null); setTasks(jobs); setPlans(savedPlans);
          }
        }
        if (active) setError('');
      } catch (e) { if (active) setError(toApiErrorMessage(e)); }
      finally { if (active) { setLoading(false); timer = setTimeout(load, 10000); } }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!readable || selectedSourceId == null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const [savedVersions, savedBacktests, savedResearch] = await Promise.all([
          sourceRuntimeApi.versions(selectedSourceId), sourceRuntimeApi.backtests(selectedSourceId), sourceRuntimeApi.research(selectedSourceId),
        ]);
        if (active) { setVersions(savedVersions); setBacktests(savedBacktests); setResearch(savedResearch); setSelectionError(''); }
      } catch (e) { if (active) setSelectionError(toApiErrorMessage(e)); }
      finally { if (active) timer = setTimeout(load, 10000); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [readable, selectedSourceId, refresh]);

  useEffect(() => {
    if (!readable || !selectedVersionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await sourceRuntimeApi.candidatePreview(selectedVersionId);
        if (data.versionId !== selectedVersionId || data.strategyId !== selectedSourceId) {
          throw new Error('来源候选与当前策略或版本不匹配，请检查来源引擎。');
        }
        if (active) { setPreview(data); setPreviewError(''); }
      } catch (e) { if (active) { setPreview(null); setPreviewError(toApiErrorMessage(e)); } }
      finally { if (active) timer = setTimeout(load, 10000); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [readable, selectedVersionId, selectedSourceId, refresh]);

  useEffect(() => {
    if (!requestSpec || !pending || !readable) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const receipt = await sourceRuntimeApi.request(requestSpec.requestId); if (active) { rememberReceipt(requestSpec, receipt); setRequestError(''); setMissingReceipt(false); } }
      catch (e) { if (active) { setRequestError(toApiErrorMessage(e)); setMissingReceipt(isAxiosError(e) && e.response?.status === 404); } }
      finally { if (active) timer = setTimeout(load, 5000); }
    };
    timer = setTimeout(load, 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [requestSpec, pending, readable, rememberReceipt]);

  useEffect(() => {
    if (!operation || unresolved(operation.status)) return;
    try { sessionStorage.removeItem(requestStorageKey()); } catch { /* Storage can be unavailable in restricted browsers. */ }
  }, [operation]);

  const submitRequest = async (spec: RequestSpec) => {
    // An authoritative UNKNOWN means execution may already have happened. Even
    // a later missing receipt cannot authorize another POST for this request.
    if (spec.authoritativeUnknownSeen || (receiptHistory.current.requestId === spec.requestId && receiptHistory.current.authoritativeUnknownSeen)) return;
    setBusy(true); setRequestSpec(spec); setRequestError(''); setMissingReceipt(false);
    receiptHistory.current = { requestId: spec.requestId, authoritativeUnknownSeen: false };
    persistPendingRequest(spec);
    setOperation(unknownOperation(spec));
    try {
      const receipt = spec.kind === 'candidate-paper'
        ? await sourceRuntimeApi.candidatePaper(spec.versionId, spec.requestId)
        : await sourceRuntimeApi.startResearch(spec.versionId, { requestId: spec.requestId, sourceBacktestId: spec.sourceBacktestId!, budget: spec.budget! });
      rememberReceipt(spec, receipt); setRefresh(value => value + 1);
    } catch (e) { setRequestError(toApiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const lookupReceipt = async () => {
    if (!requestSpec) return;
    setBusy(true);
    try { rememberReceipt(requestSpec, await sourceRuntimeApi.request(requestSpec.requestId)); setRequestError(''); setMissingReceipt(false); }
    catch (e) { setRequestError(toApiErrorMessage(e)); setMissingReceipt(isAxiosError(e) && e.response?.status === 404); }
    finally { setBusy(false); }
  };
  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); setRefresh(value => value + 1); }
    catch (e) { setError(toApiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const metric = (value: unknown, percent = false) => typeof value === 'number' && Number.isFinite(value)
    ? `${(value * (percent ? 100 : 1)).toFixed(2)}${percent ? '%' : ''}` : '—';

  return <section aria-label={t('来源策略研究与模拟')} className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div><h2 className="text-xl font-semibold">{t('QuantEvo 策略研究与模拟')}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{t('浏览来源策略与版本，复用冻结回测开展规则研究，再按来源资格建立独立模拟。原有账户继续保留。')}</p></div>
      <button className="btn-secondary" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>{t('刷新数据')}</button>
    </div>
    {error && <p role="alert" className="my-4 text-danger">{error}</p>}
    {loading && <p role="status" className="py-6 text-secondary-text">{t('加载中…')}</p>}
    {!loading && !readable && <p className="py-6 text-secondary-text">{t(runtime?.configured ? '来源引擎尚未提供兼容接口或暂时不可用。已有回测和模拟仍从管理策略使用。' : '当前工作区未配置来源研究引擎。')}</p>}
    {readable && <>
      <div className="my-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">{t('来源策略')}<select className="mt-2 w-full rounded border border-border bg-background p-2" value={selectedStrategy?.id ?? ''} onChange={event => { onSelection(Number(event.target.value), null); setSelectedBacktest(''); }}>
          {!selectedStrategy && <option value="">{t('暂无来源策略')}</option>}
          {strategies.map(row => <option key={row.id} value={row.id}>{row.name} · {row.market}</option>)}
        </select></label>
        <label className="text-sm">{t('来源版本')}<select className="mt-2 w-full rounded border border-border bg-background p-2" value={version?.id ?? ''} disabled={!currentVersions.length} onChange={event => { if (selectedStrategy) onSelection(selectedStrategy.id, event.target.value); setSelectedBacktest(''); }}>
          {!version && <option value="">{t('暂无来源版本')}</option>}
          {currentVersions.map(row => <option key={row.id} value={row.id}>v{row.number} · {row.id} {row.current ? `· ${t('当前版本')}` : ''}</option>)}
        </select></label>
      </div>
      {selectionError && <p role="alert" className="my-4 text-danger">{selectionError}</p>}
      {previewError && <p role="alert" className="my-4 text-danger">{t(previewError)}</p>}
      {version && <>
        <div className="grid gap-5 border-y border-border py-5 sm:grid-cols-2">
          <Eligibility title="年度迭代资格" value={candidate?.iterationEligibility ?? version.iterationEligibility} />
          <Eligibility title="独立模拟资格" value={candidate?.paperEligibility ?? version.paperEligibility} />
        </div>
        <div className="my-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-secondary-text">{t(version.researchSupported ? '规则研究可用' : '此版本不支持规则研究')} · {t(version.executionSupported ? '来源执行已就绪' : '来源执行未就绪')}</p>
          <button className="btn-primary" disabled={!canPaper} onClick={() => void submitRequest({ requestId: crypto.randomUUID(), versionId: version.id, kind: 'candidate-paper' })}>{t('建立独立模拟')}</button>
        </div>
        {candidate && <p className="mb-5 break-words text-sm text-secondary-text">{candidate.symbols.join(', ')} · {t('来源初始资金')} {candidate.initialCash ?? '—'}{candidate.reason ? ` · ${candidate.reason}` : ''}</p>}
        <div className="border-t border-border py-5">
          <h3 className="font-semibold">{t('冻结回测与规则研究')}</h3>
          <p className="mt-2 text-sm text-secondary-text">{t('研究沿用所选回测的行情、日期、资金和成本，只运行来源规则，不调用生成模型。资格由来源政策决定。')}</p>
          <label className="mt-4 block text-sm">{t('研究基线回测')}<select className="mt-2 w-full rounded border border-border bg-background p-2" value={selectedBacktest} onChange={event => setSelectedBacktest(event.target.value)}>
            <option value="">{t('选择来源回测记录')}</option>
            {samples.map(row => <option key={row.id} value={row.id}>{row.start ?? '—'} — {row.end ?? '—'} · {row.id} {row.complete !== true ? `· ${t('回测未完成')}` : ''}</option>)}
          </select></label>
          {sample && <>
            <p className="mt-3 text-sm text-secondary-text">{t(sample.complete === true ? '回测已完成' : sample.complete === false ? '回测未完成' : '回测完整性待确认')} · {t(sample.researchSupported ? '此回测支持规则研究' : '此回测仅供查看')}</p>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-secondary-text">{t('夏普')}</dt><dd className="mt-1 tabular-nums">{metric(sample.metrics.sharpe)}</dd></div>
              <div><dt className="text-secondary-text">{t('累计收益')}</dt><dd className="mt-1 tabular-nums">{metric(sample.metrics.total_return, true)}</dd></div>
              <div><dt className="text-secondary-text">{t('最大回撤')}</dt><dd className="mt-1 tabular-nums">{metric(sample.metrics.max_drawdown, true)}</dd></div>
            </dl>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-secondary-text sm:grid-cols-4">
            <div><dt>{t('来源初始资金')}</dt><dd>{sample.initialCash ?? '—'}</dd></div><div><dt>{t('佣金基点')}</dt><dd>{sample.feeBps ?? '—'}</dd></div>
            <div><dt>{t('滑点基点')}</dt><dd>{sample.slippageBps ?? '—'}</dd></div><div className="break-all"><dt>{t('评测口径')}</dt><dd>{sample.cohortKey ?? '—'}</dd></div>
            </dl>
          </>}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">{t('每轮实验预算')}<input type="number" min={1} max={Math.min(16, periodic?.maxBudgetPerCycle ?? 16)} value={budget} onChange={event => setBudget(Number(event.target.value))} className="mt-2 block w-28 rounded border border-border bg-background p-2" /></label>
            <button className="btn-secondary" disabled={!canResearch} onClick={() => void submitRequest({ requestId: crypto.randomUUID(), versionId: version.id, kind: 'research', sourceBacktestId: sample!.id, budget })}>{t('运行来源规则研究')}</button>
          </div>
          {!version.current && <p className="mt-3 text-sm text-secondary-text">{t('仅当前版本可启动新的规则研究；历史版本与研究记录仍可查看。')}</p>}
        </div>
        {periodic?.supported && <details className="border-t border-border py-5">
          <summary className="cursor-pointer font-semibold">{t('周期规则研究计划')}</summary>
          <p className="mt-3 max-w-3xl text-sm text-secondary-text">{t('每轮复用同一冻结回测，有界运行。暂停只影响后续计划；计划不调用模型、不建立模拟、不替换运行策略。')}</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">{t('间隔（小时）')}<input className="mt-2 block w-28 rounded border border-border bg-background p-2" type="number" min={minimumInterval / 3600} step={1} value={intervalHours} onChange={event => setIntervalHours(Number(event.target.value))} /></label>
            <label className="text-sm">{t('最多运行轮数')}<input className="mt-2 block w-28 rounded border border-border bg-background p-2" type="number" min={1} max={maximumCycles} value={maxRuns} onChange={event => setMaxRuns(Number(event.target.value))} /></label>
            <button className="btn-secondary" disabled={!canResearch || !planValid || !periodic.researchModes.includes('rules')} onClick={() => void runAction(() => sourceRuntimeApi.createPlan({ sourceStrategyId: selectedStrategy!.id, sourceVersionId: version.id, sourceBacktestId: sample!.id, intervalSeconds, budget, maxRuns }))}>{t('创建周期研究计划')}</button>
          </div>
          {plans.filter(row => row.sourceStrategyId === selectedStrategy?.id).map(row => <article className="mt-4 border-t border-border pt-3 text-sm" key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3"><span>#{row.id} · {t(statuses[row.status])} · {row.runsReserved}/{row.maxRuns} · {row.sourceVersionId}</span>
              {['active', 'paused'].includes(row.status) && <button className="btn-secondary" disabled={busy || !writable} onClick={() => void runAction(() => sourceRuntimeApi.controlPlan(row.id, row.status === 'active' ? 'pause' : 'resume'))}>{t(row.status === 'active' ? '暂停计划' : '恢复计划')}</button>}</div>
            <p className="mt-2 text-xs text-secondary-text">{t('下次研究')} · {recordTime(row.nextRunAt)} · {row.intervalSeconds / 3600}h · {t('每轮实验预算')} {row.budget}</p>
            {row.lastError && <p className="mt-2 text-danger">{row.lastError}</p>}
            <details className="mt-2"><summary className="cursor-pointer text-primary">{t('查看计划请求')}</summary>{row.operations.map(receipt => <p className="mt-2 break-all text-xs" key={receipt.requestId}>{receipt.requestId} · {t(statuses[receipt.status])}{receipt.error ? ` · ${receipt.error}` : ''}</p>)}</details>
          </article>)}
        </details>}
        <div className="border-t border-border py-5"><h3 className="font-semibold">{t('来源研究记录')}</h3>
          {!research.some(row => row.versionId === version.id) && <p className="mt-3 text-sm text-secondary-text">{t('此版本暂无研究记录。')}</p>}
          {research.filter(row => row.versionId === version.id).map(row => <details className="mt-3 border-t border-border pt-3 text-sm" key={row.id}>
            <summary className="cursor-pointer">{row.id} · {t(statuses[row.status] ?? row.status)} · {row.completed}/{row.budget} · {recordTime(row.createdAt)}</summary>
            {row.candidateVersionId && <button className="btn-secondary mt-3" onClick={() => { onSelection(selectedStrategy!.id, row.candidateVersionId); setSelectedBacktest(''); }}>{t('查看候选资格')} · {row.candidateVersionId}</button>}
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['实验', '夏普', '累计收益', '最大回撤', '结果'].map(label => <th key={label} className="p-2">{t(label)}</th>)}</tr></thead><tbody>{row.experiments.map(experiment => <tr className="border-t border-border" key={experiment.ordinal}>
              <td className="p-2">#{experiment.ordinal}</td><td className="p-2">{metric(experiment.metrics.sharpe)}</td><td className="p-2">{metric(experiment.metrics.total_return, true)}</td><td className="p-2">{metric(experiment.metrics.max_drawdown, true)}</td><td className="p-2">{experiment.decision} · {experiment.reason}</td>
            </tr>)}</tbody></table></div>
            <details className="mt-3"><summary className="cursor-pointer text-primary">{t('查看来源评测与实验记录')}</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ policyId: row.policyId, baseline: row.baselineMetrics, candidate: row.candidateMetrics }, null, 2)}</pre></details>
          </details>)}
        </div>
      </>}
      {operation && <section aria-label={t('来源请求回执')} className="mb-5 border-y border-border py-4 text-sm">
        <h3 className="font-medium">{t(statuses[operation.status])} · {operation.versionId}</h3><p className="mt-2 break-all text-xs text-secondary-text">{operation.requestId}</p>
        {operation.error && <p className="mt-2 text-danger">{operation.error}</p>}
        {requestError && <p role="alert" className="mt-2 text-danger">{t(requestError)}</p>}
        {pending && <p className="mt-2 text-secondary-text">{t('等待同一请求的服务端回执；状态确认前不会创建新请求。')}</p>}
        {pending && <button className="btn-secondary mt-3" disabled={busy || !readable} onClick={() => void lookupReceipt()}>{t('查询请求回执')}</button>}
        {requestSpec && operation.status === 'UNKNOWN' && missingReceipt && !requestSpec.authoritativeUnknownSeen && <button className="btn-secondary ml-2 mt-3" disabled={busy || !writable} onClick={() => void submitRequest(requestSpec)}>{t('重试同一请求')}</button>}
        {operation.status === 'SUCCEEDED' && operation.kind === 'candidate-paper' && Number.isInteger(operation.portfolioId) && operation.portfolioId! < 0 && <button className="btn-primary mt-3" onClick={() => onAdopt(operation.portfolioId!)}>{t('查看独立模拟')}</button>}
      </section>}
      <section className="border-t border-border py-5" aria-label={t('来源任务')}><h3 className="font-semibold">{t('来源任务')}</h3>
        {!tasks.length && <p className="mt-3 text-sm text-secondary-text">{t('暂无来源任务')}</p>}
        {tasks.map(task => <article className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3 text-sm" key={task.id}>
          <div className="min-w-0 flex-1"><p className="break-all">{task.type} · {t(statuses[task.status])} · {task.id}</p><p className="mt-1 break-words text-secondary-text">{task.message}{task.progress != null && task.progress >= 0 && task.progress <= 1 ? ` · ${metric(task.progress * 100)}%` : ''}</p>{task.error && <p className="mt-1 text-danger">{task.error}</p>}</div>
          {capabilities?.operations.cancelTasks && cancellableTaskTypes.has(task.type) && ['PENDING', 'RUNNING'].includes(task.status) && <button className="btn-secondary" disabled={busy || !writable} onClick={() => void runAction(() => sourceRuntimeApi.cancelTask(task.id))}>{t('取消来源任务')}</button>}
        </article>)}
      </section>
    </>}
  </section>;
}
