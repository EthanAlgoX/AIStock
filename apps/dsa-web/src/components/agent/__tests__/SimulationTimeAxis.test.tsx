import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SimulationOverview } from '../SimulationOverview';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
const start='2026-09-26T16:30:04.191979Z';
const api=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('../../../api/portfolios',()=>({simulationOverviewApi:api}));
beforeEach(() => {api.get.mockResolvedValue({items:[{id:1,name:'Axis fixture',status:'running',market:'CRYPTO',initialCash:10000,observations:2,curve:[{time:start,value:0,benchmark:null},{time:'2026-09-27T02:37:56Z',value:0.01,benchmark:null}],cumulativeReturn:0.01,maxDrawdown:0,lastDate:'2026-09-27T02:37:56Z'}],runtime:{configured:false,available:false}});});
vi.mock('../InlinePortfolioDetails',()=>({InlinePortfolioDetails:()=>null}));
// Supply measurable dimensions only: the real Recharts axis and tick renderer run.
vi.mock('recharts',async(importOriginal)=>({...(await importOriginal<typeof import('recharts')>()),ResponsiveContainer:({children}:{children:ReactElement})=>cloneElement(children as ReactElement<{width:number;height:number}>,{width:720,height:320})}));
it('renders the actual first observation as the first visible X-axis label',async()=>{
  localStorage.setItem('dsa.uiLanguage','en');
  const view=render(<UiLanguageProvider><SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()}/></UiLanguageProvider>);
  await waitFor(()=>expect(view.container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value').length).toBeGreaterThan(1));
  const labels=[...view.container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(el=>el.textContent);
  const expected=new Date(start).toLocaleDateString('en',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
  expect(labels[0]).toBe(expected);
  expect(labels.at(-1)).toBe(new Date('2026-09-27T02:37:56Z').toLocaleDateString('en',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}));
});

it('breaks only the source account and its benchmark at explicit gaps while keeping other timelines continuous',async()=>{
  const points=[
    {time:'2026-09-26T01:00:00Z',value:0,benchmark:0},
    {time:'2026-09-26T02:00:00Z',value:.1,benchmark:.01},
    {time:'2026-09-26T05:00:00Z',value:.2,benchmark:.02,breakBefore:true},
    {time:'2026-09-26T06:00:00Z',value:.3,benchmark:.03},
  ];
  api.get.mockResolvedValue({items:[
    {id:1,name:'Gap account',status:'running',market:'US',initialCash:10000,observations:4,curve:points,cumulativeReturn:.3,maxDrawdown:0},
    {id:2,name:'Other timeline',status:'running',market:'US',initialCash:10000,observations:2,curve:[{time:'2026-09-26T01:30:00Z',value:0,benchmark:null},{time:'2026-09-26T05:30:00Z',value:.2,benchmark:null}],cumulativeReturn:.2,maxDrawdown:0},
  ],runtime:{configured:true,available:true}});
  localStorage.setItem('dsa.uiLanguage','en');
  const view=render(<UiLanguageProvider><SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()}/></UiLanguageProvider>);
  await screen.findByText('Gap account');
  fireEvent.click(screen.getByRole('checkbox',{name:'Show available benchmarks'}));
  await waitFor(()=>{
    const paths=[...view.container.querySelectorAll('.recharts-line-curve')];
    expect(paths).toHaveLength(3);
    expect(paths.map(path => path.getAttribute('d')?.match(/M/g)?.length)).toEqual([2,1,2]);
  });
});

it('keeps recent-window filtering intact when a source observation has an invalid timestamp',async()=>{
  api.get.mockResolvedValue({items:[{id:1,name:'Axis fixture',status:'running',market:'CRYPTO',initialCash:10000,observations:4,curve:[
    {time:'unparseable source timestamp',value:0,benchmark:null},
    {time:'2026-08-01T00:00:00Z',value:0,benchmark:null},
    {time:start,value:.1,benchmark:null},
    {time:'2026-09-27T02:37:56Z',value:.2,benchmark:null},
  ],cumulativeReturn:Number.NaN,maxDrawdown:Infinity,lastDate:'2026-09-27T02:37:56Z'}],runtime:{configured:false,available:false}});
  localStorage.setItem('dsa.uiLanguage','en');
  const view=render(<UiLanguageProvider><SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()}/></UiLanguageProvider>);
  await screen.findByText('Axis fixture');
  fireEvent.change(screen.getByRole('combobox',{name:'Curve range'}),{target:{value:'7'}});
  await waitFor(()=>{
    const first=view.container.querySelector('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
    expect(first).toHaveTextContent(new Date(start).toLocaleDateString('en',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}));
  });
  expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
  expect(screen.queryByText('∞%')).not.toBeInTheDocument();
});


it.each([-.0006,-.000000006])('renders distinct overview percent ticks without negative zero for a small %s return',async value=>{
 api.get.mockResolvedValue({items:[{id:1,name:'Small range',status:'running',market:'US',initialCash:10000,observations:2,curve:[{time:start,value:0,benchmark:0},{time:'2026-09-27T02:37:56Z',value,benchmark:.01}],cumulativeReturn:value,maxDrawdown:value}],runtime:{configured:false,available:false}});
 localStorage.setItem('dsa.uiLanguage','en');
 const view=render(<UiLanguageProvider><SimulationOverview onOpen={vi.fn()} onResearch={vi.fn()} onAdopt={vi.fn()}/></UiLanguageProvider>);
 const labels=()=>[...view.container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(el=>el.textContent);
 await waitFor(()=>{
   expect(labels().length).toBeGreaterThan(2);
   expect(new Set(labels()).size).toBe(labels().length);
   expect(labels().some(label=>/^-0(?:\.0+)?%$/.test(label??''))).toBe(false);
 });
 const smallLabels=labels();
 fireEvent.click(screen.getByRole('checkbox',{name:'Show available benchmarks'}));
 await waitFor(()=>{
   expect(labels()).not.toEqual(smallLabels);
   expect(new Set(labels()).size).toBe(labels().length);
   expect(labels().some(label=>/^-0(?:\.0+)?%$/.test(label??''))).toBe(false);
 });
});
