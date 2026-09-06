import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
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
      ai_model: [{ key: 'LITELLM_MODEL', value: 'openai/test', schema: { category: 'ai_model' } }],
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

function renderPage() {
  return render(
    <MemoryRouter>
      <UiLanguageProvider>
        <PlatformSettingsPage />
      </UiLanguageProvider>
    </MemoryRouter>,
  );
}

describe('PlatformSettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
