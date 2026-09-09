import { ExpertAvatar } from "../common/ExpertAvatar";
import { useUiLanguage } from "../../contexts/UiLanguageContext";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  workspaceApi,
  type WorkspaceCapabilityCatalog,
  type WorkspaceRun,
} from "../../api/workspace";
import type { AgentCapabilityBindings } from "../../types/capabilities";
import { useWorkspaceRun } from "../../hooks/useWorkspaceRun";
import { isRunActive } from "../../stores/workspaceRunStore";
import { Drawer } from "../common/Drawer";
import { useDiscussionThread } from "../../hooks/useDiscussionThread";
import ChoiceList from "../common/ChoiceList";
import DiscussionTimeline from "./DiscussionTimeline";

type MemberCapabilities = Pick<
  AgentCapabilityBindings,
  "skillIds" | "toolIds" | "mcpIds" | "dataSourceIds"
>;
const keys = ["skillIds", "toolIds", "mcpIds", "dataSourceIds"] as const;
const labels = {
  skillIds: "Skill",
  toolIds: "内置工具",
  mcpIds: "MCP 服务",
  dataSourceIds: "数据源",
};
const empty: AgentCapabilityBindings = {
  skillIds: [],
  toolIds: [],
  mcpIds: [],
  dataSourceIds: [],
  expertIds: [],
  expertTeamIds: [],
};
const statusNames = {
  queued: "等待执行",
  running: "正在讨论",
  completed: "讨论完成",
  failed: "未完成",
  cancelled: "已停止",
};
const toggle = <T,>(items: T[], id: T) =>
  items.includes(id) ? items.filter((v) => v !== id) : [...items, id];

/** Dedicated discussion UI over the shared durable collaboration runtime. */
export default function ExpertDiscussionWorkspace({
  embedded = false,
  onDirect,
  initialTopic = "",
}: {
  embedded?: boolean;
  onDirect?: () => void;
  initialTopic?: string;
}) {
  const { translate: tx } = useUiLanguage();
  const [params, setParams] = useSearchParams();
  const {
    activeRun,
    busy,
    submitting,
    restoring,
    runError,
    startRun,
  } = useWorkspaceRun("expert_review");
  const [catalog, setCatalog] = useState<WorkspaceCapabilityCatalog>();
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [detail, setDetail] = useState<WorkspaceRun>();
  const [topicStock, setTopicStock] = useState("");
  const [topic, setTopic] = useState(initialTopic);
  const [followUp, setFollowUp] = useState("");
  const [capabilities, setCapabilities] =
    useState<AgentCapabilityBindings>(empty);
  const [profiles, setProfiles] = useState<Record<string, MemberCapabilities>>(
    {},
  );
  const [collaborationMode, setCollaborationMode] = useState("debate");
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState<WorkspaceRun>();
  const sourceId = params.get("sourceRun") || "";
  const requested = params.get("run");
  const drafting = requested === "new" || Boolean(sourceId && !requested);
  const selectedId = drafting
    ? ""
    : requested || activeRun?.id || runs[0]?.id || "";
  const selected =
    selectedId === activeRun?.id
      ? activeRun
      : detail?.id === selectedId
        ? detail
        : undefined;
  const thread = useDiscussionThread(selected);
  useEffect(() => {
    if (nearBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [selected?.id, selected?.artifacts.length, thread.rounds.length]);
  const experts = catalog?.experts.filter((e) => e.enabled) || [];
  const memberIds = capabilities.expertIds;
  const members = experts.filter((e) => memberIds.includes(e.id));
  const protocolReady =
    catalog?.discussionProtocols?.includes("cross_response_v1") === true
    && catalog?.discussionModes?.includes(collaborationMode) === true;

  useEffect(() => {
    let alive = true;
    workspaceApi
      .getCapabilities()
      .then((value) => {
        if (!alive) return;
        setCatalog(value);
        const enabled = value.experts.filter((e) => e.enabled);
        setCapabilities({
          ...value.defaults.expert_review,
          expertIds: enabled.slice(0, 3).map((e) => e.id),
          expertTeamIds: [],
        });
        setError("");
      })
      .catch(() => alive && setError("专家目录读取失败，请重试。"));
    return () => {
      alive = false;
    };
  }, [retry]);

  useEffect(() => {
    let alive = true;
    workspaceApi
      .listRuns("expert_review")
      .then((items) => {
        if (alive) setRuns(items);
      })
      .catch(() => alive && setError("讨论历史读取失败，请重试。"));
    return () => {
      alive = false;
    };
  }, [activeRun?.id, activeRun?.status, retry]);

  useEffect(() => {
    if (!selectedId || selectedId === activeRun?.id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await workspaceApi.getRun(selectedId);
        if (!alive) return;
        if (value.kind !== "expert_review") {
          setError("该记录不是专家讨论。请从讨论历史选择。");
          return;
        }
        setDetail(value);
        if (isRunActive(value)) timer = setTimeout(() => void refresh(), 1500);
      } catch {
        if (alive) {
          setError("讨论读取失败，正在重试。");
          timer = setTimeout(() => void refresh(), 3000);
        }
      }
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selectedId, activeRun?.id, retry]);

  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    workspaceApi
      .getRun(sourceId)
      .then((value) => {
        if (alive) {
          setSource(value);
          setTopic(
            `请讨论这份报告的核心结论、证据与风险：${value.taskSnapshot.name}`,
          );
        }
      })
      .catch(() => alive && setError("来源报告读取失败，不能引用该报告。"));
    return () => {
      alive = false;
    };
  }, [sourceId]);

  const select = (id: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("run", id);
      setHistoryOpen(false);
      nearBottom.current = true;
      next.delete("sourceRun");
      return next;
    });
  const newDiscussion = () => {
    setTopic("");
    setFollowUp("");
    setEditing(false);
    select("new");
  };
  const configureFrom = (run: WorkspaceRun) => {
    if (!catalog?.discussionReconfiguration) {
      setError("当前后端尚未支持群聊下轮配置调整，请更新服务后重试。");
      return;
    }
    const bindings = run.taskSnapshot.capabilities;
    const frozen = (run.taskSnapshot as { discussionSnapshot?: { members?: Array<{ expert: { id: number } }> } }).discussionSnapshot?.members;
    setCapabilities({ ...bindings, expertTeamIds: [], expertIds: frozen?.map((member) => member.expert.id) || [...new Set([...bindings.expertIds,
      ...(catalog?.expertTeams.filter((team) => bindings.expertTeamIds.includes(team.id)).flatMap((team) => team.memberIds) || [])])] });
    setProfiles(
      (run.taskSnapshot.config.expertCapabilities || {}) as Record<
        string,
        MemberCapabilities
      >,
    );
    setCollaborationMode(String(run.taskSnapshot.config.collaborationMode || "debate"));
    setEditing(true);
  };
  const submit = async (parent?: WorkspaceRun) => {
    const objective = (parent ? followUp : topic).trim();
    if (
      !objective ||
      busy ||
      !protocolReady ||
      !catalog ||
      (editing && !catalog.discussionReconfiguration) ||
      (sourceId && source?.id !== sourceId)
    )
      return;
    // Follow-ups inherit the viewed run, never a different task's latest UI defaults.
    const base = parent && !editing ? parent.taskSnapshot.capabilities : capabilities;
    const config = parent?.taskSnapshot.config;
    const chosenProfiles = parent && !editing
      ? config?.expertCapabilities || {}
      : Object.fromEntries(
          Object.entries(profiles).filter(([id]) =>
            memberIds.includes(Number(id)),
          ),
        );
    await startRun(async () => {
      const task = await workspaceApi.createTask({
        kind: "expert_review",
        name: objective.slice(0, 80),
        objective,
        market:
          parent?.taskSnapshot.market ||
          (sourceId ? source?.taskSnapshot.market : undefined) ||
          "GLOBAL",
        subject:
          parent?.taskSnapshot.subject ||
          (sourceId ? source?.taskSnapshot.subject : {stock:topicStock.trim() || undefined}) ||
          {},
        capabilities: base,
        config: {
          discussionProtocol: "cross_response_v1",
          mode: "group",
          collaborationMode: parent && !editing ? config?.collaborationMode || "debate" : collaborationMode,
          ...(parent && editing ? { reconfigureDiscussion: true } : {}),
          crossExaminationRounds: parent
            ? config?.crossExaminationRounds || 1
            : 2,
          expertCapabilities: chosenProfiles,
          ...(parent
            ? { parentDiscussionRunId: parent.id }
            : sourceId
              ? { sourceRunId: sourceId }
              : {}),
        },
      });
      const run = await workspaceApi.runTask(task.id);
      setFollowUp("");
      setEditing(false);
      select(run.id);
      return run;
    }, "讨论启动未确认，正在核对后台运行，请勿重复提交。");
  };
  const choices = {
    skillIds:
      catalog?.skills
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id, name: s.name, description: s.description })) ||
      [],
    toolIds:
      catalog?.tools
        .filter(
          (s) =>
            s.enabled &&
            ![
              "run_stock_research",
              "run_stock_screening",
              "screen_stock_universe",
            ].includes(s.id),
        )
        .map((s) => ({ id: s.id, name: s.name, description: s.description })) ||
      [],
    mcpIds:
      catalog?.mcpServers
        .filter((s) => s.selectable)
        .map((s) => ({ id: s.id, name: s.name })) || [],
    dataSourceIds:
      catalog?.dataSources
        .filter((s) => s.selectable)
        .map((s) => ({ id: s.sourceId, name: s.name })) || [],
  };
  const history = [
    ...(activeRun
      ? [runs.find((r) => r.id === activeRun.id) || activeRun]
      : []),
    ...runs.filter((r) => r.id !== activeRun?.id),
  ];
  const parentIds = new Set(
    history
      .map((r) => r.taskSnapshot.config.parentDiscussionRunId)
      .filter(Boolean),
  );
  const creating = drafting || !selectedId;
  const frozenMembers = (selected?.taskSnapshot as { discussionSnapshot?: { members?: Array<{ expert: { id: number; name: string; style: string } }> } } | undefined)?.discussionSnapshot?.members;
  const displayedMembers = creating ? members : frozenMembers?.map((member) => member.expert)
    || experts.filter((expert) => selected?.taskSnapshot.capabilities.expertIds.includes(expert.id)
      || catalog?.expertTeams.some((team) => selected?.taskSnapshot.capabilities.expertTeamIds.includes(team.id) && team.memberIds.includes(expert.id)));
  const modeNames: Record<string, string> = { pipeline: "流水线", debate: "辩论式", voting: "投票式" };
  const currentMode = creating || editing ? collaborationMode : String(selected?.taskSnapshot.config.collaborationMode || "debate");

  const editable = creating || editing;
  const canFollow = !!selected && !isRunActive(selected ?? null) && selected.artifacts.length > 0;
  const composerDisabled = busy || !protocolReady || !catalog || (!creating && !canFollow) || (editable && (members.length < 2 || members.length > 6));
  const historyList = <div className="flex h-full flex-col gap-3 p-4">
    <h2 className="text-sm font-semibold">{tx("讨论历史")}</h2>
    <button type="button" className="btn-secondary" onClick={newDiscussion}>{tx("新建讨论")}</button>
    <input aria-label={tx("搜索讨论")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("搜索议题")} className="h-11 w-full border border-border px-3 text-sm" />
    <div className="min-h-0 flex-1 overflow-y-auto">
      {history.filter((r) => !parentIds.has(r.id) && r.taskSnapshot.name.toLowerCase().includes(query.toLowerCase())).map((run) => <button type="button" key={run.id} aria-pressed={selectedId === run.id} onClick={() => { setEditing(false); setFollowUp(""); select(run.id); }} className={`mb-1 w-full rounded-lg border px-3 py-3 text-left ${selectedId === run.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-hover"}`}>
        <span className="block break-words text-sm font-medium">{run.taskSnapshot.name}</span><span className="mt-2 block text-xs text-secondary-text">{tx(statusNames[run.status])} · {new Date(run.createdAt).toLocaleDateString()}</span>
      </button>)}
      {!history.length && <p className="text-sm leading-6 text-secondary-text">{tx("发送消息后，群聊与每轮报告会保存在这里。")}</p>}
    </div>
  </div>;
  return <div data-testid="expert-discussion-workspace" className="flex h-[calc(100dvh-7.5rem)] min-w-0 lg:h-[calc(100dvh-4rem)]">
    <aside aria-label={tx("讨论历史")} className="hidden w-64 shrink-0 border-r border-border bg-background lg:block">{historyList}</aside>
    <Drawer isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title={tx("历史群聊")} side="left" width="max-w-sm">{historyList}</Drawer>
    <section aria-label={tx("专家群聊")} className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><h1 className="text-base font-semibold text-foreground">{tx("专家圆桌")}</h1><p className="mt-1 truncate text-xs text-secondary-text">{creating ? tx("新圆桌 · 选择专家后发送话题") : selected?.taskSnapshot.name || tx("正在恢复群聊…")}</p></div>
          <div className="flex shrink-0 gap-2">
            <span className="lg:hidden"><button type="button" className="btn-secondary" onClick={() => setHistoryOpen(true)}>{tx("历史")}</button></span>
            {selected && !isRunActive(selected ?? null) && <button type="button" className="btn-secondary" onClick={() => configureFrom(selected)}>{tx("调整下轮配置")}</button>}
            {onDirect && <button type="button" className="btn-secondary" onClick={onDirect}>{tx("直接对话")}</button>}
          </div>
        </div>
        <section aria-label={tx("当前专家团")} className="mt-3">
          {editable ? <div className="grid grid-cols-2 items-start gap-3">
            <ChoiceList label={tx("选择专家")} multiple limit={6} items={experts.map((e) => ({ id: String(e.id), name: e.name, description: e.style, leading: <ExpertAvatar id={e.id} name={e.name} avatar={e.avatar} /> }))} selectedIds={memberIds.map(String)} onSelect={(id) => setCapabilities((c) => ({ ...c, expertTeamIds: [], expertIds: toggle(memberIds, Number(id)) }))} />
            <ChoiceList label={tx("协作模式")} items={[
              { id: "pipeline", name: tx("流水线"), description: tx("主持人分工，专家执行，汇总成果") },
              { id: "debate", name: tx("辩论式"), description: tx("独立观点，质询反驳，总结共识与分歧") },
              { id: "voting", name: tx("投票式"), description: tx("独立报告，三位评审投票，按计票总结") },
            ]} selectedIds={[collaborationMode]} onSelect={setCollaborationMode} loading={!catalog} />
          </div> : <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-secondary-text"><span>{tx("主持人 +")}{" "}{displayedMembers.length} {" "}{tx("位专家 ·")}{" "}{tx(modeNames[currentMode] || currentMode)}</span><ul aria-label={tx("专家团成员")} className="flex flex-wrap gap-3">{displayedMembers.map((expert) => <li key={expert.id} className="inline-flex items-center gap-2"><ExpertAvatar id={expert.id} name={tx(expert.name)} avatar={catalog?.experts.find((item) => item.id === expert.id)?.avatar} size={24} />{tx(expert.name)}</li>)}</ul></div>}
        </section>
      </header>
      {(error || runError) && <div role="alert" className="bg-card px-4 py-2 text-sm text-danger">{error || runError}<button className="ml-3 text-primary" onClick={() => setRetry((n) => n + 1)}>{tx("重试")}</button></div>}
      <div ref={viewport} onScroll={() => { const el = viewport.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8" aria-label={tx("群聊消息")}>
        <div className="w-full min-w-0 space-y-8">
          {creating ? <div className="py-8 text-center"><h2 className="text-lg font-semibold">{tx("向专家们发一条消息")}</h2><p className="mx-auto mt-3 max-w-md text-sm leading-7 text-secondary-text">{tx("主持人组织讨论，专家回应彼此观点。每轮结束后，报告会作为一条成果消息保留在群里。")}</p></div> : thread.rounds.map((round) => <div key={round.id} className="space-y-4"><p className="text-center text-xs text-secondary-text">{new Date(round.createdAt).toLocaleString()} · {tx(statusNames[round.status])} · {tx(modeNames[String(round.taskSnapshot.config.collaborationMode || "debate")])}</p><DiscussionTimeline run={round} experts={catalog?.experts} />{round.errorMessage && <p role="alert" className="text-sm text-danger">{tx(round.errorMessage)}</p>}{round.outcome?.status === "partial" && <p className="text-sm text-warning">{tx(round.outcome.message)}</p>}</div>)}
          {thread.error && <p role="alert" className="text-sm text-danger">{thread.error}<button type="button" className="ml-2 text-primary" onClick={thread.retry}>{tx("重试历史")}</button></p>}
          {!creating && !selected && <p role="status">{tx("正在读取讨论…")}</p>}
        </div>
      </div>
      <footer className="shrink-0 border-t border-border bg-card px-4 py-3 md:px-6">
        <div className="w-full min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary-text">
            <span>{editing ? tx("配置仅对下一轮生效，历史发言与配置不变。") : isRunActive(selected ?? null) ? tx("后台讨论中 · 切换页面不会中断") : tx("主持人协调 · 专家独立发言 · 最终报告单独保存")}</span>
            <div className="flex gap-3">{editable && <button type="button" className="min-h-8 text-primary" onClick={() => setSettingsOpen(true)}>{tx("研究能力授权")}</button>}{selected && <Link to={embedded ? `/expert-review?run=${selected.id}` : `/runs/${selected.id}`} className="min-h-8 text-primary">{embedded ? tx("查看完整讨论") : tx("运行详情")}</Link>}<button type="button" className="min-h-8 text-primary" onClick={() => { nearBottom.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}>{tx("最新消息")}</button></div>
          </div>
          {sourceId && <p className="mb-2 text-xs text-secondary-text">{tx("引用报告：")}{source?.taskSnapshot.name || tx("正在读取…")}</p>}
          <form onSubmit={(e) => { e.preventDefault(); if (!composerDisabled) void submit(creating ? undefined : selected); }} className="flex items-end gap-3">
            {creating && !sourceId && <label className="block text-sm">关联股票代码（个股议题请填写）<input value={topicStock} onChange={e=>setTopicStock(e.target.value)} placeholder="600519 / HK00700 / AAPL；宏观议题留空" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>}
            <label className="min-w-0 flex-1"><span className="sr-only">{creating ? tx("讨论议题") : tx("继续追问")}</span><textarea aria-label={creating ? tx("讨论议题") : tx("继续追问")} value={creating ? topic : followUp} onChange={(e) => creating ? setTopic(e.target.value) : setFollowUp(e.target.value)} placeholder={creating ? tx("发消息，例如：请讨论中芯国际的投资逻辑与风险") : tx("继续向群里发消息，发起下一轮讨论…")} className="block min-h-20 max-h-40 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6" /></label>
            {isRunActive(selected ?? null) ? <button type="button" className="btn-secondary" onClick={() => { if (selected) void workspaceApi.cancelRun(selected.id).catch(() => setError(tx("停止请求未确认，请刷新运行状态后重试。"))); }}>{tx("停止讨论")}</button> : <button type="submit" className="btn-primary" disabled={composerDisabled || !(creating ? topic : followUp).trim() || Boolean(sourceId && source?.id !== sourceId)}>{restoring ? tx("恢复中…") : submitting ? tx("提交中…") : creating ? tx("开始讨论") : tx("发送追问")}</button>}
          </form>
          {editable && members.length < 2 && catalog && <p className="mt-2 text-xs text-warning">{tx("请至少选择两位专家。")}</p>}
          {catalog && !protocolReady && <p role="alert" className="mt-2 text-xs text-warning">{tx("后端尚未支持当前协作模式，请刷新或检查服务版本。")}</p>}
        </div>
      </footer>
    </section>
    <Drawer isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title={tx("研究能力授权")} width="max-w-2xl">
              <details className="border-y border-border py-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {tx("研究能力授权 · Skill、工具与数据源")}</summary>
                <p className="my-3 text-sm text-secondary-text">
                  {tx("先选择本次授权能力，再为每位专家分配子集。未自定义的专家继承公共配置；配置随讨论保存。")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {keys.map((key) => (
                    <ChoiceList
                      key={key}
                      label={tx("公共{0}", tx(labels[key]))}
                      items={choices[key]}
                      multiple
                      limit={key === "skillIds" ? 3 : undefined}
                      selectedIds={capabilities[key]}
                      onSelect={(id) => {
                        const next = toggle(capabilities[key], id);
                        setCapabilities((c) => ({ ...c, [key]: next }));
                        setProfiles((p) =>
                          Object.fromEntries(
                            Object.entries(p).map(([expert, profile]) => [
                              expert,
                              {
                                ...profile,
                                [key]: profile[key].filter((v) =>
                                  next.includes(v),
                                ),
                              },
                            ]),
                          ),
                        );
                      }}
                    />
                  ))}
                </div>
                {members.map((expert) => (
                  <details
                    key={expert.id}
                    className="mt-4 border-t border-border pt-3"
                  >
                    <summary className="cursor-pointer text-sm">
                      {tx(expert.name)} ·{" "}
                      {profiles[String(expert.id)]
                        ? tx("独立配置")
                        : tx("继承公共配置")}
                    </summary>
                    <p className="my-3 text-sm text-secondary-text">
                      {expert.description}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {keys.map((key) => (
                        <ChoiceList
                          key={key}
                          label={`${tx(expert.name)} · ${tx(labels[key])}`}
                          multiple
                          limit={key === "skillIds" ? 3 : undefined}
                          items={choices[key].filter((c) =>
                            capabilities[key].includes(c.id),
                          )}
                          selectedIds={
                            (profiles[String(expert.id)] || capabilities)[key]
                          }
                          onSelect={(id) =>
                            setProfiles((current) => {
                              const existing =
                                current[String(expert.id)] ||
                                (Object.fromEntries(
                                  keys.map((k) => [k, capabilities[k]]),
                                ) as MemberCapabilities);
                              return {
                                ...current,
                                [String(expert.id)]: {
                                  ...existing,
                                  [key]: toggle(existing[key], id),
                                },
                              };
                            })
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="mt-3 text-sm text-primary"
                      onClick={() =>
                        setProfiles((p) =>
                          Object.fromEntries(
                            Object.entries(p).filter(
                              ([id]) => id !== String(expert.id),
                            ),
                          ),
                        )
                      }
                    >
                      {tx("恢复公共配置")}</button>
                  </details>
                ))}
              </details>

    </Drawer>
  </div>;
}
