import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentCapabilityPanel from "../AgentCapabilityPanel";
import { workspaceCatalogFixture } from "../../../testWorkspaceFixtures";

const apiMocks = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
}));

vi.mock("../../../api/workspace", () => ({
  workspaceApi: apiMocks,
}));

describe("AgentCapabilityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
  });

  const inlineProps = {
    presentation: "inline" as const,
    skills: [{ id: "quality", name: "盈利质量", description: "检查现金流与利润" }],
    selectedSkillIds: [], onToggleSkill: vi.fn(), skillLimitReached: false,
    selectedToolIds: [], onToggleTool: vi.fn(),
    selectedDataSourceIds: [], onToggleDataSource: vi.fn(),
    selectedMcpIds: [], onToggleMcp: vi.fn(),
    selectedExpertIds: [], onToggleExpert: vi.fn(),
    selectedExpertTeamIds: [], onToggleExpertTeam: vi.fn(),
  };

  it("summarizes choices and opens searchable lists on demand", async () => {
    render(<MemoryRouter><AgentCapabilityPanel {...inlineProps} /></MemoryRouter>);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^盈利质量/ }));
    expect(inlineProps.onToggleSkill).toHaveBeenCalledWith("quality");
    await waitFor(() => expect(screen.getByRole("button", { name: "专家" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "专家" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /^沃伦·巴菲特/ }));
    expect(inlineProps.onToggleExpert).toHaveBeenCalledWith(-1001);
    expect(screen.queryByRole("button", { name: "专家团" })).not.toBeInTheDocument();
    expect(inlineProps.onToggleExpertTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /内置工具/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides duplicate skills when the task owns its strategy selector", async () => {
    render(<MemoryRouter><AgentCapabilityPanel {...inlineProps} showSkills={false} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Skills/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^盈利质量/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "专家" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "专家" }));
    expect(await screen.findByRole("checkbox", { name: /^沃伦·巴菲特/ })).toBeVisible();
  });

  it("expands legacy membership and converts an edit into explicit expert selection", async () => {
    render(<MemoryRouter><AgentCapabilityPanel {...inlineProps} selectedExpertTeamIds={[-2001]} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "专家" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "专家" }));
    const member = screen.getByRole("checkbox", { name: /^沃伦·巴菲特/ });
    expect(member).toBeChecked();
    fireEvent.click(member);
    expect(inlineProps.onToggleExpertTeam).toHaveBeenCalledWith(-2001);
    expect(inlineProps.onToggleExpert).not.toHaveBeenCalledWith(-1001);
    expect(inlineProps.onToggleExpert).toHaveBeenCalledWith(-1002);
  });

  it("retries the capability catalog without closing inline configuration", async () => {
    apiMocks.getCapabilities.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter><AgentCapabilityPanel {...inlineProps} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "重试读取" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "专家" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "专家" }));
    expect(await screen.findByRole("checkbox", { name: /^沃伦·巴菲特/ })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows registered capability categories and keeps MCP state honest", async () => {
    const onToggleSkill = vi.fn();
    const onToggleTool = vi.fn();
    const onToggleExpert = vi.fn();
    const onToggleExpertTeam = vi.fn();
    render(
      <MemoryRouter>
        <AgentCapabilityPanel
          skills={[{ id: "quality", name: "盈利质量", description: "检查现金流与利润" }]}
          selectedSkillIds={[]}
          onToggleSkill={onToggleSkill}
          skillLimitReached={false}
          selectedToolIds={[]}
          onToggleTool={onToggleTool}
          selectedDataSourceIds={[]}
          onToggleDataSource={vi.fn()}
          selectedMcpIds={[]}
          onToggleMcp={vi.fn()}
          selectedExpertIds={[]}
          onToggleExpert={onToggleExpert}
          selectedExpertTeamIds={[]}
          onToggleExpertTeam={onToggleExpertTeam}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "本次会话能力" })).toBeInTheDocument();
    const dataSection = await screen.findByRole("button", { name: /数据源/ });
    fireEvent.click(dataSection);
    expect(await screen.findByRole("button", { name: /行情数据/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^专家\d/ }));
    expect(screen.getByRole("button", { name: /^沃伦·巴菲特/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /基本面专家/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^沃伦·巴菲特/ }));
    expect(onToggleExpert).toHaveBeenCalledWith(-1001);
    expect(screen.queryByRole("button", { name: /专家团/ })).not.toBeInTheDocument();
    expect(onToggleExpertTeam).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /MCP/ }));
    expect(screen.getByText(/还没有启用的 MCP 连接/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /内置工具/ }));
    expect(screen.getAllByText("已接通").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /实时行情/ }));
    expect(onToggleTool).toHaveBeenCalledWith("get_realtime_quote");

    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    fireEvent.click(screen.getByRole("button", { name: /^盈利质量/ }));
    expect(onToggleSkill).toHaveBeenCalledWith("quality");
    expect(screen.getByText(/工作区注册表/)).toBeInTheDocument();
  });
});
