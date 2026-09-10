import type { WorkspaceArtifact, WorkspaceRun } from "../api/workspace";

const OUTCOMES = {
  pending: "运行中", produced: "已产出", empty: "无符合条件候选", proposal: "提案已生成",
  partial: "部分产出", blocked: "任务受阻", unverified: "成果待核实", failed: "运行失败", cancelled: "已停止",
};

export function workspaceRunLabel(run: WorkspaceRun): string {
  if (run.status === "queued") return "排队中";
  if (run.status === "running") return "运行中";
  if (run.outcome?.status === "empty" && run.kind === "trading" && run.taskSnapshot.config?.portfolioId) return "暂无新交易日";
  if (run.outcome) return OUTCOMES[run.outcome.status];
  return run.status === "completed" ? "运行结束 · 成果待核实" : run.status === "failed" ? "运行失败" : "已停止";
}

export function workspaceRunTone(run: WorkspaceRun): string {
  if (["blocked", "partial", "unverified"].includes(run.outcome?.status || "")) return "text-warning";
  if (run.status === "failed") return "text-danger";
  if (run.status === "running" || run.status === "queued") return "text-warning";
  return run.outcome && ["produced", "empty", "proposal"].includes(run.outcome.status) ? "text-success" : "text-secondary-text";
}

export function visibleWorkspaceArtifacts(artifacts: WorkspaceArtifact[]): WorkspaceArtifact[] {
  // Old free-form screening answers were copied into both contracts. Show the
  // answer once; the original payload remains available in the retained result.
  return artifacts.filter((artifact) => !(artifact.type === "ScreenSpec" && artifact.text?.trim()
    && artifacts.some((other) => other.type === "CandidateList" && other.text === artifact.text
      && JSON.stringify(other.content) === JSON.stringify(artifact.content))))
    .map((artifact) => artifact.type === "ScreenSpec" && artifact.text?.trim()
      && artifacts.some((other) => other.type === "CandidateList" && other.text === artifact.text)
      ? { ...artifact, text: null } : artifact);
}
