import type { WorkspaceRun } from "../../api/workspace";

const LABELS: Record<string, string> = { running: "执行中", completed: "调用结束", failed: "调用失败", cancelled: "已停止" };

export default function RunStages({ run }: { run: WorkspaceRun }) {
  const saved = run.resultSummary?.stages;
  if (!Array.isArray(saved) || !saved.length) return null;
  const stages = saved.filter((value): value is { id: string; label: string; status: string } =>
    value && typeof value === "object" && typeof value.id === "string"
    && typeof value.label === "string" && typeof value.status === "string");
  return <details className="my-4 border-y border-border py-3" open={run.status === "running"}>
    <summary className="cursor-pointer text-sm font-medium text-foreground">运行过程 · {stages.length} 个已记录阶段</summary>
    <ol className="mt-3 space-y-2" aria-label="实际执行阶段">
      {stages.map((stage) => <li key={stage.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{stage.label}</span><span className={stage.status === "failed" ? "text-danger" : "text-secondary-text"}>{LABELS[stage.status] || "状态未知"}</span></li>)}
    </ol>
    <p className="mt-3 text-xs leading-5 text-secondary-text">仅展示后端实际记录；调用结束不等于成果已验证。未记录的历史阶段不补造。</p>
  </details>;
}
