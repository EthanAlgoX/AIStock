import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecisionReportVisuals } from '../DecisionReportVisuals';

describe('DecisionReportVisuals', () => {
  it('preserves candidate order and zero scores, rejecting missing or out-of-range values', () => {
    render(<DecisionReportVisuals kind="screening" data={{ snapshot_count: 5208, after_filter_count: 19, candidates: [{ name: '甲', score: 0 }, { name: '乙', score: 80 }, { name: '丙', score: 101 }, { name: '丁' }] }} />);
    expect(screen.getByText('5,208')).toBeVisible();
    expect(screen.getAllByRole('meter').map(node => node.getAttribute('aria-valuenow'))).toEqual(['0', '80']);
    expect(screen.getAllByRole('meter')[0]).toHaveAttribute('aria-label', '甲');
  });
  it('shows independent equity weights without inferring cash or treating decimals as percentages', () => {
    render(<DecisionReportVisuals kind="trading" data={{ actions: [{ name: '甲', position_pct_of_equity: 14.89 }, { name: '乙', targetWeightPercent: 0 }, { name: '丙', targetWeight: 0.3 }] }} />);
    expect(screen.getByRole('meter', { name: '甲' })).toHaveAttribute('aria-valuenow', '14.89');
    expect(screen.getByRole('meter', { name: '乙' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByRole('meter', { name: '丙' })).not.toBeInTheDocument();
    expect(screen.queryByText('85.11%')).not.toBeInTheDocument();
  });
  it('keeps an empty result explicit', () => {
    render(<DecisionReportVisuals kind="screening" data={{ candidates: [] }} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('本次没有符合条件的候选。')).toBeVisible();
  });
});
