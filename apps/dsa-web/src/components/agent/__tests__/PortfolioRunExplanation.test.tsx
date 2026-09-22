import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Portfolio, PortfolioDay } from '../../../api/portfolios';
import { PortfolioRunExplanation } from '../PortfolioRunExplanation';

const day = {
  date: '2026-09-22', equity: 100000, cash: 100000, marketValue: 0, dailyReturn: 0, benchmarkReturn: 0, holdings: [], trades: [],
  opinions: [{ code: '688233', targetWeight: 0, reason: '成交量倍数 0.80，小于 1.3。', stance: 'neutral', held: false }],
} as PortfolioDay;
const portfolio = { mode: 'paper', status: 'running', days: [day] } as Portfolio;

describe('PortfolioRunExplanation', () => {
  it('shows the zero-target reason without requiring a hidden tab', () => {
    render(<PortfolioRunExplanation portfolio={portfolio} />);
    expect(screen.getByText('当前空仓，最近决策的目标仓位均为 0，没有生成买入计划。')).toBeVisible();
    expect(screen.getByText('成交量倍数 0.80，小于 1.3。')).toBeVisible();
    expect(screen.getByText(/至少 20 分钟/)).toBeVisible();
  });
  it('does not treat a positive target as a filled order', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, days: [{ ...day, opinions: [{ ...day.opinions[0], targetWeight: 0.25 }] }] }} />);
    expect(screen.getByText(/不代表已经下单或成交/)).toBeVisible();
    expect(screen.getByText(/25.0%/)).toBeVisible();
    expect(screen.queryByText(/没有生成买入计划/)).not.toBeInTheDocument();
  });
  it('does not infer unmet conditions from a missing decision', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, days: [{ ...day, opinions: [] }] }} />);
    expect(screen.getByText(/没有新决策/)).toBeVisible();
  });
  it('distinguishes paused valuation from a fresh decision', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, days: [{ ...day, paused: true }] }} />);
    expect(screen.getByText(/仅更新持仓估值/)).toBeVisible();
    expect(screen.queryByText('成交量倍数 0.80，小于 1.3。')).not.toBeInTheDocument();
  });
  it('shows order rejection reasons', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, days: [{ ...day, trades: [{ code: '688233', status: 'rejected', reason: 'Insufficient cash' } as PortfolioDay['trades'][number]] }] }} />);
    expect(screen.getByText(/有订单未成交/)).toBeVisible();
    expect(screen.getByText(/Insufficient cash/)).toBeVisible();
  });
  it('labels failed backtests as partial and explains how to resume', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, mode: 'backtest', status: 'ready', error: 'timeout' }} />);
    expect(screen.getByText(/不代表完整回测/)).toBeVisible();
    expect(screen.getByText(/运行回测.*未完成的日期/)).toBeVisible();
  });
  it('does not call an active retry interrupted', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, mode: 'backtest', status: 'ready', busy: true, error: 'timeout' }} />);
    expect(screen.getByText(/历史验证尚未完成/)).toBeVisible();
    expect(screen.queryByText(/历史验证已中断/)).not.toBeInTheDocument();
  });
  it('does not label completed backtests partial', () => {
    render(<PortfolioRunExplanation portfolio={{ ...portfolio, mode: 'backtest', status: 'completed' }} />);
    expect(screen.queryByText(/不代表完整回测|历史验证尚未完成/)).not.toBeInTheDocument();
  });
});
