import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SimulationOverview } from '../SimulationOverview';
import { SourceEvolutionPanel } from '../SourceEvolutionPanel';
const api = vi.hoisted(() => ({get:vi.fn(),evolution:vi.fn(),evolve:vi.fn()}));
vi.mock('../InlinePortfolioDetails',()=>({InlinePortfolioDetails:({id}:{id:number})=><div>Expanded account {id}</div>}));
vi.mock('../../../api/portfolios', () => ({simulationOverviewApi:api}));
const row = {id:1, name:'Live fixture', status:'running', market:'US', initialCash:10000, observations:0, curve:[], maxDrawdown:null, cumulativeReturn:null, lastDate:null};
beforeEach(() => {vi.clearAllMocks();api.get.mockResolvedValue({items:[row,{...row,id:2,name:'Paused fixture',status:'paused'}],runtime:{configured:false,available:false}});api.evolution.mockResolvedValue({supported:true,items:[]});});
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
