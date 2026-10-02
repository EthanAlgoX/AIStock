import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyApi } from '../../../api/history';
import type {
  AnalysisContextPackOverview,
  AnalysisReport,
  AnalysisResult,
  MarketStructureContext,
} from '../../../types/analysis';
import { AnalysisContextSummary } from '../AnalysisContextSummary';
import { ReportSummary } from '../ReportSummary';

vi.mock('../../../api/history', () => ({
  historyApi: {
    getDiagnostics: vi.fn(),
    getNews: vi.fn(),
  },
}));

const overview: AnalysisContextPackOverview = {
  packVersion: '1.0',
  createdAt: '2026-04-10T08:30:00+00:00',
  subject: {
    code: '600519',
    stockName: '贵州茅台',
    market: 'cn',
  },
  blocks: [
    {
      key: 'quote',
      label: '行情',
      status: 'available',
      source: 'mock_quote',
      warnings: [],
      missingReasons: [],
    },
    {
      key: 'news',
      label: '新闻',
      status: 'missing',
      source: null,
      warnings: ['news_provider_timeout'],
      missingReasons: ['news_context_missing'],
    },
    {
      key: 'fundamentals',
      label: '基本面',
      status: 'fetch_failed',
      source: 'fundamental_pipeline',
      warnings: [],
      missingReasons: ['fundamental_pipeline_failed'],
    },
  ],
  counts: {
    available: 1,
    missing: 1,
    notSupported: 0,
    fallback: 0,
    stale: 0,
    estimated: 0,
    partial: 0,
    fetchFailed: 1,
  },
  dataQuality: {
    overallScore: 82,
    level: 'usable',
    blockScores: {
      quote: 100,
      daily_bars: 100,
      technical: 100,
      news: 35,
      fundamentals: 25,
      chip: 100,
    },
    limitations: ['fundamentals: fetch_failed'],
  },
  warnings: ['intraday_realtime_overlay'],
  metadata: {
    triggerSource: 'api',
    newsResultCount: 3,
  },
};

const marketStructure: MarketStructureContext = {
  schemaVersion: 'market-structure-v1',
  status: 'ok',
  market: 'cn',
  tradeDate: '2026-07-12',
  marketThemeContext: {
    schemaVersion: 'market-theme-v1',
    status: 'ok',
    market: 'cn',
    activeThemes: [{ name: 'Robotics', rank: 1, source: 'concept' }],
    leadingConcepts: [],
    leadingIndustries: [],
    laggingThemes: [],
    themeBreadth: {
      activeCount: 1,
      leadingConceptCount: 0,
      leadingIndustryCount: 0,
      laggingCount: 0,
    },
    dataQuality: { status: 'ok', missingFields: [], sources: [], errors: [] },
  },
  stockMarketPosition: {
    schemaVersion: 'stock-market-position-v1',
    status: 'ok',
    stockCode: '600519',
    stockName: 'Kweichow Moutai',
    market: 'cn',
    primaryTheme: { name: 'Robotics', source: 'concept', rank: 1 },
    relatedBoards: [],
    stockRole: 'follower',
    themePhase: 'accelerating',
    riskTags: [],
    missingFields: [],
  },
};

describe('AnalysisContextSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a collapsed summary and expands overview details on demand', () => {
    render(<AnalysisContextSummary overview={overview} />);

    const panel = screen.getByTestId('analysis-context-summary');
    expect(panel).not.toHaveAttribute('open');
    expect(within(panel).getAllByText('输入数据块')[0]).toBeVisible();
    expect(screen.getAllByText('可用 1')[0]).toBeVisible();
    expect(screen.getAllByText('缺失 1')[0]).toBeVisible();
    expect(screen.getAllByText('抓取失败 1')[0]).toBeVisible();
    expect(screen.getAllByText('质量分 82/100 可用')[0]).toBeVisible();
    expect(screen.getByText('触发来源: api')).toBeVisible();
    expect(screen.getByText('来源: mock_quote')).not.toBeVisible();

    fireEvent.click(within(panel).getAllByText('输入数据块')[0]);

    expect(panel).toHaveAttribute('open');
    expect(screen.getByText('行情')).toBeInTheDocument();
    expect(screen.getByText('来源: mock_quote')).toBeVisible();
    expect(screen.getByText('告警:')).toBeInTheDocument();
    expect(screen.getByText(/intraday_realtime_overlay/)).toBeInTheDocument();
    expect(screen.getByText('数据限制:')).toBeInTheDocument();
    expect(screen.getByText(/基本面：抓取失败/)).toBeInTheDocument();
    expect(screen.getByText(/news_provider_timeout/)).toBeInTheDocument();
    expect(screen.getByText(/说明: 新闻未进入本次 LLM 分析，结论未使用新闻上下文/)).toBeInTheDocument();
    expect(screen.getByText(/诊断码: news_context_missing/)).toBeInTheDocument();
    expect(screen.getByText(/报告页相关资讯由独立接口补充，显示与否不代表已进入本次分析/)).toBeInTheDocument();
    expect(screen.getByText('来源: 未记录输入来源')).toBeInTheDocument();
    expect(screen.queryByText(/^处理:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^范围:/)).not.toBeInTheDocument();
    const fundamentalsBlock = screen.getByText('基本面').closest('.home-subpanel');
    expect(fundamentalsBlock).not.toBeNull();
    const fundamentals = within(fundamentalsBlock as HTMLElement);
    expect(fundamentals.getByText(/说明: 基本面抓取失败，本次分析未使用基本面数据/)).toBeInTheDocument();
    expect(fundamentals.getByText(/诊断码: fundamental_pipeline_failed/)).toBeInTheDocument();
    expect(screen.getAllByText('新闻结果数: 3').some((item) => item.textContent === '新闻结果数: 3')).toBe(true);
    expect(screen.getAllByText('本次分析输入')[0]).toBeVisible();
  });

  it('localizes the collapsed summary for english reports', () => {
    render(<AnalysisContextSummary overview={overview} language="en" />);

    const panel = screen.getByTestId('analysis-context-summary');
    expect(panel).not.toHaveAttribute('open');
    expect(screen.getAllByText('Input Blocks')[0]).toBeVisible();
    expect(screen.getByText('Shows inputs included in this LLM run, not provider run success')).toBeVisible();
    expect(screen.getAllByText('Available 1')[0]).toBeVisible();
    expect(screen.getAllByText('Missing 1')[0]).toBeVisible();
    expect(screen.getAllByText('Fetch failed 1')[0]).toBeVisible();
    expect(screen.getAllByText('Quality 82/100 Usable')[0]).toBeVisible();
    expect(screen.getByText('Trigger: api')).toBeVisible();

    fireEvent.click(within(panel).getAllByText('Input Blocks')[0]);

    expect(screen.getByText('Data Limitations:')).toBeInTheDocument();
    expect(screen.getByText(/fundamentals: Fetch failed/)).toBeInTheDocument();
    expect(screen.getByText(/Details: News was not included in this LLM run, so the conclusion did not use news context/)).toBeInTheDocument();
    expect(screen.getByText(/related news on the report page is loaded separately and does not indicate that it was used in this analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Diagnostic code: news_context_missing/)).toBeInTheDocument();
    expect(screen.queryByText(/^Action:/)).not.toBeInTheDocument();
  });

  it.each([
    ['zh', '社交舆情', '新闻检索失败，未取得可核实新闻', '社交帖子未经核实'],
    ['en', 'social sentiment', 'News retrieval failed and no verifiable news was obtained', 'Social posts are unverified'],
    ['ko', '소셜 심리', '뉴스 검색에 실패하여 검증 가능한 뉴스를 확보하지 못했습니다', '소셜 게시물은 검증되지 않았습니다'],
    ['ja', 'ソーシャルセンチメント', 'ニュース検索に失敗し、検証可能なニュースを取得できませんでした', '投稿内容は未検証です'],
    ['zh-TW', '社群情緒', '新聞檢索失敗，未取得可核實新聞', '社群貼文未經核實'],
  ] as const)('localizes social evidence and failed news in %s without showing raw posts', (
    language, socialLabel, failedNewsDetail, socialWarning,
  ) => {
    const evidenceOverview = {
      ...overview,
      blocks: [
        {
          key: 'social',
          label: '社交舆情',
          status: 'available',
          source: 'social_sentiment_service',
          warnings: ['social_sentiment_unverified', 'future_social_warning'],
          missingReasons: [],
          items: { content: { value: 'Raw social post stays private' } },
        },
        {
          key: 'news',
          label: '新闻',
          status: 'fetch_failed',
          source: null,
          warnings: [],
          missingReasons: ['news_search_failed'],
        },
      ],
      warnings: [],
      counts: { ...overview.counts, missing: 0 },
      metadata: { triggerSource: 'api', newsResultCount: 0 },
    } as AnalysisContextPackOverview;

    render(<AnalysisContextSummary overview={evidenceOverview} language={language} />);
    const panel = screen.getByTestId('analysis-context-summary');
    fireEvent.click(panel.querySelector('summary') as HTMLElement);

    expect(screen.getByText(socialLabel)).toBeVisible();
    expect(screen.getByText(new RegExp(socialWarning))).toBeVisible();
    expect(screen.getByText(new RegExp(failedNewsDetail))).toBeVisible();
    expect(screen.getByText(/social_sentiment_unverified/)).toBeInTheDocument();
    expect(screen.getByText(/news_search_failed/)).toBeInTheDocument();
    expect(screen.getByText(/future_social_warning/)).toBeInTheDocument();
    expect(screen.queryByText('Raw social post stays private')).not.toBeInTheDocument();
  });

  it('explains partial news warnings in blocks and the overview while preserving unknown codes', () => {
    const partialNewsOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'news',
        label: 'news',
        status: 'partial',
        source: 'news_search, local_intelligence',
        warnings: ['news_search_partial'],
        missingReasons: [],
      }],
      counts: { ...overview.counts, available: 0, missing: 0, fetchFailed: 0, partial: 1 },
      warnings: ['news_search_partial', 'future_overview_warning'],
    };

    render(<AnalysisContextSummary overview={partialNewsOverview} language="en" />);
    const panel = screen.getByTestId('analysis-context-summary');
    fireEvent.click(panel.querySelector('summary') as HTMLElement);

    expect(screen.getAllByText(/Some news searches failed; available sources were retained/)).toHaveLength(2);
    expect(screen.getAllByText(/news_search_partial/)).toHaveLength(2);
    expect(screen.getByText(/future_overview_warning/)).toBeInTheDocument();
  });

  it('explains insufficient valid technical history instead of suggesting a missing provider', () => {
    const insufficientHistoryOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'technical', label: '技术', status: 'missing', source: null,
        warnings: [], missingReasons: ['technical_history_insufficient'],
      }],
      counts: { ...overview.counts, available: 0, missing: 1, fetchFailed: 0 },
    };
    render(<AnalysisContextSummary overview={insufficientHistoryOverview} />);
    const panel = screen.getByTestId('analysis-context-summary');
    fireEvent.click(panel.querySelector('summary') as HTMLElement);

    expect(screen.getByText(/连续有效日线不足，无法完成趋势分析/)).toBeVisible();
    expect(screen.getByText(/请补齐日线历史并重新分析/)).toBeVisible();
    expect(screen.getByText(/technical_history_insufficient/)).toBeInTheDocument();
  });

  it.each([
    ['zh', '技术输入受历史样本、数据连续性等限制；详细原因见技术分析'],
    ['en', 'Technical inputs are limited by historical sample coverage, data continuity, or related issues; see the technical analysis for details'],
    ['ko', '과거 표본 범위, 데이터 연속성 등의 문제로 기술 분석 입력이 제한됩니다. 자세한 원인은 기술 분석을 확인하세요'],
    ['ja', '技術分析の入力は、履歴サンプルの範囲やデータの連続性などに制限があります。詳細は技術分析を確認してください'],
    ['zh-TW', '技術輸入受歷史樣本、資料連續性等限制；詳細原因請見技術分析'],
  ] as const)('localizes technical input limitations in %s in blocks and the overview', (language, detail) => {
    const limitedTechnicalOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'technical', label: '技术', status: 'partial', source: 'trend_analyzer',
        warnings: ['technical_input_limited'], missingReasons: [],
      }],
      counts: { ...overview.counts, available: 0, missing: 0, fetchFailed: 0, partial: 1 },
      warnings: ['technical_input_limited'],
    };
    render(<AnalysisContextSummary overview={limitedTechnicalOverview} language={language} />);
    const panel = screen.getByTestId('analysis-context-summary');
    fireEvent.click(panel.querySelector('summary') as HTMLElement);

    expect(screen.getAllByText(new RegExp(detail))).toHaveLength(2);
    expect(screen.getAllByText(/technical_input_limited/)).toHaveLength(2);
    if (language !== 'zh') {
      expect(screen.queryByText(/技术输入受历史样本/)).not.toBeInTheDocument();
    }
  });

  it('does not claim available fundamentals were unused when only provenance is missing', () => {
    const availableFundamentalsOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'fundamentals',
        label: '基本面',
        status: 'available',
        source: null,
        warnings: [],
        missingReasons: ['fundamental_source_chain_missing'],
      }],
      counts: {
        available: 1,
        missing: 0,
        notSupported: 0,
        fallback: 0,
        stale: 0,
        estimated: 0,
        partial: 0,
        fetchFailed: 0,
      },
    };

    render(<AnalysisContextSummary overview={availableFundamentalsOverview} />);

    fireEvent.click(screen.getAllByText('输入数据块')[0]);

    expect(screen.getByText(/说明: 未记录基本面来源链元数据/)).toBeInTheDocument();
    expect(screen.getByText(/基本面是否进入本次分析以当前状态为准/)).toBeInTheDocument();
    expect(screen.getByText(/诊断码: fundamental_source_chain_missing/)).toBeInTheDocument();
    expect(screen.queryByText(/本次分析未使用基本面数据/)).not.toBeInTheDocument();
  });

  it('uses status guidance for unknown reason codes without adding another field', () => {
    const unknownReasonOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'fundamentals',
        label: '基本面',
        status: 'fetch_failed',
        source: 'fundamental_pipeline',
        warnings: [],
        missingReasons: ['brand_new_internal_code'],
      }],
      counts: {
        available: 0,
        missing: 0,
        notSupported: 0,
        fallback: 0,
        stale: 0,
        estimated: 0,
        partial: 0,
        fetchFailed: 1,
      },
    };

    render(<AnalysisContextSummary overview={unknownReasonOverview} />);

    fireEvent.click(screen.getAllByText('输入数据块')[0]);

    expect(screen.getByText(/说明: 数据抓取失败，本次分析未使用该数据；请检查数据源、网络或限流后重新分析/)).toBeInTheDocument();
    expect(screen.getByText(/诊断码: brand_new_internal_code/)).toBeInTheDocument();
    expect(screen.queryByText(/^处理:/)).not.toBeInTheDocument();
  });

  it('explains the real chip_not_supported reason with actionable guidance', () => {
    const unsupportedChipOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [{
        key: 'chip',
        label: '筹码',
        status: 'not_supported',
        source: null,
        warnings: [],
        missingReasons: ['chip_not_supported'],
      }],
      counts: {
        available: 0,
        missing: 0,
        notSupported: 1,
        fallback: 0,
        stale: 0,
        estimated: 0,
        partial: 0,
        fetchFailed: 0,
      },
    };

    render(<AnalysisContextSummary overview={unsupportedChipOverview} />);

    fireEvent.click(screen.getAllByText('输入数据块')[0]);

    expect(screen.getByText(/说明: 当前市场或标的不支持筹码数据，本次分析未使用该指标；请结合其他指标判断/)).toBeInTheDocument();
    expect(screen.getByText(/诊断码: chip_not_supported/)).toBeInTheDocument();
    expect(screen.queryByText(/^处理:/)).not.toBeInTheDocument();
  });

  it('surfaces degraded non-zero states in the collapsed summary', () => {
    const degradedOverview: AnalysisContextPackOverview = {
      ...overview,
      blocks: [
        {
          key: 'quote',
          label: '行情',
          status: 'fallback',
          source: 'cached_quote',
          warnings: ['quote_fallback'],
          missingReasons: [],
        },
        {
          key: 'fundamental',
          label: '基本面',
          status: 'stale',
          source: 'fundamental_cache',
          warnings: ['stale_fundamental'],
          missingReasons: [],
        },
        {
          key: 'technical',
          label: '技术',
          status: 'partial',
          source: 'technical_pipeline',
          warnings: ['technical_partial'],
          missingReasons: [],
        },
        {
          key: 'chip',
          label: '筹码',
          status: 'estimated',
          source: 'estimated_chip',
          warnings: [],
          missingReasons: [],
        },
        {
          key: 'daily_bars',
          label: '日线',
          status: 'not_supported',
          source: null,
          warnings: [],
          missingReasons: [],
        },
      ],
      counts: {
        available: 0,
        missing: 0,
        notSupported: 1,
        fallback: 1,
        stale: 1,
        estimated: 1,
        partial: 1,
        fetchFailed: 0,
      },
    };

    render(<AnalysisContextSummary overview={degradedOverview} />);

    const panel = screen.getByTestId('analysis-context-summary');
    expect(panel).not.toHaveAttribute('open');
    expect(within(panel).getByText('可用 0')).toBeVisible();
    expect(within(panel).getByText('缺失 0')).toBeVisible();
    expect(within(panel).getAllByText('降级 1')[0]).toBeVisible();
    expect(within(panel).getAllByText('过期 1')[0]).toBeVisible();
    expect(within(panel).getAllByText('估算 1')[0]).toBeVisible();
    expect(within(panel).getAllByText('部分可用 1')[0]).toBeVisible();
    expect(within(panel).getAllByText('不支持 1')[0]).toBeVisible();

    fireEvent.click(within(panel).getAllByText('输入数据块')[0]);

    const quoteBlock = screen.getByText('行情').closest('.home-subpanel');
    expect(quoteBlock).not.toBeNull();
    expect(within(quoteBlock as HTMLElement).getByText('说明: 本次分析使用了备用数据路径；请结合来源和告警复核结果')).toBeInTheDocument();
    expect(within(quoteBlock as HTMLElement).queryByText(/^处理:/)).not.toBeInTheDocument();

    expect(screen.getByText('说明: 本次分析使用的不是最新数据；请检查更新时间并按需重新分析')).toBeInTheDocument();
    expect(screen.getByText('说明: 仅部分数据进入本次分析，相关结论可能不完整；请检查告警和数据源后重新分析')).toBeInTheDocument();
    expect(screen.getByText('说明: 本次分析使用了估算数据；请结合原始数据复核结果')).toBeInTheDocument();
    expect(screen.getByText('说明: 当前市场或标的不支持该数据，本次分析未使用该数据；请结合其他指标判断')).toBeInTheDocument();
  });

  it('does not render without an overview', () => {
    const { container } = render(<AnalysisContextSummary overview={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render raw values or unexpected sensitive fields', () => {
    const unsafeOverview = {
      ...overview,
      value: 'raw trend payload',
      content: '完整新闻正文不应出现',
      apiKey: 'secret-key',
      blocks: [
        {
          ...overview.blocks[0],
          items: {
            price: {
              value: 1880,
              apiKey: 'secret-key',
            },
          },
        },
      ],
    } as unknown as AnalysisContextPackOverview;

    render(<AnalysisContextSummary overview={unsafeOverview} />);

    fireEvent.click(screen.getAllByText('输入数据块')[0]);

    expect(screen.queryByText('raw trend payload')).not.toBeInTheDocument();
    expect(screen.queryByText('完整新闻正文不应出现')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-key')).not.toBeInTheDocument();
  });
});

describe('ReportSummary analysis context placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders strategy and news before context, diagnostics and traceability', async () => {
    vi.mocked(historyApi.getNews).mockResolvedValue({
      total: 0,
      items: [],
    });

    const report: AnalysisReport = {
      meta: {
        id: 1,
        queryId: 'q1',
        stockCode: '600519',
        stockName: '贵州茅台',
        reportType: 'detailed',
        reportLanguage: 'zh',
        createdAt: '2026-04-10T12:00:00',
        marketPhaseSummary: {
          market: 'cn',
          phase: 'intraday',
          marketLocalTime: '2026-04-10T10:30:00+08:00',
          sessionDate: '2026-04-10',
          effectiveDailyBarDate: '2026-04-09',
          isTradingDay: true,
          isMarketOpenNow: true,
          isPartialBar: true,
          minutesToOpen: null,
          minutesToClose: 150,
          triggerSource: 'api',
          analysisIntent: 'auto',
          warnings: [],
        },
      },
      summary: {
        analysisSummary: 'summary',
        operationAdvice: '持有',
        trendPrediction: '震荡',
        sentimentScore: 70,
      },
      strategy: {
        idealBuy: '120',
      },
      details: {
        analysisContextPackOverview: overview,
        marketStructure,
      },
    };
    const result: AnalysisResult = {
      queryId: 'q1',
      stockCode: '600519',
      stockName: '贵州茅台',
      report,
      diagnosticSummary: {
        status: 'normal',
        statusLabel: '正常',
        reason: '运行正常',
        components: {},
        copyText: '',
      },
      createdAt: '2026-04-10T12:00:00',
    };

    render(<ReportSummary data={result} />);

    await waitFor(() => {
      expect(screen.getByText('暂无相关资讯')).toBeInTheDocument();
    });

    expect(screen.getByText('市场阶段: CN · 盘中')).toBeInTheDocument();
    expect(screen.getByText('日线未完成')).toBeInTheDocument();
    expect(screen.getAllByText('质量分 82/100 可用')[0]).toBeInTheDocument();

    const strategy = screen.getByText('狙击点位');
    const news = screen.getByText('相关资讯');
    const diagnostics = screen.getByTestId('run-diagnostics');
    const contextSummary = screen.getByTestId('analysis-context-summary');
    expect(contextSummary).not.toHaveAttribute('open');
    expect(diagnostics).not.toHaveAttribute('open');
    const traceability = screen.getByText('数据追溯');

    expect(strategy.compareDocumentPosition(news) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(news.compareDocumentPosition(contextSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contextSummary.compareDocumentPosition(diagnostics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(diagnostics.compareDocumentPosition(traceability) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(contextSummary).getAllByText('输入数据块')[0]);
    expect(within(contextSummary).getByText(/说明: 新闻未进入本次 LLM 分析，结论未使用新闻上下文/)).toBeInTheDocument();
    expect(within(contextSummary).getByText(/报告页相关资讯由独立接口补充，显示与否不代表已进入本次分析/)).toBeInTheDocument();
    expect(screen.queryByText('AI 建议 / 决策信号')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '题材主线与个股位置' })).not.toBeInTheDocument();
    expect(screen.queryByText('Robotics')).not.toBeInTheDocument();
  });
});
