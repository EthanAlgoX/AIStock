import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PortfolioDetailWorkspace } from '../PortfolioDetailWorkspace';
import type { Portfolio } from '../../../api/portfolios';
import { portfolioTiming } from '../../../utils/portfolioTiming';
const portfolio={id:-1,name:'Hourly fixture',mode:'paper',market:'CRYPTO',status:'running',config:{externalRuntime:true,initialCash:10000},timing:{signalTimeframe:'1h',valuation:'live_quote',execution:'quote_simulation',timezone:'UTC',granularity:'observation'},metrics:{cumulativeReturn:.01,sharpe:9,annualizedReturn:10},days:[],externalEvidence:{positions:{},decisions:[{timestamp:'2026-09-26T01:02:00Z',symbol:'TEST',action:'HOLD',reason:'saved decision'}]}} as unknown as Portfolio;
const props={onPanel:vi.fn(),onSelect:vi.fn(),onAdopt:vi.fn(),onBacktest:vi.fn()};
it('separates hourly signals from live quote valuation and does not infer annual metrics',()=>{
 render(<MemoryRouter><PortfolioDetailWorkspace {...props} portfolio={portfolio} panel={null}/></MemoryRouter>);
 expect(screen.getByText('小时级决策')).toBeVisible();expect(screen.getByText('实时报价估值')).toBeVisible();
 expect(screen.getByRole('tab',{name:'表现'})).toHaveAttribute('aria-selected','true');
 expect(screen.queryByText('1000%')).toBeNull();expect(screen.queryByText('9')).toBeNull();
 expect(screen.queryByText('saved decision')).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'决策记录'}));expect(props.onPanel).toHaveBeenCalledWith('decisions');
});
it('uses timestamped source decisions rather than a daily selector',()=>{
 render(<MemoryRouter><PortfolioDetailWorkspace {...props} portfolio={portfolio} panel="decisions"/></MemoryRouter>);
 expect(screen.getByText('saved decision')).toBeVisible();expect(screen.queryByLabelText('查看日期')).toBeNull();
 expect(screen.getByText(/HOLD 或许可指令不等于成交/)).toBeVisible();
});
it('does not guess unknown private timing and retains the native daily contract',()=>{
 expect(portfolioTiming({...portfolio,timing:undefined})).toBeNull();
 expect(portfolioTiming({...portfolio,timing:undefined,config:{...portfolio.config,externalRuntime:false}})?.granularity).toBe('trading_day');
});

it('keeps source round trips separate from individual timestamped fills',()=>{
 const backtest={...portfolio,mode:'backtest' as const,externalEvidence:{...portfolio.externalEvidence!,trades:[
 {symbol:'PAIR',entry:'2026-01-01T01:00Z',exit:'2026-01-02T03:00Z',qty:1,pnl:2},
 {symbol:'FILL',timestamp:'2026-01-01T02:00Z',side:'buy',qty:3,price:4,fee:0.1}]}};
 render(<MemoryRouter><PortfolioDetailWorkspace {...props} portfolio={backtest} panel="executions"/></MemoryRouter>);
 expect(screen.getByText('2026-01-01T02:00Z')).toBeVisible();
 expect(screen.getByText('2026-01-02T03:00Z')).toBeVisible();
 expect(screen.getByRole('columnheader',{name:'入场时间'})).toBeVisible();
 expect(screen.getByRole('columnheader',{name:'成交时间（UTC）'})).toBeVisible();
});
