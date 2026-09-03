import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  Database,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { historyApi } from '../../api/history';
import { workspaceApi, type WorkspaceDataSource } from '../../api/workspace';
import type {
  AnalysisReport,
  HistoryItem,
  MarketReviewIndex,
  MarketReviewPayload,
  SectorRankingItem,
} from '../../types/analysis';
import { cn } from '../../utils/cn';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type DefaultSource = {
  id: string;
  label: string;
  purpose: string;
  kind: WorkspaceDataSource['kind'];
};

const DEFAULT_SOURCES: DefaultSource[] = [
  { id: 'system_market_data', label: '市场行情', purpose: '指数、涨跌与成交数据', kind: 'kline' },
  { id: 'system_news', label: '财经新闻', purpose: '事件与市场叙事', kind: 'news' },
  { id: 'system_fundamentals', label: '基本面', purpose: '估值与财务背景', kind: 'fundamentals' },
];

type WidgetId = 'overview' | 'indices' | 'breadth' | 'sectors';

type MarketDashboardLayout = {
  widgetIds: WidgetId[];
  sourceIds: string[];
};

type SourceOption = {
  id: string;
  label: string;
  purpose: string;
  kind: WorkspaceDataSource['kind'];
  source?: WorkspaceDataSource;
};

const MARKET_DASHBOARD_KEY = 'dsa.market-intelligence-layout.v1';
const DEFAULT_WIDGET_IDS: WidgetId[] = ['overview', 'indices', 'breadth', 'sectors'];
const DEFAULT_SOURCE_IDS = DEFAULT_SOURCES.map((source) => source.id);

const WIDGET_OPTIONS: Array<{ id: WidgetId; label: string; description: string; sourceHint: string }> = [
  { id: 'overview', label: 'Agent 市场摘要', description: '展示本次复盘的核心判断与市场叙事。', sourceHint: '新闻、行情与基本面' },
  { id: 'indices', label: '主要指数', description: '展示指数点位、涨跌幅和相对波动。', sourceHint: '市场行情' },
  { id: 'breadth', label: '市场宽度', description: '展示涨跌家数、涨跌停与成交额。', sourceHint: '市场行情' },
  { id: 'sectors', label: '板块排行', description: '展示领涨和承压板块。', sourceHint: '市场行情' },
];

const SOURCE_KIND_LABELS: Record<WorkspaceDataSource['kind'], string> = {
  kline: '行情与 K 线',
  news: '新闻与资讯',
  fundamentals: '基本面',
  other: '其他研究数据',
};

const readDashboardLayout = (): MarketDashboardLayout => {
  if (typeof window === 'undefined') {
    return { widgetIds: DEFAULT_WIDGET_IDS, sourceIds: DEFAULT_SOURCE_IDS };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MARKET_DASHBOARD_KEY) || '{}') as Partial<MarketDashboardLayout>;
    const widgetIds = Array.isArray(parsed.widgetIds)
      ? parsed.widgetIds.filter((id): id is WidgetId => DEFAULT_WIDGET_IDS.includes(id as WidgetId))
      : DEFAULT_WIDGET_IDS;
    const sourceIds = Array.isArray(parsed.sourceIds)
      ? parsed.sourceIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_SOURCE_IDS;
    return {
      widgetIds: widgetIds.length ? widgetIds : DEFAULT_WIDGET_IDS,
      sourceIds,
    };
  } catch {
    return { widgetIds: DEFAULT_WIDGET_IDS, sourceIds: DEFAULT_SOURCE_IDS };
  }
};

const toggleItem = <T,>(items: T[], value: T): T[] => (
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
);

const formatSourceMarkets = (markets?: string[]): string => {
  if (!markets?.length) return '市场范围未声明';
  const labels: Record<string, string> = { cn: 'A 股', hk: '港股', us: '美股' };
  return markets.map((market) => labels[market.toLowerCase()] || market.toUpperCase()).join(' · ');
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatPercent = (value: unknown): string => {
  const number = toFiniteNumber(value);
  if (number === null) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
};

const formatCount = (value: unknown): string => {
  const number = toFiniteNumber(value);
  return number === null ? '—' : Math.round(number).toLocaleString('zh-CN');
};

const stripMarkdown = (value: string): string => value
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .replace(/^\s*>\s?/gm, '')
  .replace(/\*\*|__|`/g, '')
  .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const clampText = (value: string, maxLength = 180): string => (
  value.length > maxLength ? `${value.slice(0, maxLength).trim()}…` : value
);

const resolvePayload = (report: AnalysisReport | null): MarketReviewPayload | null => {
  const payload = report?.details?.contextSnapshot?.marketReviewPayload;
  if (!payload) return null;
  if (payload.indices?.length || payload.breadth || payload.sectors) return payload;
  const nestedMarkets = Object.values(payload.markets || {});
  return nestedMarkets[0] || payload;
};

const resolveOverview = (
  payload: MarketReviewPayload | null,
  report: AnalysisReport | null,
  item: HistoryItem | null,
): string => {
  const preferredSection = payload?.sections?.find((section) => (
    section.key === 'overview' || /overview|盘面总览|市场总览/i.test(section.title)
  ));
  const candidates = [
    preferredSection?.markdown,
    report?.summary?.analysisSummary,
    item?.analysisSummary,
  ];
  const result = candidates
    .map((candidate) => stripMarkdown(candidate || ''))
    .find(Boolean);
  return result ? clampText(result) : '最新市场复盘已生成，但当前记录没有可展示的摘要。';
};

const formatSnapshotTime = (value?: string | null): string => {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const isRecentSnapshot = (value?: string | null): boolean => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= 48 * 60 * 60 * 1000;
};

const SourceStatus = ({ source, unavailable }: { source?: WorkspaceDataSource; unavailable: boolean }) => {
  const status = unavailable
    ? { label: '状态未知', tone: 'text-muted-text', dot: 'bg-muted-text' }
    : source?.selectable
      ? { label: '可供 Agent 使用', tone: 'text-success', dot: 'bg-success' }
      : source
        ? { label: '待配置', tone: 'text-warning', dot: 'bg-warning' }
        : { label: '未注册', tone: 'text-muted-text', dot: 'bg-muted-text' };

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', status.tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden="true" />
      {status.label}
    </span>
  );
};

const IndexPerformance = ({ indices }: { indices: MarketReviewIndex[] }) => {
  const visible = indices.slice(0, 6);
  const maximum = Math.max(
    1,
    ...visible.map((index) => Math.abs(toFiniteNumber(index.changePct) || 0)),
  );

  if (!visible.length) {
    return <p className="py-6 text-sm text-muted-text">本次复盘没有结构化指数数据。</p>;
  }

  return (
    <div className="space-y-4" aria-label="指数表现">
      {visible.map((index) => {
        const change = toFiniteNumber(index.changePct);
        const changeTone = change === null || change === 0
          ? 'neutral'
          : change > 0
            ? 'positive'
            : 'negative';
        const width = change === null ? 0 : Math.max(4, Math.abs(change) / maximum * 100);
        return (
          <div key={`${index.code}-${index.name}`} className="grid grid-cols-[minmax(5rem,1fr)_4rem] items-center gap-x-4 gap-y-1.5">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{index.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-text">
                {toFiniteNumber(index.current)?.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) || '—'}
              </span>
            </div>
            <span className={cn(
              'text-right text-sm font-semibold tabular-nums',
              changeTone === 'positive' && 'text-success',
              changeTone === 'negative' && 'text-danger',
              changeTone === 'neutral' && 'text-muted-text',
            )}>
              {formatPercent(change)}
            </span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-border/60">
              <div
                className={cn(
                  'h-full rounded-full',
                  changeTone === 'positive' && 'bg-success',
                  changeTone === 'negative' && 'bg-danger',
                  changeTone === 'neutral' && 'bg-muted-text/60',
                )}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SectorList = ({ title, items, positive }: { title: string; items: SectorRankingItem[]; positive: boolean }) => (
  <div>
    <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-text">{title}</p>
    {items.length ? (
      <div className="space-y-2.5">
        {items.slice(0, 4).map((item, index) => (
          <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-secondary-text">{item.name}</span>
            <span className={cn('shrink-0 font-medium tabular-nums', positive ? 'text-success' : 'text-danger')}>
              {formatPercent(item.changePct)}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted-text">暂无排行数据</p>
    )}
  </div>
);

export const MarketIntelligenceSection = () => {
  const initialLayout = useMemo(() => readDashboardLayout(), []);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [item, setItem] = useState<HistoryItem | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [sources, setSources] = useState<WorkspaceDataSource[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [layout, setLayout] = useState<MarketDashboardLayout>(initialLayout);
  const [layoutDraft, setLayoutDraft] = useState<MarketDashboardLayout>(initialLayout);
  const [editingLayout, setEditingLayout] = useState(false);
  const editLayoutButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setSourceUnavailable(false);

    const [historyResult, sourceResult] = await Promise.allSettled([
      historyApi.getList({ reportType: 'market_review', page: 1, limit: 1 }),
      workspaceApi.listDataSources(),
    ]);

    if (sourceResult.status === 'fulfilled') {
      setSources(sourceResult.value);
    } else {
      setSources([]);
      setSourceUnavailable(true);
    }

    if (historyResult.status === 'rejected') {
      setItem(null);
      setReport(null);
      setLoadState('error');
      return;
    }

    const latest = historyResult.value.items[0] || null;
    setItem(latest);
    if (!latest) {
      setReport(null);
      setLoadState('empty');
      return;
    }

    try {
      const detail = await historyApi.getDetail(latest.id);
      setReport(detail);
      setLoadState('ready');
    } catch {
      setReport(null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timerId);
  }, [load]);

  const payload = useMemo(() => resolvePayload(report), [report]);
  const indices = payload?.indices || [];
  const breadth = payload?.breadth;
  const up = toFiniteNumber(breadth?.upCount) || 0;
  const down = toFiniteNumber(breadth?.downCount) || 0;
  const flat = toFiniteNumber(breadth?.flatCount) || 0;
  const breadthTotal = up + down + flat;
  const snapshotTime = payload?.generatedAt || payload?.date || item?.createdAt;
  const snapshotIsRecent = isRecentSnapshot(snapshotTime);
  const overview = resolveOverview(payload, report, item);
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const defaultOptions = DEFAULT_SOURCES.map((defaultSource) => ({
      id: defaultSource.id,
      label: sources.find((source) => source.sourceId === defaultSource.id)?.name || defaultSource.label,
      purpose: sources.find((source) => source.sourceId === defaultSource.id)?.description || defaultSource.purpose,
      kind: sources.find((source) => source.sourceId === defaultSource.id)?.kind || defaultSource.kind,
      source: sources.find((source) => source.sourceId === defaultSource.id),
    }));
    const customOptions = sources
      .filter((source) => !DEFAULT_SOURCE_IDS.includes(source.sourceId))
      .map((source) => ({
        id: source.sourceId,
        label: source.name,
        purpose: source.description || '工作区登记的数据源',
        kind: source.kind,
        source,
      }));
    return [...defaultOptions, ...customOptions];
  }, [sources]);
  const visibleSources = sourceOptions.filter((source) => layout.sourceIds.includes(source.id));
  const visibleWidgets = new Set(layout.widgetIds);
  const hasIndexRow = visibleWidgets.has('indices') || visibleWidgets.has('breadth');

  const beginEditingLayout = () => {
    setLayoutDraft(layout);
    setEditingLayout(true);
  };

  const closeLayoutEditor = () => {
    editLayoutButtonRef.current?.focus();
    setEditingLayout(false);
  };

  const applyLayout = () => {
    if (!layoutDraft.widgetIds.length) return;
    setLayout(layoutDraft);
    window.localStorage.setItem(MARKET_DASHBOARD_KEY, JSON.stringify(layoutDraft));
    closeLayoutEditor();
  };

  const restoreDefaultLayout = () => {
    const defaultLayout = { widgetIds: DEFAULT_WIDGET_IDS, sourceIds: DEFAULT_SOURCE_IDS };
    setLayoutDraft(defaultLayout);
  };

  return (
    <section id="market-intelligence" aria-labelledby="market-intelligence-title" data-testid="market-intelligence" className="scroll-mt-20">
      <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Latest market snapshot
          </div>
          <h1 id="market-intelligence-title" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">市场情报</h1>
          <p className="mt-2 text-sm leading-6 text-secondary-text">
            默认读取已配置的行情、新闻与基本面来源，展示最新可追溯的市场复盘；数据时间与来源状态会一并保留。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button
            ref={editLayoutButtonRef}
            type="button"
            onClick={beginEditingLayout}
            aria-expanded={editingLayout}
            aria-controls="market-dashboard-editor"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-text transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            编辑展示
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loadState === 'loading'}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-text transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadState === 'loading' && 'animate-spin')} aria-hidden="true" />
            重新读取
          </button>
        </div>
      </div>

      {editingLayout ? (
        <section id="market-dashboard-editor" className="border-x border-b border-border bg-card" aria-labelledby="market-dashboard-editor-title">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <h3 id="market-dashboard-editor-title" className="text-sm font-semibold text-foreground">编辑市场情报展示</h3>
              <p className="mt-1 text-xs leading-5 text-muted-text">选择复盘内容和需要关注的数据源。设置只保存在当前浏览器。</p>
            </div>
            <p className="text-xs font-medium text-secondary-text">{layoutDraft.widgetIds.length} 个内容模块 · {layoutDraft.sourceIds.length} 个数据源</p>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.78fr)]">
            <fieldset className="min-w-0 border-b border-border px-5 py-5 xl:border-b-0 xl:border-r sm:px-7">
              <legend className="text-xs font-semibold text-foreground">复盘内容</legend>
              <div className="mt-3 divide-y divide-border border-y border-border">
                {WIDGET_OPTIONS.map((widget) => {
                  const selected = layoutDraft.widgetIds.includes(widget.id);
                  const lastSelected = selected && layoutDraft.widgetIds.length === 1;
                  return (
                    <label key={widget.id} className={cn('flex items-start gap-3 py-3.5', lastSelected && 'cursor-not-allowed opacity-65')}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={lastSelected}
                        onChange={() => setLayoutDraft((current) => ({ ...current, widgetIds: toggleItem(current.widgetIds, widget.id) }))}
                        className="mt-0.5 h-4 w-4 accent-primary"
                        aria-label={`显示 ${widget.label}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{widget.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-text">{widget.description} · 默认依赖 {widget.sourceHint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="min-w-0 px-5 py-5 sm:px-7">
              <legend className="text-xs font-semibold text-foreground">数据源信息</legend>
              <p className="mt-2 text-xs leading-5 text-muted-text">可替换默认来源，也可以加入工作区自定义数据源。</p>
              <div className="mt-3 max-h-64 divide-y divide-border overflow-y-auto border-y border-border pr-1">
                {sourceOptions.map((option) => {
                  const selected = layoutDraft.sourceIds.includes(option.id);
                  return (
                    <label key={option.id} className="flex items-start gap-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setLayoutDraft((current) => ({ ...current, sourceIds: toggleItem(current.sourceIds, option.id) }))}
                        className="mt-0.5 h-4 w-4 accent-primary"
                        aria-label={`显示数据源 ${option.label} ${SOURCE_KIND_LABELS[option.kind]}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium text-foreground">{option.label}</span>
                          <span className="shrink-0 text-[11px] text-muted-text">{SOURCE_KIND_LABELS[option.kind]}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-text">{option.purpose}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <button type="button" onClick={restoreDefaultLayout} className="inline-flex items-center gap-2 self-start text-xs font-medium text-secondary-text hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              恢复默认展示
            </button>
            <div className="flex gap-2 self-end">
              <button type="button" onClick={closeLayoutEditor} className="btn-secondary">取消</button>
              <button type="button" onClick={applyLayout} className="btn-primary inline-flex items-center gap-2">
                <Check className="h-4 w-4" aria-hidden="true" />
                应用展示
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid border-x border-b border-border bg-card xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]">
        <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
          {loadState === 'loading' || loadState === 'idle' ? (
            <div className="flex min-h-[27rem] items-center justify-center px-6 text-sm text-muted-text" role="status">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              正在读取最新市场复盘…
            </div>
          ) : loadState === 'error' ? (
            <div className="flex min-h-[27rem] flex-col items-center justify-center px-6 text-center">
              <BarChart3 className="h-8 w-8 text-muted-text" aria-hidden="true" />
              <p className="mt-4 font-medium text-foreground">暂时无法读取市场复盘</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-secondary-text">请确认历史记录接口可用后重试。数据源配置状态仍可在右侧单独查看。</p>
            </div>
          ) : loadState === 'empty' ? (
            <div className="flex min-h-[27rem] flex-col items-center justify-center px-6 text-center">
              <BarChart3 className="h-8 w-8 text-muted-text" aria-hidden="true" />
              <p className="mt-4 font-medium text-foreground">暂无市场复盘数据</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-secondary-text">完成一次大盘复盘后，这里会自动展示指数、市场宽度、板块与 Agent 摘要。</p>
            </div>
          ) : (
            <>
              {visibleWidgets.has('overview') ? (
                <div className="border-b border-border px-5 py-5 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                      snapshotIsRecent
                        ? 'border-success/25 bg-success/5 text-success'
                        : 'border-warning/25 bg-warning/5 text-warning',
                    )}>
                      {snapshotIsRecent ? '最新快照' : '历史快照'}
                    </span>
                    <span className="text-xs text-muted-text">数据截至 {formatSnapshotTime(snapshotTime)}</span>
                    <span className="text-xs text-muted-text">·</span>
                    <span className="text-xs text-muted-text">{payload?.marketScope || payload?.region || item?.region || '市场范围未标注'}</span>
                  </div>
                  <div className="mt-5 flex gap-3">
                    <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Agent 市场摘要</p>
                      <p className="mt-2 max-w-4xl text-sm leading-7 text-foreground">{overview}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {hasIndexRow ? (
                <div className={cn('grid', visibleWidgets.has('indices') && visibleWidgets.has('breadth') && 'md:grid-cols-2')}>
                  {visibleWidgets.has('indices') ? (
                    <div className={cn('border-b border-border px-5 py-6 sm:px-7', visibleWidgets.has('breadth') && 'md:border-b-0 md:border-r')}>
                      <div className="mb-5 flex items-center justify-between gap-4">
                        <h3 className="text-sm font-semibold text-foreground">主要指数</h3>
                        <span className="text-xs text-muted-text">涨跌幅</span>
                      </div>
                      <IndexPerformance indices={indices} />
                    </div>
                  ) : null}

                  {visibleWidgets.has('breadth') ? (
                    <div className="px-5 py-6 sm:px-7">
                      <h3 className="text-sm font-semibold text-foreground">市场宽度</h3>
                      {breadthTotal > 0 ? (
                        <>
                          <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-border/60" aria-label={`上涨 ${up}，下跌 ${down}，平盘 ${flat}`}>
                            <div className="bg-success" style={{ width: `${up / breadthTotal * 100}%` }} />
                            <div className="bg-muted-text/50" style={{ width: `${flat / breadthTotal * 100}%` }} />
                            <div className="bg-danger" style={{ width: `${down / breadthTotal * 100}%` }} />
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-3">
                            <div><p className="text-xs text-muted-text">上涨</p><p className="mt-1 text-lg font-semibold tabular-nums text-success">{formatCount(up)}</p></div>
                            <div><p className="text-xs text-muted-text">平盘</p><p className="mt-1 text-lg font-semibold tabular-nums text-secondary-text">{formatCount(flat)}</p></div>
                            <div><p className="text-xs text-muted-text">下跌</p><p className="mt-1 text-lg font-semibold tabular-nums text-danger">{formatCount(down)}</p></div>
                          </div>
                          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs">
                            <div><span className="text-muted-text">涨停</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.limitUpCount)}</span></div>
                            <div><span className="text-muted-text">跌停</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.limitDownCount)}</span></div>
                            <div className="col-span-2"><span className="text-muted-text">成交额</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.totalAmount)} {breadth?.turnoverUnit || ''}</span></div>
                          </div>
                        </>
                      ) : (
                        <p className="py-6 text-sm text-muted-text">本次复盘没有结构化市场宽度数据。</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {visibleWidgets.has('sectors') ? (
                <div className="grid gap-6 border-t border-border px-5 py-6 sm:grid-cols-2 sm:px-7">
                  <SectorList title="领涨板块" items={payload?.sectors?.top || []} positive />
                  <SectorList title="承压板块" items={payload?.sectors?.bottom || []} positive={false} />
                </div>
              ) : null}
            </>
          )}
        </div>

        <aside className="min-w-0 px-5 py-6 sm:px-7" aria-label="市场情报展示数据源">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">看板数据源</h3>
            </div>
            <span className="text-[11px] font-medium text-muted-text">{visibleSources.length} 项</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-text">默认展示公共行情、新闻和基本面来源；可以通过“编辑展示”替换为工作区数据源。</p>

          {visibleSources.length ? (
            <div className="mt-5 divide-y divide-border border-y border-border">
              {visibleSources.map((option) => (
                <div key={option.id} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{option.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-text">{option.purpose}</p>
                    </div>
                    {option.source?.selectable ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <SourceStatus source={option.source} unavailable={sourceUnavailable} />
                    <span className="text-[11px] text-muted-text">{SOURCE_KIND_LABELS[option.kind]}</span>
                    <span className="text-[11px] text-muted-text">{formatSourceMarkets(option.source?.markets)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 border-y border-border py-5">
              <p className="text-sm font-medium text-foreground">未选择数据源信息</p>
              <p className="mt-1 text-xs leading-5 text-muted-text">复盘内容仍会按已保存快照展示；编辑看板可以重新加入来源状态。</p>
            </div>
          )}

          <Link to="/capabilities/data" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            管理数据源
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-text">
            当前自定义来源只展示目录详情与连接状态。只有后端声明并返回对应展示数据时，才会生成新的指标或图表。
          </p>
        </aside>
      </div>
    </section>
  );
};

export default MarketIntelligenceSection;
