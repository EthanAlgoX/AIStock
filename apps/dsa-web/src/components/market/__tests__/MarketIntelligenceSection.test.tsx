import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisReport } from '../../../types/analysis';
import MarketIntelligenceSection from '../MarketIntelligenceSection';

const api = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getList: vi.fn(),
  listDataSources: vi.fn(),
  getMarketDashboard: vi.fn(),
  updateMarketDashboard: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  createMarketSubscription: vi.fn(),
  deleteMarketSubscription: vi.fn(),
  getCapabilities: vi.fn(),
  listItems: vi.fn(),
  listSources: vi.fn(),
  getTasks: vi.fn(),
  getStatus: vi.fn(),
  getMarketSnapshot: vi.fn(),
  triggerMarketReview: vi.fn(),
}));

vi.mock('../../../api/history', () => ({
  historyApi: { getDetail: api.getDetail, getList: api.getList },
}));

vi.mock('../../../api/workspace', () => ({
  workspaceApi: {
    listDataSources: api.listDataSources,
    getMarketDashboard: api.getMarketDashboard,
    updateMarketDashboard: api.updateMarketDashboard,
    listTasks: api.listWorkspaceTasks,
    createMarketSubscription: api.createMarketSubscription,
    deleteMarketSubscription: api.deleteMarketSubscription,
    getCapabilities: api.getCapabilities,
  },
}));

vi.mock('../../../api/intelligence', () => ({
  intelligenceApi: { listItems: api.listItems, listSources: api.listSources },
}));

vi.mock('../../../api/analysis', () => ({
  analysisApi: {
    getTasks: api.getTasks,
    getStatus: api.getStatus,
    getMarketSnapshot: api.getMarketSnapshot,
    triggerMarketReview: api.triggerMarketReview,
  },
}));

const renderPage = () => render(
  <MemoryRouter>
    <MarketIntelligenceSection />
  </MemoryRouter>,
);

const report: AnalysisReport = {
  meta: {
    queryId: 'market-review-5',
    stockCode: 'market_review_cn',
    stockName: 'A 股市场',
    reportType: 'market_review',
    createdAt: new Date().toISOString(),
  },
  summary: {
    analysisSummary: '市场整体走强，成长板块领涨。',
    operationAdvice: '关注结构性机会',
    trendPrediction: '震荡偏强',
    sentimentScore: 72,
  },
  details: {
    contextSnapshot: {
      marketReviewPayload: {
        kind: 'market_review',
        region: 'cn',
        marketScope: 'A 股市场',
        generatedAt: new Date().toISOString(),
        indices: [
          { code: '000001', name: '上证指数', current: 3689.12, changePct: 1.41 },
          { code: '399001', name: '深证成指', current: 11820.3, changePct: -0.62 },
          { code: 'FLAT', name: '平盘指数', current: 100, changePct: 0 },
          { code: 'MISSING', name: '缺失指数', current: 99 },
        ],
        macroIndicators: [
          {
            key: 'us_10y',
            name: '美国 10 年期国债收益率',
            current: 4.125,
            changePct: 0.42,
            unit: '%',
            asOf: new Date().toISOString(),
            source: 'Yahoo Finance',
          },
          {
            key: 'dxy',
            name: 'DXY 美元指数',
            current: 98.62,
            changePct: -0.15,
            unit: '点',
            asOf: new Date().toISOString(),
            source: 'Yahoo Finance',
          },
        ],
        breadth: {
          upCount: 4335,
          downCount: 1063,
          flatCount: 140,
          limitUpCount: 106,
          limitDownCount: 1,
          totalAmount: 24021,
          turnoverUnit: '亿元',
        },
        sectors: {
          top: [{ name: '半导体', changePct: 4.2 }],
          bottom: [{ name: '银行', changePct: -0.8 }],
        },
        sections: [{ key: 'overview', title: 'Overview', markdown: '> **市场整体走强，成长板块领涨。**' }],
      },
    },
  },
};

describe('MarketIntelligenceSection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getList.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 50,
      items: [{
        id: 5,
        queryId: 'market-review-5',
        stockCode: 'market_review_cn',
        reportType: 'market_review',
        region: 'cn',
        createdAt: new Date().toISOString(),
      }],
    });
    api.getDetail.mockResolvedValue(report);
    api.listDataSources.mockResolvedValue([
      {
        sourceId: 'market:akshare',
        name: 'AkShare 行情',
        description: 'A 股行情和板块数据',
        kind: 'kline',
        connectionKey: 'akshare',
        required: false,
        builtIn: true,
        selectable: true,
        availability: 'configured',
        selectionMode: 'provider',
        markets: ['cn'],
      },
      {
        sourceId: 'market:yfinance',
        name: 'YFinance 行情',
        kind: 'kline',
        connectionKey: 'yfinance',
        required: false,
        builtIn: true,
        selectable: true,
        availability: 'configured',
        selectionMode: 'provider',
        markets: ['hk', 'us'],
      },
    ]);
    api.getMarketDashboard.mockImplementation((market: string) => Promise.resolve({
      market,
      widgetIds: ['overview', 'subscriptions', 'macro', 'indices', 'breadth', 'sectors', 'news'],
      newsSourceIds: [],
      newsKeywords: [],
      subscriptions: [],
    }));
    api.updateMarketDashboard.mockImplementation((market: string, value: Record<string, unknown>) => Promise.resolve({ market, ...value, subscriptions: [] }));
    api.listWorkspaceTasks.mockResolvedValue([]);
    api.createMarketSubscription.mockResolvedValue({});
    api.deleteMarketSubscription.mockResolvedValue(undefined);
    api.getCapabilities.mockResolvedValue({
      skills: [], tools: [], mcpServers: [], dataSources: [], experts: [], expertTeams: [],
      defaults: {
        chat: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        research: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        screening: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        trading: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        expert_review: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        market_analysis: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
        industry_analysis: { skillIds: [], toolIds: [], mcpIds: [], dataSourceIds: [], expertIds: [], expertTeamIds: [] },
      },
    });
    api.listItems.mockImplementation(({ market }: { market: string }) => Promise.resolve({
      items: market === 'cn' ? [{
        id: 7,
        sourceId: 3,
        sourceName: '财联社热门',
        sourceType: 'newsnow',
        title: '半导体产业链出现新催化',
        summary: '这是一条由情报服务保存的测试契约数据。',
        url: 'https://example.com/news/7',
        publishedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        scopeType: 'market',
        market: 'cn',
      }] : [],
      total: market === 'cn' ? 1 : 0,
      page: 1,
      pageSize: 50,
    }));
    api.listSources.mockImplementation(({ market }: { market: string }) => Promise.resolve({
      items: market === 'cn' ? [{
        id: 3,
        name: '财联社热门',
        sourceType: 'newsnow',
        url: 'newsnow://cls-hot',
        enabled: true,
        scopeType: 'market',
        market: 'cn',
        lastStatus: 'success',
        lastFetchedAt: new Date().toISOString(),
      }] : [],
      total: market === 'cn' ? 1 : 0,
      page: 1,
      pageSize: 100,
    }));
    api.getTasks.mockResolvedValue({ total: 0, pending: 0, processing: 0, tasks: [] });
    api.getStatus.mockResolvedValue({ taskId: 'task-market', status: 'processing', progress: 15 });
    api.getMarketSnapshot.mockImplementation((market: 'cn' | 'hk' | 'us') => Promise.resolve({
      version: 1,
      kind: 'market_snapshot',
      region: market,
      marketScope: market.toUpperCase(),
      generatedAt: new Date().toISOString(),
      date: '2026-09-04',
      indices: [],
      macroIndicators: [],
      analysisSkills: ['global-macro-review', `${market}-macro-review`],
      sectors: { top: [], bottom: [] },
      dataQuality: 'unavailable',
      warnings: ['main_indices_unavailable', 'macro_indicators_unavailable'],
    }));
    api.triggerMarketReview.mockResolvedValue({
      status: 'accepted',
      message: 'accepted',
      sendNotification: false,
      region: 'cn',
      taskId: 'task-market',
    });
  });

  it('renders saved market evidence, real intelligence items, and truthful source states', async () => {
    renderPage();

    expect(await screen.findByText('市场整体走强，成长板块领涨。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '市场情报' })).toBeInTheDocument();
    expect(screen.getByText('上证指数')).toBeInTheDocument();
    expect(screen.getByText('+1.41%')).toBeInTheDocument();
    expect(screen.getByText('-0.62%')).toBeInTheDocument();
    expect(screen.getByText('0.00%')).toHaveClass('text-muted-text');
    expect(within(screen.getByLabelText('指数表现')).getByText('—')).toHaveClass('text-muted-text');
    expect(screen.getByText('4,335')).toBeInTheDocument();
    expect(screen.getByText('半导体')).toBeInTheDocument();
    expect(screen.getByText('半导体产业链出现新催化')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '宏观监控' })).toBeInTheDocument();
    expect(screen.getByText('信用周期 → 财政力度 → 房地产 → 国内流动性 → 经济修复')).toBeInTheDocument();
    expect(screen.getByText('4.125 %')).toBeInTheDocument();
    expect(screen.getByText('98.62 点')).toBeInTheDocument();
    expect(screen.getAllByText('待接入').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AkShare 行情').length).toBeGreaterThan(0);
    expect(screen.getAllByText('最近同步成功').length).toBeGreaterThan(0);
  });

  it('shows an honest market-specific empty state and can reload persisted data', async () => {
    api.getList.mockResolvedValue({ total: 0, page: 1, limit: 50, items: [] });
    renderPage();

    expect(await screen.findByText('暂无 A 股 市场复盘')).toBeInTheDocument();
    expect(api.getDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(api.getList).toHaveBeenCalledTimes(2));
  });

  it('keeps independent source and intelligence evidence visible when history fails', async () => {
    api.getList.mockRejectedValue(new Error('history unavailable'));
    renderPage();

    expect(await screen.findByText('暂时无法读取市场复盘')).toBeInTheDocument();
    expect(screen.getByText('半导体产业链出现新催化')).toBeInTheDocument();
    expect(screen.getAllByText('AkShare 行情').length).toBeGreaterThan(0);
    expect(screen.getAllByText('最近同步成功').length).toBeGreaterThan(0);
  });

  it('lets users configure visible data modules and persists that layout', async () => {
    renderPage();
    expect(await screen.findByText('市场整体走强，成长板块领涨。')).toBeInTheDocument();

    const editButton = screen.getByRole('button', { name: '编辑展示' });
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 市场宽度' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 市场资讯' }));
    fireEvent.click(screen.getByRole('button', { name: '保存看板' }));

    await waitFor(() => expect(editButton).toHaveFocus());
    expect(screen.queryByRole('heading', { name: '市场宽度' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '最新市场资讯' })).not.toBeInTheDocument();
    expect(api.updateMarketDashboard).toHaveBeenCalledWith('CN', expect.objectContaining({
      widgetIds: expect.not.arrayContaining(['breadth', 'news']),
    }));
  });

  it('starts a real market review task without sending notifications and polls progress', async () => {
    renderPage();
    await screen.findByText('市场整体走强，成长板块领涨。');

    fireEvent.click(screen.getByRole('button', { name: '生成最新复盘' }));

    await waitFor(() => expect(api.triggerMarketReview).toHaveBeenCalledWith({
      sendNotification: false,
      regions: ['cn'],
    }));
    await waitFor(() => expect(api.getStatus).toHaveBeenCalledWith('task-market'));
    expect(await screen.findByText(/正在生成 A 股 最新复盘/)).toBeInTheDocument();
  });

  it('switches markets, loads live US data, and does not reuse an unrelated saved summary', async () => {
    api.getMarketSnapshot.mockImplementation((market: 'cn' | 'hk' | 'us') => Promise.resolve(market === 'us' ? {
      version: 1,
      kind: 'market_snapshot',
      region: 'us',
      marketScope: '美股',
      generatedAt: new Date().toISOString(),
      date: '2026-09-04',
      indices: [{ code: 'SPX', name: '标普 500', current: 6501.2, changePct: 0.63 }],
      macroIndicators: [{ key: 'vix', name: 'VIX', current: 16.82, changePct: -2.1, source: 'Yahoo Finance' }],
      analysisSkills: ['global-macro-review', 'us-macro-review'],
      sectors: { top: [], bottom: [] },
      dataQuality: 'ok',
      warnings: [],
    } : {
      version: 1,
      kind: 'market_snapshot',
      region: market,
      marketScope: market.toUpperCase(),
      generatedAt: new Date().toISOString(),
      date: '2026-09-04',
      indices: [],
      macroIndicators: [],
      analysisSkills: ['global-macro-review'],
      sectors: { top: [], bottom: [] },
      dataQuality: 'unavailable',
      warnings: [],
    }));
    renderPage();
    await screen.findByText('市场整体走强，成长板块领涨。');

    fireEvent.click(screen.getByRole('button', { name: '美股' }));

    expect(await screen.findByText('标普 500')).toBeInTheDocument();
    expect(screen.getByText('6,501.2')).toBeInTheDocument();
    expect(screen.getByText('实时市场快照')).toBeInTheDocument();
    expect(screen.queryByText('市场整体走强，成长板块领涨。')).not.toBeInTheDocument();
    expect(screen.getByText('通胀 → Fed → 美债实际利率 → 估值；增长 → 企业盈利 → 股价')).toBeInTheDocument();
    expect(screen.getByText('us-macro-review')).toBeInTheDocument();
    expect(window.localStorage.getItem('dsa.market-intelligence-market.v1')).toBe('us');
  });

  it('keeps a macro-only payload visible and excludes invalid observations from snapshot coverage', async () => {
    api.getDetail.mockResolvedValue({
      ...report,
      details: {
        contextSnapshot: {
          marketReviewPayload: {
            kind: 'market_review',
            region: 'cn',
            generatedAt: new Date().toISOString(),
            macroIndicators: [
              {
                key: 'dxy',
                name: 'DXY 美元指数',
                current: 101.25,
                changePct: 0.32,
                unit: '点',
                asOf: '2026-09-03T16:00:00Z',
                source: 'Yahoo Finance',
              },
              { key: 'vix', name: 'VIX', source: 'Yahoo Finance' },
            ],
          },
        },
      },
    });

    renderPage();

    expect(await screen.findByText('101.25 点')).toBeInTheDocument();
    expect(screen.getByText('真实快照 1/15')).toBeInTheDocument();
    expect(screen.getByText(/Yahoo Finance ·/)).toBeInTheDocument();
  });
});
