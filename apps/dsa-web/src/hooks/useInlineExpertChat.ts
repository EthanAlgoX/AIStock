import { useEffect, useState } from 'react';
import { workspaceApi, type WorkspaceCapabilityCatalog, type WorkspaceRun } from '../api/workspace';
import type { AgentCapabilityBindings } from '../types/capabilities';
import { useWorkspaceRun } from './useWorkspaceRun';
import { isRunActive } from '../stores/workspaceRunStore';
import { useAgentChatStore } from '../stores/agentChatStore';

export const collaborationChoices = [
  { id: 'debate', name: '辩论式', description: '独立研究、最多两轮质询，由主持人总结。' },
  { id: 'pipeline', name: '流水线', description: '主持人拆分任务，各专家依次完成子任务。' },
  { id: 'voting', name: '投票式', description: '专家独立报告，3 位独立评审投票选出。' },
];
type Selection = { expertIds: number[]; mode: string };
const empty: Selection = { expertIds: [], mode: 'debate' };

/** Optional expert execution uses the ordinary chat session and durable run ledger. */
export function useInlineExpertChat(sessionId: string) {
  const [catalog, setCatalog] = useState<WorkspaceCapabilityCatalog>();
  const [catalogError, setCatalogError] = useState('');
  const [pollError, setPollError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [savedRun, setSavedRun] = useState<WorkspaceRun>();
  const selection = selections[sessionId] || empty;
  const runtime = useWorkspaceRun('expert_review');
  const refreshMessages = useAgentChatStore((s) => s.refreshMessages);
  const run = [runtime.activeRun, savedRun].filter((item): item is WorkspaceRun =>
    Boolean(item && item.taskSnapshot.config.chatSessionId === sessionId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt))[0] || null;
  const running = isRunActive(run);
  const runId = run?.id;
  const runStatus = run?.status;
  const enabled = selection.expertIds.length > 0;
  const supported = catalog?.discussionChatBinding && catalog.discussionModes?.includes(selection.mode);

  useEffect(() => {
    let active = true;
    workspaceApi.getCapabilities().then((value) => {
      if (active) { setCatalog(value); setCatalogError(''); }
    }).catch(() => active && setCatalogError('专家目录读取失败；普通对话仍可使用。'));
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    let active = true;
    workspaceApi.listRuns('expert_review').then((runs) => {
      if (!active) return;
      const previous = runs.find((item) => item.taskSnapshot.config.chatSessionId === sessionId);
      if (previous) setSavedRun(previous);
      if (previous && isRunActive(previous)) setSelections((current) => current[sessionId] ? current : { ...current, [sessionId]: {
        expertIds: previous.taskSnapshot.capabilities.expertIds,
        mode: String(previous.taskSnapshot.config.collaborationMode || 'debate'),
      } });
    }).catch(() => { /* Run recovery is retried and reported by the shared run store. */ });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!runId || !running) return;
    let active = true;
    const timer = window.setInterval(() => {
      workspaceApi.getRun(runId).then((value) => { if (active) { setSavedRun(value); setPollError(''); } })
        .catch(() => { if (active) setPollError('协作进度读取失败，正在重试；后台运行不会停止。'); });
    }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [runId, running]);

  useEffect(() => {
    if (runId) void refreshMessages();
  }, [runId, runStatus, sessionId, refreshMessages]);

  const update = (value: Partial<Selection>) => setSelections((current) => ({
    ...current, [sessionId]: { ...(current[sessionId] || empty), ...value },
  }));
  const error = catalogError || (enabled && !supported ? '后端尚未支持对话内专家协作，请更新服务或取消专家选择。'
    : enabled && selection.expertIds.length < 2 ? '协作需要至少 2 位专家；取消全部选择可直接对话。'
    : enabled && runtime.busy && !running && !runtime.submitting ? '正在恢复运行状态或其他专家任务尚未结束；也可取消专家选择，直接对话。' : '');

  return {
    catalog, selection, enabled, running, run, error,
    pending: running || runtime.submitting,
    blocked: enabled && (Boolean(error) || runtime.busy),
    runError: pollError || runtime.runError,
    retry: () => setRetry((value) => value + 1),
    update,
    async cancel() {
      if (!runId || !running) return;
      try {
        await workspaceApi.cancelRun(runId);
        setSavedRun(await workspaceApi.getRun(runId));
        setPollError('');
      } catch {
        setPollError('停止请求未确认，请重试；其他会话不会被停止。');
      }
    },
    async send(message: string, capabilities: AgentCapabilityBindings, accepted: () => void, sourceRunId?: string) {
      if (!enabled || !supported || error || runtime.busy) return;
      await runtime.startRun(async () => {
        const task = await workspaceApi.createTask({
          kind: 'expert_review', name: message.slice(0, 80), objective: message,
          market: 'GLOBAL', subject: {},
          capabilities: { ...capabilities, expertIds: selection.expertIds, expertTeamIds: [] },
          config: { discussionProtocol: 'cross_response_v1', collaborationMode: selection.mode,
            crossExaminationRounds: 2, mode: 'group', chatSessionId: sessionId,
            ...(sourceRunId ? { sourceRunId } : {}) },
        });
        const next = await workspaceApi.runTask(task.id);
        accepted();
        return next;
      }, '专家请求尚未确认，正在核对后台记录，请勿重复发送。');
    },
  };
}
