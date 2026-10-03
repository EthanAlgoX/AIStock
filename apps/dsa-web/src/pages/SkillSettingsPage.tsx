import { useUiLiteral } from '../hooks/useUiLiteral';
import { UiLiteral } from '../components/i18n/UiLiteral';
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Blocks, CheckCircle2, CircleAlert, LoaderCircle, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { workspaceApi, type WorkspaceSkill } from "../api/workspace";
import { AppPage, ConfirmDialog, PageHeader } from "../components/common";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";

type CustomSkillDraft = {
  id: string;
  name: string;
  category: "research" | "screening" | "risk" | "trading" | "general";
  description: string;
  instructions: string;
  enabled: boolean;
};

type CustomSkillForm = Omit<CustomSkillDraft, "id" | "enabled">;

const emptyCustomSkill: CustomSkillForm = {
  name: "",
  category: "general",
  description: "",
  instructions: "",
};

const categoryLabels: Record<CustomSkillDraft["category"], string> = {
  research: "个股研究",
  screening: "选股",
  risk: "风险分析",
  trading: "交易验证",
  general: "通用金融",
};

export default function SkillSettingsPage() {
  const uiLiteral = useUiLiteral();
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customForm, setCustomForm] = useState<CustomSkillForm>(emptyCustomSkill);
  const [customSaved, setCustomSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSkill | null>(null);
  const mutationInFlight = useRef(false);
  const beginMutation = () => {
    if (!loaded || mutationInFlight.current) return false;
    mutationInFlight.current = true; setBusy(true); setError(''); return true;
  };
  const endMutation = () => { mutationInFlight.current = false; setBusy(false); };
  const retry = () => { setError(''); setLoading(true); setLoaded(false); setRevision((value) => value + 1); };

  const loadSkills = async () => {
    const result = await workspaceApi.listSkills();
    setSkills(result);
    const ids = result.filter((skill) => skill.enabled).map((skill) => skill.id);
    setEnabledIds(ids);
    setSavedIds(ids);
  };

  useEffect(() => {
    let active = true;
    void workspaceApi.listSkills()
      .then((result) => {
        if (!active) return;
        const ids = result.filter((skill) => skill.enabled).map((skill) => skill.id);
        setSkills(result);
        setEnabledIds(ids);
        setSavedIds(ids);
        setLoaded(true);
      })
      .catch(() => active && setError("无法读取当前 Agent 的 Skill 目录。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [revision]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return keyword
      ? skills.filter((skill) => `${skill.name} ${skill.id} ${skill.description}`.toLocaleLowerCase().includes(keyword))
      : skills;
  }, [query, skills]);
  const dirty = enabledIds.join("|") !== savedIds.join("|");

  const toggle = (id: string) => {
    setSaved(false);
    setEnabledIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const save = async () => {
    if (!dirty || !beginMutation()) return;
    const snapshot = [...enabledIds];
    try {
      await workspaceApi.setPreferences("skill", snapshot);
      setSavedIds(snapshot);
      setSaved(true);
    } catch {
      setError("Skill 白名单保存失败，请稍后重试。");
    } finally { endMutation(); }
  };

  const addCustomSkill = async (event: FormEvent) => {
    event.preventDefault();
    if (!customForm.name.trim() || !customForm.instructions.trim()) return;
    if (!beginMutation()) return;
    try {
      await workspaceApi.createSkill({
        id: `custom-skill-${crypto.randomUUID()}`,
        name: customForm.name.trim(),
        category: customForm.category,
        description: customForm.description.trim(),
        instructions: customForm.instructions.trim(),
        enabled: true,
      });
      await loadSkills();
      setCustomForm(emptyCustomSkill);
      setCustomSaved(true);
    } catch {
      setError("自定义 Skill 保存失败，请检查名称是否重复。");
    } finally { endMutation(); }
  };

  const customSkills = skills.filter((skill) => !skill.builtIn);

  const updateCustomSkill = async (skill: WorkspaceSkill, enabled: boolean) => {
    if (!beginMutation()) return;
    try {
      await workspaceApi.updateSkill(skill.id, { enabled });
      await loadSkills();
    } catch {
      setError("自定义 Skill 状态更新失败。");
    } finally { endMutation(); }
  };

  const deleteCustomSkill = async (skill: WorkspaceSkill) => {
    if (!beginMutation()) return;
    try {
      await workspaceApi.deleteSkill(skill.id);
      await loadSkills();
      setDeleteTarget(null);
    } catch {
      setError("自定义 Skill 删除失败。"); setDeleteTarget(null);
    } finally { endMutation(); }
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="skill-settings-page">
      <PageHeader
        eyebrow={uiLiteral("能力注册表")}
        title="Skill"
        description={uiLiteral("管理 Agent 的可复用工作方法。平台预置金融 Skill 可直接启用，也可以在工作区编写自己的通用金融 Skill。")}
        actions={<Link to="/overview" className="btn-primary"><UiLiteral text={"返回投研助理"} /></Link>}
      />
      <CapabilityCenterNav />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
          <div className="border-b border-border/70 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary"><UiLiteral text={"平台预置"} /></p>
            <h2 className="mt-1 font-semibold text-foreground"><UiLiteral text={"金融 Skill 目录"} /></h2>
            <p className="mt-1 text-xs text-muted-text"><UiLiteral text={"由后端发布并经过治理的研究、选股、风控和交易工作方法。"} /></p>
          </div>
          <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-text" aria-hidden="true" />
              <input aria-label={uiLiteral("搜索 Skill")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiLiteral("搜索名称、ID 或说明")} className="h-11 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn-secondary" disabled={!loaded || busy} onClick={() => { setEnabledIds(skills.map((skill) => skill.id)); setSaved(false); }}><UiLiteral text={"启用金融目录"} /></button>
              <button type="button" className="btn-secondary" disabled={!loaded || busy} onClick={() => { setEnabledIds([]); setSaved(false); }}><UiLiteral text={"全部停用"} /></button>
            </div>
          </div>

          {loading ? <p className="flex items-center gap-2 px-5 py-8 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" /><UiLiteral text={"正在读取 Skill…"} /></p> : null}
          {error ? <div role="alert" className="px-5 py-5 text-sm text-danger"><p className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{uiLiteral(error)}</p>{!loaded && <button type="button" className="btn-secondary mt-3" disabled={loading} onClick={retry}><UiLiteral text="重新读取" /></button>}</div> : null}
          {loaded ? (
            <div className="divide-y divide-border/60">
              {filtered.filter((skill) => skill.builtIn).map((skill) => {
                const enabled = enabledIds.includes(skill.id);
                return (
                  <label key={skill.id} className="flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-hover/35">
                    <input type="checkbox" checked={enabled} disabled={busy} onChange={() => toggle(skill.id)} className="mt-1 chat-skill-checkbox" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{uiLiteral(skill.name)}</span>
                        <code className="text-[11px] text-muted-text">{skill.id}</code>
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-secondary-text">{uiLiteral(skill.description || "没有说明。")}</span>
                    </span>
                    <span className={enabled ? "text-xs font-medium text-success" : "text-xs text-muted-text"}>{enabled ? uiLiteral("可供 Agent 使用") : uiLiteral("已停用")}</span>
                  </label>
                );
              })}
              {!filtered.some((skill) => skill.builtIn) ? <p className="px-5 py-10 text-center text-sm text-muted-text"><UiLiteral text={"没有匹配的 Skill。"} /></p> : null}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="rounded-[14px] border border-border bg-background p-5">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold text-foreground"><UiLiteral text={"工作区启用清单"} /></h2></div>
            <p className="mt-3 text-sm leading-6 text-secondary-text"><UiLiteral text={"已启用 "} />{loaded ? `${enabledIds.length} / ${skills.length}` : '—'}<UiLiteral text={"。白名单保存在后端能力注册表，并在任务创建时再次冻结。"} /></p>
            <button type="button" onClick={() => void save()} disabled={!loaded || busy || !dirty} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45"><Save className="h-4 w-4" /><UiLiteral text={busy ? '正在保存…' : '保存 Skill 配置'} /></button>
            {saved ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" /><UiLiteral text={"已保存到工作区能力注册表。"} /></p> : null}
          </div>
          <div className="rounded-[12px] border border-border bg-background px-4 py-4">
            <p className="text-xs font-semibold text-foreground"><UiLiteral text={"金融能力治理"} /></p>
            <p className="mt-2 text-xs leading-5 text-secondary-text"><UiLiteral text={"底层完整 Agent 仍保留会话、记忆、任务恢复、工具调用和安全限制；网页只发布股票研究、选股、组合风险、交易验证及其必要的检索/计算能力。文件整理、个人助理、社交渠道等非金融 Skill 不进入此目录。"} /></p>
          </div>
          <p className="rounded-[12px] border border-success/25 bg-success/5 px-4 py-3 text-xs leading-5 text-secondary-text"><UiLiteral text={"Skill 配置已接入统一工作区注册表。任务只会加载本次绑定且仍处于启用状态的 Skill，并把版本写入运行快照。"} /></p>
        </aside>
      </div>

      <section className="rounded-[14px] border border-border bg-card shadow-soft-card">
        <div className="border-b border-border/70 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary"><UiLiteral text={"工作区自定义"} /></p>
          <h2 className="mt-1 font-semibold text-foreground"><UiLiteral text={"自定义 Skill"} /></h2>
          <p className="mt-1 text-xs text-muted-text"><UiLiteral text={"把一套稳定的金融分析方法整理为名称、适用场景和执行说明，供后续发布到 Agent 能力网关。"} /></p>
        </div>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 divide-y divide-border/60 xl:border-r xl:border-border/70">
            {loading ? <p role="status" className="px-5 py-8 text-sm text-secondary-text"><UiLiteral text="正在读取 Skill…" /></p> : !loaded ? <p className="px-5 py-8 text-sm text-secondary-text"><UiLiteral text="目录尚未读取" /></p> : customSkills.length ? filtered.filter((skill) => !skill.builtIn).map((skill) => (
              <div key={skill.id} className="flex items-start gap-4 px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-primary"><Blocks className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{skill.name}</p>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-text">{uiLiteral(categoryLabels[skill.category as CustomSkillDraft["category"]] || skill.category)}</span>
                    <span className="rounded border border-success/30 bg-success/5 px-1.5 py-0.5 text-[10px] text-success">v{skill.version} <UiLiteral text={" · 已发布"} /></span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-secondary-text">{skill.description || uiLiteral("没有补充说明。")}</p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-text">{skill.instructions}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-secondary-text">
                  <input type="checkbox" checked={skill.enabled} disabled={busy} onChange={() => void updateCustomSkill(skill, !skill.enabled)} />
                  <UiLiteral text={"启用"} /></label>
                <button type="button" disabled={busy} onClick={() => setDeleteTarget(skill)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-text hover:bg-danger/10 hover:text-danger" aria-label={uiLiteral(`删除 Skill ${skill.name}`)}><Trash2 className="h-4 w-4" /></button>
              </div>
            )) : (
              <div className="px-5 py-12 text-center">
                <Blocks className="mx-auto h-7 w-7 text-muted-text" />
                <p className="mt-3 font-medium text-foreground"><UiLiteral text={"还没有自定义 Skill"} /></p>
                <p className="mt-1 text-sm text-secondary-text"><UiLiteral text={"填写方法说明，保存后即可绑定到 Agent 任务。"} /></p>
              </div>
            )}
            {loaded && customSkills.length > 0 && !filtered.some((skill) => !skill.builtIn) && <p className="px-5 py-10 text-center text-sm text-muted-text"><UiLiteral text="没有匹配的 Skill。" /></p>}
          </div>

          <form onSubmit={addCustomSkill} onChange={() => setCustomSaved(false)} className="bg-background/45 p-5">
            <fieldset disabled={busy || !loaded}>
            <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><h3 className="font-semibold text-foreground"><UiLiteral text={"新建通用 Skill"} /></h3></div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-foreground"><UiLiteral text={"名称"} /><input aria-label={uiLiteral("自定义 Skill 名称")} value={customForm.name} onChange={(event) => setCustomForm({ ...customForm, name: event.target.value })} placeholder={uiLiteral("例如：财报质量复核")} className="mt-2 h-11 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary" /></label>
              <label className="block text-sm font-medium text-foreground"><UiLiteral text={"适用场景"} /><select aria-label={uiLiteral("自定义 Skill 场景")} value={customForm.category} onChange={(event) => setCustomForm({ ...customForm, category: event.target.value as CustomSkillDraft["category"] })} className="mt-2 h-11 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{uiLiteral(label)}</option>)}</select></label>
              <label className="block text-sm font-medium text-foreground"><UiLiteral text={"简要说明"} /><input aria-label={uiLiteral("自定义 Skill 说明")} value={customForm.description} onChange={(event) => setCustomForm({ ...customForm, description: event.target.value })} placeholder={uiLiteral("说明它解决什么问题")} className="mt-2 h-11 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary" /></label>
              <label className="block text-sm font-medium text-foreground"><UiLiteral text={"执行说明"} /><textarea aria-label={uiLiteral("自定义 Skill 执行说明")} value={customForm.instructions} onChange={(event) => setCustomForm({ ...customForm, instructions: event.target.value })} placeholder={uiLiteral("写明输入、分析步骤、输出结构和限制条件")} rows={5} className="mt-2 w-full resize-y rounded-[9px] border border-border bg-card px-3 py-2 text-sm leading-6 outline-none focus:border-primary" /></label>
            </div>
            <button type="submit" disabled={!loaded || busy || !customForm.name.trim() || !customForm.instructions.trim()} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45"><Save className="h-4 w-4" /><UiLiteral text={busy ? '正在保存…' : '发布工作区 Skill'} /></button>
            {customSaved ? <p role="status" className="mt-3 text-xs text-success"><UiLiteral text={"自定义 Skill 已保存到后端工作区。"} /></p> : null}
            </fieldset>
          </form>
        </div>
      </section>
      <ConfirmDialog isOpen={deleteTarget !== null} title={uiLiteral('删除自定义 Skill')} message={uiLiteral(`删除「${deleteTarget?.name ?? ''}」后，将无法用于新任务。已有运行记录保留。`)} confirmText={uiLiteral('删除')} isDanger confirmDisabled={busy} cancelDisabled={busy} onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) void deleteCustomSkill(deleteTarget); }} />
    </AppPage>
  );
}
