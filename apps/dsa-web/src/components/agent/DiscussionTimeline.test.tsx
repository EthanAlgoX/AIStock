import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";
import DiscussionTimeline from "./DiscussionTimeline";

it("shows persisted speaker outputs chronologically without collapsed process panels", () => {
  const run = workspaceRunFixture(workspaceTaskFixture({ objective: "研究行业", config: { collaborationMode: "voting" } }), { artifacts: [
    { id: "summary", type: "ExpertReview", title: "总结", text: "最终结论", content: {}, version: 1, createdAt: "2026-09-07T10:03:00Z" },
    { id: "ballot", type: "ExpertBallot", title: "评审 1", text: "证据完整", content: { expertId: 1, status: "completed", criterion: "证据可靠性" }, version: 1, createdAt: "2026-09-07T10:02:00Z" },
    { id: "opinion", type: "ExpertOpinion", title: "价值专家", text: "现金流需要核查", content: { expertId: 1, expertName: "价值专家" }, version: 1, createdAt: "2026-09-07T10:01:00Z" },
  ] });
  render(<DiscussionTimeline run={run} />);
  const entries = within(screen.getByRole("list", { name: "专家发言时间线" })).getAllByRole("listitem");
  expect(entries[0]).toHaveTextContent("价值专家 · 独立分析");
  expect(entries[1]).toHaveTextContent("投给：价值专家");
  expect(entries[2]).toHaveTextContent("主持人 · 依据独立评审计票总结");
  expect(screen.getByText("现金流需要核查")).toBeVisible();
  expect(screen.queryByText("最终结论")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /本轮研究报告/ }));
  expect(screen.getByText("最终结论")).toBeVisible();
});

it.each([["pipeline", "主持人 · 汇总各项任务与衔接缺口"], ["debate", "主持人 · 总结共识、分歧与待核实问题"]])("labels the supervisor's actual mode %s", (mode, label) => {
  const run = workspaceRunFixture(workspaceTaskFixture({ config: { collaborationMode: mode } }), { artifacts: [{ id: "summary", type: "ExpertReview", title: "总结", text: "结论", content: {}, version: 1, createdAt: "2026-09-07T10:00:00Z" }] });
  render(<DiscussionTimeline run={run} />);
  expect(screen.getByRole("heading", { name: label })).toBeVisible();
});

it("keeps failure and interrupted stages visible without inventing a report", () => {
  const run = workspaceRunFixture(workspaceTaskFixture(), { status: "cancelled", artifacts: [], resultSummary: { stages: [{ id: "expert-1", label: "专家一", status: "running" }] } });
  render(<DiscussionTimeline run={run} />);
  expect(screen.getByText(/已中断，未收到完整发言/)).toBeVisible();
  expect(screen.getByText(/本次尚无综合报告/)).toBeVisible();
});
