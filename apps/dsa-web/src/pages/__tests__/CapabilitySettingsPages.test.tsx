import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCatalogFixture } from "../../testWorkspaceFixtures";
import McpSettingsPage from "../McpSettingsPage";
import SkillSettingsPage from "../SkillSettingsPage";
import ToolSettingsPage from "../ToolSettingsPage";

const api = vi.hoisted(() => ({
  listSkills: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listTools: vi.fn(),
  setPreferences: vi.fn(),
  listMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  probeMcpServer: vi.fn(),
}));

vi.mock("../../api/workspace", () => ({ workspaceApi: api }));

describe("capability configuration pages", () => {
  let skills = structuredClone(workspaceCatalogFixture.skills);
  let mcpServers = structuredClone(workspaceCatalogFixture.mcpServers);

  beforeEach(() => {
    vi.clearAllMocks();
    skills = structuredClone(workspaceCatalogFixture.skills);
    mcpServers = [];
    api.listSkills.mockImplementation(async () => skills);
    api.listTools.mockResolvedValue(workspaceCatalogFixture.tools);
    api.listMcpServers.mockImplementation(async () => mcpServers);
    api.setPreferences.mockResolvedValue({});
    api.createSkill.mockImplementation(async (value: { name: string; description: string; category: string; instructions: string; enabled: boolean }) => {
      const created = { id: "custom-1", version: 1, builtIn: false, ...value };
      skills = [...skills, created];
      return created;
    });
    api.createMcpServer.mockImplementation(async (value: { name: string; transport: "http" | "stdio"; location: string; credentialKey: string }) => {
      const created = { id: "mcp-1", enabled: true, selectable: false, healthStatus: "unknown", capabilities: [], ...value };
      mcpServers = [...mcpServers, created];
      return created;
    });
  });

  it("persists the enabled Skill allowlist in the workspace registry", async () => {
    render(<MemoryRouter><SkillSettingsPage /></MemoryRouter>);
    const trend = await screen.findByRole("checkbox", { name: /趋势分析/ });
    fireEvent.click(trend);
    fireEvent.click(screen.getByRole("button", { name: "保存 Skill 配置" }));
    await waitFor(() => expect(api.setPreferences).toHaveBeenCalledWith("skill", ["quality"]));
  });

  it("registers an MCP connection by credential key without sending a secret value", async () => {
    render(<MemoryRouter><McpSettingsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("MCP 名称"), { target: { value: "公告检索" } });
    fireEvent.change(screen.getByLabelText("MCP 连接地址"), { target: { value: "https://mcp.example.com" } });
    fireEvent.change(screen.getByLabelText("MCP 凭据配置键"), { target: { value: "MCP_NEWS_TOKEN" } });
    fireEvent.click(screen.getByRole("button", { name: "保存工作区连接" }));
    await waitFor(() => expect(api.createMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      name: "公告检索",
      credentialKey: "MCP_NEWS_TOKEN",
    })));
    expect(JSON.stringify(api.createMcpServer.mock.calls)).not.toContain("secret-value");
  });

  it("keeps the financial Tool allowlist separate from MCP connections", async () => {
    render(<MemoryRouter><ToolSettingsPage /></MemoryRouter>);
    const realtimeTool = await screen.findByRole("checkbox", { name: "实时行情 工具" });
    fireEvent.click(realtimeTool);
    fireEvent.click(screen.getByRole("button", { name: "保存工具白名单" }));
    await waitFor(() => expect(api.setPreferences).toHaveBeenCalledWith("tool", []));
    expect(api.createMcpServer).not.toHaveBeenCalled();
    expect(screen.getByText(/Tool 是 Agent 可直接执行的函数/)).toBeInTheDocument();
  });

  it("creates and reloads a workspace-defined Skill", async () => {
    render(<MemoryRouter><SkillSettingsPage /></MemoryRouter>);
    await screen.findByText("盈利质量");
    fireEvent.change(screen.getByLabelText("自定义 Skill 名称"), { target: { value: "财报质量复核" } });
    fireEvent.change(screen.getByLabelText("自定义 Skill 执行说明"), { target: { value: "先核对现金流，再输出事实、推断和风险。" } });
    fireEvent.click(screen.getByRole("button", { name: "发布工作区 Skill" }));
    expect(await screen.findByText("财报质量复核")).toBeInTheDocument();
    expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "财报质量复核" }));
  });

  it("uses a built-in MCP template as a safe starting point", async () => {
    render(<MemoryRouter><McpSettingsPage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "公告与监管披露" });
    const template = screen.getByRole("heading", { name: "公告与监管披露" }).closest("article");
    fireEvent.click(template!.querySelector("button")!);
    expect(screen.getByLabelText("MCP 名称")).toHaveValue("公告与监管披露");
    expect(screen.getByLabelText("MCP 凭据配置键")).toHaveValue("REGULATORY_FILINGS_API_KEY");
    expect(screen.getByRole("button", { name: "保存工作区连接" })).toBeDisabled();
  });
});
