import { useEffect, useState } from 'react';
import { portfolioResearchApi, type HoldingItem, type HoldingPlan, type HoldingRules } from '../../api/portfolioResearch';
import { workspaceApi, type WorkspaceCapabilityCatalog } from '../../api/workspace';
import { strategyWorkspaceApi } from '../../api/strategyWorkspace';
import ResearchStrategySelector, { type ResearchStrategyOption } from '../agent/ResearchStrategySelector';
import ChoiceList from '../common/ChoiceList';
import { ExpertAvatar } from '../common/ExpertAvatar';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { getParsedApiError } from '../../api/error';

export default function HoldingPlanEditor({ item, onSaved }: { item: HoldingItem; onSaved: () => void }) {
  const { localize: l, translate: tx } = useUiLanguage();
  const [plan, setPlan] = useState<HoldingPlan>();
  const [catalog, setCatalog] = useState<WorkspaceCapabilityCatalog>();
  const [options, setOptions] = useState<ResearchStrategyOption[]>([]);
  const [custom, setCustom] = useState(false);
  const [daily, setDaily] = useState(false);
  const [runAt, setRunAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const next = await portfolioResearchApi.plan(item.accountId, item.position.symbol);
      const [caps, strategies] = await Promise.all([workspaceApi.getCapabilities(), strategyWorkspaceApi.listStrategies()]);
      const choices = await Promise.all(strategies.filter(s => s.productRole !== 'kernel' && s.currentPublishedVersionId && s.kernelExecutionStatus === 'ready' && s.currentStrategyPurpose === 'research_report').map(async s => {
        const v = await strategyWorkspaceApi.getVersion(s.currentPublishedVersionId!);
        const parameters = v.decisionPolicy?.packageParameters;
        const skills = parameters && typeof parameters === 'object' && 'skills' in parameters ? parameters.skills : [];
        return { ...s, market: v.screeningPolicy?.market || '', fixedSkillIds: Array.isArray(skills) ? skills.filter((s): s is string => typeof s === 'string') : [] };
      }));
      if (mounted) { setPlan(next); setCatalog(caps); setOptions(choices.filter(o => o.market.toUpperCase() === item.position.market.toUpperCase())); setDaily(Boolean(next.schedule?.enabled)); setRunAt(next.schedule?.runAt || next.runAt); setCustom(next.task.capabilities.skillIds.length > 0); setError(''); }
    })().catch(err => { if (mounted) setError(getParsedApiError(err).message); });
    return () => { mounted = false; };
  }, [item.accountId, item.position.symbol, item.position.market, retry]);
  if (!plan || !catalog) return <div className="mt-5 border-t border-border py-5" role="status">{error || l('正在读取研究配置…', 'Loading research settings…')}{error && <button className="ml-3 text-primary underline" onClick={() => setRetry(retry + 1)}>{l('重试', 'Retry')}</button>}</div>;
  const bindings = plan.task.capabilities;
  const rules = plan.task.config.portfolioRules as HoldingRules;
  const toggle = (field: 'skillIds' | 'expertIds', id: string) => {
    const values = bindings[field].map(String);
    const next = values.includes(id) ? values.filter(v => v !== id) : [...values, id];
    setPlan({ ...plan, task: { ...plan.task, capabilities: { ...bindings, [field]: field === 'expertIds' ? next.map(Number) : next } } });
  };
  const save = async () => {
    setBusy(true); setError('');
    try { await portfolioResearchApi.configure(item.accountId, item.position.symbol, { strategyVersionId: Number(plan.task.config.strategyVersionId), capabilities: bindings, rules, dailyEnabled: daily, runAt }); onSaved(); }
    catch (err) { setError(getParsedApiError(err).message); }
    finally { setBusy(false); }
  };
  return <div className="mt-6 border-t border-border bg-hover/20 p-4 md:p-6">
    <h4 className="font-semibold">{l('每日跟踪与研究策略', 'Daily tracking & research strategy')}</h4>
    <p className="mt-2 text-sm leading-6 text-secondary-text">{l('默认综合研究，额外专家为零。复用个股研究流程，这里只显示短简报；自定义不会变成自动下单。', 'Balanced research by default, with no extra experts. The full stock research pipeline produces a short brief here. Customization never enables order execution.')}</p>
    <fieldset disabled={busy} className="mt-5 grid gap-6 md:grid-cols-2">
      <div><ResearchStrategySelector label={l('研究策略', 'Research strategy')} options={options} versionId={String(plan.task.config.strategyVersionId)} custom={custom} onChange={(version, useCustom) => { setCustom(useCustom); setPlan({ ...plan, task: { ...plan.task, config: { ...plan.task.config, strategyVersionId: Number(version) }, capabilities: { ...bindings, skillIds: [] } } }); }} skills={catalog.skills.filter(s => s.enabled)} selectedSkillIds={bindings.skillIds} onToggleSkill={id => toggle('skillIds', id)} loading={false} skillsLoading={false} skillsError="" /></div>
      <ChoiceList label={l('补充专家（可选）', 'Additional experts (optional)')} multiple limit={3} selectedIds={bindings.expertIds.map(String)} onSelect={id => toggle('expertIds', id)} placeholder={l('主 Agent 独立研究', 'Main Agent only')} items={catalog.experts.filter(e => e.enabled).map(e => ({ id: String(e.id), name: tx(e.name), description: tx(e.description || ''), leading: <ExpertAvatar id={e.id} name={tx(e.name)} avatar={e.avatar} size={24} /> }))} />
      <div className="space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} className="h-4 w-4 accent-primary" />{l('开启每日自动研究', 'Enable daily research')}</label><label className="block text-sm">{l('运行时间（市场当地时间）', 'Run time (market local time)')}<input type="time" value={runAt} onChange={e => setRunAt(e.target.value)} className="ml-3 rounded-lg border border-border bg-background p-2" required /></label><p className="text-xs leading-6 text-secondary-text">{plan.timezone} · {l('服务需保持运行。休市期间复用最近交易时段的已完成研究；开启后会调用模型。', 'The server must stay running. Completed research is reused for the same market session on holidays. Enabling this incurs model calls.')}</p></div>
      <div><p className="mb-3 text-sm font-medium">{l('风险复核阈值（不是买卖指令）', 'Review thresholds (not trade instructions)')}</p><div className="grid grid-cols-3 gap-3">{(['lossPct', 'profitPct', 'dailyMovePct'] as const).map(field => <label key={field} className="text-xs text-secondary-text">{{ lossPct: l('成本亏损 %', 'Cost loss %'), profitPct: l('成本盈利 %', 'Cost gain %'), dailyMovePct: l('日涨跌幅 %', 'Daily move %') }[field]}<input type="number" min="0.1" max="100" step="0.1" value={rules[field]} onChange={e => setPlan({ ...plan, task: { ...plan.task, config: { ...plan.task.config, portfolioRules: { ...rules, [field]: Number(e.target.value) } } } })} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground" /></label>)}</div></div>
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    <button className="btn-primary mt-5" disabled={busy || !runAt || Object.values(rules).some(v => v < 0.1 || v > 100)} onClick={() => void save()}>{busy ? l('正在保存…', 'Saving…') : l('保存跟踪设置', 'Save tracking settings')}</button>
  </div>;
}
