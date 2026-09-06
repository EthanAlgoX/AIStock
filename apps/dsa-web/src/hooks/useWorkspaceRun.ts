import { useEffect } from "react";
import type { WorkspaceTaskKind } from "../api/workspace";
import { EMPTY_RUN_STATE, isRunActive, useWorkspaceRunStore } from "../stores/workspaceRunStore";

export function useWorkspaceRun(kind: WorkspaceTaskKind, pollEnabled = true) {
  const state = useWorkspaceRunStore((store) => store.runs[kind] ?? EMPTY_RUN_STATE);
  const refresh = useWorkspaceRunStore((store) => store.refresh);
  const start = useWorkspaceRunStore((store) => store.start);
  const cancel = useWorkspaceRunStore((store) => store.cancel);

  useEffect(() => {
    if (!pollEnabled) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(kind);
      if (!mounted) return;
      timer = setTimeout(() => {
        if (!mounted) return;
        const current = useWorkspaceRunStore.getState().runs[kind];
        if (!current || current.restoring || current.error || isRunActive(current.run)) void poll();
      }, 1500);
    };
    void poll();
    return () => { mounted = false; clearTimeout(timer); };
  }, [kind, refresh, state.run?.id, state.run?.status, state.submitting, pollEnabled]);

  return {
    activeRun: state.run,
    runError: state.error || state.startError,
    submitting: state.submitting,
    restoring: state.restoring,
    busy: state.restoring || state.submitting || isRunActive(state.run),
    startRun: (submit: Parameters<typeof start>[1], failureMessage: string) => start(kind, submit, failureMessage),
    cancelRun: () => cancel(kind),
  };
}
