import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import PlatformSettingsPage from '../PlatformSettingsPage';

const { load, save, resetDraft, setDraftValue, refreshAfterExternalSave } = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  resetDraft: vi.fn(),
  setDraftValue: vi.fn(),
  refreshAfterExternalSave: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useAuth: () => ({ passwordChangeable: false }),
  useSystemConfig: () => ({
    configVersion: 'v1',
    maskToken: '******',
    llmModelProviders: ['openai'],
    itemsByCategory: {
      ai_model: [{ key: 'LITELLM_MODEL', value: 'openai/test', schema: { category: 'ai_model' } },
        ...['TYPESAFE_API_KEY','TYPESAFE_BASE_URL','TYPESAFE_MODEL'].map(key => ({key,value:'',schema:{category:'ai_model'}}))],
      system: [
        { key: 'HTTP_PROXY', value: '', schema: { category: 'system' } },
        { key: 'SCHEDULE_ENABLED', value: 'true', schema: { category: 'system' } },
      ],
      agent: [{ key: 'AGENT_MODE', value: 'true', schema: { category: 'agent' } }],
      backtest: [{ key: 'BACKTEST_DAYS', value: '30', schema: { category: 'backtest' } }],
    },
    issueByKey: {},
    hasDirty: true,
    dirtyCount: 1,
    toast: null,
    clearToast: vi.fn(),
    isLoading: false,
    isSaving: false,
    loadError: null,
    saveError: null,
    retryAction: null,
    load,
    retry: vi.fn(),
    save,
    resetDraft,
    setDraftValue,
    getChangedItems: () => [{key:"TYPESAFE_API_KEY", value:"test-key"},{key:"HTTP_PROXY",value:"unsaved"}],
    refreshAfterExternalSave,
  }),
}));

vi.mock('../../components/settings', () => ({
  AuthSettingsCard: () => <div>认证设置</div>,
  ChangePasswordCard: () => <div>修改密码</div>,
  GenerationBackendStatusPanel: () => <div>模型后端状态</div>,
  LLMChannelEditor: () => <div>模型通道编辑器</div>,
  SettingsAlert: () => <div>设置提示</div>,
  SettingsField: ({ item }: { item: { key: string } }) => <div>{item.key}</div>,
  SettingsLoading: () => <div>读取中</div>,
  SettingsSectionCard: ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
    <section><h2>{title}</h2>{description ? <p>{description}</p> : null}{children}</section>
  ),
}));

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="settings-route">{location.pathname}{location.search}</output><button type="button" onClick={() => navigate(-1)}>返回前一个分类</button></>;
}

function renderPage(route = '/settings') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <UiLanguageProvider>
        <PlatformSettingsPage />
        <RouteControls />
      </UiLanguageProvider>
    </MemoryRouter>,
  );
}

describe('PlatformSettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  window.localStorage.setItem('dsa.uiLanguage', 'zh');
    window.localStorage.setItem('dsa.uiLanguage', 'zh');
    vi.clearAllMocks();
    load.mockResolvedValue(true);
    save.mockResolvedValue({ success: true });
  });

  it('shows only current platform settings and sends data configuration to Data Center', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: '平台设置' })).toBeInTheDocument();
    expect(screen.getByText('模型后端状态')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /管理数据源/ })).toHaveAttribute('href', '/capabilities/data');
    expect(screen.queryByText('Agent 设置')).not.toBeInTheDocument();
    expect(screen.queryByText('回测设置')).not.toBeInTheDocument();
    expect(screen.queryByText('每日调度')).not.toBeInTheDocument();
  });

  it('filters legacy scheduler keys from Security & deployment and saves real system fields', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /安全与部署/ }));

    expect(screen.getByText('HTTP_PROXY')).toBeInTheDocument();
    expect(screen.queryByText('SCHEDULE_ENABLED')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存 1 项' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('restores every valid deep-linked category and keeps its explanation outside the compact navigation', () => {
    renderPage('/settings?tab=system&from=portfolio');
    const nav = screen.getByRole('navigation', { name: '平台设置分类' });
    expect(within(nav).getByRole('button', { name: '安全与部署 1' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByText('认证、网络、日志与 Web 服务参数')).not.toBeInTheDocument();
    expect(screen.getByText('认证、网络、日志与 Web 服务参数')).toBeVisible();
    expect(screen.getByText('认证设置')).toBeVisible();
    expect(screen.queryByText('模型通道编辑器')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-route')).toHaveTextContent('tab=system&from=portfolio');
  });

  it('keeps dirty configuration and unrelated query context through category changes and browser history', () => {
    renderPage('/settings?tab=system&from=portfolio');
    fireEvent.click(screen.getByRole('button', { name: /模型与运行时/ }));
    expect(screen.getByTestId('settings-route')).toHaveTextContent('tab=model&from=portfolio');
    fireEvent.click(screen.getByRole('button', { name: '保存 JEV 配置' }));
    expect(save).toHaveBeenCalledWith([{ key: 'TYPESAFE_API_KEY', value: 'test-key' }]);
    expect(resetDraft).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '返回前一个分类' }));
    expect(screen.getByRole('button', { name: /安全与部署/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('settings-route')).toHaveTextContent('tab=system&from=portfolio');
    fireEvent.click(screen.getByRole('button', { name: '撤销修改' }));
    expect(resetDraft).toHaveBeenCalledTimes(1);
  });

  it('falls back to the model category for an unknown tab without discarding the URL context', () => {
    renderPage('/settings?tab=unknown&category=agent&from=portfolio');
    expect(screen.getByRole('button', { name: /模型与运行时/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('模型通道编辑器')).toBeVisible();
    expect(screen.getByTestId('settings-route')).toHaveTextContent('tab=unknown&category=agent&from=portfolio');
    expect(save).not.toHaveBeenCalled();
    expect(resetDraft).not.toHaveBeenCalled();
  });
});


it('exposes JEV on the routed model settings page and saves only JEV fields', () => {
  renderPage();
  expect(screen.getByRole('heading', {name:'JEV · 仅决策结果'})).toBeVisible();
  expect(screen.getByText('TYPESAFE_API_KEY')).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name:'保存 JEV 配置'}));
  expect(save).toHaveBeenCalledWith([{key:'TYPESAFE_API_KEY',value:'test-key'}]);
});
