import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoldingPlanEditor from './HoldingPlanEditor';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';

const api = vi.hoisted(() => ({ plan: vi.fn(), configure: vi.fn() }));
const workspace = vi.hoisted(() => ({ getCapabilities: vi.fn() }));
const strategies = vi.hoisted(() => ({ listStrategies: vi.fn(), getVersion: vi.fn() }));

vi.mock('../../api/portfolioResearch', () => ({ portfolioResearchApi: api }));
vi.mock('../../api/workspace', () => ({ workspaceApi: workspace }));
vi.mock('../../api/strategyWorkspace', () => ({ strategyWorkspaceApi: strategies }));
vi.mock('../agent/ResearchStrategySelector', () => ({ default: () => <div>Research strategy</div> }));
vi.mock('../common/ChoiceList', () => ({ default: () => <div>Additional experts</div> }));

const disabledPlan = {
  task: {
    id: 'holding-task', market: 'CN', capabilities: { skillIds: [], expertIds: [], expertTeamIds: [] },
    config: { strategyVersionId: 12, portfolioRules: { lossPct: 10, profitPct: 20, dailyMovePct: 5 } },
  },
  schedule: { id: 'schedule-1', enabled: false, intervalDays: 2, runAt: '16:30' },
  timezone: 'Asia/Shanghai', runAt: '16:30',
};

describe('HoldingPlanEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem('dsa.uiLanguage', 'en');
    api.plan.mockResolvedValue(disabledPlan);
    api.configure.mockResolvedValue({ ...disabledPlan, schedule: { ...disabledPlan.schedule, enabled: true } });
    workspace.getCapabilities.mockResolvedValue({ skills: [], experts: [] });
    strategies.listStrategies.mockResolvedValue([]);
  });

  it('saves schedule settings with automatic tracking enabled', async () => {
    const onSaved = vi.fn();
    render(<UiLanguageProvider><HoldingPlanEditor item={{ accountId: 7, position: { symbol: '600519', market: 'CN' } } as never} onSaved={onSaved} /></UiLanguageProvider>);

    await screen.findByRole('button', { name: 'Save & enable tracking' });
    fireEvent.change(screen.getByLabelText('Run every (days)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Run time (market local time)'), { target: { value: '17:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & enable tracking' }));

    await waitFor(() => expect(api.configure).toHaveBeenCalledWith(7, '600519', expect.objectContaining({
      dailyEnabled: true, intervalDays: 3, runAt: '17:00',
    })));
    expect(onSaved).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(api.configure).toHaveBeenLastCalledWith(7, '600519', expect.objectContaining({ dailyEnabled: false })));
  });
});

it('persists JEV as the backend used by the tracking plan', async () => {
  localStorage.setItem('dsa.uiLanguage', 'en');
  api.plan.mockResolvedValue(disabledPlan);
  api.configure.mockResolvedValue(disabledPlan);
  workspace.getCapabilities.mockResolvedValue({ skills: [], experts: [] });
  strategies.listStrategies.mockResolvedValue([]);
  render(<UiLanguageProvider><HoldingPlanEditor item={{ accountId: 7, position: { symbol: '600519', market: 'CN' } } as never} onSaved={vi.fn()} /></UiLanguageProvider>);
  fireEvent.change(await screen.findByLabelText('Analysis model'), { target: { value: 'jev' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & enable tracking' }));
  await waitFor(() => expect(api.configure).toHaveBeenLastCalledWith(7, '600519', expect.objectContaining({ decisionBackend: 'jev', dailyEnabled: true })));
});
