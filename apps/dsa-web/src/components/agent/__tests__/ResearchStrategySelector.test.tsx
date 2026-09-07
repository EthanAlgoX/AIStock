import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResearchStrategySelector, { StrategySkillPicker, type ResearchStrategyOption } from "../ResearchStrategySelector";
import { workspaceCatalogFixture } from "../../../testWorkspaceFixtures";

const options = [
  { id: 1, name: "综合研究", currentPublishedVersionId: 12, currentPublishedVersionNumber: 1, fixedSkillIds: [], market: "cn" },
  { id: 2, name: "成长质量", description: "关注盈利与成长", currentPublishedVersionId: 14, currentPublishedVersionNumber: 1, fixedSkillIds: ["quality"], market: "cn" },
] as ResearchStrategyOption[];

describe("ResearchStrategySelector", () => {
  const props = {
    label: "研究策略", options, versionId: "14", custom: false, onChange: vi.fn(),
    skills: workspaceCatalogFixture.skills, selectedSkillIds: ["trend"], onToggleSkill: vi.fn(),
    loading: false, skillsLoading: false, skillsError: "",
  };

  it("shows the preset method read-only and maps custom mode to a compatible unfixed version", () => {
    render(<ResearchStrategySelector {...props} />);
    expect(screen.getByText("包含 Skill：盈利质量")).toBeVisible();
    expect(screen.queryByRole("button", { name: /趋势分析/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "研究策略" }));
    fireEvent.click(screen.getByRole("radio", { name: "自定义组合 · 自选 Skill" }));
    expect(props.onChange).toHaveBeenCalledWith("12", true);
  });

  it("exposes custom choices only in custom mode and preserves the selection callback", () => {
    const { rerender } = render(<ResearchStrategySelector {...props} versionId="12" custom />);
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    expect(screen.getByRole("checkbox", { name: /^趋势分析/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /^盈利质量/ }));
    expect(props.onToggleSkill).toHaveBeenCalledWith("quality");
    rerender(<ResearchStrategySelector {...props} />);
    expect(screen.queryByRole("group", { name: "组合策略 Skill" })).not.toBeInTheDocument();
  });

  it("does not offer custom mode without a compatible base and blocks loading selection", () => {
    render(<ResearchStrategySelector {...props} options={[options[1]]} loading />);
    expect(screen.getByRole("button", { name: "研究策略" })).toBeDisabled();
    expect(screen.queryByRole("option", { name: /自定义组合/ })).not.toBeInTheDocument();
  });

  it("enforces the three Skill limit while allowing deselection", () => {
    const skills = ["one", "two", "three", "four"].map((id) => ({ ...workspaceCatalogFixture.skills[0], id, name: id }));
    render(<StrategySkillPicker skills={skills} selectedIds={["one", "two", "three"]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "策略 Skill" }));
    expect(screen.getByRole("checkbox", { name: /^four/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^one/ })).toBeEnabled();
  });
});
