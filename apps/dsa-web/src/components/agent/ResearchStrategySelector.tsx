import type { WorkspaceSkill } from "../../api/workspace";
import type { StrategySummary } from "../../api/strategyWorkspace";
import { CapabilityButton } from "./AgentCapabilityPanel";

export type ResearchStrategyOption = StrategySummary & { market: string; fixedSkillIds: string[] };

export function StrategySkillPicker({ skills, selectedIds, onToggle, loading, error }: {
  skills: WorkspaceSkill[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  loading?: boolean;
  error?: string;
}) {
  return <div className="mt-3" role="group" aria-label="组合策略 Skill">
    <p className="mb-2 text-sm text-secondary-text">选择最多 3 个 Skill，组合成本次研究方法。已选 {selectedIds.length} / 3。</p>
    {loading ? <p role="status" className="text-sm text-muted-text">正在读取 Skill…</p> : error ? <p role="alert" className="text-sm text-warning">{error}</p> : skills.length ? <div className="grid gap-2 sm:grid-cols-2">
      {skills.map((skill) => <CapabilityButton key={skill.id} comfortable active={selectedIds.includes(skill.id)} disabled={!selectedIds.includes(skill.id) && selectedIds.length >= 3} title={skill.name} description={skill.description} statusLabel={skill.builtIn ? "内置 Skill" : "自定义 Prompt"} onClick={() => onToggle(skill.id)} />)}
    </div> : <p className="text-sm text-muted-text">暂无可用 Skill，请前往能力中心配置。</p>}
  </div>;
}

export default function ResearchStrategySelector({ label, options, versionId, custom, onChange, skills, selectedSkillIds, onToggleSkill, loading, skillsLoading, skillsError }: {
  label: string;
  options: ResearchStrategyOption[];
  versionId: string;
  custom: boolean;
  onChange: (versionId: string, custom: boolean) => void;
  skills: WorkspaceSkill[];
  selectedSkillIds: string[];
  onToggleSkill: (id: string) => void;
  loading: boolean;
  skillsLoading: boolean;
  skillsError: string;
}) {
  const selected = options.find((item) => String(item.currentPublishedVersionId) === versionId);
  const customizable = options.find((item) => String(item.currentPublishedVersionId) === versionId && !item.fixedSkillIds.length)
    || options.find((item) => !item.fixedSkillIds.length);
  return <div className="space-y-3">
    <label className="block text-sm font-medium text-foreground">{label}
      <select aria-label={label} value={custom ? "custom" : versionId} disabled={loading || !options.length} onChange={(event) => {
        if (event.target.value === "custom" && customizable) onChange(String(customizable.currentPublishedVersionId), true);
        else onChange(event.target.value, false);
      }} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
        {!versionId && <option value="">{loading ? "正在读取研究策略…" : "当前市场暂无可用研究策略"}</option>}
        {options.map((item) => <option key={item.id} value={item.currentPublishedVersionId!}>{item.name} · v{item.currentPublishedVersionNumber}</option>)}
        {customizable && <option value="custom">自定义组合 · 自选 Skill</option>}
      </select>
    </label>
    {selected && <div className="text-sm leading-6">
      <p className="text-secondary-text">{custom ? `基于「${selected.name}」生成完整报告，仅自定义研究方法，不另建执行流程。` : selected.description || "按已发布策略生成完整研究报告。"}</p>
      {!custom && <p className="mt-2 text-foreground">{selected.fixedSkillIds.length ? `包含 Skill：${selected.fixedSkillIds.map((id) => skills.find((skill) => skill.id === id)?.name || id).join("、")}` : "综合研究：使用策略默认分析方法，不额外挂载自选 Skill。"}</p>}
      <p className="mt-1 text-secondary-text">{custom ? "内置 Skill 可参与正式单股报告；自定义 Prompt 用于 Agent 补充研究，不改变底层取数。选择与策略版本一起随任务保存。" : "策略已确定研究方法，无需重复选择 Skill。"}</p>
    </div>}
    {custom && <StrategySkillPicker skills={skills} selectedIds={selectedSkillIds} onToggle={onToggleSkill} loading={skillsLoading} error={skillsError} />}
  </div>;
}
