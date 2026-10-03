import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceCatalogFixture } from '../../testWorkspaceFixtures';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { CapabilityCenterNav } from '../../components/capability/CapabilityCenterNav';
import CapabilityOverviewPage from '../CapabilityOverviewPage';
import ToolSettingsPage from '../ToolSettingsPage';
import SkillSettingsPage from '../SkillSettingsPage';
import McpSettingsPage from '../McpSettingsPage';
import AgentCenterPage from '../AgentCenterPage';

const api = vi.hoisted(() => ({
  getCapabilities: vi.fn(), listTools: vi.fn(), listSkills: vi.fn(), listMcpServers: vi.fn(), listExperts: vi.fn(),
  setPreferences: vi.fn(), createSkill: vi.fn(), updateSkill: vi.fn(), deleteSkill: vi.fn(),
  createMcpServer: vi.fn(), updateMcpServer: vi.fn(), deleteMcpServer: vi.fn(), probeMcpServer: vi.fn(),
  createExpert: vi.fn(), updateExpert: vi.fn(), deleteExpert: vi.fn(),
}));
vi.mock('../../api/workspace', () => ({ workspaceApi: api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const customSkill = { ...workspaceCatalogFixture.skills[0], id: 'custom-cash', name: '现金流复核', builtIn: false, instructions: '核对现金流。' };
const connection = { id: 'news-mcp', name: '公告连接', transport: 'http' as const, location: 'https://example.com/mcp', credentialKey: '', enabled: true, selectable: false, healthStatus: 'not_tested', capabilities: [] };
const customExpert = { ...workspaceCatalogFixture.experts[0], id: 12, name: '现金流专家', builtIn: false };
function show(page: React.ReactNode) { return render(<MemoryRouter><UiLanguageProvider>{page}</UiLanguageProvider></MemoryRouter>); }

beforeEach(() => {
  vi.resetAllMocks();
  api.getCapabilities.mockResolvedValue(workspaceCatalogFixture);
  api.listTools.mockResolvedValue(workspaceCatalogFixture.tools);
  api.listSkills.mockResolvedValue([...workspaceCatalogFixture.skills, customSkill]);
  api.listMcpServers.mockResolvedValue([connection]);
  api.listExperts.mockResolvedValue([...workspaceCatalogFixture.experts, customExpert]);
});
afterEach(cleanup);

describe('Capability read and write states', () => {
  it('does not turn an unresolved or failed catalog into zero enabled capabilities, and retries the real read', async () => {
    const read = deferred<typeof workspaceCatalogFixture>();
    api.getCapabilities.mockReturnValueOnce(read.promise);
    show(<CapabilityOverviewPage />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取能力目录');
    expect(screen.queryByText(/当前可见/)).not.toBeInTheDocument();
    expect(screen.queryByText('已接入能力网关')).not.toBeInTheDocument();
    await act(async () => read.reject(new Error('connection interrupted')));
    expect(screen.getByRole('alert')).toHaveTextContent('目录暂时不可用');
    expect(screen.queryByText(/当前可见/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText(/当前可见/);
    expect(api.getCapabilities).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: /MCP 服务.*0 已启用/ })).toBeInTheDocument();
  });

  it('cannot clear the tool allowlist while its read is pending or failed, and protects a dirty save until acknowledged', async () => {
    const read = deferred<typeof workspaceCatalogFixture.tools>();
    const write = deferred<void>();
    api.listTools.mockReturnValueOnce(read.promise);
    api.setPreferences.mockReturnValueOnce(write.promise);
    show(<ToolSettingsPage />);
    const save = screen.getByRole('button', { name: '保存工具白名单' });
    expect(save).toBeDisabled(); fireEvent.click(save);
    await act(async () => read.reject(new Error('offline')));
    expect(save).toBeDisabled(); fireEvent.click(save);
    expect(api.setPreferences).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    const checkbox = await screen.findByRole('checkbox');
    expect(save).toBeDisabled();
    fireEvent.click(checkbox); fireEvent.click(save);
    expect(api.setPreferences).toHaveBeenCalledWith('tool', []);
    expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));
    expect(api.setPreferences).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve());
    expect(screen.getByRole('button', { name: '保存工具白名单' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('已保存到后端');
  });

  it('filters custom skills consistently and prevents repeated creation while the API is pending', async () => {
    const write = deferred<void>();
    api.listSkills.mockResolvedValue([...workspaceCatalogFixture.skills, customSkill, { ...customSkill, id: 'custom-risk', name: '风险复核' }]);
    api.createSkill.mockReturnValueOnce(write.promise);
    show(<SkillSettingsPage />);
    await screen.findByText('现金流复核');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索 Skill' }), { target: { value: '现金流复核' } });
    expect(screen.queryByText('风险复核')).not.toBeInTheDocument();
    expect(screen.getByText('没有匹配的 Skill。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('自定义 Skill 名称'), { target: { value: '财报方法' } });
    fireEvent.change(screen.getByLabelText('自定义 Skill 执行说明'), { target: { value: '核对财报证据。' } });
    const publish = screen.getByRole('button', { name: '发布工作区 Skill' });
    fireEvent.click(publish); fireEvent.click(publish);
    expect(api.createSkill).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('自定义 Skill 名称')).toBeDisabled();
    await act(async () => write.resolve());
    expect(screen.getByRole('button', { name: '发布工作区 Skill' })).toBeDisabled();
  });

  it.each([
    ['Skill', SkillSettingsPage, api.listSkills, '无法读取当前 Agent 的 Skill 目录。', /还没有自定义 Skill/],
    ['MCP', McpSettingsPage, api.listMcpServers, 'MCP Server 列表读取失败，请稍后重试。', /还没有 MCP Server/],
    ['experts', AgentCenterPage, api.listExperts, '专家目录读取失败，请稍后重试。', /暂无自定义专家/],
  ] as const)('%s catalog errors remain errors and can be retried without navigating away', async (_name, Page, list, error, emptyState) => {
    list.mockRejectedValueOnce(new Error('offline'));
    show(<Page />);
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByText(emptyState)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Skill', SkillSettingsPage, '删除 Skill 现金流复核', api.deleteSkill, customSkill.id],
    ['MCP', McpSettingsPage, '删除 MCP 公告连接', api.deleteMcpServer, connection.id],
    ['expert', AgentCenterPage, '删除自定义专家 现金流专家', api.deleteExpert, customExpert.id],
  ] as const)('requires an object-specific %s confirmation and protects the in-flight deletion', async (_kind, Page, buttonName, remove, id) => {
    const write = deferred<void>(); remove.mockReturnValueOnce(write.promise);
    if (_kind === 'Skill') api.listSkills.mockResolvedValueOnce([...workspaceCatalogFixture.skills, customSkill]).mockResolvedValueOnce(workspaceCatalogFixture.skills);
    if (_kind === 'MCP') api.listMcpServers.mockResolvedValueOnce([connection]).mockResolvedValueOnce([]);
    if (_kind === 'expert') api.listExperts.mockResolvedValueOnce([...workspaceCatalogFixture.experts, customExpert]).mockResolvedValueOnce(workspaceCatalogFixture.experts);
    show(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: buttonName }));
    expect(remove).not.toHaveBeenCalled();
    const firstDialog = screen.getByRole('dialog');
    expect(firstDialog).toHaveTextContent(buttonName.replace(/^删除(?:自定义专家| MCP| Skill)? /, ''));
    fireEvent.click(within(firstDialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(remove).toHaveBeenCalledWith(id);
    expect(within(dialog).getByRole('button', { name: '删除' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: buttonName })).not.toBeInTheDocument();
  });

  it.each(['en', 'ja', 'ko', 'zh-TW'] as const)('localizes the capability navigation in %s', (language) => {
    localStorage.setItem('dsa.uiLanguage', language);
    show(<CapabilityCenterNav />);
    for (const label of ['总览', '内置工具', 'MCP 服务', '数据源', '专家配置']) {
      if (language !== 'zh-TW' || !['总览', '内置工具'].includes(label)) expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });
});
