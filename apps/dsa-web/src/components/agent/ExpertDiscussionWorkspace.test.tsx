import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import {
  workspaceCatalogFixture,
  workspaceRunFixture,
  workspaceTaskFixture,
} from "../../testWorkspaceFixtures";
import { useWorkspaceRunStore } from "../../stores/workspaceRunStore";
import ExpertDiscussionWorkspace from "./ExpertDiscussionWorkspace";

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  cancelRun: vi.fn(),
}));
vi.mock("../../api/workspace", () => ({ workspaceApi: api }));
const task = workspaceTaskFixture({
  kind: "expert_review",
  name: "行业讨论",
  config: {
    discussionProtocol: "cross_response_v1",
    crossExaminationRounds: 1,
  },
  capabilities: {
    ...workspaceCatalogFixture.defaults.expert_review,
    expertIds: [-1001, -1002],
  },
});
const run = workspaceRunFixture(task, {
  artifacts: [
    {
      id: "review",
      type: "ExpertReview",
      title: "结论",
      content: {},
      text: "## 综合结论\n\n保留现金流分歧。",
      version: 1,
      createdAt: task.createdAt,
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceRunStore.setState({ runs: {} });
  api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
  api.listRuns.mockResolvedValue([]);
  api.getRun.mockResolvedValue(run);
  api.createTask.mockResolvedValue(task);
  api.runTask.mockResolvedValue(run);
});

function RouteContext() {
  const location = useLocation();
  return <output data-testid="discussion-route">{location.pathname}{location.search}</output>;
}

it("opens history only on request and closes it after selecting a discussion, preserving route context", async () => {
  const first = { ...run, id: "first", taskSnapshot: { ...task, name: "第一个议题" } };
  const second = { ...run, id: "second", taskSnapshot: { ...task, name: "第二个议题" } };
  api.listRuns.mockResolvedValue([first, second]);
  api.getRun.mockImplementation(async (id: string) => id === "first" ? first : second);
  render(<MemoryRouter initialEntries={["/expert-review?run=first&mode=discussion&workspace=retained"]}><ExpertDiscussionWorkspace /><RouteContext /></MemoryRouter>);

  const trigger = await screen.findByRole("button", { name: "讨论历史" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog", { name: "历史群聊" })).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "讨论历史" })).not.toBeInTheDocument();
  fireEvent.click(trigger);

  const history = screen.getByRole("dialog", { name: "历史群聊" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(await within(history).findByRole("button", { name: /第二个议题/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史群聊" })).not.toBeInTheDocument());
  expect(screen.getByTestId("discussion-route")).toHaveTextContent("/expert-review?run=second&mode=discussion&workspace=retained");
  expect(api.createTask).not.toHaveBeenCalled();
  expect(api.runTask).not.toHaveBeenCalled();
});

it("keeps a new discussion's experts visible and opens a fresh draft without running work", async () => {
  api.listRuns.mockResolvedValue([run]);
  render(<MemoryRouter initialEntries={["/expert-review?run=run-1"]}><ExpertDiscussionWorkspace /><RouteContext /></MemoryRouter>);
  await screen.findByRole("textbox", { name: "继续追问" });
  fireEvent.click(screen.getByRole("button", { name: "新建讨论" }));

  expect(screen.getByRole("textbox", { name: "讨论议题" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "选择专家" })).toBeInTheDocument();
  const members = screen.getByRole("list", { name: "下轮专家团成员" });
  expect(within(members).getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByTestId("discussion-route")).toHaveTextContent("run=new");
  expect(api.createTask).not.toHaveBeenCalled();
  expect(api.runTask).not.toHaveBeenCalled();
});

it("reveals frozen round members on demand and follows up with their original bindings", async () => {
  const frozenRun = { ...run, taskSnapshot: { ...task, discussionSnapshot: { members: [
    { expert: { id: -1001, name: "历史专家甲", style: "冻结观点" } },
    { expert: { id: -1002, name: "历史专家乙", style: "冻结观点" } },
  ] } } };
  api.getRun.mockResolvedValue(frozenRun);
  api.listRuns.mockResolvedValue([frozenRun]);
  api.getCapabilities.mockResolvedValue({ ...workspaceCatalogFixture, experts: workspaceCatalogFixture.experts.map(expert => ({ ...expert, name: "已更名目录", enabled: false })) });
  render(<MemoryRouter initialEntries={["/expert-review?run=run-1"]}><ExpertDiscussionWorkspace /></MemoryRouter>);

  const summary = await screen.findByText("查看本轮成员");
  const disclosure = summary.closest("details")!;
  expect(disclosure).not.toHaveAttribute("open");
  fireEvent.click(summary.closest("summary")!);
  expect(disclosure).toHaveAttribute("open");
  const members = screen.getByRole("list", { name: "专家团成员" });
  expect(within(members).getByText("历史专家甲")).toBeVisible();
  expect(within(members).getByText("历史专家乙")).toBeVisible();
  expect(within(members).queryByText("已更名目录")).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "继续追问" }), { target: { value: "继续核查原来的观点" } });
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
    capabilities: task.capabilities,
    config: expect.objectContaining({ parentDiscussionRunId: run.id }),
  })));
});

it("starts a real discussion task using visible team defaults and renders Markdown", async () => {
  render(
    <MemoryRouter>
      <ExpertDiscussionWorkspace />
    </MemoryRouter>,
  );
  const start = await screen.findByRole("button", { name: "开始讨论" });
  fireEvent.change(screen.getByRole("textbox", { name: "讨论议题" }), {
    target: { value: "讨论美股苹果的投资逻辑" },
  });
  expect(screen.queryByText(/关联股票代码/)).not.toBeInTheDocument();
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await waitFor(() =>
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "expert_review",
        objective: "讨论美股苹果的投资逻辑",
        market: "GLOBAL",
        subject: {},
        config: expect.objectContaining({
          discussionProtocol: "cross_response_v1",
          crossExaminationRounds: 2,
          collaborationMode: "debate",
        }),
        capabilities: expect.objectContaining({ expertTeamIds: [], expertIds: expect.arrayContaining([-1001, -1002]) }),
      }),
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: /本轮研究报告/ }));
  expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "综合结论" })).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "讨论议题" }),
  ).not.toBeInTheDocument();
});

it("restores the running discussion after remount without resubmitting", async () => {
  api.listRuns.mockResolvedValue([{ ...run, status: "running" }]);
  api.getRun.mockResolvedValue({
    ...run,
    status: "running",
    artifacts: [],
    completedAt: null,
  });
  const view = render(
    <MemoryRouter>
      <ExpertDiscussionWorkspace />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/专家正在研究/)).toBeInTheDocument();
  view.unmount();
  api.getRun.mockResolvedValue(run);
  render(
    <MemoryRouter>
      <ExpertDiscussionWorkspace />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("button", { name: /本轮研究报告/ })).toBeInTheDocument();
  expect(api.createTask).not.toHaveBeenCalled();
});

it.each([["pipeline", "流水线"], ["voting", "投票式"]])("persists the selected collaboration mode %s", async (mode, name) => {
  render(<MemoryRouter><ExpertDiscussionWorkspace /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "协作模式" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "协作模式" }));
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(name) }));
  fireEvent.change(screen.getByRole("textbox", { name: "讨论议题" }), { target: { value: "分析行业风险" } });
  fireEvent.click(screen.getByRole("button", { name: "开始讨论" }));
  await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
    config: expect.objectContaining({ collaborationMode: mode }),
    capabilities: expect.objectContaining({ expertTeamIds: [] }),
  })));
});

it("follows up on the viewed report with its original members, preserving parent linkage", async () => {
  api.listRuns.mockResolvedValue([run]);
  render(
    <MemoryRouter initialEntries={["/overview?mode=discussion&run=run-1"]}>
      <ExpertDiscussionWorkspace embedded />
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByRole("textbox", { name: "继续追问" }), {
    target: { value: "请核查现金流证据" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() =>
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: "请核查现金流证据",
        capabilities: task.capabilities,
        config: expect.objectContaining({ parentDiscussionRunId: run.id }),
      }),
    ),
  );
  expect(screen.getByRole("link", { name: "查看完整讨论" })).toHaveAttribute(
    "href",
    "/expert-review?run=run-1",
  );
});

it("links an existing report by server ID instead of accepting client evidence", async () => {
  const source = workspaceRunFixture(
    workspaceTaskFixture({ name: "个股研究" }),
    { id: "source" },
  );
  api.getRun.mockImplementation(async (id: string) =>
    id === "source" ? source : run,
  );
  render(
    <MemoryRouter initialEntries={["/expert-review?sourceRun=source"]}>
      <ExpertDiscussionWorkspace />
    </MemoryRouter>,
  );
  await screen.findByDisplayValue(/请讨论这份报告/);
  const start = screen.getByRole("button", { name: "开始讨论" });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await waitFor(() =>
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ sourceRunId: "source" }),
      }),
    ),
  );
});

it("keeps earlier messages in the group and explicitly saves next-round configuration", async () => {
  const parent = { ...run, id: "first", taskSnapshot: { ...task, objective: "第一轮问题" } };
  const child = { ...run, id: "second", taskSnapshot: { ...task, objective: "第二轮问题", config: { ...task.config, parentDiscussionRunId: "first" } } };
  api.listRuns.mockResolvedValue([child, parent]);
  api.getRun.mockImplementation(async (id: string) => id === "first" ? parent : child);
  render(<MemoryRouter initialEntries={["/expert-review?run=second"]}><ExpertDiscussionWorkspace /></MemoryRouter>);
  expect(await screen.findByText("第一轮问题")).toBeInTheDocument();
  expect(await screen.findByText("第二轮问题")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "调整下轮配置" }));
  fireEvent.click(screen.getByRole("button", { name: "协作模式" }));
  fireEvent.click(screen.getByRole("radio", { name: /流水线/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "继续追问" }), { target: { value: "第三轮问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ parentDiscussionRunId: "second", reconfigureDiscussion: true, collaborationMode: "pipeline" }) })));
});
