import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import TokenUsagePage from '../TokenUsagePage';

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../api/index', () => ({
  default: { get },
}));

const dashboardResponse = {
  period: 'month',
  from_date: '2026-06-01',
  to_date: '2026-06-11',
  total_calls: 3,
  total_prompt_tokens: 120,
  total_completion_tokens: 280,
  total_tokens: 400,
  attributed_calls: 1,
  unattributed_calls: 2,
  by_call_type: [
    {
      call_type: 'analysis',
      calls: 2,
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
    },
    {
      call_type: 'agent',
      calls: 1,
      prompt_tokens: 20,
      completion_tokens: 80,
      total_tokens: 100,
    },
  ],
  by_model: [
    {
      model: 'openai/gpt-test',
      calls: 2,
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
      max_total_tokens: 240,
    },
    {
      model: 'custom-router',
      calls: 1,
      prompt_tokens: 20,
      completion_tokens: 80,
      total_tokens: 100,
      max_total_tokens: 100,
    },
  ],
  recent_calls: [
    {
      id: 1,
      called_at: '2026-06-11T09:30:00',
      call_type: 'analysis',
      model: 'openai/gpt-test',
      stock_code: '600519',
      strategy_id: 9,
      strategy_version_id: 12,
      strategy_run_id: 21,
      usage_scope: 'research_run',
      prompt_tokens: 40,
      completion_tokens: 200,
      total_tokens: 240,
    },
  ],
};

function makeDashboardResponse(overrides: Partial<typeof dashboardResponse> = {}) {
  return {
    ...dashboardResponse,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(
    <UiLanguageProvider>
      <TokenUsagePage />
    </UiLanguageProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('dsa.uiLanguage', 'zh');
  window.localStorage.setItem('dsa.uiLanguage', 'zh');
  vi.clearAllMocks();
  get.mockResolvedValue({ data: dashboardResponse });
});

describe('TokenUsagePage', () => {
  it('renders token summary, model breakdowns, and recent calls from the dashboard API shape', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '模型用量' })).toBeInTheDocument();
    expect(await screen.findByText('400')).toBeInTheDocument();
    expect(screen.getAllByText('openai/gpt-test')).toHaveLength(2);
    expect(screen.getAllByText('兼容单股分析')).toHaveLength(2);
    expect(screen.getByText(/600519/)).toBeInTheDocument();
    expect(screen.getByText('StrategyVersion #12')).toBeInTheDocument();
    expect(screen.getByText('研究运行 #21')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/usage/dashboard', {
      params: { period: 'month', limit: 50 },
    });
  });

  it('renders English copy when the UI language is English', async () => {
    window.localStorage.setItem('dsa.uiLanguage', 'en');

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Model usage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getAllByText('Compatibility stock analysis')).toHaveLength(2);
    expect(screen.getByText('Latest 50 model usage records, with version and run IDs when attribution is available.')).toBeInTheDocument();
    expect(screen.queryByText('模型用量')).not.toBeInTheDocument();
  });

  it('keeps the newest period data when dashboard requests resolve out of order', async () => {
    const monthRequest = createDeferred<{ data: typeof dashboardResponse }>();
    const todayRequest = createDeferred<{ data: typeof dashboardResponse }>();
    const todayResponse = makeDashboardResponse({
      period: 'today',
      from_date: '2026-06-15',
      to_date: '2026-06-15',
      total_calls: 9,
      total_prompt_tokens: 700,
      total_completion_tokens: 200,
      total_tokens: 900,
      by_call_type: [
        {
          call_type: 'analysis',
          calls: 9,
          prompt_tokens: 700,
          completion_tokens: 200,
          total_tokens: 900,
        },
      ],
      by_model: [
        {
          model: 'openai/gpt-test',
          calls: 9,
          prompt_tokens: 700,
          completion_tokens: 200,
          total_tokens: 900,
          max_total_tokens: 300,
        },
      ],
      recent_calls: [],
    });

    get.mockImplementation((_url, config) => {
      const period = config?.params?.period;
      if (period === 'month') {
        return monthRequest.promise;
      }
      if (period === 'today') {
        return todayRequest.promise;
      }
      return Promise.resolve({ data: dashboardResponse });
    });

    renderPage();

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/api/v1/usage/dashboard', {
        params: { period: 'month', limit: 50 },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '今日' }));

    await waitFor(() => {
      expect(get).toHaveBeenLastCalledWith('/api/v1/usage/dashboard', {
        params: { period: 'today', limit: 50 },
      });
    });

    await act(async () => {
      todayRequest.resolve({ data: todayResponse });
    });

    expect(await screen.findAllByText('900')).toHaveLength(2);

    await act(async () => {
      monthRequest.resolve({ data: dashboardResponse });
    });

    await waitFor(() => {
      expect(screen.getAllByText('900')).toHaveLength(2);
    });
    expect(screen.queryByText('400')).not.toBeInTheDocument();
  });

  it('reloads dashboard when period changes', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '模型用量' });
    fireEvent.click(screen.getByRole('button', { name: '今日' }));

    await waitFor(() => {
      expect(get).toHaveBeenLastCalledWith('/api/v1/usage/dashboard', {
        params: { period: 'today', limit: 50 },
      });
    });
  });

  it('keeps every model figure in a divided ledger and announces an in-flight period refresh', async () => {
    window.localStorage.setItem('dsa.uiLanguage', 'en');
    const next = createDeferred<{ data: typeof dashboardResponse }>();
    get.mockImplementation((_url, config) => config?.params?.period === 'today' ? next.promise : Promise.resolve({ data: dashboardResponse }));
    renderPage();
    await screen.findByText('400');
    const models = screen.getByRole('list', { name: 'Model usage' });
    const model = within(models).getAllByRole('listitem')[0];
    for (const number of ['300', '100', '200', '240']) expect(within(model).getByText(number)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('status')).toHaveTextContent('Updating; previous data remains visible.');
    expect(screen.getByText('400')).toBeVisible();
    await act(async () => next.resolve({ data: makeDashboardResponse({ period: 'today', total_tokens: 500 }) }));
    expect(screen.getByText('500')).toBeVisible();
    expect(screen.queryByText('Updating; previous data remains visible.')).not.toBeInTheDocument();
  });
});
