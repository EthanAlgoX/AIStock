import {
  Bot,
  ChevronDown,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  workspaceApi,
  type WorkspaceExpert,
} from "../api/workspace";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";
import { AppPage, PageHeader } from "../components/common";
import { ExpertAvatar } from "../components/common/ExpertAvatar";
import { ExpertAvatarPicker } from "../components/common/ExpertAvatarPicker";
import { useUiLanguage } from "../contexts/UiLanguageContext";

const emptyExpert = { name: "", style: "", description: "", prompt: "", avatar: null as string | null };

export default function AgentCenterPage() {
  const { localize: l } = useUiLanguage();
  const [avatarDrafts, setAvatarDrafts] = useState<Record<number, string | null>>({});
  const [experts, setExperts] = useState<WorkspaceExpert[]>([]);
  const [editingExpertId, setEditingExpertId] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [showCreateExpert, setShowCreateExpert] = useState(false);
  const [newExpert, setNewExpert] = useState(emptyExpert);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");


  const loadCatalog = async () => {
    setExperts(await workspaceApi.listExperts());
  };

  useEffect(() => {
    let active = true;
    void workspaceApi.listExperts()
      .then((nextExperts) => {
        if (!active) return;
        setExperts(nextExperts);
      })
      .catch(() => active && setError("专家目录读取失败，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const openPromptEditor = (expert: WorkspaceExpert) => {
    if (editingExpertId === expert.id) {
      setEditingExpertId(null);
      return;
    }
    setEditingExpertId(expert.id);
    setPromptDraft(expert.prompt);
    setNotice("");
  };

  const savePrompt = async (expert: WorkspaceExpert, prompt = promptDraft) => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi.updateExpert(expert.id, { prompt: prompt.trim() });
      await loadCatalog();
      setPromptDraft(prompt.trim());
      setNotice(`${expert.name} 的 Prompt 已发布为新版本。`);
    } catch {
      setError("专家 Prompt 保存失败。");
    } finally { setBusy(false); }
  };

  const resetPrompt = async (expert: WorkspaceExpert) => {
    if (!expert.builtIn) return;
    setPromptDraft(expert.defaultPrompt);
    await savePrompt(expert, expert.defaultPrompt);
  };

  const createExpert = async () => {
    if (!newExpert.name.trim() || !newExpert.style.trim() || !newExpert.prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi.createExpert({
        name: newExpert.name.trim(),
        style: newExpert.style.trim(),
        description: newExpert.description.trim(),
        philosophy: newExpert.style.trim(),
        focus: [],
        prompt: newExpert.prompt.trim(),
        avatar: newExpert.avatar,
      });
      await loadCatalog();
      setNewExpert(emptyExpert);
      setShowCreateExpert(false);
      setNotice("自定义专家已保存到工作区。 ");
    } catch {
      setError("专家保存失败，请检查名称是否重复。");
    } finally { setBusy(false); }
  };

  const removeExpert = async (expert: WorkspaceExpert) => {
    setBusy(true);
    try {
      await workspaceApi.deleteExpert(expert.id);
      await loadCatalog();
      setNotice("自定义专家已移除。");
    } catch { setError("专家删除失败。"); }
    finally { setBusy(false); }
  };

  const customExperts = experts.filter((expert) => !expert.builtIn);
  const saveAvatar = async (expert: WorkspaceExpert) => {
    setBusy(true); setError('');
    try {
      await workspaceApi.updateExpert(expert.id, { avatar: avatarDrafts[expert.id] });
      await loadCatalog();
      setAvatarDrafts((drafts) => { const next = { ...drafts }; delete next[expert.id]; return next; });
      setNotice(l('头像已保存。', 'Avatar saved.'));
    } catch { setError(l('头像保存失败，请重试。', 'Could not save the avatar. Please retry.')); }
    finally { setBusy(false); }
  };
  const builtInExperts = experts.filter((expert) => expert.builtIn);

  return (
    <AppPage className="space-y-6 pb-20" data-testid="expert-settings-page">
      <PageHeader
        eyebrow="Capability registry"
        title="专家配置"
        description="管理平台预置和工作区自定义的投资 Persona。专家共享同一 Agent Runtime，通过版本化 Prompt 独立分析，再由主 Agent 汇总。"
        actions={<Link to="/expert-review" className="btn-primary">进入专家圆桌</Link>}
      />
      <CapabilityCenterNav />

      {loading ? <p className="flex items-center gap-2 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取专家目录…</p> : null}
      {error ? <p role="alert" className="rounded-[12px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p role="status" className="rounded-[12px] border border-success/25 bg-success/5 px-4 py-3 text-sm text-success">{notice}</p> : null}

      <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="create-expert-heading">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">工作区自定义</p><h2 id="create-expert-heading" className="mt-1 font-semibold text-foreground">自定义专家 Persona</h2><p className="mt-1 text-xs leading-5 text-secondary-text">Prompt 定义投资方法；任务运行时再挂载 Skill、Tool、MCP 和数据源。</p></div>
          <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2" aria-expanded={showCreateExpert} onClick={() => setShowCreateExpert((current) => !current)}><Plus className="h-4 w-4" />添加专家</button>
        </div>
        {showCreateExpert ? <div className="border-t border-border/70 px-5 py-5">
          <ExpertAvatarPicker onProcessingChange={setProcessingAvatar} name={newExpert.name} value={newExpert.avatar} disabled={busy} onChange={(avatar) => setNewExpert((current) => ({ ...current, avatar }))} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-foreground">专家名称<input aria-label="自定义专家名称" value={newExpert.name} onChange={(event) => setNewExpert({ ...newExpert, name: event.target.value })} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 outline-none focus:border-primary" /></label>
            <label className="text-sm font-medium text-foreground">投资风格<input aria-label="自定义专家投资风格" value={newExpert.style} onChange={(event) => setNewExpert({ ...newExpert, style: event.target.value })} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 outline-none focus:border-primary" /></label>
          </div>
          <label className="mt-4 block text-sm font-medium text-foreground">职责说明<input aria-label="自定义专家职责说明" value={newExpert.description} onChange={(event) => setNewExpert({ ...newExpert, description: event.target.value })} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 outline-none focus:border-primary" /></label>
          <label className="mt-4 block text-sm font-medium text-foreground">System Prompt<textarea aria-label="自定义专家 System Prompt" value={newExpert.prompt} onChange={(event) => setNewExpert({ ...newExpert, prompt: event.target.value })} className="mt-2 min-h-40 w-full resize-y rounded-[10px] border border-border bg-background px-3 py-3 text-sm leading-6 outline-none focus:border-primary" /></label>
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setShowCreateExpert(false)}>取消</button><button type="button" className="btn-primary" disabled={busy || processingAvatar || !newExpert.name.trim() || !newExpert.style.trim() || !newExpert.prompt.trim()} onClick={() => void createExpert()}>保存专家</button></div>
        </div> : null}
        {customExperts.length ? <div className="divide-y divide-border/60 border-t border-border/70">{customExperts.map((expert) => <article key={expert.id} className="flex items-start gap-4 px-5 py-4"><ExpertAvatar id={expert.id} name={expert.name} avatar={expert.avatar} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-foreground">{expert.name}</h3><span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-text">{expert.style}</span><span className="text-[10px] text-success">v{expert.version}</span></div><p className="mt-1 text-sm leading-6 text-secondary-text">{expert.description}</p><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-text">{expert.prompt}</p><details className="mt-3"><summary className="cursor-pointer py-2 text-sm text-primary">{l("设置头像", "Edit avatar")}</summary><ExpertAvatarPicker onProcessingChange={setProcessingAvatar} id={expert.id} name={expert.name} value={expert.id in avatarDrafts ? avatarDrafts[expert.id] : expert.avatar} disabled={busy} onChange={(avatar) => setAvatarDrafts((drafts) => ({ ...drafts, [expert.id]: avatar }))} /><button type="button" className="btn-secondary" disabled={busy || processingAvatar || !(expert.id in avatarDrafts)} onClick={() => void saveAvatar(expert)}>{l("保存头像", "Save avatar")}</button></details></div><button type="button" disabled={busy} onClick={() => void removeExpert(expert)} className="rounded-md p-2 text-muted-text hover:bg-danger/10 hover:text-danger" aria-label={`删除自定义专家 ${expert.name}`}><Trash2 className="h-4 w-4" /></button></article>)}</div> : <p className="border-t border-border/70 px-5 py-4 text-xs text-muted-text">暂无自定义专家。添加后可在投研助理、个股研究、策略选股和专家圆桌中选择。</p>}
      </section>

      <section className="grid overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card md:grid-cols-3" aria-label="专家系统工作方式">
        <div className="border-b border-border/70 px-5 py-4 md:border-b-0 md:border-r"><p className="text-xs font-semibold text-primary">统一运行时</p><p className="mt-1 text-sm font-medium text-foreground">同一个主 Agent</p><p className="mt-1 text-xs leading-5 text-secondary-text">共享冻结任务、数据快照与能力权限。</p></div>
        <div className="border-b border-border/70 px-5 py-4 md:border-b-0 md:border-r"><p className="text-xs font-semibold text-primary">独立视角</p><p className="mt-1 text-sm font-medium text-foreground">不同 Persona Prompt</p><p className="mt-1 text-xs leading-5 text-secondary-text">每位专家分别产生观点、证据、反证与置信度。</p></div>
        <div className="px-5 py-4"><p className="text-xs font-semibold text-primary">统一结论</p><p className="mt-1 text-sm font-medium text-foreground">主 Agent 综合评审</p><p className="mt-1 text-xs leading-5 text-secondary-text">按流水线、辩论或独立评审投票协议汇总；主持人不参与具体研究或投票。</p></div>
      </section>

      <div className="grid items-start gap-6 ">
        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card" aria-labelledby="builtin-expert-heading">
          <div className="border-b border-border/70 px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">平台预置</p><div className="mt-1 flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /><h2 id="builtin-expert-heading" className="font-semibold text-foreground">内置投资专家</h2></div><p className="mt-1 text-xs leading-5 text-secondary-text">Prompt 是对公开投资框架的抽象，不代表相关人物本人观点。</p></div>
          <div className="divide-y divide-border/60">{builtInExperts.map((expert) => {
            const editing = editingExpertId === expert.id;
            return <article key={expert.id} className="px-5 py-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ExpertAvatar id={expert.id} name={expert.name} avatar={expert.avatar} /><h3 className="font-semibold text-foreground">{expert.name}</h3><span className="rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">{expert.style}</span><span className="text-[10px] text-muted-text">v{expert.version}</span></div><p className="mt-1 text-sm leading-6 text-secondary-text">{expert.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{expert.focus.map((item) => <span key={item} className="rounded border border-border bg-background px-2 py-1 text-[10px] text-secondary-text">{item}</span>)}</div></div><button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-2" aria-expanded={editing} onClick={() => openPromptEditor(expert)}>配置 Prompt<ChevronDown className={`h-3.5 w-3.5 transition-transform ${editing ? "rotate-180" : ""}`} /></button></div>{editing ? <div className="mt-4 border-t border-border/70 pt-4"><label className="text-xs font-medium text-foreground">专家 System Prompt<textarea aria-label={`${expert.name} System Prompt`} value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} className="mt-2 min-h-64 w-full resize-y rounded-[10px] border border-border bg-background px-3 py-3 text-sm leading-6 outline-none focus:border-primary" /></label><div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void resetPrompt(expert)}><RotateCcw className="h-3.5 w-3.5" />恢复默认</button><button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy || processingAvatar || !promptDraft.trim()} onClick={() => void savePrompt(expert)}><Save className="h-3.5 w-3.5" />保存 Prompt</button></div></div> : null}</article>;
          })}</div>
        </section>


      </div>
    </AppPage>
  );
}
