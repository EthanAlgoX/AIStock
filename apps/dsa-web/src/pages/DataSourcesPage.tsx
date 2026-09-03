import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  Database,
  LoaderCircle,
  Newspaper,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  workspaceApi,
  type WorkspaceDataSource,
} from "../api/workspace";
import { toApiErrorMessage } from "../api/error";
import { AppPage, Card, PageHeader } from "../components/common";
import { useUiLanguage } from "../contexts/UiLanguageContext";
import {
  dataSourceMarketSummary,
  STRATEGY_MARKETS,
  strategyMarketLabel,
} from "../utils/strategyMarkets";
import { CapabilityCenterNav } from "../components/capability/CapabilityCenterNav";

const DataSourcesPage: React.FC = () => {
  const { language, localize } = useUiLanguage();
  const kindLabel: Record<WorkspaceDataSource["kind"], string> = {
    kline: localize("K 线与行情", "Market data & OHLCV"),
    news: localize("新闻与资讯", "News & intelligence"),
    fundamentals: localize("基本面", "Fundamentals"),
    other: localize("其他研究数据", "Other research data"),
  };
  const [sources, setSources] = useState<WorkspaceDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [connectionKey, setConnectionKey] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<WorkspaceDataSource["kind"]>("kline");
  const [markets, setMarkets] = useState<string[]>(["cn"]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSources(await workspaceApi.listDataSources());
    } catch (error) {
      setError(
        toApiErrorMessage(
          error,
          localize(
            "无法读取数据源目录。",
            "Unable to load the data source catalog.",
          ),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [localize]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !connectionKey.trim() || markets.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const created = await workspaceApi.createDataSource({
        name: name.trim(),
        connectionKey: connectionKey.trim(),
        description: description.trim() || undefined,
        kind,
        markets,
      });
      setSources((current) => [...current, created]);
      setName("");
      setConnectionKey("");
      setDescription("");
      setKind("kline");
      setMarkets(["cn"]);
    } catch (error) {
      setError(
        toApiErrorMessage(
          error,
          localize("无法登记数据源。", "Unable to register the data source."),
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  const archive = async (source: WorkspaceDataSource) => {
    if (
      !source.id ||
      !window.confirm(
        localize(
          `从目录移除“${source.name}”？历史运行和已冻结任务中的引用不会被改写。`,
          `Remove “${source.name}” from the catalog? References in historical runs and frozen tasks will not change.`,
        ),
      )
    )
      return;
    try {
      await workspaceApi.archiveDataSource(source.id);
      setSources((current) =>
        current.filter((item) => item.sourceId !== source.sourceId),
      );
    } catch (error) {
      setError(
        toApiErrorMessage(
          error,
          localize("无法移除数据源。", "Unable to remove the data source."),
        ),
      );
    }
  };
  const defaults = sources.filter((item) =>
    ["system_market_data", "system_news", "system_fundamentals"].includes(
      item.sourceId,
    ),
  );
  const providers = sources.filter(
    (item) => item.selectionMode === "provider" && item.builtIn,
  );
  const customSources = sources.filter((item) => !item.builtIn);
  const configuredProviders = providers.filter(
    (item) => item.selectable,
  ).length;
  const unconfiguredProviders = providers.filter(
    (item) => !item.selectable,
  ).length;
  const readyDefaults = defaults.filter((item) => item.selectable).length;
  const financeRssSource = providers.find(
    (item) => item.sourceId === "news:finance_rss",
  );
  const financeNewsSources = financeRssSource?.includedSources ?? [];
  const financeNewsGroups = [
    {
      category: "publisher" as const,
      label: localize("财经媒体", "Financial publishers"),
      description: localize(
        "公司、市场与宏观新闻",
        "Company, market, and macro coverage",
      ),
    },
    {
      category: "corporate_wire" as const,
      label: localize("企业公告线", "Corporate newswires"),
      description: localize(
        "公司公告与事件披露",
        "Company announcements and event disclosures",
      ),
    },
    {
      category: "regulator" as const,
      label: localize("监管与宏观", "Regulatory & macro"),
      description: localize(
        "监管公告与政策证据",
        "Regulatory releases and policy evidence",
      ),
    },
  ];

  return (
    <AppPage className="space-y-6">
      <PageHeader
        eyebrow="Platform data dependencies"
        title={localize("数据源", "Data sources")}
        description={localize(
          "管理主 Agent 在个股分析、选股和交易任务中可选择的数据连接、适用市场与配置状态。密钥仍由设置管理。",
          "Manage the data connections, supported markets, and configuration status available to Primary Agent research, screening, and trading tasks. Secrets remain managed in Settings.",
        )}
        actions={
          <Link
            to="/overview"
            className="btn-primary inline-flex items-center gap-2"
          >
            {localize("返回主 Agent", "Back to Primary Agent")}
          </Link>
        }
      />
      <CapabilityCenterNav />
      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-sm leading-6 text-secondary-text">
        <Database className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          {localize(
            "平台预置来源可直接绑定到 Agent 任务，工作区也可以登记专用行情、新闻和私有研究数据。每次运行都会冻结所选来源、目录状态和数据时点。",
            "Platform sources can be bound to Agent tasks, and the workspace can register dedicated market, news, and private research data. Every run freezes the selected sources, catalog status, and data timestamp.",
          )}
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}
      <section
        aria-label={localize("数据连接摘要", "Data connection summary")}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 lg:grid-cols-4"
      >
        {[
          [
            localize("系统默认", "System defaults"),
            loading ? "—" : `${readyDefaults}/${defaults.length}`,
            localize("当前可用 / 全部", "Available / total"),
          ],
          [
            localize("已配置提供方", "Configured providers"),
            loading ? "—" : configuredProviders,
            localize("可固定数据口径", "Available for pinned datasets"),
          ],
          [
            localize("待配置提供方", "Unconfigured providers"),
            loading ? "—" : unconfiguredProviders,
            localize("连接尚不可用", "Connection unavailable"),
          ],
          [
            localize("自定义来源", "Custom sources"),
            loading ? "—" : customSources.length,
            localize("已登记到目录", "Registered in catalog"),
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="bg-card px-4 py-4">
            <p className="text-xs text-secondary-text">{label}</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-text">{hint}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card variant="gradient" padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {localize("系统默认来源", "System default sources")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-text">
                {localize(
                  "K 线、新闻和基本面已作为新 Agent 任务的默认输入。系统会沿用设置中的提供方优先级和失败降级，不要求每个任务重复配置。",
                  "Market data, news, and fundamentals are default inputs for new Agent tasks. Provider priority and fallback settings are reused so every task does not need duplicate configuration.",
                )}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              {localize("开箱即用", "Ready to use")}
            </span>
          </div>
          {loading ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-secondary-text">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {localize("正在读取数据源目录…", "Loading data source catalog…")}
            </p>
          ) : (
            <div className="mt-5 divide-y divide-border/70">
              {defaults.map((source) => (
                <div
                  key={source.sourceId}
                  className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-foreground">
                        {source.name}
                      </h3>
                      {source.required ? (
                        <span className="text-xs text-cyan">
                          {localize("默认启用", "Enabled by default")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-text">
                          {localize(
                            "默认启用，可关闭",
                            "Enabled by default; optional",
                          )}
                        </span>
                      )}
                      <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-secondary-text">
                        {dataSourceMarketSummary(source, language)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-secondary-text">
                      {source.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-text">
                      {localize("连接", "Connection")}: {source.connectionKey}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card variant="bordered" padding="lg">
          <h2 className="text-lg font-semibold text-foreground">
            {localize("登记数据源", "Register data source")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary-text">
            {localize(
              "标注数据类型和适用市场后，Agent 任务只展示兼容来源。这里仅保存无密钥的连接标识；对应适配器必须已在系统中配置。",
              "After you label the data type and supported markets, Agent tasks only show compatible sources. Only a secret-free connection key is stored here; its adapter must already be configured.",
            )}
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => void create(event)}
          >
            <label className="block text-sm text-secondary-text">
              {localize("数据源名称", "Data source name")}
              <input
                aria-label={localize("数据源名称", "Data source name")}
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={localize(
                  "例如 港股日线数据库",
                  "e.g. Hong Kong daily market database",
                )}
                className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 text-foreground"
              />
            </label>
            <label className="block text-sm text-secondary-text">
              {localize("数据类型", "Data type")}
              <select
                aria-label={localize("数据类型", "Data type")}
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as WorkspaceDataSource["kind"])
                }
                className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 text-foreground"
              >
                {Object.entries(kindLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="text-sm text-secondary-text">
                {localize("适用市场", "Supported markets")}
              </legend>
              <p className="mt-1 text-xs leading-5 text-muted-text">
                {localize(
                  "至少选择一个。一个跨市场来源可以多选；任务配置只展示与所选市场匹配的来源。",
                  "Select at least one. Cross-market sources may support several markets; task setup only shows sources compatible with the selected market.",
                )}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {STRATEGY_MARKETS.map((market) => {
                  const label =
                    language === "en"
                      ? (
                          {
                            cn: "China A-shares",
                            hk: "Hong Kong",
                            us: "US",
                          } as const
                        )[market.value]
                      : market.label;
                  return (
                    <label
                      key={market.value}
                      className={`flex min-h-10 items-center justify-center gap-2 rounded-lg border px-2 text-sm ${markets.includes(market.value) ? "border-cyan/50 bg-cyan/10 text-foreground" : "border-border bg-base text-secondary-text"}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`${localize("适用市场", "Supported market")} ${label}`}
                        checked={markets.includes(market.value)}
                        onChange={(event) =>
                          setMarkets((current) =>
                            event.target.checked
                              ? [...current, market.value]
                              : current.filter((item) => item !== market.value),
                          )
                        }
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
              {markets.length === 0 ? (
                <p role="alert" className="mt-2 text-xs text-warning">
                  {localize(
                    "请至少选择一个适用市场。",
                    "Select at least one supported market.",
                  )}
                </p>
              ) : null}
            </fieldset>
            <label className="block text-sm text-secondary-text">
              {localize("连接标识", "Connection key")}
              <input
                aria-label={localize("连接标识", "Connection key")}
                required
                maxLength={160}
                value={connectionKey}
                onChange={(event) => setConnectionKey(event.target.value)}
                placeholder="e.g. hk_daily_v1"
                className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 font-mono text-sm text-foreground"
              />
              <span className="mt-1 block text-xs text-muted-text">
                {localize(
                  "仅填写已配置适配器的连接标识，不要填写 URL、Token 或密钥。",
                  "Enter the key of an existing adapter only. Do not enter a URL, token, or secret.",
                )}
              </span>
            </label>
            <label className="block text-sm text-secondary-text">
              {localize("用途说明（可选）", "Description (optional)")}
              <textarea
                aria-label={localize("用途说明", "Description")}
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={localize(
                  "说明它提供的数据范围和口径",
                  "Describe its coverage and methodology",
                )}
                className="mt-1 min-h-20 w-full rounded-lg border border-border bg-base p-2.5 text-foreground"
              />
            </label>
            <button
              type="submit"
              className="btn-primary inline-flex w-full items-center justify-center gap-2"
              disabled={
                saving ||
                !name.trim() ||
                !connectionKey.trim() ||
                markets.length === 0
              }
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving
                ? localize("正在登记…", "Registering…")
                : localize("登记到数据源目录", "Add to data source catalog")}
            </button>
          </form>
        </Card>
      </section>
      {financeRssSource && financeNewsSources.length ? (
        <section
          aria-labelledby="default-finance-news-heading"
          className="space-y-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                id="default-finance-news-heading"
                className="text-xl font-semibold text-foreground"
              >
                {localize("默认财经资讯网络", "Default finance news network")}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">
                {localize(
                  "以下来源已纳入免密钥财经 RSS 路由。Agent 任务使用系统新闻时会按股票或题材定向检索，并保留发布方、时间与原文链接。",
                  "These sources are included in the keyless finance RSS route. Agent tasks search them by symbol or topic while preserving publisher, timestamp, and original link.",
                )}
              </p>
            </div>
            <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <Newspaper className="h-3.5 w-3.5" />
              {localize(
                `${financeNewsSources.length} 个来源·默认可用`,
                `${financeNewsSources.length} sources · available by default`,
              )}
            </span>
          </div>
          <div className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 lg:grid-cols-3">
            {financeNewsGroups.map((group) => {
              const members = financeNewsSources.filter(
                (source) => source.category === group.category,
              );
              return (
                <div key={group.category} className="min-w-0 bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">
                        {group.label}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-muted-text">
                        {group.description}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-secondary-text">
                      {members.length}
                    </span>
                  </div>
                  <div className="mt-3 divide-y divide-border/70">
                    {members.map((source) => (
                      <div
                        key={source.id}
                        className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {source.name}
                          </p>
                          <p className="truncate font-mono text-[11px] text-muted-text">
                            {source.domain}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-secondary-text">
                          {source.markets
                            .map((market) => strategyMarketLabel(market, language))
                            .join(" / ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-5 text-muted-text">
            {localize(
              "这是默认检索覆盖清单，不表示已批量抓取或保存各站正文；单个来源失败不会伪造证据。",
              "This is default search coverage, not a claim that article bodies have been bulk-fetched or stored. A failed source never becomes fabricated evidence.",
            )}
          </p>
        </section>
      ) : null}
      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-foreground">
            {localize("可指定的提供方", "Selectable providers")}
          </h2>
          <p className="mt-1 text-sm text-secondary-text">
            {localize(
              "Agent 任务默认使用自动路由；用户指定提供方或任务需要复现数据口径时，平台会核对以下连接。市场标签决定任务可选择的来源。",
              "Agent tasks use automatic routing by default. When a user pins a provider or a task needs a reproducible dataset, the platform checks the following connections. Market tags determine task compatibility.",
            )}
          </p>
        </div>
        {loading ? (
          <Card variant="bordered" padding="lg">
            <p className="text-sm text-secondary-text">
              {localize(
                "正在核对提供方配置…",
                "Checking provider configuration…",
              )}
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {(["kline", "news", "fundamentals"] as const).map((kind) => (
              <Card key={kind} variant="bordered" padding="lg">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-foreground">
                    {kindLabel[kind]}
                  </h3>
                  <span className="text-xs text-muted-text">
                    {
                      providers.filter(
                        (item) => item.kind === kind && item.selectable,
                      ).length
                    }{" "}
                    {localize("个可选", "available")}
                  </span>
                </div>
                <div className="mt-3 divide-y divide-border/70">
                  {providers
                    .filter((item) => item.kind === kind)
                    .map((source) => (
                      <div
                        key={source.sourceId}
                        className="py-3 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {source.name}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${source.selectable ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
                          >
                            {source.selectable
                              ? localize("已配置", "Configured")
                              : localize("未配置", "Not configured")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-secondary-text">
                          {source.description}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-text">
                          {localize(
                            `适用市场：${dataSourceMarketSummary(source, language)}`,
                            `Markets: ${dataSourceMarketSummary(source, language)}`,
                          )}
                        </p>
                      </div>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-foreground">
            {localize("自定义数据源目录", "Custom data source catalog")}
          </h2>
          <p className="mt-1 text-sm text-secondary-text">
            {localize(
              "自定义来源保留数据类型和市场标签；Agent 任务会按市场和数据需求匹配可用连接。",
              "Custom sources retain their data type and market tags. Agent tasks match available connections by market and data requirements.",
            )}
          </p>
        </div>
        {loading ? (
          <Card variant="bordered" padding="lg">
            <p className="text-sm text-secondary-text">
              {localize("正在读取目录…", "Loading catalog…")}
            </p>
          </Card>
        ) : customSources.length ? (
          <div className="divide-y divide-border/70 rounded-2xl border border-border/70 bg-card px-5">
            {customSources.map((source) => (
              <div
                key={source.sourceId}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Database className="h-4 w-4 text-cyan" />
                    <h3 className="font-medium text-foreground">
                      {source.name}
                    </h3>
                    <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-secondary-text">
                      {kindLabel[source.kind]}
                    </span>
                    <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-secondary-text">
                      {dataSourceMarketSummary(source, language)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-secondary-text">
                    {source.description ||
                      localize(
                        "自定义登记数据源",
                        "Custom registered data source",
                      )}
                  </p>
                  <p className="mt-1 text-xs text-muted-text">
                    {localize("连接", "Connection")}: {source.connectionKey} ·{" "}
                    {localize(
                      "已登记，运行时核对适配器",
                      "registered; adapter checked at runtime",
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void archive(source)}
                  className="inline-flex shrink-0 items-center gap-1 text-sm text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                  {localize("移出目录", "Remove")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Card variant="bordered" padding="lg">
            <p className="font-medium text-foreground">
              {localize("还没有自定义数据源", "No custom data sources yet")}
            </p>
            <p className="mt-1 text-sm text-secondary-text">
              {localize(
                "可以先直接使用系统默认来源；需要专用行情、新闻或私有研究数据时再登记。",
                "Use system defaults first, then register dedicated market, news, or private research data when needed.",
              )}
            </p>
          </Card>
        )}
      </section>
      <Card
        variant="bordered"
        padding="lg"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-semibold text-foreground">
            {localize(
              "Agent 任务按市场核对数据依赖",
              "Agent tasks check data dependencies by market",
            )}
          </p>
          <p className="mt-1 text-sm text-secondary-text">
            {localize(
              "任务提交后，平台将根据市场、数据类型和指定提供方检查连接；缺少依赖时应明确指出，不会静默替换数据口径。",
              "After submission, the platform will check connections against the market, data types, and pinned providers. Missing dependencies must be reported explicitly; datasets are never silently substituted.",
            )}
          </p>
        </div>
        <Link
          to="/stock-research"
          className="inline-flex items-center gap-1 text-sm font-medium text-cyan"
        >
          {localize("前往个股分析", "Open stock analysis")}{" "}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Card>
    </AppPage>
  );
};

export default DataSourcesPage;
