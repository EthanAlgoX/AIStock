import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Newspaper,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { analysisApi } from '../../api/analysis';
import { toApiErrorMessage } from '../../api/error';
import { historyApi } from '../../api/history';
import {
  intelligenceApi,
  type IntelligenceItem,
  type IntelligenceSource,
} from '../../api/intelligence';
import {
  workspaceApi,
  type MarketDashboard,
  type MarketDashboardWidgetId,
  type MarketSubscription,
  type WorkspaceDataSource,
  type WorkspaceCapabilityCatalog,
  type WorkspaceTask,
} from '../../api/workspace';
import AgentCapabilityPanel from '../agent/AgentCapabilityPanel';
import {
  EMPTY_AGENT_CAPABILITIES,
  countAgentCapabilities,
  type AgentCapabilityBindings,
} from '../../types/capabilities';
import type {
  AnalysisReport,
  HistoryItem,
  MarketReviewIndex,
  MarketMacroIndicator,
  MarketReviewPayload,
  MarketReviewRegion,
  MarketSnapshot,
  SectorRankingItem,
  TaskInfo,
} from '../../types/analysis';
import { cn } from '../../utils/cn';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type RefreshState = 'idle' | 'submitting' | 'running' | 'completed' | 'error';
type WidgetId = MarketDashboardWidgetId;

type MarketDashboardLayout = {
  widgetIds: WidgetId[];
  newsSourceIds: number[];
  newsKeywords: string[];
};

const MARKET_DASHBOARD_KEY = 'dsa.market-intelligence-layout.v3';
const MARKET_SELECTION_KEY = 'dsa.market-intelligence-market.v1';
const DEFAULT_WIDGET_IDS: WidgetId[] = ['overview', 'subscriptions', 'macro', 'indices', 'breadth', 'sectors', 'news'];
const MARKET_OPTIONS: Array<{ id: MarketReviewRegion; label: string }> = [
  { id: 'cn', label: 'A 股' },
  { id: 'hk', label: '港股' },
  { id: 'us', label: '美股' },
];
const MARKET_TIMEZONES: Record<string, string> = {
  cn: 'Asia/Shanghai',
  hk: 'Asia/Hong_Kong',
  us: 'America/New_York',
};
const WIDGET_OPTIONS: Array<{ id: WidgetId; label: string; description: string; sourceHint: string }> = [
  { id: 'overview', label: 'Agent 市场摘要', description: '展示最近一次完整复盘形成的核心判断。', sourceHint: '行情、资讯与 Agent' },
  { id: 'subscriptions', label: '分析订阅', description: '展示定时任务最近一次成功运行的摘要。', sourceHint: 'Task、Run 与 Artifact' },
  { id: 'macro', label: '宏观监控', description: '展示三地共同宏观变量和当前市场的专属驱动。', sourceHint: '宏观行情快照与监控框架' },
  { id: 'indices', label: '主要指数', description: '展示指数点位、涨跌幅和相对波动。', sourceHint: '行情提供方' },
  { id: 'breadth', label: '市场宽度', description: '展示涨跌家数、涨跌停与成交额。', sourceHint: 'A 股行情提供方' },
  { id: 'sectors', label: '板块排行', description: '展示最近一次复盘中的领涨和承压板块。', sourceHint: '板块行情' },
  { id: 'news', label: '市场资讯', description: '展示情报服务已经抓取并保存的最新真实资讯。', sourceHint: '已启用资讯源' },
];

type MacroChecklistItem = {
  key: string;
  label: string;
  category: string;
  rationale: string;
};

type MarketMacroFramework = {
  chain: string;
  summary: string;
  primary: Array<{ label: string; importance: 3 | 4 | 5; rationale: string }>;
  secondary: string[];
};

const COMMON_MACRO_CHECKLIST: MacroChecklistItem[] = [
  { key: 'us_2y', label: '美国 2Y', category: '资金价格', rationale: '最敏感地反映 Fed 政策预期' },
  { key: 'us_10y', label: '美国 10Y', category: '资金价格', rationale: '全球资产的重要折现率锚' },
  { key: 'us_10y_real', label: '美国 10Y 实际利率', category: '资金价格', rationale: '成长股与长久期资产估值核心变量' },
  { key: 'fed_expectations', label: 'Fed 政策预期', category: '资金价格', rationale: '决定美元资产机会成本' },
  { key: 'dxy', label: 'DXY', category: '流动性', rationale: '美元走强通常意味着全球金融条件收紧' },
  { key: 'usd_cnh', label: 'USD/CNH', category: '流动性', rationale: '观察中国资产风险溢价与资本流动' },
  { key: 'usd_jpy', label: 'USD/JPY', category: '流动性', rationale: '日元急升可能触发套息交易去杠杆' },
  { key: 'vix', label: 'VIX', category: '风险偏好', rationale: '重点观察波动率是否快速抬升' },
  { key: 'us_high_yield_spread', label: '美国高收益信用利差', category: '风险偏好', rationale: '领先观察企业信用与衰退风险' },
  { key: 'brent', label: 'Brent 原油', category: '全球周期', rationale: '能源冲击会改变通胀与利率预期' },
  { key: 'copper', label: '铜', category: '全球周期', rationale: '辅助判断全球制造业需求' },
  { key: 'china_10y', label: '中国 10Y', category: '中国周期', rationale: '反映国内增长与货币政策预期' },
  { key: 'china_credit', label: '社融 / 信用趋势', category: '中国周期', rationale: '判断信用扩张或收缩' },
  { key: 'china_property', label: '中国房地产趋势', category: '中国周期', rationale: '影响居民财富、银行和地产链预期' },
  { key: 'global_pmi', label: '中美欧 PMI', category: '全球周期', rationale: '识别全球扩张、放缓、衰退或复苏' },
];

const MARKET_RELEASES: Record<'cn' | 'hk' | 'us', Array<{ key: string; label: string }>> = {
  cn: [
    { key: 'china_pmi', label: '中国制造业 PMI' },
    { key: 'china_cpi_yoy', label: '中国 CPI 同比' },
    { key: 'china_ppi_yoy', label: '中国 PPI 同比' },
    { key: 'china_gdp_yoy', label: '中国 GDP 同比' },
  ],
  hk: [
    { key: 'china_pmi', label: '中国制造业 PMI' },
    { key: 'china_cpi_yoy', label: '中国 CPI 同比' },
    { key: 'china_ppi_yoy', label: '中国 PPI 同比' },
    { key: 'china_gdp_yoy', label: '中国 GDP 同比' },
  ],
  us: [
    { key: 'us_cpi', label: '美国 CPI' },
    { key: 'us_unemployment', label: '美国失业率' },
  ],
};

const MARKET_MACRO_FRAMEWORKS: Record<'cn' | 'hk' | 'us', MarketMacroFramework> = {
  cn: {
    chain: '信用周期 → 财政力度 → 房地产 → 国内流动性 → 经济修复',
    summary: 'A 股更偏内生，核心问题是中国是否进入新的信用扩张阶段。',
    primary: [
      { label: '货币政策', importance: 5, rationale: 'LPR、MLF、逆回购、降准与降息' },
      { label: '社融与货币', importance: 5, rationale: '社融、人民币贷款及 M1/M2' },
      { label: '财政力度', importance: 5, rationale: '专项债、特别国债与财政支出' },
      { label: '房地产', importance: 5, rationale: '销售、投资、融资与政策变化' },
      { label: '经济修复', importance: 4, rationale: 'PMI、工业增加值与固定资产投资' },
    ],
    secondary: ['CPI / PPI', 'USD/CNY 与 USD/CNH', '中国 10Y', '外资风险偏好', '铜、原油与黑色系'],
  },
  hk: {
    chain: '中国增长预期 × 美国利率环境 × 人民币汇率',
    summary: '港股同时暴露于中国经济周期和美元金融周期，宏观敏感度最高。',
    primary: [
      { label: '美国 10Y', importance: 5, rationale: '直接影响港股尤其科技股的折现率' },
      { label: '美国实际利率', importance: 5, rationale: '压制或释放互联网与成长股估值' },
      { label: 'Fed 政策预期', importance: 5, rationale: '影响全球美元资金配置' },
      { label: 'USD/CNH', importance: 5, rationale: '反映中国资产风险溢价与资本流动' },
      { label: '中国基本面', importance: 5, rationale: '经济、房地产与政策决定盈利预期' },
    ],
    secondary: ['DXY', '美元流动性', 'USD/JPY 与美日利差', 'VIX 与信用利差', '南向资金'],
  },
  us: {
    chain: '通胀 → Fed → 美债实际利率 → 估值；增长 → 企业盈利 → 股价',
    summary: '美股需要同时判断利率估值链和增长盈利链，强数据不一定等于利好。',
    primary: [
      { label: 'Fed', importance: 5, rationale: '利率决议、点阵图与官员讲话' },
      { label: '美国 2Y / 10Y', importance: 5, rationale: '政策预期与股票估值折现率' },
      { label: '美国实际利率', importance: 5, rationale: '科技成长股最敏感的宏观变量之一' },
      { label: '通胀', importance: 5, rationale: 'CPI、核心 CPI 与 PCE 决定政策反应' },
      { label: '就业', importance: 5, rationale: '非农、失业率与工资决定增长和降息空间' },
    ],
    secondary: ['ISM / PMI 与零售销售', 'Fed 资产负债表', '信用利差', 'VIX', 'TGA 与国债发行', '原油', 'USD/JPY'],
  },
};

const readDashboardLayout = (): MarketDashboardLayout => {
  if (typeof window === 'undefined') return { widgetIds: DEFAULT_WIDGET_IDS, newsSourceIds: [], newsKeywords: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MARKET_DASHBOARD_KEY) || '{}') as Partial<MarketDashboardLayout>;
    const widgetIds = Array.isArray(parsed.widgetIds)
      ? parsed.widgetIds.filter((id): id is WidgetId => DEFAULT_WIDGET_IDS.includes(id as WidgetId))
      : DEFAULT_WIDGET_IDS;
    return { widgetIds: widgetIds.length ? widgetIds : DEFAULT_WIDGET_IDS, newsSourceIds: [], newsKeywords: [] };
  } catch {
    return { widgetIds: DEFAULT_WIDGET_IDS, newsSourceIds: [], newsKeywords: [] };
  }
};

const toWorkspaceMarket = (market: MarketReviewRegion): WorkspaceTask['market'] => market.toUpperCase() as WorkspaceTask['market'];

const dashboardLayout = (dashboard: MarketDashboard): MarketDashboardLayout => ({
  widgetIds: dashboard.widgetIds,
  newsSourceIds: dashboard.newsSourceIds || [],
  newsKeywords: dashboard.newsKeywords || [],
});

const readMarket = (): MarketReviewRegion => {
  if (typeof window === 'undefined') return 'cn';
  const value = window.localStorage.getItem(MARKET_SELECTION_KEY);
  return MARKET_OPTIONS.some((market) => market.id === value) ? value as MarketReviewRegion : 'cn';
};

const toggleItem = <T,>(items: T[], value: T): T[] => (
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
);

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

const clampText = (value: string, maxLength = 240): string => (
  value.length > maxLength ? `${value.slice(0, maxLength).trim()}…` : value
);

const resolvePayload = (report: AnalysisReport | null, market: MarketReviewRegion): MarketReviewPayload | null => {
  const payload = report?.details?.contextSnapshot?.marketReviewPayload;
  if (!payload) return null;
  if (payload.markets?.[market]) return payload.markets[market];
  if (payload.indices?.length || payload.macroIndicators?.length || payload.breadth || payload.sectors) return payload;
  return null;
};

const resolveOverview = (
  payload: MarketReviewPayload | null,
  report: AnalysisReport | null,
  item: HistoryItem | null,
): string => {
  const preferredSection = payload?.sections?.find((section) => (
    section.key === 'overview' || /overview|盘面总览|市场总览/i.test(section.title)
  ));
  const result = [preferredSection?.markdown, report?.summary?.analysisSummary, item?.analysisSummary]
    .map((candidate) => stripMarkdown(candidate || ''))
    .find(Boolean);
  return result ? clampText(result) : '本次市场复盘没有生成可展示的摘要，请查看完整报告或重新生成。';
};

const formatDateTime = (value?: string | null, includeYear = false): string => {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const snapshotAgeHours = (value?: string | null): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
};

const historyMatchesMarket = (item: HistoryItem, market: MarketReviewRegion): boolean => {
  const region = String(item.region || '').toLowerCase();
  if (region.split(',').map((token) => token.trim()).includes(market)) return true;
  return String(item.stockCode || '').toLowerCase().endsWith(`_${market}`);
};

const taskMatchesMarket = (task: TaskInfo, market: MarketReviewRegion): boolean => {
  if (String(task.stockCode || '').toLowerCase() !== 'market_review') return false;
  const region = String(task.region || '').toLowerCase();
  return !region || region.split(',').map((token) => token.trim()).includes(market);
};

const mergeIntelligence = (...groups: IntelligenceItem[][]): IntelligenceItem[] => {
  const seen = new Set<number>();
  return groups.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((left, right) => {
    const leftTime = new Date(left.publishedAt || left.fetchedAt || 0).getTime();
    const rightTime = new Date(right.publishedAt || right.fetchedAt || 0).getTime();
    return rightTime - leftTime;
  });
};

const mergeSources = (...groups: IntelligenceSource[][]): IntelligenceSource[] => {
  const seen = new Set<number>();
  return groups.flat().filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
};

const IndexPerformance = ({ indices }: { indices: MarketReviewIndex[] }) => {
  const visible = indices.slice(0, 6);
  const maximum = Math.max(1, ...visible.map((index) => Math.abs(toFiniteNumber(index.changePct) || 0)));
  if (!visible.length) return <p className="py-6 text-sm text-muted-text">本次复盘没有结构化指数数据。</p>;

  return (
    <div className="space-y-4" aria-label="指数表现">
      {visible.map((index) => {
        const change = toFiniteNumber(index.changePct);
        const tone = change === null || change === 0 ? 'neutral' : change > 0 ? 'positive' : 'negative';
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
              tone === 'positive' && 'text-success', tone === 'negative' && 'text-danger', tone === 'neutral' && 'text-muted-text',
            )}>{formatPercent(change)}</span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-border/60">
              <div className={cn('h-full rounded-full', tone === 'positive' && 'bg-success', tone === 'negative' && 'bg-danger', tone === 'neutral' && 'bg-muted-text/60')} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SectorList = ({ title, items, positive }: { title: string; items: SectorRankingItem[]; positive: boolean }) => (
  <div className="min-w-0">
    <p className="mb-3 text-xs font-medium text-muted-text">{title}</p>
    {items.length ? (
      <div className="space-y-2.5">
        {items.slice(0, 5).map((item, index) => (
          <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-secondary-text">{item.name}</span>
            <span className={cn('shrink-0 font-medium tabular-nums', positive ? 'text-success' : 'text-danger')}>{formatPercent(item.changePct)}</span>
          </div>
        ))}
      </div>
    ) : <p className="text-sm text-muted-text">暂无排行数据</p>}
  </div>
);

const IntelligenceList = ({ items, state }: { items: IntelligenceItem[]; state: LoadState }) => {
  if (state === 'loading' || state === 'idle') {
    return <p className="flex items-center gap-2 py-6 text-sm text-muted-text" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取已抓取资讯…</p>;
  }
  if (state === 'error') return <p className="py-6 text-sm text-muted-text">资讯服务暂时不可用，市场快照仍可正常查看。</p>;
  if (!items.length) return <p className="py-6 text-sm text-muted-text">当前市场暂无已抓取资讯。可以在数据源页面检查资讯源的同步状态。</p>;

  return (
    <div className="divide-y divide-border">
      {items.slice(0, 8).map((news) => {
        const hasExternalUrl = /^https?:\/\//i.test(news.url);
        const title = (
          <>
            <span className="line-clamp-2 min-w-0 text-sm font-medium leading-6 text-foreground">{news.title}</span>
            {hasExternalUrl ? <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-text" aria-hidden="true" /> : null}
          </>
        );
        return (
          <article key={news.id} className="py-4 first:pt-0 last:pb-0">
            {hasExternalUrl ? <a href={news.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:text-primary">{title}</a> : <div className="flex items-start gap-2">{title}</div>}
            {news.summary ? <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-secondary-text">{news.summary}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-text">
              <span>{news.sourceName || news.source || '来源未标注'}</span>
              <span aria-hidden="true">·</span>
              <span>{formatDateTime(news.publishedAt || news.fetchedAt)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5">{String(news.market || 'global').toUpperCase()}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const FeedStatus = ({ source }: { source: IntelligenceSource }) => {
  const succeeded = source.lastStatus === 'success';
  const failed = Boolean(source.lastStatus && !succeeded);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', succeeded && 'text-success', failed && 'text-danger', !source.lastStatus && 'text-muted-text')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', succeeded && 'bg-success', failed && 'bg-danger', !source.lastStatus && 'bg-muted-text')} aria-hidden="true" />
      {succeeded ? '最近同步成功' : failed ? '最近同步失败' : '尚未同步'}
    </span>
  );
};

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '运行失败',
  cancelled: '已取消',
};

const AnalysisSubscriptions = ({ subscriptions }: { subscriptions: MarketSubscription[] }) => {
  const visible = subscriptions.filter((item) => item.enabled);
  return (
    <section className="border-t border-border px-5 py-6 sm:px-7" aria-labelledby="market-subscriptions-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="market-subscriptions-title" className="text-sm font-semibold text-foreground">分析订阅</h2>
          <p className="mt-1 text-xs leading-5 text-muted-text">这里只显示任务摘要；完整内容保存在对应 Run 和 Artifact 中。</p>
        </div>
        <Link to="/schedules" className="text-xs font-medium text-primary hover:underline">管理定时任务</Link>
      </div>
      {visible.length ? (
        <div className="mt-5 divide-y divide-border border-y border-border">
          {visible.map((subscription) => {
            const artifact = subscription.latestArtifact;
            const latestRun = subscription.latestRun;
            const running = latestRun?.status === 'queued' || latestRun?.status === 'running';
            const failed = latestRun?.status === 'failed';
            const stock = String(subscription.task?.subject?.stockName || subscription.task?.subject?.stock || '');
            return (
              <article key={subscription.id} className="py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{subscription.title}</p>
                      {stock ? <span className="text-[11px] text-muted-text">{stock}</span> : null}
                      <span className={cn('text-[11px] font-medium', running && 'text-warning', failed && 'text-danger', !running && !failed && 'text-success')}>
                        {RUN_STATUS_LABEL[latestRun?.status || ''] || (artifact ? '已有成果' : '等待首次运行')}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[75ch] text-sm leading-6 text-secondary-text">
                      {artifact?.summary.text || (running ? '新一轮分析正在运行，完成前继续保留上一份成功成果。' : failed ? latestRun?.errorMessage || '最近一次任务未完成，可在运行账本查看失败原因。' : '任务尚未产生可展示的成功成果。')}
                    </p>
                    {artifact?.summary.risks?.length ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-warning">风险：{artifact.summary.risks.join('；')}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-text">
                      <span>{subscription.task?.kind === 'research' ? '个股分析' : subscription.task?.kind === 'screening' ? '选股' : subscription.task?.kind === 'market_analysis' ? '宏观分析' : subscription.task?.kind === 'industry_analysis' ? '产业分析' : 'Agent 任务'}</span>
                      <span>成果时间 {formatDateTime(artifact?.createdAt)}</span>
                      {artifact?.summary.confidence != null ? <span>置信度 {Math.round(artifact.summary.confidence * 100)}%</span> : null}
                    </div>
                  </div>
                  {artifact ? (
                    <Link to={`/runs/${artifact.runId}`} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start text-xs font-medium text-primary hover:underline">
                      查看完整成果 <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : (
                    <Link to="/runs" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start text-xs font-medium text-secondary-text hover:text-foreground">
                      查看运行 <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 flex min-h-28 flex-col items-center justify-center border-y border-border px-5 py-6 text-center">
          <p className="text-sm font-medium text-foreground">还没有分析订阅</p>
          <p className="mt-1 text-xs leading-5 text-muted-text">可在个股分析或选股页面创建定时任务，并选择展示到市场看板。</p>
        </div>
      )}
    </section>
  );
};

const formatMacroValue = (indicator: MarketMacroIndicator): string => {
  const value = toFiniteNumber(indicator.current);
  if (value === null) return '—';
  const digits = Math.abs(value) >= 100 ? 2 : 3;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: digits })}${indicator.unit ? ` ${indicator.unit}` : ''}`;
};

const dataSourceState = (source: WorkspaceDataSource): { label: string; className: string } => {
  if (source.healthStatus === 'available') return { label: '可用', className: 'text-success' };
  if (source.healthStatus === 'degraded') return { label: '部分可用', className: 'text-warning' };
  if (source.healthStatus === 'unavailable') return { label: '不可用', className: 'text-danger' };
  if (source.availability === 'unconfigured' || source.healthStatus === 'not_configured') return { label: '未配置', className: 'text-muted-text' };
  return { label: '已配置 · 未检测', className: 'text-secondary-text' };
};

const resolveMacroIndicators = (
  macroIndicators: MarketMacroIndicator[],
  indices: MarketReviewIndex[],
): Map<string, MarketMacroIndicator> => {
  const result = new Map(
    macroIndicators
      .filter((indicator) => toFiniteNumber(indicator.current) !== null)
      .map((indicator) => [indicator.key, indicator]),
  );
  if (!result.has('vix')) {
    const vix = indices.find((index) => index.code.toUpperCase() === 'VIX' || /VIX|恐慌指数/i.test(index.name));
    if (vix) {
      result.set('vix', {
        key: 'vix',
        name: 'VIX',
        current: vix.current,
        changePct: vix.changePct,
        source: '市场复盘指数快照',
      });
    }
  }
  return result;
};

const MacroMonitor = ({
  market,
  macroIndicators,
  indices,
  analysisSkills,
}: {
  market: MarketReviewRegion;
  macroIndicators: MarketMacroIndicator[];
  indices: MarketReviewIndex[];
  analysisSkills: string[];
}) => {
  const framework = MARKET_MACRO_FRAMEWORKS[market as 'cn' | 'hk' | 'us'];
  const observations = resolveMacroIndicators(macroIndicators, indices);
  const availableCount = COMMON_MACRO_CHECKLIST.filter((item) => observations.has(item.key)).length;
  const marketReleases = MARKET_RELEASES[market as 'cn' | 'hk' | 'us'];

  return (
    <section className="border-t border-border px-5 py-6 sm:px-7" aria-labelledby="macro-monitor-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-[72ch]">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id="macro-monitor-title" className="text-sm font-semibold text-foreground">宏观监控</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-text">共同变量用于观察全球资金价格、流动性、风险偏好和经济周期；市场专属变量用于解释当前市场的主要传导链。</p>
          {analysisSkills.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="已就绪的市场分析 Skill">
              <span className="text-[11px] font-medium text-muted-text">复盘框架已就绪</span>
              {analysisSkills.map((skill) => <span key={skill} className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">{skill}</span>)}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-secondary-text">真实快照 {availableCount}/15</span>
      </div>

      <div className="mt-5 grid border-y border-border lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="border-b border-border py-5 lg:border-b-0 lg:border-r lg:pr-6">
          <p className="text-xs font-semibold text-primary">当前市场传导链</p>
          <p className="mt-2 text-base font-semibold leading-7 text-foreground">{framework.chain}</p>
          <p className="mt-2 text-xs leading-5 text-secondary-text">{framework.summary}</p>
          <div className="mt-5 divide-y divide-border border-t border-border">
            {framework.primary.map((driver) => (
              <div key={driver.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{driver.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-text">{driver.rationale}</p>
                </div>
                <span className="text-[11px] font-medium tabular-nums text-secondary-text">优先级 {driver.importance}/5</span>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-[11px] font-medium text-muted-text">其他重点</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
              {framework.secondary.map((label) => <span key={label} className="text-xs text-secondary-text">{label}</span>)}
            </div>
          </div>
        </div>

        <div className="py-5 lg:pl-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">每日宏观检查表</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-text">未接入项只保留监控定义，不显示估算值。</p>
            </div>
            <Activity className="h-4 w-4 shrink-0 text-muted-text" aria-hidden="true" />
          </div>
          <div className="mt-4 grid border-t border-border md:grid-cols-2" aria-label="每日宏观检查表">
            {COMMON_MACRO_CHECKLIST.map((item, index) => {
              const indicator = observations.get(item.key);
              const change = toFiniteNumber(indicator?.changePct);
              return (
                <div key={item.key} className={cn(
                  'min-w-0 border-b border-border py-3 md:px-4',
                  index % 2 === 0 ? 'md:border-r md:pl-0' : 'md:pr-0',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <span className="text-[10px] text-muted-text">{item.category}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-text">{item.rationale}</p>
                      {indicator ? <p className="mt-1 text-[10px] leading-4 text-muted-text">{indicator.source || '来源未标注'} · {formatDateTime(indicator.asOf)}</p> : null}
                    </div>
                    {indicator ? (
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-semibold tabular-nums text-foreground">{formatMacroValue(indicator)}</p>
                        <p className="mt-1 text-[10px] tabular-nums text-secondary-text">{indicator.changeLabel || '日变动'} {change === null ? '—' : formatPercent(change)}</p>
                      </div>
                    ) : <span className="shrink-0 text-[10px] font-medium text-warning">待接入</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {marketReleases.some((item) => observations.has(item.key)) ? (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs font-semibold text-foreground">市场专属发布值</p>
              <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                {marketReleases.map((item) => {
                  const indicator = observations.get(item.key);
                  if (!indicator) return null;
                  const change = toFiniteNumber(indicator.changePct);
                  return (
                    <div key={item.key} className="flex items-start justify-between gap-3 border-b border-border pb-3">
                      <div className="min-w-0"><p className="text-sm font-medium text-foreground">{item.label}</p><p className="mt-1 text-[10px] text-muted-text">{indicator.source || '来源未标注'} · {formatDateTime(indicator.asOf)}</p></div>
                      <div className="shrink-0 text-right"><p className="text-xs font-semibold tabular-nums text-foreground">{formatMacroValue(indicator)}</p><p className="mt-1 text-[10px] text-secondary-text">{indicator.changeLabel || '较前值'} {change === null ? '—' : formatPercent(change)}</p></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-5 text-muted-text">宏观观测由已配置的数据源随复盘保存。中国 GDP、CPI、PPI、PMI 可由免密钥公共接口提供；FRED 密钥可补充官方美债、实际利率、信用利差、通胀和就业序列。社融、房地产与政策预期仍保持待接入，不显示估算值。</p>
        </div>
      </div>
    </section>
  );
};

export const MarketIntelligenceSection = () => {
  const initialLayout = useMemo(() => readDashboardLayout(), []);
  const [market, setMarket] = useState<MarketReviewRegion>(() => readMarket());
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [snapshotState, setSnapshotState] = useState<LoadState>('idle');
  const [liveSnapshot, setLiveSnapshot] = useState<MarketSnapshot | null>(null);
  const [newsState, setNewsState] = useState<LoadState>('idle');
  const [feedState, setFeedState] = useState<LoadState>('idle');
  const [item, setItem] = useState<HistoryItem | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceDataSource[]>([]);
  const [feedSources, setFeedSources] = useState<IntelligenceSource[]>([]);
  const [newsItems, setNewsItems] = useState<IntelligenceItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<MarketSubscription[]>([]);
  const [availableTasks, setAvailableTasks] = useState<WorkspaceTask[]>([]);
  const [capabilityCatalog, setCapabilityCatalog] = useState<WorkspaceCapabilityCatalog | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [layout, setLayout] = useState<MarketDashboardLayout>(initialLayout);
  const [layoutDraft, setLayoutDraft] = useState<MarketDashboardLayout>(initialLayout);
  const [editingLayout, setEditingLayout] = useState(false);
  const [editorTab, setEditorTab] = useState<'layout' | 'analysis' | 'data'>('layout');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [analysisBuilderOpen, setAnalysisBuilderOpen] = useState(false);
  const [analysisKind, setAnalysisKind] = useState<'market_analysis' | 'industry_analysis'>('market_analysis');
  const [analysisName, setAnalysisName] = useState('');
  const [analysisObjective, setAnalysisObjective] = useState('');
  const [analysisRunAt, setAnalysisRunAt] = useState('18:30');
  const [analysisCapabilities, setAnalysisCapabilities] = useState<AgentCapabilityBindings>(EMPTY_AGENT_CAPABILITIES);
  const [analysisCapabilityOpen, setAnalysisCapabilityOpen] = useState(false);
  const [newsKeywordDraft, setNewsKeywordDraft] = useState('');
  const [dashboardSaving, setDashboardSaving] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [refreshTaskId, setRefreshTaskId] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const editLayoutButtonRef = useRef<HTMLButtonElement>(null);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async (
    selectedMarket: MarketReviewRegion = market,
    forceSnapshot = false,
  ) => {
    const sequence = ++loadSequenceRef.current;
    setLoadState('loading');
    setSnapshotState('loading');
    setLiveSnapshot(null);
    setNewsState('loading');
    setFeedState('loading');
    setSourceUnavailable(false);

    void analysisApi.getMarketSnapshot(selectedMarket, forceSnapshot).then((snapshot) => {
      if (sequence !== loadSequenceRef.current) return;
      setLiveSnapshot(snapshot);
      setSnapshotState(snapshot.dataQuality === 'unavailable' ? 'empty' : 'ready');
    }).catch(() => {
      if (sequence !== loadSequenceRef.current) return;
      setLiveSnapshot(null);
      setSnapshotState('error');
    });

    const [historyResult, sourceResult, marketItemsResult, globalItemsResult, marketFeedsResult, globalFeedsResult, taskResult, dashboardResult, workspaceTasksResult, capabilityResult] = await Promise.allSettled([
      historyApi.getList({ reportType: 'market_review', page: 1, limit: 50 }),
      workspaceApi.listDataSources(),
      intelligenceApi.listItems({ market: selectedMarket, days: 14, pageSize: 50 }),
      intelligenceApi.listItems({ market: 'global', days: 14, pageSize: 50 }),
      intelligenceApi.listSources({ enabled: true, market: selectedMarket }),
      intelligenceApi.listSources({ enabled: true, market: 'global' }),
      analysisApi.getTasks({ status: 'pending,processing', limit: 20 }),
      workspaceApi.getMarketDashboard(toWorkspaceMarket(selectedMarket)),
      workspaceApi.listTasks(),
      workspaceApi.getCapabilities(),
    ]);
    if (sequence !== loadSequenceRef.current) return;

    if (sourceResult.status === 'fulfilled') setWorkspaceSources(sourceResult.value);
    else {
      setWorkspaceSources([]);
      setSourceUnavailable(true);
    }

    if (marketItemsResult.status === 'fulfilled' || globalItemsResult.status === 'fulfilled') {
      setNewsItems(mergeIntelligence(
        marketItemsResult.status === 'fulfilled' ? marketItemsResult.value.items : [],
        globalItemsResult.status === 'fulfilled' ? globalItemsResult.value.items : [],
      ));
      setNewsState('ready');
    } else {
      setNewsItems([]);
      setNewsState('error');
    }

    if (marketFeedsResult.status === 'fulfilled' || globalFeedsResult.status === 'fulfilled') {
      setFeedSources(mergeSources(
        marketFeedsResult.status === 'fulfilled' ? marketFeedsResult.value.items : [],
        globalFeedsResult.status === 'fulfilled' ? globalFeedsResult.value.items : [],
      ));
      setFeedState('ready');
    } else {
      setFeedSources([]);
      setFeedState('error');
    }

    if (!refreshTaskId && taskResult.status === 'fulfilled') {
      const active = taskResult.value.tasks.find((task) => taskMatchesMarket(task, selectedMarket));
      if (active) {
        setRefreshTaskId(active.taskId);
        setRefreshProgress(active.progress || 0);
        setRefreshState('running');
      }
    }

    if (dashboardResult.status === 'fulfilled') {
      const nextLayout = dashboardLayout(dashboardResult.value);
      setLayout(nextLayout);
      setLayoutDraft(nextLayout);
      setSubscriptions(dashboardResult.value.subscriptions || []);
      setDashboardError('');
    } else {
      setSubscriptions([]);
      setDashboardError('市场看板配置暂时不可用，当前使用本机保存的展示设置。');
    }
    if (workspaceTasksResult.status === 'fulfilled') setAvailableTasks(workspaceTasksResult.value);
    else setAvailableTasks([]);
    if (capabilityResult.status === 'fulfilled') setCapabilityCatalog(capabilityResult.value);

    if (historyResult.status === 'rejected') {
      setItem(null);
      setReport(null);
      setLoadState('error');
      return;
    }

    const latest = historyResult.value.items.find((historyItem) => historyMatchesMarket(historyItem, selectedMarket)) || null;
    setItem(latest);
    if (!latest?.id) {
      setReport(null);
      setLoadState('empty');
      return;
    }

    try {
      const detail = await historyApi.getDetail(latest.id);
      if (sequence !== loadSequenceRef.current) return;
      setReport(detail);
      setLoadState('ready');
    } catch {
      if (sequence !== loadSequenceRef.current) return;
      setReport(null);
      setLoadState('error');
    }
  }, [market, refreshTaskId]);

  useEffect(() => {
    const timerId = window.setTimeout(() => void load(market), 0);
    return () => window.clearTimeout(timerId);
  }, [load, market]);

  useEffect(() => {
    if (!refreshTaskId || refreshState !== 'running') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const task = await analysisApi.getStatus(refreshTaskId);
        if (cancelled) return;
        setRefreshProgress(task.progress || 0);
        if (task.status === 'completed') {
          setRefreshState('completed');
          setRefreshTaskId(null);
          await load(market, true);
          return;
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
          setRefreshState('error');
          setRefreshTaskId(null);
          setRefreshError(task.error || '市场复盘没有完成，请查看任务运行记录。');
        }
      } catch (error) {
        if (cancelled) return;
        setRefreshState('error');
        setRefreshTaskId(null);
        setRefreshError(toApiErrorMessage(error, '无法读取市场复盘任务状态。'));
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [load, market, refreshState, refreshTaskId]);

  const triggerRefresh = async () => {
    setRefreshState('submitting');
    setRefreshError('');
    setRefreshProgress(0);
    try {
      const accepted = await analysisApi.triggerMarketReview({ sendNotification: false, regions: [market] });
      if (!accepted.taskId) throw new Error('市场复盘任务未返回任务 ID。');
      setRefreshTaskId(accepted.taskId);
      setRefreshState('running');
    } catch (error) {
      setRefreshState('error');
      setRefreshError(toApiErrorMessage(error, '无法启动市场复盘。'));
    }
  };

  const changeMarket = (value: MarketReviewRegion) => {
    setMarket(value);
    window.localStorage.setItem(MARKET_SELECTION_KEY, value);
    setRefreshState('idle');
    setRefreshTaskId(null);
    setRefreshError('');
  };

  const persistedPayload = useMemo(() => resolvePayload(report, market), [market, report]);
  const payload = useMemo<MarketReviewPayload | null>(() => {
    if (!liveSnapshot || liveSnapshot.region !== market) return persistedPayload;
    if (!persistedPayload) return liveSnapshot;
    const liveHasData = Boolean(liveSnapshot.indices?.length || liveSnapshot.macroIndicators?.length || liveSnapshot.breadth);
    return {
      ...persistedPayload,
      ...(liveHasData ? {
        generatedAt: liveSnapshot.generatedAt,
        date: liveSnapshot.date,
      } : {}),
      indices: liveSnapshot.indices?.length ? liveSnapshot.indices : persistedPayload.indices,
      macroIndicators: liveSnapshot.macroIndicators?.length ? liveSnapshot.macroIndicators : persistedPayload.macroIndicators,
      breadth: liveSnapshot.breadth || persistedPayload.breadth,
      sectors: liveSnapshot.sectors?.top?.length || liveSnapshot.sectors?.bottom?.length
        ? liveSnapshot.sectors
        : persistedPayload.sectors,
      analysisSkills: liveSnapshot.analysisSkills?.length ? liveSnapshot.analysisSkills : persistedPayload.analysisSkills,
      dataQuality: liveSnapshot.dataQuality,
      warnings: liveSnapshot.warnings,
    };
  }, [liveSnapshot, market, persistedPayload]);
  const indices = payload?.indices || [];
  const macroIndicators = payload?.macroIndicators || [];
  const analysisSkills = payload?.analysisSkills || [];
  const breadth = payload?.breadth;
  const up = toFiniteNumber(breadth?.upCount) || 0;
  const down = toFiniteNumber(breadth?.downCount) || 0;
  const flat = toFiniteNumber(breadth?.flatCount) || 0;
  const breadthTotal = up + down + flat;
  const hasStructuredData = Boolean(indices.length || macroIndicators.length || breadthTotal || payload?.sectors?.top?.length || payload?.sectors?.bottom?.length);
  const snapshotTime = payload?.generatedAt || payload?.date || item?.createdAt;
  const ageHours = snapshotAgeHours(snapshotTime);
  const snapshotIsRecent = ageHours !== null && ageHours <= 48;
  const overview = resolveOverview(payload, report, item);
  const visibleWidgets = new Set(layout.widgetIds);
  const hasIndexRow = visibleWidgets.has('indices') || visibleWidgets.has('breadth');
  const marketLabel = MARKET_OPTIONS.find((option) => option.id === market)?.label || market.toUpperCase();
  const compatibleProviders = workspaceSources.filter((source) => {
    if (!source.selectable || source.kind !== 'kline') return false;
    return !source.markets?.length || source.markets.map((value) => value.toLowerCase()).includes(market);
  });
  const compatibleMacroProviders = workspaceSources.filter((source) => {
    if (source.kind !== 'macro' || source.selectionMode !== 'provider') return false;
    return !source.markets?.length || source.markets.map((value) => value.toLowerCase()).includes(market);
  });
  const successfulFeeds = feedSources.filter((source) => source.lastStatus === 'success').length;
  const displayedNewsItems = useMemo(() => {
    const sourceIds = new Set(layout.newsSourceIds);
    const keywords = layout.newsKeywords.map((item) => item.toLocaleLowerCase());
    return newsItems.filter((news) => {
      if (sourceIds.size && (!news.sourceId || !sourceIds.has(news.sourceId))) return false;
      if (!keywords.length) return true;
      const text = `${news.title} ${news.summary || ''}`.toLocaleLowerCase();
      return keywords.some((keyword) => text.includes(keyword));
    });
  }, [layout.newsKeywords, layout.newsSourceIds, newsItems]);
  const subscribedTaskIds = new Set(subscriptions.map((item) => item.taskId));
  const availableSubscriptionTasks = availableTasks.filter((task) => (
    task.enabled
    && ['research', 'screening', 'market_analysis', 'industry_analysis'].includes(task.kind)
    && task.market === toWorkspaceMarket(market)
    && !subscribedTaskIds.has(task.id)
  ));
  const subscriptionKindLabel = (kind?: WorkspaceTask['kind']) => (
    kind === 'research' ? '个股分析'
      : kind === 'screening' ? '选股'
        : kind === 'market_analysis' ? '宏观分析'
          : kind === 'industry_analysis' ? '产业分析' : 'Agent 任务'
  );

  const beginEditingLayout = () => {
    setLayoutDraft(layout);
    setEditorTab('layout');
    setSelectedTaskId('');
    setNewsKeywordDraft('');
    setAnalysisCapabilities(capabilityCatalog?.defaults.market_analysis || EMPTY_AGENT_CAPABILITIES);
    setAnalysisBuilderOpen(false);
    setAnalysisCapabilityOpen(false);
    setDashboardError('');
    setEditingLayout(true);
  };
  const closeLayoutEditor = () => {
    editLayoutButtonRef.current?.focus();
    setEditingLayout(false);
  };
  const applyLayout = async () => {
    if (!layoutDraft.widgetIds.length) return;
    setDashboardSaving(true);
    setDashboardError('');
    try {
      const saved = await workspaceApi.updateMarketDashboard(toWorkspaceMarket(market), layoutDraft);
      const nextLayout = dashboardLayout(saved);
      setLayout(nextLayout);
      setLayoutDraft(nextLayout);
      setSubscriptions(saved.subscriptions || []);
      window.localStorage.setItem(MARKET_DASHBOARD_KEY, JSON.stringify({ widgetIds: nextLayout.widgetIds }));
      closeLayoutEditor();
    } catch {
      setDashboardError('看板设置保存失败，请检查服务状态后重试。');
    } finally {
      setDashboardSaving(false);
    }
  };
  const restoreDefaultLayout = () => setLayoutDraft((current) => ({ ...current, widgetIds: DEFAULT_WIDGET_IDS, newsSourceIds: [], newsKeywords: [] }));
  const toggleNewsSource = (sourceId: number) => setLayoutDraft((current) => ({
    ...current,
    newsSourceIds: toggleItem(current.newsSourceIds, sourceId),
  }));
  const addNewsKeyword = () => {
    const keyword = newsKeywordDraft.trim();
    if (!keyword || layoutDraft.newsKeywords.includes(keyword) || layoutDraft.newsKeywords.length >= 20) return;
    setLayoutDraft((current) => ({ ...current, newsKeywords: [...current.newsKeywords, keyword] }));
    setNewsKeywordDraft('');
  };
  const addTaskSubscription = async () => {
    const task = availableTasks.find((item) => item.id === selectedTaskId);
    if (!task) return;
    setDashboardSaving(true);
    setDashboardError('');
    try {
      await workspaceApi.createMarketSubscription({ taskId: task.id, market: toWorkspaceMarket(market), title: task.name });
      const next = await workspaceApi.getMarketDashboard(toWorkspaceMarket(market));
      setSubscriptions(next.subscriptions || []);
      setSelectedTaskId('');
      setLayoutDraft((current) => current.widgetIds.includes('subscriptions') ? current : ({ ...current, widgetIds: [...current.widgetIds, 'subscriptions'] }));
    } catch {
      setDashboardError('分析任务没有添加到市场看板，请稍后重试。');
    } finally {
      setDashboardSaving(false);
    }
  };
  const changeAnalysisKind = (kind: 'market_analysis' | 'industry_analysis') => {
    setAnalysisKind(kind);
    setAnalysisCapabilities(capabilityCatalog?.defaults[kind] || EMPTY_AGENT_CAPABILITIES);
    setAnalysisName('');
    setAnalysisObjective('');
    setAnalysisCapabilityOpen(false);
  };
  const createAnalysisSubscription = async () => {
    const title = analysisName.trim();
    const objective = analysisObjective.trim();
    if (!title || !objective) {
      setDashboardError('请填写分析名称和分析目标。');
      return;
    }
    setDashboardSaving(true);
    setDashboardError('');
    try {
      const task = await workspaceApi.createTask({
        kind: analysisKind,
        name: title,
        market: toWorkspaceMarket(market),
        objective,
        subject: analysisKind === 'industry_analysis' ? { industry: objective } : { scope: market },
        config: { outputLanguage: 'zh', dashboardSummary: true },
        capabilities: analysisCapabilities,
      });
      await workspaceApi.createSchedule({
        taskId: task.id,
        name: title,
        scheduleMode: 'daily',
        runAt: analysisRunAt,
        timezone: MARKET_TIMEZONES[market] || 'Asia/Shanghai',
        publishToMarket: true,
        marketDashboardTitle: title,
      });
      const [nextDashboard, nextTasks] = await Promise.all([
        workspaceApi.getMarketDashboard(toWorkspaceMarket(market)),
        workspaceApi.listTasks(),
      ]);
      setSubscriptions(nextDashboard.subscriptions || []);
      setAvailableTasks(nextTasks);
      setAnalysisBuilderOpen(false);
      setAnalysisCapabilityOpen(false);
      setAnalysisName('');
      setAnalysisObjective('');
      setLayoutDraft((current) => current.widgetIds.includes('subscriptions') ? current : ({ ...current, widgetIds: [...current.widgetIds, 'subscriptions'] }));
    } catch {
      setDashboardError('分析订阅创建失败，请检查能力配置、运行时间和服务状态。');
    } finally {
      setDashboardSaving(false);
    }
  };
  const removeTaskSubscription = async (subscriptionId: string) => {
    setDashboardSaving(true);
    setDashboardError('');
    try {
      await workspaceApi.deleteMarketSubscription(subscriptionId);
      setSubscriptions((current) => current.filter((item) => item.id !== subscriptionId));
    } catch {
      setDashboardError('分析订阅删除失败，请稍后重试。');
    } finally {
      setDashboardSaving(false);
    }
  };

  const generating = refreshState === 'submitting' || refreshState === 'running';

  return (
    <section id="market-intelligence" aria-labelledby="market-intelligence-title" data-testid="market-intelligence" className="scroll-mt-20">
      <div className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />Verified market workspace
          </div>
          <h1 id="market-intelligence-title" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">市场雷达</h1>
          <p className="mt-2 max-w-[72ch] text-sm leading-6 text-secondary-text">切换市场即可读取真实指数与宏观快照，并结合已保存的 Agent 复盘和资讯服务数据。页面不会用示例行情填充空缺；每项内容都会标明数据时间与运行状态。</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start lg:justify-end lg:self-auto">
          <button ref={editLayoutButtonRef} type="button" onClick={beginEditingLayout} aria-expanded={editingLayout} aria-controls="market-dashboard-editor" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-text transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />编辑展示
          </button>
          <button type="button" onClick={() => void load(market, true)} disabled={(loadState === 'loading' && snapshotState === 'loading') || generating} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-text transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', (loadState === 'loading' || snapshotState === 'loading') && 'animate-spin')} aria-hidden="true" />刷新数据
          </button>
          <button type="button" onClick={() => void triggerRefresh()} disabled={generating} className="btn-primary inline-flex h-10 items-center gap-2 disabled:cursor-wait disabled:opacity-65">
            {generating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {refreshState === 'submitting' ? '正在提交…' : refreshState === 'running' ? `正在生成 ${refreshProgress}%` : '生成最新复盘'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-x border-b border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="选择市场">
          {MARKET_OPTIONS.map((option) => (
            <button key={option.id} type="button" onClick={() => changeMarket(option.id)} aria-pressed={market === option.id} className={cn('min-h-9 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', market === option.id ? 'bg-primary text-white' : 'bg-muted text-secondary-text hover:text-foreground')}>
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-text">
          <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />{compatibleProviders.length} 个可配置行情来源</span>
          <span className="inline-flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" />{compatibleMacroProviders.length} 个宏观来源</span>
          <span className="inline-flex items-center gap-1.5"><Newspaper className="h-3.5 w-3.5" />{feedState === 'loading' ? '正在读取资讯源状态' : feedState === 'error' ? '资讯源状态不可用' : `${successfulFeeds}/${feedSources.length} 个资讯源同步成功`}</span>
        </div>
      </div>

      {refreshState === 'running' ? (
        <div className="border-x border-b border-primary/25 bg-primary/5 px-5 py-3 text-sm text-secondary-text sm:px-7" role="status" aria-live="polite">
          <span className="font-medium text-foreground">正在生成 {marketLabel} 最新复盘。</span> 任务会调用已配置的数据源并保存新快照；生成期间继续展示上一份已保存结果。
        </div>
      ) : null}
      {refreshState === 'completed' ? (
        <div className="flex items-center gap-2 border-x border-b border-success/25 bg-success/5 px-5 py-3 text-sm text-success sm:px-7" role="status"><CheckCircle2 className="h-4 w-4" />最新复盘已经生成并载入。</div>
      ) : null}
      {refreshState === 'error' ? (
        <div className="flex items-start gap-2 border-x border-b border-danger/25 bg-danger/5 px-5 py-3 text-sm text-danger sm:px-7" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{refreshError}</span></div>
      ) : null}
      {snapshotState === 'error' ? (
        <div className="flex items-start gap-2 border-x border-b border-warning/25 bg-warning/5 px-5 py-3 text-sm text-warning sm:px-7" role="status"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>实时指数与宏观快照暂时不可用；页面继续展示已保存复盘和资讯。</span></div>
      ) : null}

      {editingLayout ? (
        <section id="market-dashboard-editor" className="border-x border-b border-border bg-card" aria-labelledby="market-dashboard-editor-title">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <h2 id="market-dashboard-editor-title" className="text-sm font-semibold text-foreground">编辑 {marketLabel} 市场看板</h2>
              <p className="mt-1 text-xs leading-5 text-muted-text">管理展示结构、Agent 分析订阅和资讯范围；数据源连接仍由能力中心统一维护。</p>
            </div>
            <Link to="/capabilities/data" className="text-xs font-medium text-primary hover:underline">管理数据源</Link>
          </div>
          <div className="border-b border-border px-5 sm:px-7">
            <div className="flex gap-5 overflow-x-auto" role="tablist" aria-label="市场看板配置分类">
              {[
                { id: 'layout' as const, label: '看板布局' },
                { id: 'analysis' as const, label: `分析订阅 ${subscriptions.length}` },
                { id: 'data' as const, label: '资讯订阅' },
              ].map((tab) => (
                <button key={tab.id} type="button" role="tab" aria-selected={editorTab === tab.id} onClick={() => setEditorTab(tab.id)} className={cn('min-h-11 shrink-0 border-b-2 text-xs font-medium', editorTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-secondary-text hover:text-foreground')}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {editorTab === 'layout' ? (
            <fieldset className="min-w-0 px-5 py-5 sm:px-7">
              <legend className="text-xs font-semibold text-foreground">展示内容</legend>
              <p className="mt-1 text-xs text-muted-text">已选择 {layoutDraft.widgetIds.length} 个模块，可分别为不同市场保存。</p>
              <div className="mt-3 grid gap-x-8 border-y border-border md:grid-cols-2">
                {WIDGET_OPTIONS.map((widget) => {
                  const selected = layoutDraft.widgetIds.includes(widget.id);
                  const lastSelected = selected && layoutDraft.widgetIds.length === 1;
                  return (
                    <label key={widget.id} className={cn('flex items-start gap-3 border-b border-border py-3.5 last:border-b-0 md:[&:nth-last-child(-n+2)]:border-b-0', lastSelected && 'cursor-not-allowed opacity-65')}>
                      <input type="checkbox" checked={selected} disabled={lastSelected} onChange={() => setLayoutDraft((current) => ({ ...current, widgetIds: toggleItem(current.widgetIds, widget.id) }))} className="mt-0.5 h-4 w-4 accent-primary" aria-label={`显示 ${widget.label}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{widget.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-text">{widget.description} · 数据来自 {widget.sourceHint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {editorTab === 'analysis' ? (
            <div className="px-5 py-5 sm:px-7">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="text-xs font-semibold text-foreground">
                  添加已有 Agent 任务
                  <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary">
                    <option value="">{availableSubscriptionTasks.length ? '选择个股分析或选股任务' : '当前市场没有可添加的任务'}</option>
                    {availableSubscriptionTasks.map((task) => <option key={task.id} value={task.id}>{task.name} · {subscriptionKindLabel(task.kind)}</option>)}
                  </select>
                </label>
                <button type="button" disabled={!selectedTaskId || dashboardSaving} onClick={() => void addTaskSubscription()} className="btn-secondary h-10 disabled:cursor-not-allowed disabled:opacity-55">添加订阅</button>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-text">个股和选股任务在各自工作台中定义；市场宏观和产业分析可直接在这里创建。</p>

              <div className="mt-4 border-t border-border pt-4">
                <button type="button" onClick={() => { setAnalysisBuilderOpen((value) => !value); setAnalysisCapabilities(capabilityCatalog?.defaults[analysisKind] || EMPTY_AGENT_CAPABILITIES); }} className="inline-flex min-h-10 items-center gap-2 text-xs font-medium text-primary hover:underline" aria-expanded={analysisBuilderOpen}>
                  <Plus className="h-3.5 w-3.5" />新建宏观或产业分析
                </button>
                {analysisBuilderOpen ? (
                  <div className="mt-3 rounded-[10px] border border-border bg-background px-4 py-4">
                    <div className="inline-flex rounded-[8px] border border-border bg-card p-1" role="radiogroup" aria-label="分析类型">
                      <button type="button" role="radio" aria-checked={analysisKind === 'market_analysis'} onClick={() => changeAnalysisKind('market_analysis')} className={cn('rounded-[6px] px-3 py-1.5 text-xs font-medium', analysisKind === 'market_analysis' ? 'bg-primary text-primary-foreground' : 'text-secondary-text')}>宏观分析</button>
                      <button type="button" role="radio" aria-checked={analysisKind === 'industry_analysis'} onClick={() => changeAnalysisKind('industry_analysis')} className={cn('rounded-[6px] px-3 py-1.5 text-xs font-medium', analysisKind === 'industry_analysis' ? 'bg-primary text-primary-foreground' : 'text-secondary-text')}>产业分析</button>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-foreground">分析名称<input value={analysisName} onChange={(event) => setAnalysisName(event.target.value)} placeholder={analysisKind === 'market_analysis' ? `${marketLabel}每日宏观分析` : '例如：半导体产业跟踪'} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 text-sm font-normal text-foreground outline-none focus:border-primary" /></label>
                      <label className="text-xs font-semibold text-foreground">每天运行时间<input type="time" value={analysisRunAt} onChange={(event) => setAnalysisRunAt(event.target.value)} className="mt-2 h-10 w-full rounded-[9px] border border-border bg-card px-3 text-sm font-normal text-foreground outline-none focus:border-primary" /></label>
                    </div>
                    <label className="mt-4 block text-xs font-semibold text-foreground">{analysisKind === 'market_analysis' ? '分析目标' : '产业主题与关注目标'}<textarea value={analysisObjective} onChange={(event) => setAnalysisObjective(event.target.value)} placeholder={analysisKind === 'market_analysis' ? '跟踪影响当前市场的流动性、增长、通胀、汇率和风险偏好变化' : '例如：半导体产业链景气、政策、供需、估值与主要风险'} className="mt-2 min-h-24 w-full resize-y rounded-[9px] border border-border bg-card px-3 py-2.5 text-sm font-normal leading-6 text-foreground outline-none focus:border-primary" /></label>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                      <button type="button" onClick={() => setAnalysisCapabilityOpen((value) => !value)} className="btn-secondary">配置 Agent 能力 · {countAgentCapabilities(analysisCapabilities)} 项</button>
                      <button type="button" disabled={dashboardSaving} onClick={() => void createAnalysisSubscription()} className="btn-primary inline-flex items-center gap-2 disabled:opacity-55">{dashboardSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}创建并订阅</button>
                    </div>
                    {analysisCapabilityOpen ? (
                      <AgentCapabilityPanel
                        scopeLabel="任务"
                        skills={capabilityCatalog?.skills || []}
                        selectedSkillIds={analysisCapabilities.skillIds}
                        onToggleSkill={(id) => setAnalysisCapabilities((current) => ({ ...current, skillIds: toggleItem(current.skillIds, id) }))}
                        skillLimitReached={analysisCapabilities.skillIds.length >= 3}
                        selectedToolIds={analysisCapabilities.toolIds}
                        onToggleTool={(id) => setAnalysisCapabilities((current) => ({ ...current, toolIds: toggleItem(current.toolIds, id) }))}
                        selectedDataSourceIds={analysisCapabilities.dataSourceIds}
                        onToggleDataSource={(id) => setAnalysisCapabilities((current) => ({ ...current, dataSourceIds: toggleItem(current.dataSourceIds, id) }))}
                        selectedMcpIds={analysisCapabilities.mcpIds}
                        onToggleMcp={(id) => setAnalysisCapabilities((current) => ({ ...current, mcpIds: toggleItem(current.mcpIds, id) }))}
                        selectedExpertIds={analysisCapabilities.expertIds}
                        onToggleExpert={(id) => setAnalysisCapabilities((current) => ({ ...current, expertIds: toggleItem(current.expertIds, id) }))}
                        selectedExpertTeamIds={analysisCapabilities.expertTeamIds}
                        onToggleExpertTeam={(id) => setAnalysisCapabilities((current) => ({ ...current, expertTeamIds: toggleItem(current.expertTeamIds, id) }))}
                        className="mt-4 h-[30rem] w-full shadow-none"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-5 divide-y divide-border border-y border-border">
                {subscriptions.length ? subscriptions.map((subscription) => (
                  <div key={subscription.id} className="flex items-center justify-between gap-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{subscription.title}</p>
                      <p className="mt-1 text-xs text-muted-text">{subscriptionKindLabel(subscription.task?.kind)} · {subscription.schedules.length ? `${subscription.schedules.length} 个运行计划` : '仅手动运行'} · {subscription.latestArtifact ? '已有成果' : '等待成果'}</p>
                    </div>
                    <button type="button" disabled={dashboardSaving} onClick={() => void removeTaskSubscription(subscription.id)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-muted-text hover:bg-danger/10 hover:text-danger disabled:opacity-50" aria-label={`移除订阅 ${subscription.title}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                )) : <p className="py-6 text-center text-sm text-muted-text">尚未订阅任何分析任务。</p>}
              </div>
            </div>
          ) : null}

          {editorTab === 'data' ? (
            <div className="px-5 py-5 sm:px-7">
              <div>
                <p className="text-xs font-semibold text-foreground">资讯来源</p>
                <p className="mt-1 text-xs leading-5 text-muted-text">不选择时展示当前市场和全球全部启用资讯源；选择后只显示指定来源。</p>
                <div className="mt-3 grid gap-x-8 border-y border-border md:grid-cols-2">
                  {feedSources.map((source) => (
                    <label key={source.id} className="flex items-start gap-3 border-b border-border py-3 last:border-b-0 md:[&:nth-last-child(-n+2)]:border-b-0">
                      <input type="checkbox" checked={layoutDraft.newsSourceIds.includes(source.id)} onChange={() => toggleNewsSource(source.id)} className="mt-0.5 h-4 w-4 accent-primary" />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{source.name}</span><span className="mt-1 block text-xs text-muted-text">{String(source.market).toUpperCase()} · {source.lastStatus === 'success' ? '最近同步成功' : source.lastStatus ? '最近同步异常' : '尚未同步'}</span></span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <p className="text-xs font-semibold text-foreground">关注关键词</p>
                <div className="mt-2 flex gap-2">
                  <input value={newsKeywordDraft} onChange={(event) => setNewsKeywordDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addNewsKeyword(); } }} maxLength={80} placeholder="例如：美联储、房地产、半导体" className="h-10 min-w-0 flex-1 rounded-[9px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
                  <button type="button" onClick={addNewsKeyword} disabled={!newsKeywordDraft.trim() || layoutDraft.newsKeywords.length >= 20} className="btn-secondary h-10 disabled:opacity-55">添加</button>
                </div>
                {layoutDraft.newsKeywords.length ? <div className="mt-3 flex flex-wrap gap-2">{layoutDraft.newsKeywords.map((keyword) => <button key={keyword} type="button" onClick={() => setLayoutDraft((current) => ({ ...current, newsKeywords: current.newsKeywords.filter((item) => item !== keyword) }))} className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-secondary-text hover:border-danger/30 hover:text-danger" aria-label={`移除关键词 ${keyword}`}>{keyword} ×</button>)}</div> : <p className="mt-2 text-xs text-muted-text">当前不限制关键词。</p>}
              </div>
            </div>
          ) : null}

          {dashboardError ? <p role="alert" className="mx-5 mb-4 text-sm text-danger sm:mx-7">{dashboardError}</p> : null}
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <button type="button" onClick={restoreDefaultLayout} className="inline-flex min-h-10 items-center gap-2 self-start text-xs font-medium text-secondary-text hover:text-foreground"><RotateCcw className="h-3.5 w-3.5" />恢复默认展示</button>
            <div className="flex gap-2 self-end">
              <button type="button" onClick={closeLayoutEditor} className="btn-secondary">取消</button>
              <button type="button" disabled={dashboardSaving} onClick={() => void applyLayout()} className="btn-primary inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-60">{dashboardSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存看板</button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="border-x border-b border-border bg-card">
        <div className="min-w-0 border-b border-border">
          {(loadState === 'loading' || loadState === 'idle') && !hasStructuredData ? (
            <div className="flex min-h-[24rem] items-center justify-center px-6 text-sm text-muted-text" role="status"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />正在读取 {marketLabel} 已保存快照…</div>
          ) : loadState === 'error' && !hasStructuredData ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
              <BarChart3 className="h-8 w-8 text-muted-text" />
              <p className="mt-4 font-medium text-foreground">暂时无法读取市场复盘</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-secondary-text">已抓取资讯和数据源状态会独立显示。可以刷新状态，或生成一份新的市场复盘。</p>
            </div>
          ) : loadState === 'empty' && !hasStructuredData ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
              <BarChart3 className="h-8 w-8 text-muted-text" />
              <p className="mt-4 font-medium text-foreground">暂无 {marketLabel} 市场复盘</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-secondary-text">系统不会显示示例行情。点击“生成最新复盘”后，页面会调用真实数据链路并保存第一份快照。</p>
            </div>
          ) : (
            <>
              {visibleWidgets.has('overview') ? (
                <div className="border-b border-border px-5 py-5 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', snapshotIsRecent ? 'border-success/25 bg-success/5 text-success' : 'border-warning/25 bg-warning/5 text-warning')}>{snapshotIsRecent ? '近期快照' : '历史快照'}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-text"><Clock3 className="h-3.5 w-3.5" />数据截至 {formatDateTime(snapshotTime, true)}</span>
                    {ageHours !== null && ageHours > 48 ? <span className="text-xs text-warning">已超过 48 小时，请重新生成</span> : null}
                  </div>
                  <div className="mt-5 flex gap-3">
                    <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-primary">{persistedPayload ? 'Agent 市场摘要' : '实时市场快照'}</p>
                      <p className="mt-2 max-w-[75ch] text-sm leading-7 text-foreground">{persistedPayload ? overview : `已取得 ${marketLabel} 的实时指数与宏观观测。当前尚无已保存的 Agent 深度复盘；可先查看下方数据，或点击“生成最新复盘”获得分析结论。`}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {hasIndexRow ? (
                <div className={cn('grid', visibleWidgets.has('indices') && visibleWidgets.has('breadth') && 'md:grid-cols-2')}>
                  {visibleWidgets.has('indices') ? (
                    <div className={cn('border-b border-border px-5 py-6 sm:px-7', visibleWidgets.has('breadth') && 'md:border-b-0 md:border-r')}>
                      <div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-sm font-semibold text-foreground">主要指数</h2><span className="text-xs text-muted-text">涨跌幅</span></div>
                      <IndexPerformance indices={indices} />
                    </div>
                  ) : null}
                  {visibleWidgets.has('breadth') ? (
                    <div className="px-5 py-6 sm:px-7">
                      <h2 className="text-sm font-semibold text-foreground">市场宽度</h2>
                      {breadthTotal > 0 ? (
                        <>
                          <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-border/60" aria-label={`上涨 ${up}，下跌 ${down}，平盘 ${flat}`}><div className="bg-success" style={{ width: `${up / breadthTotal * 100}%` }} /><div className="bg-muted-text/50" style={{ width: `${flat / breadthTotal * 100}%` }} /><div className="bg-danger" style={{ width: `${down / breadthTotal * 100}%` }} /></div>
                          <div className="mt-4 grid grid-cols-3 gap-3"><div><p className="text-xs text-muted-text">上涨</p><p className="mt-1 text-lg font-semibold tabular-nums text-success">{formatCount(up)}</p></div><div><p className="text-xs text-muted-text">平盘</p><p className="mt-1 text-lg font-semibold tabular-nums text-secondary-text">{formatCount(flat)}</p></div><div><p className="text-xs text-muted-text">下跌</p><p className="mt-1 text-lg font-semibold tabular-nums text-danger">{formatCount(down)}</p></div></div>
                          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs"><div><span className="text-muted-text">涨停</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.limitUpCount)}</span></div><div><span className="text-muted-text">跌停</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.limitDownCount)}</span></div><div className="col-span-2"><span className="text-muted-text">成交额</span><span className="ml-2 font-medium tabular-nums text-foreground">{formatCount(breadth?.totalAmount)} {breadth?.turnoverUnit || ''}</span></div></div>
                        </>
                      ) : <p className="py-6 text-sm text-muted-text">该市场或本次复盘没有结构化市场宽度数据。</p>}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {visibleWidgets.has('sectors') ? (
                <div className="grid gap-6 border-t border-border px-5 py-6 sm:grid-cols-2 sm:px-7"><SectorList title="领涨板块" items={payload?.sectors?.top || []} positive /><SectorList title="承压板块" items={payload?.sectors?.bottom || []} positive={false} /></div>
              ) : null}
            </>
          )}

          {visibleWidgets.has('macro') ? (
            <MacroMonitor market={market} macroIndicators={macroIndicators} indices={indices} analysisSkills={analysisSkills} />
          ) : null}

          {visibleWidgets.has('news') ? (
            <section className="border-t border-border px-5 py-6 sm:px-7" aria-labelledby="market-news-title">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div><h2 id="market-news-title" className="text-sm font-semibold text-foreground">最新市场资讯</h2><p className="mt-1 text-xs text-muted-text">来自情报服务已经抓取并保存的 {marketLabel} 与全球资讯，不使用页面示例数据。</p></div>
                <span className="text-xs text-muted-text">近 14 天 · {displayedNewsItems.length} 条{layout.newsSourceIds.length || layout.newsKeywords.length ? ' · 已筛选' : ''}</span>
              </div>
              <IntelligenceList items={displayedNewsItems} state={newsState} />
            </section>
          ) : null}
        </div>

        {visibleWidgets.has('subscriptions') ? <AnalysisSubscriptions subscriptions={subscriptions} /> : null}

        <details className="min-w-0 px-5 py-6 sm:px-7" aria-label="市场雷达数据状态">
          <summary className="cursor-pointer text-sm font-medium text-secondary-text">数据来源与同步状态 · 展开查看</summary>
          <div className="mt-5">
          <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">数据状态</h2></div>
          <p className="mt-2 text-xs leading-5 text-muted-text">目录状态表示提供方已配置；只有同步记录和快照时间能够证明本次页面实际取得了数据。</p>

          <div className="mt-5 border-y border-border py-4">
            <p className="text-xs font-semibold text-foreground">行情提供方目录</p>
            {sourceUnavailable ? <p className="mt-3 text-xs text-danger">无法读取工作区数据源目录。</p> : compatibleProviders.length ? (
              <div className="mt-3 space-y-3">
                {compatibleProviders.slice(0, 6).map((source) => {
                  const state = dataSourceState(source);
                  return (
                    <div key={source.sourceId} className="min-w-0">
                      <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-foreground">{source.name}</p><span className={cn('shrink-0 text-[11px]', state.className)}>{state.label}</span></div>
                      <p className="mt-1 truncate text-[11px] text-muted-text">{source.description || source.connectionKey}</p>
                    </div>
                  );
                })}
              </div>
            ) : <p className="mt-3 text-xs leading-5 text-muted-text">当前市场没有可配置的行情提供方。</p>}
          </div>

          <div className="border-b border-border py-4">
            <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-foreground">宏观提供方目录</p><span className="text-[11px] text-muted-text">{compatibleMacroProviders.length} 项</span></div>
            {sourceUnavailable ? <p className="mt-3 text-xs text-danger">无法读取宏观数据源目录。</p> : compatibleMacroProviders.length ? (
              <div className="mt-3 space-y-3">
                {compatibleMacroProviders.map((source) => {
                  const state = dataSourceState(source);
                  return (
                    <div key={source.sourceId} className="min-w-0">
                      <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-foreground">{source.name}</p><span className={cn('shrink-0 text-[11px]', state.className)}>{state.label}</span></div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-text">{source.description || source.connectionKey}</p>
                    </div>
                  );
                })}
              </div>
            ) : <p className="mt-3 text-xs leading-5 text-muted-text">当前市场没有可选择的宏观提供方。</p>}
          </div>

          <div className="border-b border-border py-4">
            <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-foreground">资讯源同步</p><span className="text-[11px] text-muted-text">{feedSources.length} 项</span></div>
            {feedState === 'loading' || feedState === 'idle' ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-text"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在读取同步状态…</p> : feedState === 'error' ? <p className="mt-3 text-xs leading-5 text-danger">无法读取资讯源同步状态，已抓取资讯仍可独立查看。</p> : feedSources.length ? (
              <div className="mt-3 space-y-4">
                {feedSources.slice(0, 6).map((source) => (
                  <div key={source.id} className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={source.name}>{source.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"><FeedStatus source={source} />{source.lastFetchedAt ? <span className="text-[11px] text-muted-text">{formatDateTime(source.lastFetchedAt)}</span> : null}</div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-3 text-xs leading-5 text-muted-text">当前市场没有启用的资讯源。</p>}
          </div>

          <Link to="/capabilities/data" className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary hover:underline">管理数据源<ArrowRight className="h-4 w-4" /></Link>
          <Link to="/runs" className="mt-1 flex min-h-10 items-center gap-2 text-sm font-medium text-secondary-text hover:text-foreground">查看任务运行记录<ArrowRight className="h-4 w-4" /></Link>
          <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-text">“生成最新复盘”会创建 Agent 后台任务并保存结论；“刷新数据”会重新请求实时市场快照，并同步读取报告、资讯和来源状态。</p>
          </div>
        </details>
      </div>
    </section>
  );
};

export default MarketIntelligenceSection;
