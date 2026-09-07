import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useInlineExpertChat } from './useInlineExpertChat';
import { useWorkspaceRunStore, EMPTY_RUN_STATE } from '../stores/workspaceRunStore';
import { workspaceCatalogFixture, workspaceRunFixture, workspaceTaskFixture } from '../testWorkspaceFixtures';

const api = vi.hoisted(() => ({ getCapabilities: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), cancelRun: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('../api/workspace', () => ({ workspaceApi: api }));
vi.mock('../stores/agentChatStore', () => ({ useAgentChatStore: (select: (s: unknown) => unknown) => select({ refreshMessages: refresh }) }));
const makeRun = (id: string, chatSessionId: string) => workspaceRunFixture(workspaceTaskFixture({
  kind: 'expert_review', config: { chatSessionId, collaborationMode: 'debate' },
  capabilities: { ...workspaceCatalogFixture.defaults.expert_review, expertIds: [-1001, -1002] },
}), { id, status: 'running', completedAt: null });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceRunStore.setState({ runs: {} });
  api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
  api.cancelRun.mockResolvedValue({ accepted: true });
});

it('restores and cancels this chat only, even when the global run belongs to another chat', async () => {
  const own = makeRun('own-run', 'own-chat');
  const other = makeRun('other-run', 'other-chat');
  api.listRuns.mockResolvedValue([other, own]);
  api.getRun.mockImplementation(async (id: string) => id === own.id ? own : other);
  useWorkspaceRunStore.setState({ runs: { expert_review: { ...EMPTY_RUN_STATE, restoring: false, run: other } } });
  const { result } = renderHook(() => useInlineExpertChat('own-chat'));
  await waitFor(() => expect(result.current.run?.id).toBe('own-run'));
  expect(result.current.running).toBe(true);
  await act(async () => { await result.current.cancel(); });
  expect(api.cancelRun).toHaveBeenCalledWith('own-run');
  expect(api.cancelRun).not.toHaveBeenCalledWith('other-run');
});

it('restores the newest chat run instead of a stale completed global run', async () => {
  const old = { ...makeRun('old', 'same-chat'), status: 'completed' as const, createdAt: '2026-09-01T00:00:00' };
  const current = { ...makeRun('current', 'same-chat'), createdAt: '2026-09-02T00:00:00' };
  api.listRuns.mockResolvedValue([current, old]);
  api.getRun.mockResolvedValue(old);
  useWorkspaceRunStore.setState({ runs: { expert_review: { ...EMPTY_RUN_STATE, restoring: false, run: old } } });
  const { result } = renderHook(() => useInlineExpertChat('same-chat'));
  await waitFor(() => expect(result.current.run?.id).toBe('current'));
  expect(result.current.running).toBe(true);
  expect(result.current.selection.expertIds).toEqual([-1001, -1002]);
});
