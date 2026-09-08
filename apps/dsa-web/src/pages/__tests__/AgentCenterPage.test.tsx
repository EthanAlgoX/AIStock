import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture } from "../../testWorkspaceFixtures";
import AgentCenterPage from "../AgentCenterPage";

const api = vi.hoisted(() => ({
  listExperts: vi.fn(),
  listExpertTeams: vi.fn(),
  updateExpert: vi.fn(),
  createExpert: vi.fn(),
  deleteExpert: vi.fn(),
  createExpertTeam: vi.fn(),
  deleteExpertTeam: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

describe("ExpertSettingsPage", () => {
  let experts = structuredClone(workspaceCatalogFixture.experts);

  beforeEach(() => {
    vi.clearAllMocks();
    experts = structuredClone(workspaceCatalogFixture.experts);
    api.listExperts.mockImplementation(async () => experts);
    api.listExpertTeams.mockResolvedValue(workspaceCatalogFixture.expertTeams);
    api.updateExpert.mockImplementation(async (id: number, value: { prompt?: string }) => {
      experts = experts.map((expert) => expert.id === id
        ? { ...expert, ...value, version: expert.version + 1 }
        : expert);
      return experts.find((expert) => expert.id === id);
    });
    api.createExpert.mockImplementation(async (value: { name: string; style: string; prompt: string }) => {
      const created = { ...workspaceCatalogFixture.experts[0], ...value, id: 1, builtIn: false };
      experts = [...experts, created];
      return created;
    });
  });

  it("presents current Persona experts without legacy AgentTemplate records", async () => {
    render(<MemoryRouter><AgentCenterPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "专家配置" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "沃伦·巴菲特" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "查理·芒格" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "段永平" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "凯西·伍德" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "张磊" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "全视角个股委员会" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加专家团" })).not.toBeInTheDocument();
    expect(screen.queryByText("工作区自定义能力")).not.toBeInTheDocument();
    expect(screen.queryByText("StrategyVersion")).not.toBeInTheDocument();
  });

  it("shows an empty state only for custom experts", async () => {
    render(<MemoryRouter><AgentCenterPage /></MemoryRouter>);
    expect(await screen.findByText(/暂无自定义专家/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "沃伦·巴菲特" })).toBeInTheDocument();
  });

  it("publishes a customized expert Prompt as a new backend version", async () => {
    render(<MemoryRouter><AgentCenterPage /></MemoryRouter>);
    const expertRow = (await screen.findByRole("heading", { name: "沃伦·巴菲特" })).closest("article");
    expect(expertRow).not.toBeNull();
    fireEvent.click(within(expertRow!).getByRole("button", { name: /配置 Prompt/ }));
    const prompt = within(expertRow!).getByRole("textbox", { name: "沃伦·巴菲特 System Prompt" });
    fireEvent.change(prompt, { target: { value: "只使用公开证据，重点检查护城河与安全边际。" } });
    fireEvent.click(within(expertRow!).getByRole("button", { name: /保存 Prompt/ }));

    await waitFor(() => expect(api.updateExpert).toHaveBeenCalledWith(-1001, {
      prompt: "只使用公开证据，重点检查护城河与安全边际。",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Prompt 已发布为新版本");
  });

  it("creates a workspace expert that can be mounted by other Agent pages", async () => {
    render(<MemoryRouter><AgentCenterPage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "沃伦·巴菲特" });
    fireEvent.click(screen.getByRole("button", { name: "添加专家" }));
    fireEvent.change(screen.getByLabelText("自定义专家名称"), { target: { value: "现金流审查员" } });
    fireEvent.change(screen.getByLabelText("自定义专家投资风格"), { target: { value: "现金流与会计质量" } });
    fireEvent.change(screen.getByLabelText("自定义专家 System Prompt"), { target: { value: "只使用可追溯财务证据，并主动寻找反证。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存专家" }));

    expect(await screen.findByRole("heading", { name: "现金流审查员" })).toBeInTheDocument();
    expect(api.createExpert).toHaveBeenCalledWith(expect.objectContaining({ name: "现金流审查员", avatar: null }));
    expect(screen.getByRole("status")).toHaveTextContent("已保存到工作区");
    fireEvent.click(screen.getByText('设置头像'));
    fireEvent.click(screen.getByRole('button', { name: '使用默认头像' }));
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }));
    await waitFor(() => expect(api.updateExpert).toHaveBeenCalledWith(1, { avatar: null }));
  });
});
