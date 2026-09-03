import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Blocks, CheckCircle2, CircleAlert, LoaderCircle, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { workspaceApi, type WorkspaceSkill } from "../api/workspace";
import { AppPage, PageHeader } from "../components/common";
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
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customForm, setCustomForm] = useState<CustomSkillForm>(emptyCustomSkill);
  const [customSaved, setCustomSaved] = useState(false);

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
      })
      .catch(() => active && setError("无法读取当前 Agent 的 Skill 目录。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

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
    setError("");
    try {
      await workspaceApi.setPreferences("skill", enabledIds);
      setSavedIds(enabledIds);
      setSaved(true);
    } catch {
      setError("Skill 白名单保存失败，请稍后重试。");
    }
  };

  const addCustomSkill = async (event: FormEvent) => {
    event.preventDefault();
    if (!customForm.name.trim() || !customForm.instructions.trim()) return;
    setError("");
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
    }
  };

  const customSkills = skills.filter((skill) => !skill.builtIn);

  const updateCustomSkill = async (skill: WorkspaceSkill, enabled: boolean) => {
    setError("");
    try {
      await workspaceApi.updateSkill(skill.id, { enabled });
      await loadSkills();
    } catch {
      setError("自定义 Skill 状态更新失败。");
    }
  };

  const deleteCustomSkill = async (skill: WorkspaceSkill) => {
    setError("");
    try {
      await workspaceApi.deleteSkill(skill.id);
      await loadSkills();
    } catch {
      setError("自定义 Skill 删除失败。");
    }
  };

  return (
    <AppPage className="space-y-6 pb-20" data-testid="skill-settings-page">
      <PageHeader
        eyebrow="Capability registry"
        title="Skill"
        description="管理 Agent 的可复用工作方法。平台预置金融 Skill 可直接启用，也可以在工作区编写自己的通用金融 Skill。"
        actions={<Link to="/overview" className="btn-primary">返回主 Agent</Link>}
      />
      <CapabilityCenterNav />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-soft-card">
          <div className="border-b border-border/70 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">平台预置</p>
            <h2 className="mt-1 font-semibold text-foreground">金融 Skill 目录</h2>
            <p className="mt-1 text-xs text-muted-text">由后端发布并经过治理的研究、选股、风控和交易工作方法。</p>
          </div>
          <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-text" aria-hidden="true" />
              <input aria-label="搜索 Skill" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、ID 或说明" className="h-10 w-full rounded-[9px] border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEnabledIds(skills.map((skill) => skill.id))}>启用金融目录</button>
              <button type="button" className="btn-secondary" onClick={() => setEnabledIds([])}>全部停用</button>
            </div>
          </div>

          {loading ? <p className="flex items-center gap-2 px-5 py-8 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取 Skill…</p> : null}
          {error ? <p role="alert" className="flex items-center gap-2 px-5 py-8 text-sm text-danger"><CircleAlert className="h-4 w-4" />{error}</p> : null}
          {!loading && !error ? (
            <div className="divide-y divide-border/60">
              {filtered.filter((skill) => skill.builtIn).map((skill) => {
                const enabled = enabledIds.includes(skill.id);
                return (
                  <label key={skill.id} className="flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-hover/35">
                    <input type="checkbox" checked={enabled} onChange={() => toggle(skill.id)} className="mt-1 chat-skill-checkbox" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{skill.name}</span>
                        <code className="text-[11px] text-muted-text">{skill.id}</code>
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-secondary-text">{skill.description || "没有说明。"}</span>
                    </span>
                    <span className={enabled ? "text-xs font-medium text-success" : "text-xs text-muted-text"}>{enabled ? "可供 Agent 使用" : "已停用"}</span>
                  </label>
                );
              })}
              {!filtered.length ? <p className="px-5 py-10 text-center text-sm text-muted-text">没有匹配的 Skill。</p> : null}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-[14px] border border-border bg-background p-5">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold text-foreground">工作区启用清单</h2></div>
            <p className="mt-3 text-sm leading-6 text-secondary-text">已启用 {enabledIds.length} / {skills.length}。白名单保存在后端能力注册表，并在任务创建时再次冻结。</p>
            <button type="button" onClick={() => void save()} disabled={!dirty} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45"><Save className="h-4 w-4" />保存 Skill 配置</button>
            {saved ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />已保存到工作区能力注册表。</p> : null}
          </div>
          <div className="rounded-[12px] border border-border bg-background px-4 py-4">
            <p className="text-xs font-semibold text-foreground">金融能力治理</p>
            <p className="mt-2 text-xs leading-5 text-secondary-text">底层完整 Agent 仍保留会话、记忆、任务恢复、工具调用和安全限制；网页只发布股票研究、选股、组合风险、交易验证及其必要的检索/计算能力。文件整理、个人助理、社交渠道等非金融 Skill 不进入此目录。</p>
          </div>
          <p className="rounded-[12px] border border-success/25 bg-success/5 px-4 py-3 text-xs leading-5 text-secondary-text">Skill 配置已接入统一工作区注册表。任务只会加载本次绑定且仍处于启用状态的 Skill，并把版本写入运行快照。</p>
        </aside>
      </div>

      <section className="rounded-[14px] border border-border bg-card shadow-soft-card">
        <div className="border-b border-border/70 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">工作区自定义</p>
          <h2 className="mt-1 font-semibold text-foreground">自定义 Skill</h2>
          <p className="mt-1 text-xs text-muted-text">把一套稳定的金融分析方法整理为名称、适用场景和执行说明，供后续发布到 Agent 能力网关。</p>
        </div>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 divide-y divide-border/60 xl:border-r xl:border-border/70">
            {customSkills.length ? customSkills.map((skill) => (
              <div key={skill.id} className="flex items-start gap-4 px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-primary"><Blocks className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{skill.name}</p>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-text">{categoryLabels[skill.category as CustomSkillDraft["category"]]}</span>
                    <span className="rounded border border-success/30 bg-success/5 px-1.5 py-0.5 text-[10px] text-success">v{skill.version} · 已发布</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-secondary-text">{skill.description || "没有补充说明。"}</p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-text">{skill.instructions}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-secondary-text">
                  <input type="checkbox" checked={skill.enabled} onChange={() => void updateCustomSkill(skill, !skill.enabled)} />
                  启用
                </label>
                <button type="button" onClick={() => void deleteCustomSkill(skill)} className="rounded-md p-2 text-muted-text hover:bg-danger/10 hover:text-danger" aria-label={`删除 Skill ${skill.name}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            )) : (
              <div className="px-5 py-12 text-center">
                <Blocks className="mx-auto h-7 w-7 text-muted-text" />
                <p className="mt-3 font-medium text-foreground">还没有自定义 Skill</p>
                <p className="mt-1 text-sm text-secondary-text">右侧填写方法说明，保存后即可绑定到 Agent 任务。</p>
              </div>
            )}
          </div>

          <form onSubmit={addCustomSkill} className="bg-background/45 p-5">
            <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><h3 className="font-semibold text-foreground">新建通用 Skill</h3></div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-foreground">名称<input aria-label="自定义 Skill 名称" value={customForm.name} onChange={(event) => setCustomForm({ ...customForm, name: event.target.value })} placeholder="例如：财报质量复核" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary" /></label>
              <label className="block text-sm font-medium text-foreground">适用场景<select aria-label="自定义 Skill 场景" value={customForm.category} onChange={(event) => setCustomForm({ ...customForm, category: event.target.value as CustomSkillDraft["category"] })} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="block text-sm font-medium text-foreground">简要说明<input aria-label="自定义 Skill 说明" value={customForm.description} onChange={(event) => setCustomForm({ ...customForm, description: event.target.value })} placeholder="说明它解决什么问题" className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 outline-none focus:border-primary" /></label>
              <label className="block text-sm font-medium text-foreground">执行说明<textarea aria-label="自定义 Skill 执行说明" value={customForm.instructions} onChange={(event) => setCustomForm({ ...customForm, instructions: event.target.value })} placeholder="写明输入、分析步骤、输出结构和限制条件" rows={5} className="mt-2 w-full resize-y rounded-[9px] border border-border bg-card px-3 py-2 text-sm leading-6 outline-none focus:border-primary" /></label>
            </div>
            <button type="submit" disabled={!customForm.name.trim() || !customForm.instructions.trim()} className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 disabled:opacity-45"><Save className="h-4 w-4" />发布工作区 Skill</button>
            {customSaved ? <p role="status" className="mt-3 text-xs text-success">自定义 Skill 已保存到后端工作区。</p> : null}
          </form>
        </div>
      </section>
    </AppPage>
  );
}
