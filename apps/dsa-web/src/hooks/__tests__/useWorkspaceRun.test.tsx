import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRun } from "../useWorkspaceRun";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import { workspaceRunFixture, workspaceTaskFixture } from "../../testWorkspaceFixtures";

const api = vi.hoisted(() => ({ listRuns: vi.fn(), getRun: vi.fn(), cancelRun: vi.fn() }));
vi.mock("../../api/workspace", () => ({ workspaceApi: api }));
const settle = async () => { await act(async () => {}); };

describe("durable workspace runs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    useWorkspaceRunStore.setState({ runs: {} });
    api.listRuns.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it.each(["research", "screening", "trading", "expert_review"] as const)("restores %s from the ledger and keeps its completed artifacts", async (kind) => {
    const run = workspaceRunFixture(workspaceTaskFixture({ kind }), { status: "running", completedAt: null });
    api.listRuns.mockResolvedValue([
      { ...run, id: "scheduled", triggerType: "schedule" },
      { ...run, id: "chat", triggerType: "agent_tool" },
      run,
    ]);
    api.getRun.mockResolvedValue(run);
    const first = renderHook(() => useWorkspaceRun(kind));
    expect(first.result.current.busy).toBe(true);
    await settle();
    expect(first.result.current.activeRun?.id).toBe(run.id);
    first.unmount();

    const completed = { ...run, status: "completed" as const, artifacts: [{ id: "report", type: "ResearchReport", title: "结果", content: {}, version: 1, createdAt: run.createdAt }] };
    api.getRun.mockResolvedValue(completed);
    const second = renderHook(() => useWorkspaceRun(kind));
    await settle();
    expect(second.result.current.activeRun).toEqual(completed);
    expect(second.result.current.busy).toBe(false);
    const calls = api.getRun.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.getRun).toHaveBeenCalledTimes(calls);
    expect(api.cancelRun).not.toHaveBeenCalled();
  });

  it("keeps an in-flight submission after unmount and prevents a second start", async () => {
    const first = renderHook(() => useWorkspaceRun("research"));
    await settle();
    const run = workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { status: "running" });
    let resolve!: (value: typeof run) => void;
    const submit = vi.fn(() => new Promise<typeof run>((done) => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = first.result.current.startRun(submit, "未确认"); });
    first.unmount();
    const second = renderHook(() => useWorkspaceRun("research"));
    const other = renderHook(() => useWorkspaceRun("screening"));
    await settle();
    expect(second.result.current.submitting).toBe(true);
    expect(other.result.current.activeRun).toBeNull();
    await act(async () => { await second.result.current.startRun(submit, "未确认"); });
    expect(submit).toHaveBeenCalledTimes(1);
    api.getRun.mockResolvedValue(run);
    await act(async () => { resolve(run); await pending; });
    expect(second.result.current.activeRun?.id).toBe(run.id);
    expect(second.result.current.busy).toBe(true);
  });

  it("retries failed restoration and polling without discarding the last known run", async () => {
    api.listRuns.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const view = renderHook(() => useWorkspaceRun("research"));
    await settle();
    expect(view.result.current.runError).toContain("自动重试");
    const run = workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { status: "running" });
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(view.result.current.activeRun?.id).toBe(run.id);
    api.getRun.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(view.result.current.activeRun?.status).toBe("running");
    expect(view.result.current.runError).toContain("自动重试");
    api.getRun.mockResolvedValue({ ...run, status: "failed", errorMessage: "模型调用失败" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(view.result.current.activeRun?.status).toBe("failed");
    expect(view.result.current.runError).toBe("");
  });

  it("ignores a stale poll after a new submission and waits for backend cancellation", async () => {
    const old = workspaceRunFixture(workspaceTaskFixture({ kind: "trading" }), { id: "old" });
    api.listRuns.mockResolvedValue([old]);
    api.getRun.mockResolvedValue(old);
    const view = renderHook(() => useWorkspaceRun("trading"));
    await settle();
    let resolve!: (value: typeof old) => void;
    api.getRun.mockImplementationOnce(() => new Promise<typeof old>((done) => { resolve = done; }));
    let stale!: Promise<void>;
    act(() => { stale = useWorkspaceRunStore.getState().refresh("trading"); });
    const next = { ...old, id: "new", status: "running" as const };
    api.getRun.mockResolvedValue(next);
    await act(async () => { await view.result.current.startRun(async () => next, "未确认"); });
    await act(async () => { resolve(old); await stale; });
    expect(view.result.current.activeRun?.id).toBe("new");
    api.cancelRun.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await view.result.current.cancelRun(); });
    expect(view.result.current.activeRun?.status).toBe("running");
    expect(view.result.current.runError).toContain("停止请求未确认");
    api.cancelRun.mockResolvedValue({ accepted: true });
    await act(async () => { await view.result.current.cancelRun(); });
    expect(view.result.current.activeRun?.status).toBe("running");
    api.getRun.mockResolvedValue({ ...next, status: "cancelled" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(view.result.current.activeRun?.status).toBe("cancelled");
  });

  it("reconciles a lost submission response instead of submitting again", async () => {
    const view = renderHook(() => useWorkspaceRun("research"));
    await settle();
    const run = workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { status: "running" });
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    const submit = vi.fn().mockRejectedValue(new Error("response lost"));
    await act(async () => { await view.result.current.startRun(submit, "启动未确认"); });
    expect(view.result.current.activeRun?.id).toBe(run.id);
    expect(view.result.current.busy).toBe(true);
    expect(view.result.current.runError).toBe("");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("re-reads the ledger when a previously cached run no longer exists", async () => {
    const run = workspaceRunFixture(workspaceTaskFixture({ kind: "research" }), { status: "running" });
    api.listRuns.mockResolvedValue([run]);
    api.getRun.mockResolvedValue(run);
    const view = renderHook(() => useWorkspaceRun("research"));
    await settle();
    api.getRun.mockRejectedValue({ response: { status: 404 } });
    api.listRuns.mockResolvedValue([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(view.result.current.activeRun).toBeNull();
    expect(view.result.current.busy).toBe(false);
  });
});
