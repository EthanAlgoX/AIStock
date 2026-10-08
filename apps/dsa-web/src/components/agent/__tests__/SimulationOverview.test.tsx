import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SimulationOverview } from '../SimulationOverview';
import { SourceEvolutionPanel } from '../SourceEvolutionPanel';
import { PortfolioDetailWorkspace } from '../PortfolioDetailWorkspace';
import type { Portfolio } from '../../../api/portfolios';
const api = vi.hoisted(() => ({get:vi.fn(),evolution:vi.fn(),evolve:vi.fn(),capabilities:vi.fn()}));
vi.mock('../InlinePortfolioDetails',()=>({InlinePortfolioDetails:({id}:{id:number})=><div>Expanded account {id}</div>}));
vi.mock('../../../api/portfolios', () => ({simulationOverviewApi:api,sourceRuntimeApi:{capabilities:api.capabilities}}));
const row = {id:1, name:'Live fixture', status:'running', market:'US', initialCash:10000, observations:0, curve:[], maxDrawdown:null, cumulativeReturn:null, lastDate:null};
beforeEach(() => {vi.clearAllMocks();api.get.mockResolvedValue({items:[row,{...row,id:2,name:'Paused fixture',status:'paused'}],runtime:{configured:false,available:false}});api.evolution.mockResolvedValue({supported:true,items:[]});api.capabilities.mockResolvedValue({configured:true,available:false,capabilities:null});});
it('prioritizes running accounts and keeps empty observations unknown', async () => {
  const open=vi.fn(),research=vi.fn();render(<SimulationOverview onOpen={open} onResearch={research} onAdopt={vi.fn()} />);
  await screen.findByText('Live fixture');
  expect(screen.queryByText('Paused fixture')).toBeNull();
  expect(screen.getByText('等待有效模拟观测，尚无收益曲线。')).toBeVisible();
  expect(screen.queryByText('0%')).toBeNull();
  const toggle=screen.getByRole('button',{name:/Live fixture/});
  expect(toggle).toHaveAttribute('aria-expanded','false');
  fireEvent.click(toggle);expect(screen.getByText('Expanded account 1')).toBeVisible();
  expect(open).not.toHaveBeenCalled();expect(research).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox',{name:'包含暂停和停止的账户'}));expect(screen.getByText('Paused fixture')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/Paused fixture/}));
  expect(screen.queryByText('Expanded account 1')).toBeNull();
  expect(screen.getByText('Expanded account 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/Paused fixture/}));expect(screen.queryByText('Expanded account 2')).toBeNull();
  expect(api.get).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('combobox',{name:'市场'}),{target:{value:'CRYPTO'}});
  expect(screen.getByText('当前筛选下没有正在模拟的策略。')).toBeVisible();
});
it('does not treat a candidate without final evaluation as passed', async () => {
  api.evolution.mockResolvedValue({supported:true,items:[{id:'research',status:'SUCCEEDED',completed:1,budget:1,candidateVersion:'candidate',passed:false,finalChecked:false,experiments:[]}]});
  render(<SourceEvolutionPanel id={-1004} />);
  expect(await screen.findByText(/验证候选，待最终检查/)).toBeTruthy();
  expect(screen.queryByText('检查通过')).toBeNull();
  api.evolve.mockResolvedValue({supported:true,items:[]});
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'15'}});
  fireEvent.click(screen.getByRole('button',{name:'运行参数实验'}));
  await waitFor(()=>expect(api.evolve).toHaveBeenCalledWith(-1004,.15));
});
it('explains unsupported search instead of allowing model calls', async () => {
  api.evolution.mockResolvedValue({supported:false,items:[]});render(<SourceEvolutionPanel id={-1006} />);
  await screen.findByText(/此版本尚无可复核/);
  expect(screen.getByRole('button',{name:'运行参数实验'})).toBeDisabled();
});
it('offers the unified source workspace only for a compatible source contract and keeps legacy checks distinct', async () => {
  api.capabilities.mockResolvedValue({available:true,capabilities:{contractVersion:'quantevo.ai-stock.v1',operations:{read:true}}});
  render(<MemoryRouter><SourceEvolutionPanel id={-1004}/></MemoryRouter>);
  expect(await screen.findByRole('link',{name:'打开来源策略研究'})).toHaveAttribute('href','/trading?view=source');
  expect(screen.getByText(/旧研究检查标签不代表模拟准入/)).toBeVisible();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button', {name:'运行参数实验'})).toBeNull();
});

it('uses the real source account research panel for read-only history and the unified rule research entry', async () => {
  api.capabilities.mockResolvedValue({available:true,capabilities:{contractVersion:'quantevo.ai-stock.v1',operations:{read:true}}});
  api.evolution.mockResolvedValue({supported:true,items:[{id:'archive-research',status:'SUCCEEDED',completed:1,budget:2,candidateVersion:'source-candidate',passed:false,finalChecked:false,experiments:[{ordinal:1,validation_metrics_json:{sharpe:1.2,total_return:.1,max_drawdown:-.05}}]}]});
  const portfolio = {id:-1004,name:'Source account',mode:'paper',market:'US',status:'paused',config:{externalRuntime:true,initialCash:10000},metrics:{},days:[]} as unknown as Portfolio;
  render(<MemoryRouter><PortfolioDetailWorkspace portfolio={portfolio} panel="research" onPanel={vi.fn()} onAdopt={vi.fn()} onSelect={vi.fn()} onBacktest={vi.fn()}/></MemoryRouter>);
  expect(await screen.findByRole('link',{name:'打开来源策略研究'})).toHaveAttribute('href','/trading?view=source');
  expect(screen.getByText('冻结回测与规则研究 · 年度迭代资格 · 每轮实验预算')).toBeVisible();
  expect(await screen.findByText(/验证候选，待最终检查/)).toBeVisible();
  expect(screen.getByText(/source-candidate/)).toBeInTheDocument();
  expect(screen.getByText('1.20')).toBeInTheDocument();
  expect(screen.queryByText(/复用来源引擎与冻结样本筛选参数候选/)).toBeNull();
  expect(screen.queryByLabelText(/回撤上限/)).toBeNull();
  expect(screen.queryByRole('button',{name:'运行参数实验'})).toBeNull();
  expect(api.evolve).not.toHaveBeenCalled();
});

it.each([
  {available:true,capabilities:{contractVersion:'unknown.v2',operations:{read:true}}},
  {available:false,capabilities:{contractVersion:'quantevo.ai-stock.v1',operations:{read:true}}},
  {available:true,capabilities:{contractVersion:'quantevo.ai-stock.v1',operations:{read:false}}},
  {available:true,capabilities:null},
  {available:false,capabilities:null,legacy:false},
])('keeps legacy and source writes closed for an unavailable or invalid contract %j', async (status) => {
  api.capabilities.mockResolvedValue(status);
  api.evolution.mockResolvedValue({supported:true,items:[{id:'retained-record',status:'FAILED',completed:0,budget:1,experiments:[]}]});
  render(<MemoryRouter><SourceEvolutionPanel id={-1004}/></MemoryRouter>);
  expect(await screen.findByText(/尚未提供兼容接口或暂时不可用/)).toBeVisible();
  expect(await screen.findByText(/研究失败/)).toBeVisible();
  expect(screen.queryByRole('link',{name:'打开来源策略研究'})).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button',{name:'运行参数实验'})).toBeNull();
  expect(api.evolve).not.toHaveBeenCalled();
});

it('does not enable the legacy max-drawdown form while capability detection is pending or timed out', async () => {
  let reject: (reason: unknown) => void = () => undefined;
  api.capabilities.mockImplementation(() => new Promise((_resolve, fail) => {reject=fail;}));
  api.evolution.mockResolvedValue({supported:true,items:[{id:'retained-record',status:'FAILED',completed:0,budget:1,experiments:[]}]});
  render(<MemoryRouter><SourceEvolutionPanel id={-1004}/></MemoryRouter>);
  await screen.findByText(/研究失败/);
  expect(screen.queryByRole('button',{name:'运行参数实验'})).toBeNull();
  await act(async () => {reject({isAxiosError:true,response:{status:503}});});
  expect(await screen.findByText(/尚未提供兼容接口或暂时不可用/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'运行参数实验'})).toBeNull();
  expect(api.evolve).not.toHaveBeenCalled();
});

it('retains legacy research controls when the capability endpoint is confirmed absent', async () => {
  api.capabilities.mockRejectedValue({isAxiosError:true,response:{status:404}});
  api.evolve.mockResolvedValue({supported:true,items:[]});
  render(<MemoryRouter><SourceEvolutionPanel id={-1004}/></MemoryRouter>);
  const button = await screen.findByRole('button',{name:'运行参数实验'});
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(api.evolve).toHaveBeenCalledWith(-1004,.2));
});

it('retains the old research controls only when a new wrapper explicitly confirms a legacy bridge', async () => {
  api.capabilities.mockResolvedValue({configured:true,available:false,capabilities:null,legacy:true});
  api.evolve.mockResolvedValue({supported:true,items:[]});
  render(<MemoryRouter><SourceEvolutionPanel id={-1004}/></MemoryRouter>);
  const button = await screen.findByRole('button',{name:'运行参数实验'});
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'15'}});
  fireEvent.click(button);
  await waitFor(() => expect(api.evolve).toHaveBeenCalledWith(-1004,.15));
});

it('ranks current returns descending on every poll, keeping unknowns last and expansion attached to the account', async () => {
  vi.useFakeTimers();
  const items = [
    {...row, id:1, name:'Losing strategy', cumulativeReturn:-.1, observations:1},
    {...row, id:2, name:'Unknown strategy'},
    {...row, id:3, name:'Winning strategy', cumulativeReturn:.2, observations:1},
    {...row, id:4, name:'Flat strategy', cumulativeReturn:0, observations:1},
    {...row, id:5, name:'Tied strategy', cumulativeReturn:.2, observations:1},
    {...row, id:6, name:'Invalid strategy', cumulativeReturn:Number.NaN, observations:1},
  ];
  api.get.mockResolvedValue({items,runtime:{configured:false,available:false}});
  let view: ReturnType<typeof render> | undefined;
  const names = () => screen.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded'))
    .map(button => items.find(item => button.textContent?.includes(item.name))?.name);
  try {
    await act(async () => {view=render(<SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()} />);});
    expect(names()).toEqual(['Winning strategy','Tied strategy','Flat strategy','Losing strategy','Unknown strategy','Invalid strategy']);
    fireEvent.click(screen.getByRole('button',{name:/Losing strategy/}));
    expect(screen.getByText('Expanded account 1')).toBeVisible();
    api.get.mockResolvedValue({items:[...items].reverse().map(item => item.id===1 ? {...item,cumulativeReturn:.3} : item),runtime:{configured:false,available:false}});
    await act(async () => {await vi.advanceTimersByTimeAsync(30000);});
    expect(names()).toEqual(['Losing strategy','Winning strategy','Tied strategy','Flat strategy','Unknown strategy','Invalid strategy']);
    expect(screen.getByText('Expanded account 1')).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(items.map(item => item.id)).toEqual([1,2,3,4,5,6]);
  } finally {
    view?.unmount();
    vi.useRealTimers();
  }
});
