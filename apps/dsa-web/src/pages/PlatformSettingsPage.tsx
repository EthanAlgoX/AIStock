import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Database, KeyRound, RotateCcw, Save, ServerCog, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth, useSystemConfig } from '../hooks';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { ApiErrorAlert, AppPage, Button, InlineAlert, PageHeader } from '../components/common';
import {
  AuthSettingsCard,
  ChangePasswordCard,
  GenerationBackendStatusPanel,
  LLMChannelEditor,
  SettingsAlert,
  SettingsField,
  SettingsLoading,
  SettingsSectionCard,
  NotificationTestPanel,
} from '../components/settings';
import { cn } from '../utils/cn';

type PlatformSettingsTab = 'model' | 'system' | 'notifications';

const PLATFORM_SYSTEM_KEYS = new Set([
  'HTTP_PROXY',
  'LOG_LEVEL',
  'LOG_DIR',
  'WEBUI_ENABLED',
  'WEBUI_AUTO_BUILD',
  'WEBUI_HOST',
  'WEBUI_PORT',
  'TRUST_X_FORWARDED_FOR',
  'MAX_WORKERS',
  'DEBUG',
]);

const TAB_ITEMS: Array<{
  id: PlatformSettingsTab;
  icon: React.ComponentType<{ className?: string }>;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  { id: 'notifications', icon: ServerCog, titleZh: '通知与告警', titleEn: 'Notifications & alerts', descriptionZh: '渠道凭据、告警路由与检查频率', descriptionEn: 'Channel credentials, alert routing and polling' },
  {
    id: 'model',
    icon: Sparkles,
    titleZh: '模型与运行时',
    titleEn: 'Models & runtime',
    descriptionZh: '策略调用的模型通道、路由与可用性',
    descriptionEn: 'Model channels, routing, and runtime health',
  },
  {
    id: 'system',
    icon: ServerCog,
    titleZh: '安全与部署',
    titleEn: 'Security & deployment',
    descriptionZh: '认证、网络、日志与 Web 服务参数',
    descriptionEn: 'Authentication, network, logs, and web service',
  },
];

const PlatformSettingsPage: React.FC = () => {
  const { language } = useUiLanguage();
  const { passwordChangeable } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PlatformSettingsTab>(searchParams.get('tab') === 'notifications' ? 'notifications' : 'model');
  const {
    configVersion,
    maskToken,
    llmModelProviders,
    itemsByCategory,
    issueByKey,
    hasDirty,
    dirtyCount,
    toast,
    clearToast,
    isLoading,
    isSaving,
    loadError,
    saveError,
    retryAction,
    load,
    retry,
    save,
    resetDraft,
    setDraftValue,
    refreshAfterExternalSave,
  } = useSystemConfig();

  const isZh = language === 'zh';
  const modelItems = itemsByCategory.ai_model ?? [];
  const notificationItems = itemsByCategory.notification ?? [];
  const alertItems = Object.values(itemsByCategory).flat().filter(item => ['AGENT_EVENT_MONITOR_ENABLED', 'AGENT_EVENT_MONITOR_INTERVAL_MINUTES'].includes(item.key));
  const systemItems = useMemo(
    () => (itemsByCategory.system ?? []).filter((item) => PLATFORM_SYSTEM_KEYS.has(item.key)),
    [itemsByCategory.system],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow={isZh ? '平台治理' : 'Platform governance'}
          title={isZh ? '平台设置' : 'Platform settings'}
          description={isZh
            ? '管理平台运行与通知设置。模型、Skill、工具和 MCP 在能力中心配置，定时计划在任务与运行中管理。'
            : 'Manage platform runtime and notifications. Configure models, skills, tools and MCP in Capabilities, and schedules in Tasks & Runs.'}
          actions={activeTab !== 'model' ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={resetDraft} disabled={isLoading || isSaving || !hasDirty}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {isZh ? '撤销修改' : 'Reset'}
              </Button>
              <Button type="button" variant="primary" onClick={() => void save()} disabled={isLoading || isSaving || !hasDirty} isLoading={isSaving}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {dirtyCount ? (isZh ? `保存 ${dirtyCount} 项` : `Save ${dirtyCount}`) : (isZh ? '保存' : 'Save')}
              </Button>
            </div>
          ) : undefined}
        />

        <InlineAlert
          variant="info"
          title={isZh ? '数据连接在能力中心管理' : 'Data connections live in Capabilities'}
          message={isZh
            ? '行情、新闻和宏观数据源统一在能力中心配置；实际可用性以健康检测和每次运行的取数结果为准。'
            : 'Configure market, news and macro sources in Capabilities. Health checks and each run’s fetched results determine actual availability.'}
          action={(
            <Link className="btn-secondary inline-flex items-center gap-2" to="/capabilities/data">
              <Database className="h-4 w-4" aria-hidden="true" />
              {isZh ? '管理数据源' : 'Manage data sources'}
            </Link>
          )}
        />

        {loadError ? (
          <ApiErrorAlert
            error={loadError}
            actionLabel={isZh ? '重新读取' : 'Reload'}
            onAction={() => void (retryAction === 'load' ? retry() : load())}
          />
        ) : null}
        {saveError ? (
          <ApiErrorAlert
            error={saveError}
            actionLabel={retryAction === 'save' ? (isZh ? '重新保存' : 'Retry save') : undefined}
            onAction={retryAction === 'save' ? () => void retry() : undefined}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label={isZh ? '平台设置分类' : 'Platform settings categories'} className="space-y-2 lg:sticky lg:top-5 lg:self-start">
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2',
                    selected
                      ? 'border-cyan/35 bg-cyan/10 text-foreground'
                      : 'border-transparent text-secondary-text hover:border-border hover:bg-hover hover:text-foreground',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className={cn('h-4 w-4', selected ? 'text-cyan' : 'text-muted-text')} aria-hidden="true" />
                    {isZh ? item.titleZh : item.titleEn}
                  </span>
                  <span className="mt-1 block pl-6 text-xs leading-5 text-muted-text">
                    {isZh ? item.descriptionZh : item.descriptionEn}
                  </span>
                </button>
              );
            })}
          </nav>

          <section aria-live="polite" className="min-w-0 space-y-4">
            {isLoading ? (
              <div>
                <p className="mb-3 text-sm text-secondary-text">
                  {isZh ? '正在读取模型通道和平台状态…' : 'Loading model channels and platform status…'}
                </p>
                <SettingsLoading />
              </div>
            ) : activeTab === 'notifications' ? (
              <SettingsSectionCard title={isZh ? '通知渠道与告警' : 'Notification channels & alerts'} description={isZh ? '先配置渠道凭据，再设置告警路由。空路由使用全部可用渠道；规则可进一步缩小发送范围。' : 'Configure channel credentials, then the alert route. An empty route uses all available channels; individual rules may narrow delivery.'}>
                <Link to="/alerts" className="inline-block min-h-11 py-2 text-primary">{isZh ? '管理股票告警' : 'Manage stock alerts'}</Link>
                <div className="divide-y divide-border">{alertItems.map(item => <SettingsField key={item.key} item={item} value={item.value} disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />)}</div>
                <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer py-3 font-medium">{isZh ? '渠道凭据、路由与通知选项' : 'Channel credentials, routing & delivery options'}</summary><div className="divide-y divide-border">{notificationItems.map(item => <SettingsField key={item.key} item={item} value={item.value} disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />)}</div></details>
                <NotificationTestPanel items={notificationItems.map(item => ({ key: item.key, value: item.value }))} maskToken={maskToken} disabled={isSaving} />
              </SettingsSectionCard>
            ) : activeTab === 'model' ? (
              <SettingsSectionCard
                title={isZh ? '策略模型运行时' : 'Strategy model runtime'}
                description={isZh
                  ? '这些通道会被策略研究、验证和运行链路真实调用。可先检查后端状态，再编辑和测试模型通道。'
                  : 'These channels are used by strategy research, validation, and runs. Check runtime health before editing or testing channels.'}
              >
                <GenerationBackendStatusPanel
                  items={modelItems.map((item) => ({ key: item.key, value: item.value }))}
                  maskToken={maskToken}
                  disabled={isSaving}
                />
                <LLMChannelEditor
                  items={modelItems}
                  configVersion={configVersion}
                  maskToken={maskToken}
                  modelProviderPrefixes={llmModelProviders}
                  onSaved={async (updatedItems) => {
                    await refreshAfterExternalSave(updatedItems.map((item) => item.key));
                  }}
                  disabled={isSaving}
                />
              </SettingsSectionCard>
            ) : (
              <>
                <AuthSettingsCard />
                {passwordChangeable ? <ChangePasswordCard /> : null}
                <SettingsSectionCard
                  title={isZh ? '部署与诊断' : 'Deployment & diagnostics'}
                  description={isZh
                    ? '仅保留当前 Web 策略平台真实使用的网络、日志、并发与调试参数。'
                    : 'Only network, logging, concurrency, and debugging settings used by this strategy platform are shown.'}
                  actions={<KeyRound className="h-4 w-4 text-muted-text" aria-hidden="true" />}
                >
                  <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                    {systemItems.map((item) => (
                      <SettingsField
                        key={item.key}
                        item={item}
                        value={item.value}
                        disabled={isSaving}
                        onChange={setDraftValue}
                        issues={issueByKey[item.key] ?? []}
                      />
                    ))}
                  </div>
                </SettingsSectionCard>
              </>
            )}
          </section>
        </div>

        {toast ? (
          <div className="fixed bottom-5 right-5 z-50 w-[340px] max-w-[calc(100vw-24px)]" onAnimationEnd={clearToast}>
            {toast.type === 'success'
              ? <SettingsAlert title={isZh ? '设置已更新' : 'Settings updated'} message={toast.message} variant="success" presentation="toast" />
              : <ApiErrorAlert error={toast.error} />}
          </div>
        ) : null}
      </div>
    </AppPage>
  );
};

export default PlatformSettingsPage;
