import { useUiLiteral } from '../hooks/useUiLiteral';
import { withUiLanguages } from '../i18n/localize';
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
type NotificationChannelChoice = 'feishu' | 'email' | 'wechat' | 'dingtalk' | 'telegram' | 'slack' | 'discord' | 'custom' | 'mobile';

const NOTIFICATION_CHANNEL_CHOICES: Array<{ id: NotificationChannelChoice; zh: string; en: string; prefixes: string[] }> = [
  withUiLanguages({ id: 'feishu', zh: '飞书', en: 'Feishu', prefixes: ['FEISHU_'] }),
  withUiLanguages({ id: 'email', zh: '邮件', en: 'Email', prefixes: ['EMAIL_'] }),
  withUiLanguages({ id: 'wechat', zh: '企业微信', en: 'WeCom', prefixes: ['WECHAT_'] }),
  withUiLanguages({ id: 'dingtalk', zh: '钉钉', en: 'DingTalk', prefixes: ['DINGTALK_'] }),
  withUiLanguages({ id: 'telegram', zh: 'Telegram', en: 'Telegram', prefixes: ['TELEGRAM_'] }),
  withUiLanguages({ id: 'slack', zh: 'Slack', en: 'Slack', prefixes: ['SLACK_'] }),
  withUiLanguages({ id: 'discord', zh: 'Discord', en: 'Discord', prefixes: ['DISCORD_'] }),
  withUiLanguages({ id: 'custom', zh: '自定义 Webhook', en: 'Custom webhook', prefixes: ['CUSTOM_WEBHOOK_'] }),
  withUiLanguages({ id: 'mobile', zh: '手机推送', en: 'Mobile push', prefixes: ['PUSHPLUS_', 'PUSHOVER_', 'NTFY_', 'GOTIFY_', 'SERVERCHAN'] }),
];

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
  const uiLiteral = useUiLiteral();
  const { localize } = useUiLanguage();
  const { passwordChangeable } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PlatformSettingsTab>(searchParams.get('tab') === 'notifications' ? 'notifications' : 'model');
  const [notificationChannel, setNotificationChannel] = useState<NotificationChannelChoice>('feishu');
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
    getChangedItems,
    refreshAfterExternalSave,
  } = useSystemConfig();

  const modelItems = itemsByCategory.ai_model ?? [];
  const jevItems = modelItems.filter((item) => item.key.startsWith("TYPESAFE_"));
  const jevChanges = getChangedItems().filter((item) => item.key.startsWith("TYPESAFE_"));
  const notificationItems = useMemo(() => itemsByCategory.notification ?? [], [itemsByCategory.notification]);
  const notificationByKey = useMemo(() => new Map(notificationItems.map(item => [item.key, item])), [notificationItems]);
  const notificationFields = (keys: string[]) => keys.flatMap(key => {
    const item = notificationByKey.get(key);
    return item ? [<SettingsField key={item.key} item={item} value={item.value} disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />] : [];
  });
  const feishuWebhookKeys = ['FEISHU_WEBHOOK_URL', 'FEISHU_WEBHOOK_SECRET', 'FEISHU_WEBHOOK_KEYWORD'];
  const feishuAppKeys = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_CHAT_ID', 'FEISHU_RECEIVE_ID_TYPE'];
  const feishuAdvancedKeys = ['FEISHU_DOMAIN', 'FEISHU_STREAM_ENABLED', 'FEISHU_FOLDER_TOKEN', 'FEISHU_SEND_AS_FILE'];
  const routeKeys = ['NOTIFICATION_REPORT_CHANNELS', 'NOTIFICATION_ALERT_CHANNELS', 'NOTIFICATION_SYSTEM_ERROR_CHANNELS'];
  const selectedChannel = NOTIFICATION_CHANNEL_CHOICES.find(channel => channel.id === notificationChannel)!;
  const selectedChannelItems = notificationItems.filter(item => selectedChannel.prefixes.some(prefix => item.key.startsWith(prefix)));
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
          eyebrow={localize(uiLiteral('平台治理'), 'Platform governance')}
          title={localize(uiLiteral('平台设置'), 'Platform settings')}
          description={localize(uiLiteral('管理平台运行与通知设置。模型、Skill、工具和 MCP 在能力中心配置，定时计划在任务与运行中管理。'), 'Manage platform runtime and notifications. Configure models, skills, tools and MCP in Capabilities, and schedules in Tasks & Runs.')}
          actions={activeTab !== 'model' ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={resetDraft} disabled={isLoading || isSaving || !hasDirty}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {localize(uiLiteral('撤销修改'), 'Reset')}
              </Button>
              <Button type="button" variant="primary" onClick={() => void save()} disabled={isLoading || isSaving || !hasDirty} isLoading={isSaving}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {dirtyCount ? (localize(`保存 ${dirtyCount} 项`, `Save ${dirtyCount}`)) : (localize('保存', 'Save'))}
              </Button>
            </div>
          ) : undefined}
        />

        <InlineAlert
          variant="info"
          title={localize(uiLiteral('数据连接在能力中心管理'), 'Data connections live in Capabilities')}
          message={localize(uiLiteral('行情、新闻和宏观数据源统一在能力中心配置；实际可用性以健康检测和每次运行的取数结果为准。'), 'Configure market, news and macro sources in Capabilities. Health checks and each run’s fetched results determine actual availability.')}
          action={(
            <Link className="btn-secondary inline-flex items-center gap-2" to="/capabilities/data">
              <Database className="h-4 w-4" aria-hidden="true" />
              {localize(uiLiteral('管理数据源'), 'Manage data sources')}
            </Link>
          )}
        />

        {loadError ? (
          <ApiErrorAlert
            error={loadError}
            actionLabel={localize(uiLiteral('重新读取'), 'Reload')}
            onAction={() => void (retryAction === 'load' ? retry() : load())}
          />
        ) : null}
        {saveError ? (
          <ApiErrorAlert
            error={saveError}
            actionLabel={retryAction === 'save' ? (localize('重新保存', 'Retry save')) : undefined}
            onAction={retryAction === 'save' ? () => void retry() : undefined}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label={localize(uiLiteral('平台设置分类'), 'Platform settings categories')} className="space-y-2 lg:sticky lg:top-5 lg:self-start">
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
                    {localize(item.titleZh, item.titleEn)}
                  </span>
                  <span className="mt-1 block pl-6 text-xs leading-5 text-muted-text">
                    {localize(item.descriptionZh, item.descriptionEn)}
                  </span>
                </button>
              );
            })}
          </nav>

          <section aria-live="polite" className="min-w-0 space-y-4">
            {isLoading ? (
              <div>
                <p className="mb-3 text-sm text-secondary-text">
                  {localize(uiLiteral('正在读取模型通道和平台状态…'), 'Loading model channels and platform status…')}
                </p>
                <SettingsLoading />
              </div>
            ) : activeTab === 'notifications' ? (
              <SettingsSectionCard title={localize(uiLiteral('通知渠道与告警'), 'Notification channels & alerts')} description={localize(uiLiteral('先选择一个通知渠道并完成其最小配置，再测试发送；报告与告警最后再决定走哪些已启用渠道。'), 'Choose one channel and complete its minimum setup, then test it. Choose which enabled channels receive reports and alerts last.')}>
                <Link to="/alerts" className="inline-block min-h-11 py-2 text-primary">{localize(uiLiteral('管理股票告警'), 'Manage stock alerts')}</Link>
                <div className="divide-y divide-border">{alertItems.map(item => <SettingsField key={item.key} item={item} value={item.value} disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />)}</div>
                <section className="mt-5 border-y border-border py-5" aria-label={localize(uiLiteral('选择通知渠道'), 'Choose a notification channel')}>
                  <h3 className="text-base font-semibold">{localize(uiLiteral('选择通知渠道'), 'Choose a notification channel')}</h3>
                  <p className="mt-2 text-sm leading-6 text-secondary-text">{localize(uiLiteral('选择后只显示这个渠道的配置。先完成配置并测试，再在下方设置报告和告警分别发往哪些渠道。'), 'Choose a channel to see only its setup. Configure and test it first, then set report and alert routes below.')}</p>
                  <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={localize(uiLiteral('通知渠道列表'), 'Notification channel list')}>{NOTIFICATION_CHANNEL_CHOICES.map(channel => <button key={channel.id} type="button" role="tab" aria-selected={notificationChannel === channel.id} onClick={() => setNotificationChannel(channel.id)} className={cn('min-h-11 rounded-lg border px-3 text-sm font-medium', notificationChannel === channel.id ? 'border-cyan/35 bg-cyan/10 text-foreground' : 'border-border text-secondary-text hover:bg-hover hover:text-foreground')}>{localize(channel.zh, channel.en)}</button>)}</div>
                </section>
                {notificationChannel === 'feishu' && <section className="mt-5 border-t border-border pt-5" aria-label={localize(uiLiteral('飞书通知配置'), 'Feishu notification setup')}>
                  <h3 className="text-base font-semibold">{localize(uiLiteral('飞书：先选一种推送方式'), 'Feishu: choose one delivery method first')}</h3>
                  <p className="mt-2 max-w-[72ch] text-sm leading-6 text-secondary-text">{localize(uiLiteral('大多数情况下只需使用“群机器人 Webhook”。应用机器人适合需要主动发到指定群或私聊的场景；两种方式互不替代，也无需同时配置。'), 'Most teams only need a group bot webhook. App Bot is for proactive delivery to a selected chat or direct message. The two methods are independent; you do not need both.')}</p>
                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    <div className="border-y border-border py-4"><h4 className="font-medium">{localize(uiLiteral('推荐：群机器人 Webhook'), 'Recommended: group bot webhook')}</h4><p className="mt-1 text-sm leading-6 text-secondary-text">{localize(uiLiteral('在目标群添加自定义机器人，复制 Webhook 地址。仅 URL 是必填项；机器人开启签名或关键词时，才补填对应字段。'), 'Add a custom bot to the target group and paste its webhook URL. Only the URL is required; add the matching fields only if the bot enables signature or keyword security.')}</p><div className="mt-3 divide-y divide-border">{notificationFields(feishuWebhookKeys)}</div></div>
                    <div className="border-y border-border py-4"><h4 className="font-medium">{localize(uiLiteral('按需：应用机器人主动推送'), 'Optional: App Bot delivery')}</h4><p className="mt-1 text-sm leading-6 text-secondary-text">{localize(uiLiteral('仅在不用 Webhook、需要向指定群或用户主动发送时使用。必须同时填写应用 ID、应用 Secret 和接收目标。'), 'Use only when you need proactive delivery to a selected chat or user without a webhook. App ID, App Secret, and a recipient target are all required.')}</p><div className="mt-3 divide-y divide-border">{notificationFields(feishuAppKeys)}</div></div>
                  </div>
                  <details className="mt-3 border-b border-border"><summary className="cursor-pointer py-3 text-sm font-medium">{localize(uiLiteral('飞书高级功能：国际版、Stream Bot、云文档与文件发送'), 'Feishu advanced: Lark, Stream Bot, cloud docs, and file delivery')}</summary><div className="divide-y divide-border">{notificationFields(feishuAdvancedKeys)}</div></details>
                </section>}
                {notificationChannel !== 'feishu' && <div className="mt-5 divide-y divide-border border-y border-border" role="tabpanel">{selectedChannelItems.length ? selectedChannelItems.map(item => <SettingsField key={item.key} item={item} value={item.value} disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />) : <p className="py-4 text-sm text-secondary-text">{localize(uiLiteral('当前版本没有可编辑的渠道字段。'), 'This version has no editable fields for this channel.')}</p>}</div>}
                <details className="mt-4 border-b border-border"><summary className="cursor-pointer py-3 text-sm font-medium">{localize(uiLiteral('报告与告警发送范围'), 'Report and alert delivery routes')}</summary><p className="pb-2 text-xs leading-5 text-secondary-text">{localize(uiLiteral('先完成渠道配置并测试，再选择报告、告警分别发送到哪些渠道。留空会使用所有已配置渠道。'), 'Finish and test channel setup first, then choose which channels receive reports or alerts. Leaving a route blank uses every configured channel.')}</p><div className="divide-y divide-border">{notificationFields(routeKeys)}</div></details>
                <NotificationTestPanel items={notificationItems.map(item => ({ key: item.key, value: item.value }))} maskToken={maskToken} disabled={isSaving} />
              </SettingsSectionCard>
            ) : activeTab === 'model' ? (
              <SettingsSectionCard
                title={localize(uiLiteral('策略模型运行时'), 'Strategy model runtime')}
                description={localize(uiLiteral('这些通道会被策略研究、验证和运行链路真实调用。可先检查后端状态，再编辑和测试模型通道。'), 'These channels are used by strategy research, validation, and runs. Check runtime health before editing or testing channels.')}
              >
                {jevItems.length > 0 && <section className="mb-6 space-y-3 border-b border-border pb-6" aria-label="JEV">
                  <h3 className="font-semibold">{uiLiteral("JEV · 仅决策结果")}</h3>
                  <p className="text-sm text-secondary-text">{uiLiteral("仅用于交易决策，不生成报告。")}</p>
                  {jevItems.map((item) => <SettingsField key={item.key} item={item} value={item.value}
                    disabled={isSaving} onChange={setDraftValue} issues={issueByKey[item.key]} />)}
                  <Button variant="primary" disabled={isSaving || jevChanges.length === 0}
                    onClick={() => { void save(jevChanges); }}>{uiLiteral("保存 JEV 配置")}</Button>
                </section>}
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
                  title={localize(uiLiteral('部署与诊断'), 'Deployment & diagnostics')}
                  description={localize(uiLiteral('仅保留当前 Web 策略平台真实使用的网络、日志、并发与调试参数。'), 'Only network, logging, concurrency, and debugging settings used by this strategy platform are shown.')}
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
              ? <SettingsAlert title={localize(uiLiteral('设置已更新'), 'Settings updated')} message={toast.message} variant="success" presentation="toast" />
              : <ApiErrorAlert error={toast.error} />}
          </div>
        ) : null}
      </div>
    </AppPage>
  );
};

export default PlatformSettingsPage;
