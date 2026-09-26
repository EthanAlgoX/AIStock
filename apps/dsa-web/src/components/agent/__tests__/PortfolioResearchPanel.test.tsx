import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PortfolioResearchPanel } from '../PortfolioResearchPanel';
import type { Portfolio } from '../../../api/portfolios';
const api = vi.hoisted(() => ({list: vi.fn(), create: vi.fn(), adopt: vi.fn()}));
vi.mock('../../../api/portfolios', () => ({portfolioResearchApi: api}));
const source = {id:1, status:'completed', config:{scopeRefresh:'snapshot'}, days:Array(100).fill({})} as Portfolio;
beforeEach(() => {vi.clearAllMocks(); api.list.mockResolvedValue([]);});
it('requires a completed 100-day fixed-universe backtest', async () => {
  render(<PortfolioResearchPanel portfolio={{...source, status:'ready'}} onAdopt={vi.fn()} />);
  expect(await screen.findByRole('button', {name:'运行参数实验'})).toBeDisabled();
});
it('runs bounded research without starting a paper account', async () => {
  api.create.mockRejectedValue(new Error('sample invalid'));
  const adopt = vi.fn();
  render(<PortfolioResearchPanel portfolio={source} onAdopt={adopt} />);
  fireEvent.change(screen.getByRole('spinbutton'), {target:{value:'15'}});
  fireEvent.click(screen.getByRole('button', {name:'运行参数实验'}));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(1, .15));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(adopt).not.toHaveBeenCalled();
});
