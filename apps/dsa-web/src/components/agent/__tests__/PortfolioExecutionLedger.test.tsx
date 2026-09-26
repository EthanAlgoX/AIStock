import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PortfolioExecutionLedger } from '../PortfolioExecutionLedger';
import type { Portfolio } from '../../../api/portfolios';
const portfolio={id:-1,mode:'paper',config:{externalRuntime:true},days:[{date:'2026-09-26',equity:10001,cash:5000,marketValue:5001,trades:[],holdings:[{code:'BTCUSDT'}]}],executionLedger:[{id:'0',timestamp:'2026-09-25T10:00:00Z',code:'BTCUSDT',side:'buy',quantity:.01,price:50000,fee:null,status:'filled',reason:'source record'}],executionCoverage:{sourceCount:1}} as unknown as Portfolio;
it('shows an older execution even when the latest observation has no trade',()=>{
 render(<PortfolioExecutionLedger portfolio={portfolio} />);
 expect(screen.getByRole('cell',{name:'2026-09-25T10:00:00Z'})).toBeVisible();
 expect(screen.getByRole('cell',{name:'BTCUSDT'})).toBeVisible();
 expect(screen.getByRole('cell',{name:'—'})).toBeVisible();
});
it('does not equate an unavailable source ledger with no trading',()=>{
 render(<PortfolioExecutionLedger portfolio={{...portfolio,executionLedger:undefined,executionCoverage:null}} />);
 expect(screen.getByText('模拟成交明细暂未提供，不能据此判断没有交易。')).toBeVisible();
});
