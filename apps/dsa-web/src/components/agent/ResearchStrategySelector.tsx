import type { WorkspaceSkill } from "../../api/workspace";
import type { StrategySummary } from "../../api/strategyWorkspace";
import ChoiceList from "../common/ChoiceList";

export type ResearchStrategyOption = StrategySummary & { market: string; fixedSkillIds: string[] };

export function StrategySkillPicker({ skills, selectedIds, onToggle, loading, error }: {
  skills: WorkspaceSkill[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  loading?: boolean;
  error?: string;
}) {
  return <div className="mt-3" role="group" aria-label="组合策略 Skill">
    <ChoiceList label="策略 Skill" multiple limit={3} items={skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, badge: skill.builtIn ? "内置 Skill" : "自定义 Prompt" }))}
      selectedIds={selectedIds} onSelect={onToggle} loading={loading} error={error}
      placeholder="选择研究方法" emptyText="暂无可用 Skill，请前往能力中心配置。" />
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
    <ChoiceList label={label} selectedIds={custom ? ["custom"] : versionId ? [versionId] : []}
      items={[...options.map((item) => ({ id: String(item.currentPublishedVersionId), name: item.name, description: item.description, badge: `v${item.currentPublishedVersionNumber}` })),
        ...(customizable ? [{ id: "custom", name: "自定义组合 · 自选 Skill", description: "自由组合研究方法，仍生成完整报告", badge: "自定义" }] : [])]}
      loading={loading} disabled={!options.length} placeholder="当前市场暂无可用研究策略"
      onSelect={(value) => { if (value === "custom" && customizable) onChange(String(customizable.currentPublishedVersionId), true); else onChange(value, false); }} />
    {selected && <div className="text-sm leading-6">
      <p className="text-secondary-text">{custom ? `基于「${selected.name}」生成完整报告，仅自定义研究方法，不另建执行流程。` : selected.description || "按已发布策略生成完整研究报告。"}</p>
      {!custom && <p className="mt-2 text-foreground">{selected.fixedSkillIds.length ? `包含 Skill：${selected.fixedSkillIds.map((id) => skills.find((skill) => skill.id === id)?.name || id).join("、")}` : "综合研究：使用策略默认分析方法，不额外挂载自选 Skill。"}</p>}
      <p className="mt-1 text-secondary-text">{custom ? "内置 Skill 可参与正式单股报告；自定义 Prompt 用于 Agent 补充研究，不改变底层取数。选择与策略版本一起随任务保存。" : "策略已确定研究方法，无需重复选择 Skill。"}</p>
    </div>}
    {custom && <StrategySkillPicker skills={skills} selectedIds={selectedSkillIds} onToggle={onToggleSkill} loading={skillsLoading} error={skillsError} />}
  </div>;
}
