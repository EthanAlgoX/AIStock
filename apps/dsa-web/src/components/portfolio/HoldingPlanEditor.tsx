import { useEffect, useState } from 'react';
import { portfolioResearchApi, type HoldingItem, type HoldingPlan, type HoldingRules, type WatchItem } from '../../api/portfolioResearch';
import { workspaceApi, type WorkspaceCapabilityCatalog } from '../../api/workspace';
import { strategyWorkspaceApi } from '../../api/strategyWorkspace';
import ResearchStrategySelector, { type ResearchStrategyOption } from '../agent/ResearchStrategySelector';
import ChoiceList from '../common/ChoiceList';
import { ExpertAvatar } from '../common/ExpertAvatar';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { getParsedApiError } from '../../api/error';

export default function HoldingPlanEditor({ item, watch, onSaved }: { item?: HoldingItem; watch?: WatchItem; onSaved: () => void }) {
  const isWatch = !!watch;
  const accountId = item?.accountId;
  const symbol = watch?.symbol || item!.position.symbol;
  const market = watch?.market || item!.position.market;
  const { localize: l, translate: tx } = useUiLanguage();
  const [plan, setPlan] = useState<HoldingPlan>();
  const [catalog, setCatalog] = useState<WorkspaceCapabilityCatalog>();
  const [options, setOptions] = useState<ResearchStrategyOption[]>([]);
  const [custom, setCustom] = useState(false);
  const [intervalDays, setIntervalDays] = useState('1');
  const [runAt, setRunAt] = useState('');
  const [dailyNotify, setDailyNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const next = isWatch ? await portfolioResearchApi.watchPlan(symbol) : await portfolioResearchApi.plan(accountId!, symbol);
      const [caps, strategies] = await Promise.all([workspaceApi.getCapabilities(), strategyWorkspaceApi.listStrategies()]);
      const choices = await Promise.all(strategies.filter(s => s.productRole !== 'kernel' && s.currentPublishedVersionId && s.kernelExecutionStatus === 'ready' && s.currentStrategyPurpose === 'research_report').map(async s => {
        const v = await strategyWorkspaceApi.getVersion(s.currentPublishedVersionId!);
        const parameters = v.decisionPolicy?.packageParameters;
        const skills = parameters && typeof parameters === 'object' && 'skills' in parameters ? parameters.skills : [];
        return { ...s, market: v.screeningPolicy?.market || '', fixedSkillIds: Array.isArray(skills) ? skills.filter((s): s is string => typeof s === 'string') : [] };
      }));
      if (mounted) { setPlan(next); setCatalog(caps); setOptions(choices.filter(o => o.market.toUpperCase() === market.toUpperCase())); setIntervalDays(String(next.schedule?.intervalDays || 1)); setRunAt(next.schedule?.runAt || next.runAt); setDailyNotify(Boolean(next.task.config.portfolioDailyNotify)); setCustom(next.task.capabilities.skillIds.length > 0); setError(''); }
    })().catch(err => { if (mounted) setError(getParsedApiError(err).message); });
    return () => { mounted = false; };
  }, [isWatch, accountId, symbol, market, retry]);
  if (!plan || !catalog) return <div className="mt-5 border-t border-border py-5" role="status">{error || l('正在读取研究配置…', 'Loading research settings…')}{error && <button className="ml-3 text-primary underline" onClick={() => setRetry(retry + 1)}>{l('重试', 'Retry')}</button>}</div>;
  const bindings = plan.task.capabilities;
  const rules = plan.task.config.portfolioRules as HoldingRules | undefined;
  const toggle = (field: 'skillIds' | 'expertIds', id: string) => {
    const values = bindings[field].map(String);
    const next = values.includes(id) ? values.filter(v => v !== id) : [...values, id];
    setPlan({ ...plan, task: { ...plan.task, capabilities: { ...bindings, [field]: field === 'expertIds' ? next.map(Number) : next } } });
  };
  const save = async (dailyEnabled: boolean) => {
    setBusy(true); setError('');
    try {
      const payload = { strategyVersionId: Number(plan.task.config.strategyVersionId), capabilities: bindings, dailyEnabled, dailyNotify, intervalDays: Number(intervalDays), runAt };
      const saved = isWatch ? await portfolioResearchApi.configureWatch(symbol, payload) : await portfolioResearchApi.configure(accountId!, symbol, { ...payload, rules: rules! });
      setPlan(saved);
      onSaved();
    }
    catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(false); }
  };
  return <div className="mt-6 border-t border-border bg-hover/20 p-4 md:p-6">
    <h4 className="font-semibold">{l('跟踪周期与研究策略', 'Tracking schedule & research strategy')}</h4>
    <p className="mt-2 text-sm leading-6 text-secondary-text">{isWatch ? l('默认综合研究，额外专家为零。关注研究不读取持仓数据，也不输出持仓操作建议。', 'Balanced research by default, with no extra experts. Watch research does not read holdings or give holding actions.') : l('默认综合研究，额外专家为零。复用个股研究流程，这里只显示短简报；自定义不会变成自动下单。', 'Balanced research by default, with no extra experts. The full stock research pipeline produces a short brief here. Customization never enables order execution.')}</p>
    <fieldset disabled={busy} className="mt-5 grid gap-6 md:grid-cols-2">
      <div><ResearchStrategySelector label={l('研究策略', 'Research strategy')} options={options} versionId={String(plan.task.config.strategyVersionId)} custom={custom} onChange={(version, useCustom) => { setCustom(useCustom); setPlan({ ...plan, task: { ...plan.task, config: { ...plan.task.config, strategyVersionId: Number(version) }, capabilities: { ...bindings, skillIds: [] } } }); }} skills={catalog.skills.filter(s => s.enabled)} selectedSkillIds={bindings.skillIds} onToggleSkill={id => toggle('skillIds', id)} loading={false} skillsLoading={false} skillsError="" /></div>
      <ChoiceList label={l('补充专家（可选）', 'Additional experts (optional)')} multiple limit={3} selectedIds={bindings.expertIds.map(String)} onSelect={id => toggle('expertIds', id)} placeholder={l('主 Agent 独立研究', 'Main Agent only')} items={catalog.experts.filter(e => e.enabled).map(e => ({ id: String(e.id), name: tx(e.name), description: tx(e.description || ''), leading: <ExpertAvatar id={e.id} name={tx(e.name)} avatar={e.avatar} size={24} /> }))} />
      <div className="space-y-3"><label className="block text-sm">{l('每隔几天运行', 'Run every (days)')}<input type="number" min="1" max="365" step="1" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} className="ml-3 w-24 rounded-lg border border-border bg-background p-2" required /></label><p className="text-xs text-secondary-text">{l('填写 1–365 的整数：1 为每天，2 为每两天。保存并开启后可在任务与运行中查看。', 'Enter an integer from 1–365: 1 runs daily, 2 every two days. Saving enables the schedule shown in Tasks & Runs.')}</p><label className="block text-sm">{l('运行时间（市场当地时间）', 'Run time (market local time)')}<input type="time" value={runAt} onChange={e => setRunAt(e.target.value)} className="ml-3 rounded-lg border border-border bg-background p-2" required /></label><p className="text-xs leading-6 text-secondary-text">{plan.timezone} · {l('保存只会开启按周期、按设定时间运行的自动研究，不会立即执行；临时研究请点击持仓卡片上的“研究这只持仓”。自动研究会调用模型，服务需保持运行；如需暂停，可使用下方“暂停自动跟踪”。', 'Saving only enables research at the configured time and cadence; it does not run immediately. Use “Research this holding” on the holding card for a one-time run. Scheduled research may call models, so keep the service running. Use “Pause tracking” below when you need to stop it.')}</p></div>
      <div className="space-y-3"><label className="block text-sm">{l('每隔几天运行', 'Run every (days)')}<input type="number" min="1" max="365" step="1" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} className="ml-3 w-24 rounded-lg border border-border bg-background p-2" required /></label><p className="text-xs text-secondary-text">{l('填写 1–365 的整数：1 为每天，2 为每两天。保存并开启后可在任务与运行中查看。', 'Enter an integer from 1–365: 1 runs daily, 2 every two days. Saving enables the schedule shown in Tasks & Runs.')}</p><label className="block text-sm">{l('运行时间（市场当地时间）', 'Run time (market local time)')}<input type="time" value={runAt} onChange={e => setRunAt(e.target.value)} className="ml-3 rounded-lg border border-border bg-background p-2" required /></label><label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={dailyNotify} onChange={event => setDailyNotify(event.target.checked)} /><span>{isWatch ? l('完成后推送关注股票每日研究', 'Send the completed watch research') : l('完成后推送持仓每日研究', 'Send the completed holding research')}<small className="mt-1 block text-xs text-secondary-text">{l('仅在定时研究成功完成后，发送到“通知与告警”已配置的报告渠道；手动运行不会发送。', 'Only sends after a successful scheduled run through report channels configured in Notifications & Alerts; manual runs do not send.')}</small></span></label><p className="text-xs leading-6 text-secondary-text">{plan.timezone} · {l('保存只会开启按周期、按设定时间运行的自动研究，不会立即执行；临时研究请点击持仓卡片上的“研究这只持仓”。自动研究会调用模型，服务需保持运行；如需暂停，可使用下方“暂停自动跟踪”。', 'Saving only enables research at the configured time and cadence; it does not run immediately. Use “Research this holding” on the holding card for a one-time run. Scheduled research may call models, so keep the service running. Use “Pause tracking” below when you need to stop it.')}</p></div>
      {!isWatch && rules && <div><p className="mb-3 text-sm font-medium">{l('风险复核阈值（不是买卖指令）', 'Review thresholds (not trade instructions)')}</p><div className="grid grid-cols-3 gap-3">{(['lossPct', 'profitPct', 'dailyMovePct'] as const).map(field => <label key={field} className="text-xs text-secondary-text">{{ lossPct: l('成本亏损 %', 'Cost loss %'), profitPct: l('成本盈利 %', 'Cost gain %'), dailyMovePct: l('日涨跌幅 %', 'Daily move %') }[field]}<input type="number" min="0.1" max="100" step="0.1" value={rules[field]} onChange={e => setPlan({ ...plan, task: { ...plan.task, config: { ...plan.task.config, portfolioRules: { ...rules, [field]: Number(e.target.value) } } } })} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground" /></label>)}</div></div>}
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button className="btn-primary" disabled={busy || !runAt || !Number.isInteger(Number(intervalDays)) || Number(intervalDays) < 1 || Number(intervalDays) > 365 || (!!rules && Object.values(rules).some(v => v < 0.1 || v > 100))} onClick={() => void save(true)}>{busy ? l('正在保存…', 'Saving…') : l('保存并开启自动跟踪', 'Save & enable tracking')}</button>
      {plan.schedule?.enabled && <button className="btn-secondary" disabled={busy} onClick={() => void save(false)}>{l('暂停自动跟踪', 'Pause tracking')}</button>}
    </div>
  </div>;
}
