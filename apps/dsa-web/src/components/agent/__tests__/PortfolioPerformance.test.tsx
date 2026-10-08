import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PortfolioPerformance } from '../PortfolioPerformance';
import type { Portfolio, PortfolioDay } from '../../../api/portfolios';

// Only supply layout dimensions; the real Recharts paths, axes and gaps run.
vi.mock('recharts',async(importOriginal)=>({...(await importOriginal<typeof import('recharts')>()),ResponsiveContainer:({children}:{children:ReactElement})=>cloneElement(children as ReactElement<{width:number;height:number}>,{width:720,height:320})}));
const base={id:-1,name:'Source performance',mode:'paper',market:'US',status:'running',config:{externalRuntime:true,initialCash:1000},metrics:{cumulativeReturn:.075,maxDrawdown:-.15},days:[],externalEvidence:{performanceBasis:'unit_nav',metricsScope:'account_lifetime',curveScope:'selected_run'}} as unknown as Portfolio;
const day=(date:string,sourceReturn:number|null,extra:Record<string,unknown>={}):PortfolioDay=>({date,equity:200000,cash:0,marketValue:200000,holdings:[],trades:[],opinions:[],dailyReturn:0,benchmarkReturn:null,sourceReturn,sourceDrawdown:null,...extra});
beforeEach(()=>{localStorage.setItem('dsa.uiLanguage','zh');});

it('uses source unit returns for the real chart while retaining lifetime summary metrics',async()=>{
  const view=render(<PortfolioPerformance portfolio={{...base,days:[day('2026-01-01',.2),day('2026-01-02',.4)]}}/>);
  await waitFor(()=>expect(view.container.querySelector('.recharts-line-curve')).toBeInTheDocument());
  expect(screen.getByText('40.0%')).toBeInTheDocument();
  expect(screen.getByText('7.5%')).toBeVisible();
  expect(screen.getByText('-15%')).toBeVisible();
  expect(screen.getByText('来源收益使用单位净值，不按账户金额或外部资金流重新计算。')).toBeVisible();
  expect(screen.getByText('指标覆盖账户累计历史；曲线仅覆盖当前运行批次。')).toBeVisible();
  expect(screen.queryByText(/最大回撤使用完整账本高点/)).not.toBeInTheDocument();
});

it.each(['explicit-null','missing-unit-nav'])('does not rebuild unknown source returns from account money for %s',reason=>{
  const observation=day('2026-01-01',null);
  if(reason==='missing-unit-nav') delete observation.sourceReturn;
  render(<PortfolioPerformance portfolio={{...base,days:[observation]}}/>);
  expect(screen.getByText('尚无有效估值记录。')).toBeVisible();
  expect(screen.queryByRole('img',{name:'收益曲线'})).not.toBeInTheDocument();
  expect(screen.getByText('7.5%')).toBeVisible();
});

it('does not infer source lifetime drawdown from a thinned current-run curve',()=>{
  render(<PortfolioPerformance portfolio={{...base,days:[day('2026-01-01',.2),day('2026-01-02',.1)]}}/>);
  fireEvent.click(screen.getByRole('button',{name:'回撤曲线'}));
  expect(screen.getByText('尚无有效估值记录。')).toBeVisible();
  expect(screen.getByText('-15%')).toBeVisible();
});

it('keeps source return and drawdown gaps disconnected in real SVG paths',async()=>{
  const view=render(<PortfolioPerformance portfolio={{...base,days:[
    day('2026-01-01',.1,{sourceDrawdown:-.01}),day('2026-01-02',.2,{sourceDrawdown:-.02}),
    day('2026-01-05',.3,{sourceDrawdown:-.03,breakBefore:true}),day('2026-01-06',.4,{sourceDrawdown:-.04}),
  ]}}/>);
  await waitFor(()=>expect(view.container.querySelector('.recharts-line-curve')?.getAttribute('d')?.match(/M/g)).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'回撤曲线'}));
  await waitFor(()=>expect(view.container.querySelector('.recharts-line-curve')?.getAttribute('d')?.match(/M/g)).toHaveLength(2));
});

it('preserves native and older account-equity curves when source return fields are absent',async()=>{
  const observation={date:'2026-01-01',equity:1200,cash:1200,marketValue:0,holdings:[],trades:[],opinions:[],dailyReturn:0,benchmarkReturn:null};
  const view=render(<PortfolioPerformance portfolio={{...base,config:{...base.config,externalRuntime:false},externalEvidence:undefined,days:[observation,{...observation,date:'2026-01-02',equity:1400,cash:1400}]}}/>);
  await waitFor(()=>expect(view.container.querySelector('.recharts-line-curve')).toBeInTheDocument());
  expect(screen.getByText('按实际记录时间展示；筛选区间不重设收益起点。最大回撤使用完整账本高点，缺失指标不补零。')).toBeVisible();
  view.rerender(<PortfolioPerformance portfolio={{...base,externalEvidence:undefined,days:[observation,{...observation,date:'2026-01-02',equity:1400,cash:1400}]}}/>);
  await waitFor(()=>expect(view.container.querySelector('.recharts-line-curve')).toBeInTheDocument());
});


it.each([-.0006,-.000000006])('renders distinct detail percent ticks without negative zero for a small %s return',async value=>{
 const view=render(<PortfolioPerformance portfolio={{...base,days:[day('2026-01-01',0,{sourceDrawdown:0}),day('2026-01-02',value,{sourceDrawdown:value})]}}/>);
 const labels=()=>[...view.container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(el=>el.textContent);
 await waitFor(()=>{
   expect(labels().length).toBeGreaterThan(2);
   expect(new Set(labels()).size).toBe(labels().length);
   expect(labels().some(label=>/^-0(?:\.0+)?%$/.test(label??''))).toBe(false);
 });
 fireEvent.click(screen.getByRole('button',{name:'回撤曲线'}));
 await waitFor(()=>{
   expect(new Set(labels()).size).toBe(labels().length);
   expect(labels().some(label=>/^-0(?:\.0+)?%$/.test(label??''))).toBe(false);
 });
});
