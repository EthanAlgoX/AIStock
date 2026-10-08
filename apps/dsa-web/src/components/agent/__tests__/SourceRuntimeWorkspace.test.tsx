import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SourceRuntimeWorkspace } from '../SourceRuntimeWorkspace';
import type { SourceCapabilities, SourceOperation, SourceVersion } from '../../../api/portfolios';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(), strategies: vi.fn(), versions: vi.fn(), backtests: vi.fn(), research: vi.fn(), tasks: vi.fn(),
  candidatePreview: vi.fn(), candidatePaper: vi.fn(), startResearch: vi.fn(), request: vi.fn(), cancelTask: vi.fn(),
  plans: vi.fn(), createPlan: vi.fn(), controlPlan: vi.fn(),
}));
vi.mock('../../../api/portfolios', () => ({ sourceRuntimeApi: api }));
const eligibility = { available: true, eligible: true, reason: 'Source annual policy evidence', policyId: 'all_markets_strict_sharpe_v3', evidence: { annualSharpe: .8 } };
const caps: SourceCapabilities = {
  engine: 'quantevo', contractVersion: 'quantevo.ai-stock.v1', markets: ['US'],
  operations: { read: true, candidatePaper: true, research: true, cancelTasks: true }, families: [], policy: { id: eligibility.policyId },
  asyncRequests: true, idempotentRequests: true,
  periodicResearch: { supported: true, scheduler: 'main_app', minIntervalSeconds: 3600, maxCycles: 20, maxBudgetPerCycle: 16, researchModes: ['rules'], modelCalls: false },
};
const version: SourceVersion = {
  id: 'source_v2', definitionId: -22, strategyId: -11, number: 2, status: 'CURRENT', parentId: 'source_v1', current: true,
  iterationEligibility: { ...eligibility, eligible: false, reason: 'Yearly Sharpe did not strictly improve' },
  paperEligibility: eligibility, researchSupported: true, executionSupported: true,
};
const receipt = (requestId: string, overrides: Partial<SourceOperation> = {}): SourceOperation => ({
  requestId, kind: 'candidate-paper', status: 'SUCCEEDED', taskId: 'task_paper', portfolioId: -33,
  versionId: version.id, resultId: 'paper_source', error: null, reused: false, ...overrides,
});
const adopt = vi.fn();
function Workspace({ initialVersion = null, initialStrategy = -11 }: { initialVersion?: string | null; initialStrategy?: number | null }) {
  const [selection, setSelection] = useState<{ strategy: number | null; version: string | null }>({ strategy: initialStrategy, version: initialVersion });
  return <SourceRuntimeWorkspace strategyId={selection.strategy} versionId={selection.version}
    onSelection={(strategy, next) => setSelection({ strategy, version: next })} onAdopt={adopt} />;
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  api.capabilities.mockResolvedValue({ configured: true, available: true, capabilities: caps });
  api.strategies.mockResolvedValue([{ id: -11, name: 'Overseas source strategy', market: 'US', kind: 'rules', currentVersionId: version.id, versionCount: 2, paperAccountCount: 1 }]);
  api.versions.mockResolvedValue([version, { ...version, id: 'source_v1', number: 1, current: false }]);
  api.backtests.mockResolvedValue([{ id: 'frozen_bt', versionId: version.id, start: '2025-01-01', end: '2025-12-31', createdAt: '2026-01-01T00:00:00Z', initialCash: 12345, feeBps: 7, slippageBps: 9, metrics: {}, complete: true, cohortKey: 'source_cohort', researchSupported: true }]);
  api.candidatePreview.mockResolvedValue({ versionId: version.id, strategyId: -11, iterationEligibility: version.iterationEligibility, paperEligibility: eligibility, symbols: ['AAPL'], initialCash: 12345, policyId: eligibility.policyId, existingPortfolioId: null, reason: 'Source approved' });
  api.research.mockResolvedValue([]); api.tasks.mockResolvedValue([]); api.plans.mockResolvedValue([]);
  api.candidatePaper.mockImplementation(async (_version: string, id: string) => receipt(id));
  api.request.mockImplementation(async (id: string) => receipt(id));
  api.startResearch.mockImplementation(async (_version: string, input: { requestId: string }) => receipt(input.requestId, { kind: 'research', portfolioId: null, resultId: 'research_new' }));
  api.createPlan.mockResolvedValue({ id: 7 });
});

it.each([
  { configured: true, available: false, capabilities: null },
  { configured: true, available: true, capabilities: { ...caps, contractVersion: 'unknown.v2' } },
])('keeps legacy and unsupported contracts read-only without calling new operations', async (runtime) => {
  api.capabilities.mockResolvedValue(runtime);
  render(<Workspace />);
  expect(await screen.findByText(/来源引擎尚未提供兼容接口/)).toBeVisible();
  expect(api.strategies).not.toHaveBeenCalled(); expect(api.candidatePaper).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '建立独立模拟' })).toBeNull();
});

it('does not enable new writes without both asynchronous and idempotent request capabilities', async () => {
  api.capabilities.mockResolvedValue({ configured: true, available: true, capabilities: { ...caps, idempotentRequests: false } });
  render(<Workspace />);
  await waitFor(() => expect(api.candidatePreview).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '运行来源规则研究' })).toBeDisabled();
});

it('uses separate authoritative annual and paper qualifications and opens only the returned private account', async () => {
  render(<Workspace />);
  const paper = await screen.findByRole('button', { name: '建立独立模拟' });
  await waitFor(() => expect(paper).toBeEnabled());
  expect(screen.getByText('年度迭代资格 · 不具备资格')).toBeVisible();
  expect(screen.getByText('独立模拟资格 · 具备资格')).toBeVisible();
  fireEvent.click(paper);
  const open = await screen.findByRole('button', { name: '查看独立模拟' });
  expect(api.candidatePaper).toHaveBeenCalledWith('source_v2', expect.stringMatching(/^[0-9a-f-]{36}$/i));
  expect(adopt).not.toHaveBeenCalled(); fireEvent.click(open); expect(adopt).toHaveBeenCalledWith(-33);
});

it.each(['not-qualified', 'execution-not-ready', 'authority-unavailable'])('blocks candidate paper for %s even when the version displays historical eligibility', async (reason) => {
  if (reason === 'execution-not-ready') api.versions.mockResolvedValue([{ ...version, executionSupported: false }]);
  else api.candidatePreview.mockResolvedValue({ versionId: version.id, strategyId: -11, paperEligibility: { ...eligibility, eligible: reason === 'not-qualified' ? false : null, available: reason !== 'authority-unavailable' }, iterationEligibility: eligibility, symbols: [], initialCash: null });
  render(<Workspace />);
  await waitFor(() => expect(api.candidatePreview).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  expect(api.candidatePaper).not.toHaveBeenCalled();
});

it('researches the selected frozen backtest and uses the same source contract for a bounded periodic plan', async () => {
  render(<Workspace />);
  await screen.findByText('冻结回测与规则研究');
  fireEvent.change(screen.getByRole('combobox', { name: '研究基线回测' }), { target: { value: 'frozen_bt' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '每轮实验预算' }), { target: { value: '4' } });
  const run = screen.getByRole('button', { name: '运行来源规则研究' });
  await waitFor(() => expect(run).toBeEnabled()); fireEvent.click(run);
  await waitFor(() => expect(api.startResearch).toHaveBeenCalledWith('source_v2', { requestId: expect.any(String), sourceBacktestId: 'frozen_bt', budget: 4 }));
  fireEvent.click(screen.getByText('周期规则研究计划'));
  await waitFor(() => expect(screen.getByRole('button', { name: '创建周期研究计划' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '创建周期研究计划' }));
  await waitFor(() => expect(api.createPlan).toHaveBeenCalledWith({ sourceStrategyId: -11, sourceVersionId: 'source_v2', sourceBacktestId: 'frozen_bt', intervalSeconds: 86400, budget: 4, maxRuns: 3 }));
  expect(api.candidatePaper).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
});

it.each([
  { complete: true, researchSupported: false, dedicated: true },
  { complete: false, researchSupported: true, dedicated: false },
  { complete: null, researchSupported: true, dedicated: false },
])('shows every source backtest read-only even when research is unavailable ($complete/$researchSupported)', async ({ complete, researchSupported, dedicated }) => {
  if (dedicated) api.versions.mockResolvedValue([{ ...version, researchSupported: false, executionSupported: false }]);
  api.backtests.mockResolvedValue([{ id: 'readonly_backtest', versionId: version.id, start: '2025-01-01', end: '2025-02-01', initialCash: 12345, feeBps: 7, slippageBps: 9,
    metrics: { sharpe: .71, total_return: .2345, max_drawdown: -.0678 }, complete, researchSupported, cohortKey: 'readonly_cohort' }]);
  render(<Workspace />);
  const selection = await screen.findByRole('combobox', { name: '研究基线回测' });
  const option = within(selection).getByRole('option', { name: /readonly_backtest/ });
  expect(option).not.toBeDisabled(); fireEvent.change(selection, { target: { value: 'readonly_backtest' } });
  expect(await screen.findByText('0.71')).toBeVisible();
  expect(screen.getByText('23.45%')).toBeVisible(); expect(screen.getByText('-6.78%')).toBeVisible();
  expect(screen.getByRole('button', { name: '运行来源规则研究' })).toBeDisabled();
  expect(api.startResearch).not.toHaveBeenCalled();
  expect(screen.getByText(complete === true ? '回测已完成 · 此回测仅供查看' : complete === false ? '回测未完成 · 此回测支持规则研究' : '回测完整性待确认 · 此回测支持规则研究')).toBeVisible();
});

it('rejects candidate authority for an unrelated source strategy even with a matching version identifier', async () => {
  api.candidatePreview.mockResolvedValue({ versionId: version.id, strategyId: -999, iterationEligibility: eligibility, paperEligibility: eligibility, symbols: ['UNRELATED'], initialCash: 888, reason: 'Unrelated source approval' });
  render(<Workspace />);
  expect(await screen.findByRole('alert')).toHaveTextContent('来源候选与当前策略或版本不匹配');
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  expect(screen.queryByText(/Unrelated source approval/)).toBeNull();
  expect(api.candidatePaper).not.toHaveBeenCalled();
});

it('does not silently replace an unknown URL version with the current version', async () => {
  render(<Workspace initialVersion="missing_version" />);
  await waitFor(() => expect(api.versions).toHaveBeenCalled());
  expect(api.candidatePreview).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '建立独立模拟' })).toBeNull();
});

it('retains selection loading errors and blocks writes when preview refresh succeeds', async () => {
  render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  api.versions.mockRejectedValue(new Error('Version catalog failed'));
  fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Version catalog failed');
  await waitFor(() => expect(api.candidatePreview.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
});

it('keeps the first selected source strategy stable when refresh reorders the catalog', async () => {
  const first = { id: -11, name: 'Initial source', market: 'US', kind: 'rules', currentVersionId: version.id };
  const second = { ...first, id: -44, name: 'Other source' };
  api.strategies.mockResolvedValue([first, second]);
  render(<Workspace initialStrategy={null} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  expect(screen.getByRole('combobox', { name: '来源策略' })).toHaveValue('-11');
  api.strategies.mockResolvedValue([second, first]);
  fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
  await waitFor(() => expect(api.strategies).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('combobox', { name: '来源策略' })).toHaveValue('-11');
  expect(api.versions).not.toHaveBeenCalledWith(-44);
});

it('orders source strategies US, HK, CN and crypto first while retaining order within each market', async () => {
  const first = { id: -11, name: 'First US', market: 'US', kind: 'rules', currentVersionId: version.id };
  const catalog = [
    { ...first, id: -8, name: 'Crypto', market: 'CRYPTO' }, { ...first, id: -7, name: 'China', market: 'CN' },
    { ...first, id: -6, name: 'Hong Kong', market: 'HK' }, first, { ...first, id: -5, name: 'Second US' },
    { ...first, id: -4, name: 'Japan', market: 'JP' }, { ...first, id: -3, name: 'Britain', market: 'GB' },
  ];
  api.strategies.mockResolvedValue(catalog);
  render(<Workspace initialStrategy={null} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  expect([...screen.getByRole('combobox', { name: '来源策略' }).querySelectorAll('option')].map(row => row.value)).toEqual(['-11', '-5', '-6', '-7', '-8', '-4', '-3']);
  expect(screen.getByRole('combobox', { name: '来源策略' })).toHaveValue('-11');
  expect(catalog.map(row => row.id)).toEqual([-8, -7, -6, -11, -5, -4, -3]);
});

it.each(['kind', 'versionId', 'portfolioId'])('rejects a mismatched or incomplete %s receipt without opening an unrelated account', async (field) => {
  api.candidatePaper.mockImplementation(async (_version: string, id: string) => receipt(id, { status: 'RUNNING', portfolioId: null }));
  api.request.mockImplementation(async (id: string) => receipt(id, field === 'kind' ? { kind: 'research' } : field === 'versionId' ? { versionId: 'unrelated_version' } : { portfolioId: null }));
  render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '建立独立模拟' }));
  fireEvent.click(await screen.findByRole('button', { name: '查询请求回执' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('来源回执与当前请求不匹配');
  expect(screen.queryByRole('button', { name: '查看独立模拟' })).toBeNull();
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  expect(adopt).not.toHaveBeenCalled();
});

it('keeps an unknown request across remounts and only queries its receipt after a gateway failure', async () => {
  api.candidatePaper.mockRejectedValue(new Error('gateway timeout'));
  const view = render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '建立独立模拟' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('超时');
  const requestId = api.candidatePaper.mock.calls[0][1];
  expect(screen.queryByRole('button', { name: '重试同一请求' })).toBeNull();
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  view.unmount(); render(<Workspace />);
  const lookup = await screen.findByRole('button', { name: '查询请求回执' });
  await waitFor(() => expect(lookup).toBeEnabled()); fireEvent.click(lookup);
  expect(await screen.findByRole('button', { name: '查看独立模拟' })).toBeEnabled();
  expect(api.request).toHaveBeenCalledWith(requestId); expect(api.candidatePaper).toHaveBeenCalledTimes(1);
});

it('keeps a restored pending receipt visible during a source outage without querying or resubmitting it', async () => {
  const requestId='11111111-1111-4111-8111-111111111111';
  sessionStorage.setItem(`dsa.source-runtime-request.${localStorage.getItem('investcrew.activeIdentity') || 'owner'}`,JSON.stringify({requestId,versionId:version.id,kind:'candidate-paper',authoritativeUnknownSeen:true}));
  api.capabilities.mockResolvedValue({configured:true,available:false,capabilities:null,legacy:false});
  render(<Workspace />);
  expect(await screen.findByText(/来源引擎尚未提供兼容接口/)).toBeVisible();
  expect(screen.getByText(requestId)).toBeVisible();
  expect(screen.getByRole('button',{name:'查询请求回执'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'重试同一请求'})).not.toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
  expect(api.candidatePaper).not.toHaveBeenCalled();
});

it('allows resubmitting the same UUID only after receipt lookup explicitly returns 404', async () => {
  api.candidatePaper.mockRejectedValueOnce(new Error('timeout'));
  api.request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { detail: 'Receipt absent' } }, message: 'Receipt absent' });
  render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '建立独立模拟' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('超时');
  fireEvent.click(screen.getByRole('button', { name: '查询请求回执' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试同一请求' }));
  await screen.findByRole('button', { name: '查看独立模拟' });
  expect(api.candidatePaper).toHaveBeenCalledTimes(2);
  expect(api.candidatePaper.mock.calls[1]).toEqual(api.candidatePaper.mock.calls[0]);
});

it('never resubmits after a receipt lookup returns an unavailable gateway', async () => {
  api.candidatePaper.mockRejectedValueOnce(new Error('timeout'));
  api.request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503, data: { detail: 'Source unavailable' } }, message: 'Source unavailable' });
  render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '建立独立模拟' }));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '查询请求回执' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: '重试同一请求' })).toBeNull();
  expect(api.candidatePaper).toHaveBeenCalledTimes(1);
});

it.each([
  ['post', false], ['query', false], ['post', true], ['query', true],
])('never POSTs again after authoritative UNKNOWN from %s, even after missing receipt (remount=%s)', async (origin, remount) => {
  const absent = { isAxiosError: true, response: { status: 404, data: { detail: 'Receipt absent' } }, message: 'Receipt absent' };
  if (origin === 'post') {
    api.candidatePaper.mockImplementation(async (_version: string, id: string) => receipt(id, { status: 'UNKNOWN', portfolioId: null }));
    api.request.mockRejectedValueOnce(absent);
  } else {
    api.candidatePaper.mockRejectedValueOnce(new Error('timeout'));
    api.request.mockImplementationOnce(async (id: string) => receipt(id, { status: 'UNKNOWN', portfolioId: null }));
    api.request.mockRejectedValueOnce(absent);
  }
  const view = render(<Workspace />);
  await waitFor(() => expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '建立独立模拟' }));
  if (origin === 'query') {
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '查询请求回执' }));
  }
  const requestId = api.candidatePaper.mock.calls[0][1];
  const storedRequest = () => {
    const key = [...Array(sessionStorage.length)].map((_, i) => sessionStorage.key(i)).find(key => key?.startsWith('dsa.source-runtime-request.'));
    return key ? JSON.parse(sessionStorage.getItem(key)!) : null;
  };
  await waitFor(() => expect(storedRequest()?.authoritativeUnknownSeen).toBe(true));
  if (remount) { view.unmount(); render(<Workspace />); }
  const query = await screen.findByRole('button', { name: '查询请求回执' });
  await waitFor(() => expect(query).toBeEnabled()); fireEvent.click(query);
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(origin === 'query' ? 2 : 1));
  await waitFor(() => expect(query).toBeEnabled());
  expect(api.request).toHaveBeenLastCalledWith(requestId);
  expect(screen.queryByRole('button', { name: '重试同一请求' })).toBeNull();
  expect(screen.getByRole('button', { name: '建立独立模拟' })).toBeDisabled();
  expect(storedRequest()?.authoritativeUnknownSeen).toBe(true);
  expect(api.candidatePaper).toHaveBeenCalledTimes(1);
});

it('preserves failed and cancelled tasks, cancels an active source task, and controls a plan without paper calls', async () => {
  api.tasks.mockResolvedValue([
    { id: 'task_running', type: 'EVOLUTION', status: 'RUNNING', progress: .2, message: 'Evaluating', error: null },
    { id: 'task_failed', type: 'EVOLUTION', status: 'FAILED', progress: null, message: 'Failed', error: 'Missing frozen bars' },
    { id: 'task_cancelled', type: 'EVOLUTION', status: 'CANCELLED', progress: null, message: 'Cancelled', error: null },
  ]);
  const plan = { id: 7, sourceStrategyId: -11, sourceVersionId: version.id, sourceBacktestId: 'frozen_bt', status: 'active', intervalSeconds: 86400, budget: 4, maxRuns: 3, runsReserved: 1, nextRunAt: null, lastError: null, operations: [] };
  api.plans.mockResolvedValue([plan]);
  api.controlPlan.mockImplementation(async (_id: number, action: string) => { api.plans.mockResolvedValue([{ ...plan, status: action === 'pause' ? 'paused' : 'active' }]); });
  render(<Workspace />);
  expect(await screen.findByText('Missing frozen bars')).toBeVisible();
  expect(screen.getByText(/EVOLUTION · 已取消/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消来源任务' }));
  await waitFor(() => expect(api.cancelTask).toHaveBeenCalledWith('task_running'));
  fireEvent.click(screen.getByText('周期规则研究计划'));
  await waitFor(() => expect(screen.getByRole('button', { name: '暂停计划' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '暂停计划' }));
  await waitFor(() => expect(api.controlPlan).toHaveBeenCalledWith(7, 'pause'));
  const resume = await screen.findByRole('button', { name: '恢复计划' });
  await waitFor(() => expect(resume).toBeEnabled()); fireEvent.click(resume);
  await waitFor(() => expect(api.controlPlan).toHaveBeenCalledWith(7, 'resume'));
  expect(api.candidatePaper).not.toHaveBeenCalled();
});

it.each(['unavailable-source','preview-failure','selection-failure'])('can pause saved local research plans during %s and gates resume on source capabilities', async (failure) => {
  const plan = { id: 7, sourceStrategyId: -11, sourceVersionId: version.id, sourceBacktestId: 'frozen_bt', status: 'active', intervalSeconds: 86400, budget: 4, maxRuns: 3, runsReserved: 1, nextRunAt: null, lastError: null, operations: [] };
  api.plans.mockResolvedValue([plan]);
  api.controlPlan.mockImplementation(async () => {api.plans.mockResolvedValue([{...plan,status:'paused'}]);});
  if (failure==='unavailable-source') api.capabilities.mockResolvedValue({configured:true,available:false,capabilities:null,legacy:false});
  else if (failure==='preview-failure') api.candidatePreview.mockRejectedValue(new Error('Candidate preview unavailable'));
  else api.versions.mockRejectedValue(new Error('Source versions unavailable'));
  render(<Workspace />);
  const pause = await screen.findByRole('button',{name:'暂停计划'});
  await waitFor(() => expect(pause).toBeEnabled());
  fireEvent.click(pause);
  await waitFor(() => expect(api.controlPlan).toHaveBeenCalledWith(7,'pause'));
  const resume=await screen.findByRole('button',{name:'恢复计划'});
  if (failure==='unavailable-source') expect(resume).toBeDisabled();
  else {expect(resume).toBeEnabled();fireEvent.click(resume);await waitFor(()=>expect(api.controlPlan).toHaveBeenCalledWith(7,'resume'));}
  expect(api.candidatePaper).not.toHaveBeenCalled();
  expect(api.startResearch).not.toHaveBeenCalled();
});

it('retains local plan control failures when unrelated source records refresh successfully', async () => {
  const plan = { id: 7, sourceStrategyId: -11, sourceVersionId: version.id, sourceBacktestId: 'frozen_bt', status: 'active', intervalSeconds: 86400, budget: 4, maxRuns: 3, runsReserved: 1, nextRunAt: null, lastError: null, operations: [] };
  api.plans.mockResolvedValue([plan]);
  api.controlPlan.mockRejectedValue(new Error('Local plan write failed'));
  render(<Workspace />);
  const pause = await screen.findByRole('button',{name:'暂停计划',hidden:true});
  await waitFor(() => expect(pause).toBeEnabled()); fireEvent.click(pause);
  expect(await screen.findByRole('alert')).toHaveTextContent('Local plan write failed');
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}));
  await waitFor(() => expect(api.strategies).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('alert')).toHaveTextContent('Local plan write failed');
  expect(screen.getByRole('button',{name:'暂停计划',hidden:true})).toBeEnabled();
});

it('only offers cancellation for supported evolution and bridge research task types', async () => {
  api.tasks.mockResolvedValue([
    { id: 'task_evolution', type: 'EVOLUTION', status: 'RUNNING', progress: .2, message: 'Running', error: null },
    { id: 'task_research', type: 'BRIDGE_RESEARCH', status: 'PENDING', progress: null, message: 'Pending', error: null },
    { id: 'task_paper', type: 'BRIDGE_CANDIDATE_PAPER', status: 'RUNNING', progress: null, message: 'Starting', error: null },
  ]);
  render(<Workspace />);
  const paper = (await screen.findByText(/BRIDGE_CANDIDATE_PAPER/)).closest('article')!;
  expect(within(paper).queryByRole('button', { name: '取消来源任务' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '取消来源任务' })).toHaveLength(2);
  const researchTask = screen.getByText(/BRIDGE_RESEARCH/).closest('article')!;
  const cancel = within(researchTask).getByRole('button', { name: '取消来源任务' });
  await waitFor(() => expect(cancel).toBeEnabled()); fireEvent.click(cancel);
  await waitFor(() => expect(api.cancelTask).toHaveBeenCalledWith('task_research'));
  expect(api.cancelTask).not.toHaveBeenCalledWith('task_paper');
});

it.each([
  ['zh', '建立独立模拟'], ['en', 'Create independent paper account'], ['zh-TW', '建立獨立模擬'], ['ja', '独立した模擬口座を作成'], ['ko', '독립 모의 계좌 만들기'],
])('localizes the source workflow in %s', async (language, label) => {
  localStorage.setItem('dsa.uiLanguage', language);
  render(<Workspace />);
  expect(await screen.findByRole('button', { name: label })).toBeVisible();
});

it.each([
  { sourceMinimum: 60, sourceMaximum: 100, minimumHours: 1, maximumCycles: 20 },
  { sourceMinimum: 7200, sourceMaximum: 2, minimumHours: 2, maximumCycles: 2 },
])('uses the stricter main/source plan limits ($sourceMinimum/$sourceMaximum)', async ({ sourceMinimum, sourceMaximum, minimumHours, maximumCycles }) => {
  api.capabilities.mockResolvedValue({ configured: true, available: true, capabilities: {
    ...caps, periodicResearch: { ...caps.periodicResearch, minIntervalSeconds: sourceMinimum, maxCycles: sourceMaximum },
  } });
  render(<Workspace />);
  await screen.findByText('冻结回测与规则研究');
  fireEvent.change(screen.getByRole('combobox', { name: '研究基线回测' }), { target: { value: 'frozen_bt' } });
  const interval = screen.getByRole('spinbutton', { name: '间隔（小时）' });
  const cycles = screen.getByRole('spinbutton', { name: '最多运行轮数' });
  const create = screen.getByRole('button', { name: '创建周期研究计划' });
  expect(interval).toHaveAttribute('min', String(minimumHours));
  expect(cycles).toHaveAttribute('max', String(maximumCycles));
  fireEvent.change(interval, { target: { value: String(minimumHours) } });
  fireEvent.change(cycles, { target: { value: String(maximumCycles) } });
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.change(interval, { target: { value: String(minimumHours / 2) } });
  expect(create).toBeDisabled();
  fireEvent.change(interval, { target: { value: String(minimumHours) } });
  fireEvent.change(cycles, { target: { value: String(maximumCycles + 1) } });
  expect(create).toBeDisabled();
  expect(api.createPlan).not.toHaveBeenCalled();
});
