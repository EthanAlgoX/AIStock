import { cloneElement, type ReactElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SimulationOverview } from '../SimulationOverview';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
const start='2026-09-26T16:30:04.191979Z';
vi.mock('../../../api/portfolios',()=>({simulationOverviewApi:{get:async()=>({items:[{id:1,name:'Axis fixture',status:'running',market:'CRYPTO',initialCash:10000,observations:2,curve:[{time:start,value:0,benchmark:null},{time:'2026-09-27T02:37:56Z',value:0.01,benchmark:null}],cumulativeReturn:0.01,maxDrawdown:0,lastDate:'2026-09-27T02:37:56Z'}],runtime:{configured:false,available:false}})}}));
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
