import {
  Bot,
  Check,
  CircleAlert,
  Database,
  MessageCircle,
  MessagesSquare,
  Play,
  Send,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  workspaceApi,
  type WorkspaceExpert,
  type WorkspaceExpertTeam,
  type WorkspaceSkill,
} from "../api/workspace";
import { useWorkspaceRun } from "../hooks/useWorkspaceRun";
import AgentCapabilityPanel from "../components/agent/AgentCapabilityPanel";
import { AppPage, PageHeader } from "../components/common";
import { countAgentCapabilities, type AgentCapabilityBindings } from "../types/capabilities";
import { cn } from "../utils/cn";

type ReviewMode = "single" | "group";
type TopicType = "stock" | "screening" | "trade" | "open";

const EMPTY_CAPABILITIES: AgentCapabilityBindings = {
  skillIds: [],
  toolIds: [],
  mcpIds: [],
  dataSourceIds: [],
  expertIds: [-1001],
  expertTeamIds: [],
};

const TOPIC_TYPES: Array<{ id: TopicType; label: string; hint: string }> = [
  { id: "stock", label: "个股判断", hint: "围绕一家公司形成多视角判断" },
  { id: "screening", label: "选股规则", hint: "审查筛选目标、条件与遗漏风险" },
  { id: "trade", label: "交易提案", hint: "复核信号、假设和风险边界" },
  { id: "open", label: "开放议题", hint: "讨论行业、组合或投资方法" },
];

const REVIEW_STAGES = [
  { label: "独立观点", description: "各专家围绕同一议题独立形成观点，标注实际使用的证据与时点。" },
  { label: "主 Agent 汇总", description: "输出共识、分歧、置信度和失效条件。" },
];

const toggleValue = <T,>(items: T[], value: T) => (
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
);

export default function ExpertReviewPage() {
  const [mode, setMode] = useState<ReviewMode>("single");
  const [topicType, setTopicType] = useState<TopicType>("stock");
  const [topic, setTopic] = useState("");
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [skillError, setSkillError] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilityBindings>(EMPTY_CAPABILITIES);
  const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
  const [reviewStarted, setReviewStarted] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [expertCatalog, setExpertCatalog] = useState<WorkspaceExpert[]>([]);
  const [expertTeams, setExpertTeams] = useState<WorkspaceExpertTeam[]>([]);
  const { activeRun, runError, submitting, restoring, busy, startRun } = useWorkspaceRun("expert_review");
  const [restoredRunId, setRestoredRunId] = useState<string | null>(null);
  if (activeRun && restoredRunId !== activeRun.id) {
    setRestoredRunId(activeRun.id);
    const task = activeRun.taskSnapshot;
    setMode(task.config.mode === "group" ? "group" : "single");
    setTopicType((task.subject.topicType as TopicType) || "stock");
    setTopic(task.objective);
    setCapabilities(task.capabilities);
  }
  const capabilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const capabilityDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void workspaceApi.getCapabilities()
      .then((result) => {
        if (!active) return;
        setSkills(result.skills.filter((skill) => skill.enabled));
        const nextExperts = result.experts.filter((expert) => expert.enabled);
        setExpertCatalog(nextExperts);
        setExpertTeams(result.expertTeams.filter((team) => team.enabled));
        setCapabilities((current) => {
          const selectedExpertIds = current.expertIds.length
            ? current.expertIds
            : nextExperts.length ? [nextExperts[0].id] : [];
          return countAgentCapabilities(current) > current.expertIds.length
            ? { ...current, expertIds: selectedExpertIds }
            : { ...result.defaults.expert_review, expertIds: selectedExpertIds };
        });
      })
      .catch(() => {
        if (active) setSkillError("金融 Skill 目录读取失败，仍可先配置专家评审。 ");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!capabilityPanelOpen) return;
    const dialog = capabilityDialogRef.current;
    const trigger = capabilityTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const frame = window.requestAnimationFrame(() => {
      const firstControl = dialog?.querySelector<HTMLElement>(focusableSelector);
      (firstControl || dialog)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapabilityPanelOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [capabilityPanelOpen]);

  const selectedTeamMembers = useMemo(() => {
    const ids = new Set(capabilities.expertIds);
    return expertCatalog.filter((expert) => ids.has(expert.id));
  }, [capabilities.expertIds, expertCatalog]);

  const singleExpert = expertCatalog.find((expert) => expert.id === capabilities.expertIds[0]);
  const canStart = Boolean(topic.trim()) && (mode === "single" ? Boolean(singleExpert) : selectedTeamMembers.length >= 2);
  const capabilityCount = countAgentCapabilities(capabilities);

  const changeMode = (nextMode: ReviewMode) => {
    setMode(nextMode);
    setReviewStarted(false);
    if (nextMode === "single") {
      setCapabilities((current) => ({ ...current, expertIds: [current.expertIds[0] || expertCatalog[0]?.id].filter((value): value is number => typeof value === "number"), expertTeamIds: [] }));
    } else {
      const defaultTeam = expertTeams[0];
      setCapabilities((current) => defaultTeam ? ({ ...current, expertIds: [...defaultTeam.memberIds], expertTeamIds: [defaultTeam.id] }) : current);
    }
  };

  const selectSingleExpert = (expertId: number) => {
    setCapabilities((current) => ({ ...current, expertIds: [expertId], expertTeamIds: [] }));
    setReviewStarted(false);
  };

  const toggleGroupExpert = (expertId: number) => {
    setCapabilities((current) => ({
      ...current,
      expertIds: toggleValue(current.expertIds, expertId),
      expertTeamIds: [],
    }));
    setReviewStarted(false);
  };

  const applyGroupTeam = (teamId: number) => {
    const team = expertTeams.find((item) => item.id === teamId);
    if (!team) return;
    setMode("group");
    setCapabilities((current) => ({
      ...current,
      expertIds: [...team.memberIds],
      expertTeamIds: [team.id],
    }));
    setReviewStarted(false);
  };

  const selectAllExperts = () => {
    setCapabilities((current) => ({ ...current, expertIds: expertCatalog.map((expert) => expert.id), expertTeamIds: [] }));
    setReviewStarted(false);
  };

  const clearExperts = () => {
    setCapabilities((current) => ({ ...current, expertIds: [], expertTeamIds: [] }));
    setReviewStarted(false);
  };

  const startReview = async (followUp?: string) => {
    const objective = followUp?.trim() ? `${topic.trim()}\n\n追问：${followUp.trim()}` : topic.trim();
    if (!canStart || !objective || busy) return;
    setReviewStarted(true);
    await startRun(async () => {
      const task = await workspaceApi.createTask({
        kind: "expert_review",
        name: `${mode === "single" ? "专家单聊" : "专家群聊"} · ${objective.slice(0, 32)}`,
        market: "GLOBAL",
        objective,
        subject: { topicType },
        config: { mode, reviewProtocol: "independent_then_synthesis" },
        capabilities: {
          ...capabilities,
          expertTeamIds: mode === "single" ? [] : capabilities.expertTeamIds,
        },
      });
      const run = await workspaceApi.runTask(task.id);
      setRestoredRunId(run.id);
      setMessageDraft("");
      return run;
    }, "专家评审启动未确认，请检查 Agent 状态和运行记录。");
  };

  const reviewText = activeRun?.artifacts.find((artifact) => artifact.type === "ExpertReview")?.text;

  const renderCapabilityPanel = (className: string, onClose?: () => void) => (
    <AgentCapabilityPanel
      scopeLabel="会话"
      skills={skills}
      selectedSkillIds={capabilities.skillIds}
      onToggleSkill={(id) => setCapabilities((current) => ({ ...current, skillIds: toggleValue(current.skillIds, id) }))}
      skillLimitReached={capabilities.skillIds.length >= 3}
      selectedToolIds={capabilities.toolIds}
      onToggleTool={(id) => setCapabilities((current) => ({ ...current, toolIds: toggleValue(current.toolIds, id) }))}
      selectedDataSourceIds={capabilities.dataSourceIds}
      onToggleDataSource={(id) => setCapabilities((current) => ({ ...current, dataSourceIds: toggleValue(current.dataSourceIds, id) }))}
      selectedMcpIds={capabilities.mcpIds}
      onToggleMcp={(id) => setCapabilities((current) => ({ ...current, mcpIds: toggleValue(current.mcpIds, id) }))}
      selectedExpertIds={capabilities.expertIds}
      onToggleExpert={(id) => {
        if (mode === "single") selectSingleExpert(id);
        else toggleGroupExpert(id);
      }}
      selectedExpertTeamIds={capabilities.expertTeamIds}
      onToggleExpertTeam={(id) => {
        applyGroupTeam(id);
      }}
      onClose={onClose}
      className={className}
    />
  );

  return (
    <AppPage className="space-y-6 pb-20" data-testid="expert-review-page">
      <PageHeader
        eyebrow="Expert review"
        title="专家评审"
        description="围绕研究议题获取独立专家意见，再由主 Agent 比较证据、假设与分歧。"
        actions={<Link to="/capabilities/experts" className="btn-secondary">管理专家配置</Link>}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_304px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="review-setup-heading">
            <div className="border-b border-border/70 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="review-setup-heading" className="text-base font-semibold text-foreground">创建评审</h2>
                  <p className="mt-1 text-sm leading-6 text-secondary-text">专家本质上是共享完整金融 Agent 底座、但拥有不同 Prompt 的独立会话。</p>
                </div>
                <div className="inline-flex rounded-[10px] border border-border bg-background p-1" aria-label="专家评审模式">
                  <button type="button" aria-pressed={mode === "single"} onClick={() => changeMode("single")} className={cn("inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-sm font-medium transition-colors", mode === "single" ? "bg-card text-foreground shadow-sm" : "text-secondary-text hover:text-foreground")}><MessageCircle className="h-4 w-4" />专家单聊</button>
                  <button type="button" aria-pressed={mode === "group"} onClick={() => changeMode("group")} className={cn("inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-sm font-medium transition-colors", mode === "group" ? "bg-card text-foreground shadow-sm" : "text-secondary-text hover:text-foreground")}><Users className="h-4 w-4" />专家群聊</button>
                </div>
              </div>
            </div>

            <div className="space-y-6 px-5 py-5 sm:px-6">
              <fieldset>
                <legend className="text-sm font-semibold text-foreground">1. 选择议题类型</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {TOPIC_TYPES.map((item) => (
                    <button key={item.id} type="button" aria-pressed={topicType === item.id} onClick={() => setTopicType(item.id)} className={cn("min-h-20 rounded-[10px] border px-3 py-3 text-left transition-colors", topicType === item.id ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/35")}>
                      <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{item.label}</span>{topicType === item.id ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-muted-text">{item.hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block text-sm font-semibold text-foreground">2. 定义共同议题
                <textarea value={topic} onChange={(event) => { setTopic(event.target.value); setReviewStarted(false); }} placeholder="例如：请基于最新可得财务和行业证据，判断腾讯当前最重要的长期增长驱动、估值风险与投资逻辑失效条件。" className="mt-3 min-h-28 w-full resize-y rounded-[10px] border border-border bg-background px-3 py-3 text-sm leading-6 text-foreground outline-none focus:border-primary" />
              </label>

              {mode === "single" ? (
                <fieldset>
                  <legend className="text-sm font-semibold text-foreground">3. 选择一位专家</legend>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {expertCatalog.map((expert) => {
                      const selected = capabilities.expertIds[0] === expert.id;
                      return (
                        <button key={expert.id} type="button" aria-pressed={selected} onClick={() => selectSingleExpert(expert.id)} className={cn("rounded-[10px] border px-4 py-3 text-left transition-colors", selected ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/35")}>
                          <span className="flex items-center justify-between gap-3"><span className="font-semibold text-foreground">{expert.name}</span>{selected ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                          <span className="mt-1 block text-xs text-primary">{expert.style}</span>
                          <span className="mt-2 line-clamp-2 block text-xs leading-5 text-secondary-text">{expert.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <div className="space-y-5">
                  <fieldset>
                    <legend className="text-sm font-semibold text-foreground">3. 快速选择专家团</legend>
                    <p className="mt-1 text-xs leading-5 text-muted-text">预设只用于填充参会名单，之后仍可逐个增删专家。</p>
                    <div className="mt-3 grid gap-2 lg:grid-cols-3">
                      {expertTeams.map((team) => {
                        const selected = capabilities.expertTeamIds.includes(team.id);
                        return (
                          <button key={team.id} type="button" aria-pressed={selected} onClick={() => applyGroupTeam(team.id)} className={cn("rounded-[10px] border px-4 py-3 text-left transition-colors", selected ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/35")}>
                            <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{team.name}</span>{selected ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                            <span className="mt-2 block text-xs leading-5 text-secondary-text">{team.description}</span>
                            <span className="mt-2 block text-[10px] text-muted-text">{team.memberIds.map((id) => expertCatalog.find((expert) => expert.id === id)?.name || id).join(" · ")}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <fieldset aria-describedby="expert-selection-hint">
                    <legend className="text-sm font-semibold text-foreground">4. 指定参会专家</legend>
                    <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <p id="expert-selection-hint" className="text-xs leading-5 text-muted-text">当前已选 {selectedTeamMembers.length} 位。手动调整后将作为自定义组合运行。</p>
                      <div className="flex gap-2">
                        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={selectAllExperts}>选择全部</button>
                        <span className="text-border" aria-hidden="true">/</span>
                        <button type="button" className="text-xs font-medium text-secondary-text hover:text-foreground hover:underline" onClick={clearExperts}>清空</button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {expertCatalog.map((expert) => {
                        const selected = capabilities.expertIds.includes(expert.id);
                        return (
                          <button
                            key={expert.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleGroupExpert(expert.id)}
                            className={cn(
                              "flex min-h-16 items-start gap-3 rounded-[10px] border px-3 py-3 text-left transition-colors",
                              selected ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:border-primary/25 hover:bg-hover/35",
                            )}
                          >
                            <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")} aria-hidden="true">{selected ? <Check className="h-3 w-3" /> : null}</span>
                            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{expert.name}</span><span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted-text">{expert.style}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="grid gap-4">
                    <div className="rounded-[10px] border border-border bg-background px-4 py-3">
                      <p className="text-xs font-medium text-foreground">公共证据协议</p>
                      <p className="mt-1 text-xs leading-5 text-muted-text">专家共享议题及已提供的研究成果，独立判断后由主 Agent 比较证据、假设与分歧。不进行多轮交叉质疑；各自补充的数据需注明来源和时点。</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">已挂载 {capabilityCount} 项 Agent 工具</p>
                  <p className="mt-1 text-xs text-muted-text">金融 Skill、内置工具、MCP 服务和数据源均来自工作区能力注册表。</p>
                  {skillError ? <p role="alert" className="mt-1 text-xs text-warning">{skillError}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button ref={capabilityTriggerRef} type="button" className="btn-secondary inline-flex items-center gap-2 xl:hidden" onClick={() => setCapabilityPanelOpen(true)}><SlidersHorizontal className="h-4 w-4" />配置 Agent 工具</button>
                  <button type="button" disabled={!canStart || busy} onClick={() => void startReview()} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"><Play className="h-4 w-4" />{restoring ? "恢复运行状态…" : submitting ? "正在提交…" : mode === "single" ? "运行专家单聊" : "运行群聊评审"}</button>
                </div>
              </div>
              {!canStart ? <p className="text-xs text-muted-text">{!topic.trim() ? "填写共同议题后即可创建。" : mode === "group" ? "群聊至少需要两位专家。" : "请选择一位专家。"}</p> : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="review-room-heading">
            <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 id="review-room-heading" className="font-semibold text-foreground">{mode === "single" ? "专家会话" : "评审房间"}</h2><p className="mt-1 text-xs text-secondary-text">{reviewStarted ? "评审已创建为独立运行；已生成的专家意见和汇总会保存为研究成果。" : "完成上方配置后，在这里查看专家意见与主持汇总。"}</p></div>
              {activeRun ? <span className={`inline-flex items-center gap-2 text-xs font-medium ${activeRun.status === "completed" ? "text-success" : activeRun.status === "failed" ? "text-danger" : "text-warning"}`}><span className="h-2 w-2 rounded-full bg-current" />{activeRun.status}</span> : null}
            </div>

            {activeRun ? <Link className="mx-5 mt-3 inline-block text-xs text-primary" to={`/runs/${activeRun.id}`}>后台任务 · 切换页面不会中断 · 查看运行详情</Link> : null}
            {!reviewStarted && !activeRun && !submitting && !runError ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                {mode === "single" ? <Bot className="h-8 w-8 text-muted-text" /> : <MessagesSquare className="h-8 w-8 text-muted-text" />}
                <p className="mt-4 font-medium text-foreground">还没有创建评审</p>
                <p className="mt-2 max-w-lg text-sm leading-6 text-secondary-text">运行后，每条结论会绑定专家 Prompt 版本、能力清单和任务上下文标识，不预填虚构观点。</p>
              </div>
            ) : mode === "single" && singleExpert ? (
              <div>
                <div className="border-b border-border/70 bg-background/55 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-foreground">{singleExpert.name}</p><p className="text-xs text-muted-text">{singleExpert.style} · 单聊会话已创建</p></div></div>
                </div>
                <div className="min-h-52 space-y-3 px-5 py-5 sm:px-6">
                  <div className="max-w-2xl rounded-[12px] border border-border bg-background px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">共同议题</p><p className="mt-2 text-sm leading-6 text-foreground">{topic}</p></div>
                  {runError ? <p role="alert" className="flex items-center gap-2 text-xs text-danger"><CircleAlert className="h-3.5 w-3.5" />{runError}</p> : null}
                  {activeRun && ["queued", "running"].includes(activeRun.status) ? <p role="status" className="text-sm text-warning">专家 Agent 正在分析并整理证据…</p> : null}
                  {reviewText ? <div className="max-w-3xl whitespace-pre-wrap rounded-[12px] border border-border bg-background px-4 py-4 text-sm leading-7 text-foreground">{reviewText}</div> : null}
                  {activeRun?.errorMessage ? <p className="text-sm text-danger">{activeRun.errorMessage}</p> : null}
                </div>
                <div className="border-t border-border/70 px-5 py-4 sm:px-6">
                  <div className="flex gap-2"><textarea aria-label="继续询问专家" value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder={`继续询问${singleExpert.name}…`} className="min-h-12 flex-1 resize-none rounded-[10px] border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary" /><button type="button" aria-label="发送给专家" disabled={!messageDraft.trim() || busy} onClick={() => void startReview(messageDraft)} className="btn-primary self-end px-4 disabled:cursor-not-allowed disabled:opacity-45"><Send className="h-4 w-4" /></button></div>
                </div>
              </div>
            ) : (
              <div className="grid gap-px bg-border lg:grid-cols-[15rem_minmax(0,1fr)]">
                <aside className="bg-background px-5 py-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-text">参会视角 · {selectedTeamMembers.length}</p>
                  <div className="mt-4 space-y-3">{selectedTeamMembers.map((expert) => <div key={expert.id} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><Bot className="h-3.5 w-3.5" /></span><div><p className="text-sm font-medium text-foreground">{expert.name}</p><p className="text-[10px] text-muted-text">独立 Persona Agent</p></div></div>)}</div>
                  <div className="mt-5 border-t border-border/70 pt-4"><p className="flex items-center gap-2 text-xs font-medium text-foreground"><Database className="h-3.5 w-3.5 text-primary" />任务上下文标识</p><p className="mt-2 break-all font-mono text-[10px] text-secondary-text">{activeRun?.dataSnapshotId || "运行后创建"}</p></div>
                </aside>
                <div className="bg-card px-5 py-5 sm:px-6">
                  <div className="rounded-[10px] border border-border bg-background px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">评审议题</p><p className="mt-2 text-sm leading-6 text-foreground">{topic}</p></div>
                  <ol className="mt-5 space-y-0">{REVIEW_STAGES.map((stage, index) => <li key={stage.label} className="relative flex gap-4 pb-5 last:pb-0"><span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-text">{index + 1}</span>{index < REVIEW_STAGES.length - 1 ? <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" /> : null}<div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{stage.label}</p><span className={`text-[10px] ${activeRun?.status === "completed" ? "text-success" : "text-warning"}`}>{activeRun?.artifacts.some((artifact) => artifact.type === (index === 0 ? "ExpertOpinion" : "ExpertReview")) ? "已有保存成果" : "尚无保存成果"}</span></div><p className="mt-1 text-xs leading-5 text-secondary-text">{stage.description}</p></div></li>)}</ol>
                  {reviewText ? <div className="mt-5 whitespace-pre-wrap border-t border-border/70 pt-4 text-sm leading-7 text-foreground">{reviewText}</div> : null}
                  {runError || activeRun?.errorMessage ? <p role="alert" className="mt-4 text-xs text-danger">{runError || activeRun?.errorMessage}</p> : null}
                  <p className="mt-5 border-t border-border/70 pt-4 text-xs leading-5 text-muted-text">当前协议为独立评审后统一汇总，不执行多轮交叉质疑。最终比较证据质量和假设强度，不采用多数投票。</p>
                </div>
              </div>
            )}
          </section>
        </div>

        {renderCapabilityPanel("hidden h-[calc(100vh-10rem)] w-full xl:sticky xl:top-6 xl:flex")}
      </div>

      {capabilityPanelOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 p-3 xl:hidden" role="presentation" onClick={() => setCapabilityPanelOpen(false)}>
          <div ref={capabilityDialogRef} tabIndex={-1} className="ml-auto h-full w-fit outline-none" role="dialog" aria-modal="true" aria-label="配置专家评审能力" onClick={(event) => event.stopPropagation()}>{renderCapabilityPanel("h-full w-[min(21rem,calc(100vw-1.5rem))]", () => setCapabilityPanelOpen(false))}</div>
        </div>
      ) : null}
    </AppPage>
  );
}
