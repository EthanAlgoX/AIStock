import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InlinePortfolioDetails } from '../InlinePortfolioDetails';
const api=vi.hoisted(()=>({detail:vi.fn()}));
vi.mock('../../../api/portfolios',()=>({portfoliosApi:api}));
vi.mock('../PortfolioDetailWorkspace',()=>({PortfolioDetailWorkspace:()=> <div>account details</div>}));
const props={id:1,onManage:vi.fn(),onResearch:vi.fn(),onAdopt:vi.fn()};
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it('refreshes only the mounted account and stops after collapse',async()=>{
 vi.useFakeTimers();api.detail.mockResolvedValue({id:1,mode:'paper',currency:'USD'});
 const view=render(<InlinePortfolioDetails {...props}/>);
 await act(async()=>{});
 expect(api.detail).toHaveBeenCalledWith(1);
 await act(async()=>{vi.advanceTimersByTime(30000);});
 expect(api.detail).toHaveBeenCalledTimes(2);
 view.unmount();await act(async()=>{vi.advanceTimersByTime(30000);});
 expect(api.detail).toHaveBeenCalledTimes(2);
});
it('offers retry on a failed detail request without inventing empty positions',async()=>{
 api.detail.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({id:1,mode:'paper',currency:'USD'});
 render(<InlinePortfolioDetails {...props}/>);
 expect(await screen.findByRole('alert')).toBeVisible();
 expect(screen.queryByText('account details')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重试'}));
 expect(await screen.findByText('account details')).toBeVisible();
});
