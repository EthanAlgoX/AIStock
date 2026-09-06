import { create } from "zustand";
import { workspaceApi, type WorkspaceRun, type WorkspaceTaskKind } from "../api/workspace";
import { getParsedApiError } from "../api/error";

type RunState = {
  run: WorkspaceRun | null;
  submitting: boolean;
  restoring: boolean;
  error: string;
  startError: string;
  revision: number;
};

export const EMPTY_RUN_STATE: RunState = {
  run: null, submitting: false, restoring: true, error: "", startError: "", revision: 0,
};

export const isRunActive = (run: WorkspaceRun | null) => (
  run?.status === "queued" || run?.status === "running"
);

// UI state outlives routes. Runs themselves remain owned by the backend;
// a fresh browser session restores the latest manual run from its ledger.
export const useWorkspaceRunStore = create<{
  runs: Partial<Record<WorkspaceTaskKind, RunState>>;
  refresh: (kind: WorkspaceTaskKind) => Promise<void>;
  start: (kind: WorkspaceTaskKind, submit: () => Promise<WorkspaceRun>, failureMessage: string) => Promise<void>;
  cancel: (kind: WorkspaceTaskKind) => Promise<void>;
}>((set, get) => {
  const read = (kind: WorkspaceTaskKind) => get().runs[kind] ?? EMPTY_RUN_STATE;
  const patch = (kind: WorkspaceTaskKind, value: Partial<RunState>) => {
    set((state) => ({ runs: { ...state.runs, [kind]: { ...read(kind), ...value } } }));
  };
  return {
    runs: {},
    refresh: async (kind) => {
      const before = read(kind);
      if (before.submitting) return;
      const revision = before.revision + 1;
      patch(kind, { revision });
      try {
        let id = before.run?.id;
        if (!id) {
          const runs = (await workspaceApi.listRuns(kind)).filter((run) => run.triggerType === "manual");
          id = (runs.find(isRunActive) ?? runs[0])?.id;
        }
        const run = id ? await workspaceApi.getRun(id) : null;
        if (read(kind).revision === revision) patch(kind, { run, restoring: false, error: "" });
      } catch (error) {
        if (read(kind).revision === revision) patch(kind, {
          ...(getParsedApiError(error).status === 404 ? { run: null, restoring: true } : {}),
          error: "运行状态读取失败，正在自动重试；后台任务不会因此停止。",
        });
      }
    },
    start: async (kind, submit, failureMessage) => {
      const before = read(kind);
      if (before.restoring || before.submitting || isRunActive(before.run)) return;
      patch(kind, { submitting: true, error: "", startError: "", revision: before.revision + 1 });
      try {
        patch(kind, { run: await submit(), submitting: false });
      } catch {
        // A lost HTTP response does not prove the backend rejected the run.
        // Reconcile with the ledger before allowing another submission.
        patch(kind, { submitting: false, run: null, restoring: true, startError: failureMessage });
        await get().refresh(kind);
        if (isRunActive(read(kind).run)) patch(kind, { startError: "" });
      }
    },
    cancel: async (kind) => {
      const run = read(kind).run;
      if (!isRunActive(run) || !run) return;
      try {
        await workspaceApi.cancelRun(run.id);
        await get().refresh(kind);
      } catch {
        patch(kind, { error: "停止请求未确认，请重试；当前状态以后台为准。" });
      }
    },
  };
});
