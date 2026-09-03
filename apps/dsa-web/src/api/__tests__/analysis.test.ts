import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../analysis';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../index', () => ({
  default: {
    get,
    post,
  },
}));

describe('analysisApi.getMarketSnapshot', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({
      data: {
        kind: 'market_snapshot',
        region: 'us',
        generated_at: '2026-09-04T09:00:00+08:00',
        date: '2026-09-04',
        market_scope: '美股',
        indices: [],
        macro_indicators: [{ key: 'vix', name: 'VIX', current: 17.2 }],
        analysis_skills: ['global-macro-review', 'us-macro-review'],
        data_quality: 'partial',
        warnings: [],
      },
    });
  });

  it('requests a region-scoped read-only snapshot and converts its fields', async () => {
    const result = await analysisApi.getMarketSnapshot('us', true);

    expect(get).toHaveBeenCalledWith('/api/v1/analysis/market-snapshot', {
      params: { region: 'us', force_refresh: true },
    });
    expect(result.macroIndicators?.[0].key).toBe('vix');
    expect(result.analysisSkills).toContain('us-macro-review');
  });
});

describe('analysisApi.triggerMarketReview', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      status: 202,
      data: {
        status: 'accepted',
        message: 'accepted',
        send_notification: true,
        region: 'cn,us',
        task_id: 'market-task-1',
      },
    });
  });

  it('serializes selected markets to a comma-separated request string', async () => {
    const result = await analysisApi.triggerMarketReview({
      sendNotification: false,
      regions: ['cn', 'us'],
    });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/market-review',
      {
        send_notification: false,
        report_language: undefined,
        region: 'cn,us',
      },
      expect.any(Object),
    );
    expect(result.region).toBe('cn,us');
  });

  it('omits region when the caller inherits the server default', async () => {
    await analysisApi.triggerMarketReview({ sendNotification: true });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/market-review',
      {
        send_notification: true,
        report_language: undefined,
      },
      expect.any(Object),
    );
  });
});

describe('analysisApi strategy binding', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      status: 202,
      data: { task_id: 'analysis-1', trace_id: 'analysis-1', status: 'pending', message: 'accepted' },
    });
  });

  it('sends the selected formal StrategyVersion with the research request', async () => {
    await analysisApi.analyzeAsync({ stockCode: '600519', strategyVersionId: 120, notify: false });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/analysis/analyze',
      expect.objectContaining({
        stock_code: '600519',
        strategy_version_id: 120,
        async_mode: true,
        notify: false,
      }),
      expect.any(Object),
    );
  });
});
