import { useEffect, useState } from "react";
import { workspaceApi, type WorkspaceRun } from "../api/workspace";

export function useDiscussionThread(run?: WorkspaceRun) {
  const [result, setResult] = useState<{ id: string; ancestors: WorkspaceRun[]; error?: string }>();
  const [retry, setRetry] = useState(0);
  const id = run?.id;
  const parent = run?.taskSnapshot.config.parentDiscussionRunId;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const ancestors: WorkspaceRun[] = [];
      const seen = new Set([id]);
      let cursor = parent;
      try {
        while (typeof cursor === "string" && cursor) {
          if (seen.has(cursor) || ancestors.length >= 100) throw new Error("讨论历史关联异常或超过 100 轮，请从运行详情查看更早记录。");
          seen.add(cursor);
          const previous = await workspaceApi.getRun(cursor);
          if (!alive) return;
          if (previous.id !== cursor || previous.kind !== "expert_review") throw new Error("讨论历史关联无效。");
          ancestors.unshift(previous);
          cursor = previous.taskSnapshot.config.parentDiscussionRunId;
        }
        if (alive) setResult({ id, ancestors });
      } catch {
        if (alive) setResult({ id, ancestors, error: "部分群聊历史读取失败，请重试；当前轮次仍保留。" });
      }
    };
    void load();
    return () => { alive = false; };
  }, [id, parent, retry]);
  return { rounds: run ? [...(result && result.id === id ? result.ancestors : []), run] : [], error: result && result.id === id ? result.error : undefined, retry: () => setRetry((n) => n + 1) };
}
