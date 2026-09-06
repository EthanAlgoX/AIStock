import { describe, expect, it } from "vitest";
import { workspaceRunFixture, workspaceTaskFixture } from "../testWorkspaceFixtures";
import { visibleWorkspaceArtifacts, workspaceRunLabel, workspaceRunTone } from "./workspaceOutcome";

describe("workspace business outcomes", () => {
  it("does not present executor completion as success", () => {
    const run = workspaceRunFixture(workspaceTaskFixture(), { status: "completed" });
    expect(workspaceRunLabel(run)).toContain("成果待核实");
    run.outcome = { status: "blocked", message: "未执行" };
    expect(workspaceRunLabel(run)).toBe("任务受阻");
    expect(workspaceRunTone(run)).toBe("text-warning");
    run.status = "running";
    expect(workspaceRunLabel(run)).toBe("运行中");
  });
  it("distinguishes empty results, proposals, and partial reports", () => {
    for (const [status, label] of [["empty", "无符合条件候选"], ["proposal", "提案已生成"], ["partial", "部分产出"]] as const) {
      const run = workspaceRunFixture(workspaceTaskFixture(), { status: "completed", outcome: { status, message: "说明" } });
      expect(workspaceRunLabel(run)).toBe(label);
    }
  });
  it("only hides exact legacy duplicate screening wrappers", () => {
    const base = { id: "one", title: "说明", content: { text: "original" }, text: "同一说明", version: 1, createdAt: "2026-09-07" };
    const items = [{ ...base, type: "ScreenSpec" }, { ...base, id: "two", type: "CandidateList" }];
    expect(visibleWorkspaceArtifacts(items)).toEqual([items[1]]);
    expect(visibleWorkspaceArtifacts([{ ...items[0], content: { filters: [] } }, items[1]])).toHaveLength(2);
    const result = visibleWorkspaceArtifacts([{ ...items[0], content: { filters: [] } }, items[1]]);
    expect(result[0].content).toEqual({ filters: [] });
    expect(result[0].text).toBeNull();
    expect(result[1].text).toBe("同一说明");
    expect(items[0].text).toBe("同一说明");
  });
});
