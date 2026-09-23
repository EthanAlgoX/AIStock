import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StrategyAuthoringPanel from './StrategyAuthoringPanel';
import { strategyDraftsApi, type StrategyDraftState } from '../../api/strategyDrafts';

vi.mock('../../api/strategyDrafts', () => ({ strategyDraftsApi: { sync: vi.fn(), begin: vi.fn(), validate: vi.fn(), save: vi.fn() } }));
const state: StrategyDraftState = { sessionId: 'one', kind: 'trading', draft: { name: '网格策略', method: '高成交量高波动', missing: [] }, revision: 1, validated: false, skillId: null, error: null };
const mode = vi.fn();
const created = vi.fn();
const view = (loading = false) => <MemoryRouter><StrategyAuthoringPanel sessionId="one" messageCount={2} loading={loading} hasDiscussion onMode={mode} onCreated={created} /></MemoryRouter>;

beforeEach(() => { vi.clearAllMocks(); });
describe('Strategy authoring', () => {
  it('creates a separate session and explicitly carries discussion', async () => {
    vi.mocked(strategyDraftsApi.sync).mockResolvedValue(null);
    vi.mocked(strategyDraftsApi.begin).mockResolvedValue(state);
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: '将当前讨论转为策略' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.any(String), true));
    expect(strategyDraftsApi.begin).toHaveBeenCalledWith(expect.any(String), 'trading');
    expect(strategyDraftsApi.save).not.toHaveBeenCalled();
  });
  it('restores a draft, checks before saving, and links to the existing simulator', async () => {
    vi.mocked(strategyDraftsApi.sync).mockResolvedValue(state);
    vi.mocked(strategyDraftsApi.validate).mockResolvedValue({ ...state, validated: true });
    vi.mocked(strategyDraftsApi.save).mockResolvedValue({ ...state, validated: true, skillId: 'saved' });
    render(view());
    await screen.findByText('交易推演策略 · 网格策略');
    fireEvent.click(screen.getByText('查看策略草稿与发布操作'));
    expect(screen.getByRole('button', { name: '保存为 Skill' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '检查策略完整性' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存为 Skill' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '保存为 Skill' }));
    expect(await screen.findByRole('link', { name: '配置交易推演' })).toHaveAttribute('href', '/trading?sourceSession=one');
    expect(strategyDraftsApi.save).toHaveBeenCalledWith('one', 1);
  });
  it('blocks actions for an incomplete latest answer', async () => {
    vi.mocked(strategyDraftsApi.sync).mockResolvedValue({ ...state, error: '回答不完整' });
    render(view());
    await screen.findByText('回答不完整');
    expect(screen.getByRole('button', { name: '检查策略完整性' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存为 Skill' })).toBeDisabled();
  });
  it('shows the actual published definition instead of creating another one', async () => {
    vi.mocked(strategyDraftsApi.sync).mockResolvedValue({ ...state, validated: true, skillId: 'saved', publishedStrategyId: 7 });
    render(view());
    expect(await screen.findByRole('link', { name: '查看交易推演' })).toHaveAttribute('href', '/trading?strategy=7');
  });
  it.each([['research', '/stock-research', '配置个股研究工作流'], ['screening', '/screening', '配置选股工作流']] as const)(
    'links a saved %s Skill to formal task configuration', async (kind, path, label) => {
      vi.mocked(strategyDraftsApi.sync).mockResolvedValue({ ...state, kind, skillId: 'saved' });
      render(view());
      expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', `${path}?sourceSession=one`);
    },
  );
});

it('does not let a late save response change another conversation', async () => {
  vi.mocked(strategyDraftsApi.sync).mockResolvedValue({ ...state, validated: true });
  let resolveSave!: (value: StrategyDraftState) => void;
  vi.mocked(strategyDraftsApi.save).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
  const mounted = render(view());
  await screen.findByText('交易推演策略 · 网格策略');
  fireEvent.click(screen.getByRole('button', { name: '保存为 Skill' }));
  await waitFor(() => expect(strategyDraftsApi.save).toHaveBeenCalled());
  mounted.unmount();
  mode.mockClear();
  resolveSave({ ...state, validated: true, skillId: 'late' });
  await Promise.resolve();
  expect(mode).not.toHaveBeenCalled();
});
