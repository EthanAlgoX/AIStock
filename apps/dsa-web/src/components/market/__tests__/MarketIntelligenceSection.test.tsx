import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisReport } from '../../../types/analysis';
import MarketIntelligenceSection from '../MarketIntelligenceSection';

const { getDetail, getList, listDataSources } = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getList: vi.fn(),
  listDataSources: vi.fn(),
}));

vi.mock('../../../api/history', () => ({
  historyApi: { getDetail, getList },
}));

vi.mock('../../../api/workspace', () => ({
  workspaceApi: { listDataSources },
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
    getList.mockReset();
    getDetail.mockReset();
    listDataSources.mockReset();
    getList.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 1,
      items: [{
        id: 5,
        queryId: 'market-review-5',
        stockCode: 'market_review_cn',
        reportType: 'market_review',
        region: 'cn',
        createdAt: new Date().toISOString(),
      }],
    });
    getDetail.mockResolvedValue(report);
    listDataSources.mockResolvedValue([
      {
        sourceId: 'system_market_data',
        name: '系统行情',
        kind: 'kline',
        connectionKey: 'system',
        required: false,
        builtIn: true,
        selectable: true,
        availability: 'system_managed',
      },
      {
        sourceId: 'system_news',
        name: '财经新闻',
        kind: 'news',
        connectionKey: 'news',
        required: false,
        builtIn: true,
        selectable: false,
        availability: 'unconfigured',
      },
    ]);
  });

  it('renders the latest real market snapshot and configured source states', async () => {
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
    expect(screen.getByText('可供 Agent 使用')).toBeInTheDocument();
    expect(screen.getByText('待配置')).toBeInTheDocument();
    expect(screen.getByText('未注册')).toBeInTheDocument();
  });

  it('shows an honest empty state and can reload', async () => {
    getList.mockResolvedValue({ total: 0, page: 1, limit: 1, items: [] });
    renderPage();

    expect(await screen.findByText('暂无市场复盘数据')).toBeInTheDocument();
    expect(getDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(getList).toHaveBeenCalledTimes(2));
  });

  it('keeps source status visible when market history fails', async () => {
    getList.mockRejectedValue(new Error('history unavailable'));
    renderPage();

    expect(await screen.findByText('暂时无法读取市场复盘')).toBeInTheDocument();
    expect(screen.getByText('系统行情')).toBeInTheDocument();
    expect(screen.getByText('可供 Agent 使用')).toBeInTheDocument();
  });

  it('lets users replace default modules and source details, then restores the layout', async () => {
    listDataSources.mockResolvedValue([
      {
        sourceId: 'system_market_data',
        name: '系统行情',
        kind: 'kline',
        connectionKey: 'system',
        required: false,
        builtIn: true,
        selectable: true,
        availability: 'system_managed',
      },
      {
        sourceId: 'system_news',
        name: '财经新闻',
        kind: 'news',
        connectionKey: 'news',
        required: false,
        builtIn: true,
        selectable: false,
        availability: 'unconfigured',
      },
      {
        sourceId: 'workspace_macro',
        name: '工作区宏观数据库',
        description: '利率、汇率与宏观日历',
        kind: 'other',
        connectionKey: 'macro',
        required: false,
        builtIn: false,
        selectable: true,
        availability: 'configured',
        markets: ['cn', 'hk', 'us'],
      },
    ]);
    const first = renderPage();
    expect(await screen.findByText('市场整体走强，成长板块领涨。')).toBeInTheDocument();

    const editButton = screen.getByRole('button', { name: '编辑展示' });
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole('checkbox', { name: '显示 市场宽度' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示数据源 财经新闻 新闻与资讯' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示数据源 工作区宏观数据库 其他研究数据' }));
    fireEvent.click(screen.getByRole('button', { name: '应用展示' }));

    expect(editButton).toHaveFocus();
    expect(screen.queryByRole('heading', { name: '市场宽度' })).not.toBeInTheDocument();
    const sourcePanel = screen.getByRole('complementary', { name: '市场情报展示数据源' });
    expect(within(sourcePanel).getByText('工作区宏观数据库')).toBeInTheDocument();
    expect(within(sourcePanel).queryByText('财经新闻')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('dsa.market-intelligence-layout.v1')).toContain('workspace_macro');
    first.unmount();

    renderPage();
    expect(await screen.findByText('市场整体走强，成长板块领涨。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '市场宽度' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: '市场情报展示数据源' })).getByText('工作区宏观数据库')).toBeInTheDocument();
  });
});
