import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { workspaceRunFixture, workspaceTaskFixture } from "../testWorkspaceFixtures";
import { useDiscussionThread } from "./useDiscussionThread";

const getRun = vi.hoisted(() => vi.fn());
vi.mock("../api/workspace", () => ({ workspaceApi: { getRun } }));
const first = workspaceRunFixture(workspaceTaskFixture({ kind: "expert_review" }), { id: "first" });
const second = workspaceRunFixture(workspaceTaskFixture({ kind: "expert_review", config: { parentDiscussionRunId: "first" } }), { id: "second" });
beforeEach(() => { getRun.mockReset(); });
it("loads previous rounds into the same conversation in order", async () => {
  getRun.mockResolvedValue(first);
  const { result } = renderHook(() => useDiscussionThread(second));
  await waitFor(() => expect(result.current.rounds.map((r) => r.id)).toEqual(["first", "second"]));
});
it("never carries old group messages into a different conversation", async () => {
  let resolve!: (value: typeof first) => void;
  getRun.mockReturnValue(new Promise((done) => { resolve = done; }));
  const { result, rerender } = renderHook(({ run }) => useDiscussionThread(run), { initialProps: { run: second } });
  rerender({ run: { ...first, id: "other" } });
  resolve(first);
  await waitFor(() => expect(result.current.rounds.map((r) => r.id)).toEqual(["other"]));
});
it("reports missing history and keeps the current round", async () => {
  getRun.mockRejectedValue(new Error("missing"));
  const { result } = renderHook(() => useDiscussionThread(second));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.rounds.map((r) => r.id)).toEqual(["second"]);
});
