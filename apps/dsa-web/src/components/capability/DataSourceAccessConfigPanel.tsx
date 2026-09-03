import { useEffect, useMemo } from "react";
import { CircleAlert, ExternalLink, X } from "lucide-react";

import type { WorkspaceDataSource } from "../../api/workspace";
import { useSystemConfig } from "../../hooks";
import { Button, Card } from "../common";
import { SettingsField, SettingsLoading } from "../settings";
import { useUiLanguage } from "../../contexts/UiLanguageContext";

type DataSourceAccessConfigPanelProps = {
  source: WorkspaceDataSource;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export function DataSourceAccessConfigPanel({
  source,
  onClose,
  onSaved,
}: DataSourceAccessConfigPanelProps) {
  const { localize } = useUiLanguage();
  const {
    itemsByCategory,
    issueByKey,
    isLoading,
    isSaving,
    loadError,
    saveError,
    hasDirty,
    load,
    save,
    resetDraft,
    setDraftValue,
  } = useSystemConfig();
  const requestedKeys = useMemo(
    () => new Set(source.configurationKeys ?? []),
    [source.configurationKeys],
  );
  const items = useMemo(
    () =>
      (itemsByCategory.data_source ?? []).filter((item) =>
        requestedKeys.has(item.key),
      ),
    [itemsByCategory.data_source, requestedKeys],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const saveAccess = async () => {
    const result = await save();
    if (result.success) await onSaved();
  };

  return (
    <Card variant="bordered" padding="none" className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {localize("数据源接入配置", "Data source connection")}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">
            {source.name}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">
            {localize(
              "以下字段来自该适配器的真实配置契约。敏感值会按平台现有安全规则掩码保存，不会写入数据源目录或显示在 Agent 上下文中。",
              "These fields come from this adapter's actual configuration contract. Sensitive values are stored under the platform's existing masking rules and never written to the data-source catalog or exposed to Agent context.",
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 px-2"
          aria-label={localize("关闭接入配置", "Close connection settings")}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {source.setupUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-5 py-3 text-xs text-secondary-text">
          <span>
            {localize(
              "还没有凭据？先在官方页面完成注册，再回来填写。",
              "Need credentials? Complete registration on the official page, then return here.",
            )}
          </span>
          <a
            href={source.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {localize("打开官方接入说明", "Open official setup")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div className="px-1 py-1">
        {isLoading ? (
          <div className="p-4">
            <SettingsLoading />
          </div>
        ) : loadError ? (
          <div role="alert" className="m-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{loadError.message}</span>
          </div>
        ) : items.length ? (
          <div className="divide-y divide-border/70">
            {items.map((item) => (
              <SettingsField
                key={item.key}
                item={item}
                value={item.value}
                disabled={isSaving}
                issues={issueByKey[item.key] ?? []}
                onChange={setDraftValue}
              />
            ))}
          </div>
        ) : (
          <div role="status" className="m-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {localize(
              `当前版本没有发布 ${[...requestedKeys].join(" / ")} 的可编辑配置字段，请先确认对应适配器已经安装。`,
              `This version does not expose editable fields for ${[...requestedKeys].join(" / ")}. Confirm that the adapter is installed.`,
            )}
          </div>
        )}
        {saveError ? (
          <p role="alert" className="px-5 pb-2 text-sm text-danger">
            {saveError.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 px-5 py-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isLoading || isSaving || !hasDirty}
          onClick={resetDraft}
        >
          {localize("撤销修改", "Reset")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          isLoading={isSaving}
          disabled={isLoading || !items.length || !hasDirty}
          loadingText={localize("保存中…", "Saving…")}
          onClick={() => void saveAccess()}
        >
          {localize("保存并刷新状态", "Save and refresh status")}
        </Button>
      </div>
    </Card>
  );
}
