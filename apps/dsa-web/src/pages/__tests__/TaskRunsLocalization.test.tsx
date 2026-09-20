import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { workspaceApi } from '../../api/workspace';
import { workspaceRunFixture, workspaceTaskFixture } from '../../testWorkspaceFixtures';
import TaskRunsPage from '../TaskRunsPage';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { UiLanguageToggle } from '../../components/i18n/UiLanguageToggle';
import { translateSource } from '../../i18n/localize';

vi.mock('../../api/workspace', () => ({ workspaceApi: {
  runHistory: vi.fn().mockRejectedValue(new Error('offline')),
  listSchedules: vi.fn().mockResolvedValue([]),
} }));

describe('Task ledger language consistency', () => {
  it('updates options, static explanations and an existing error in all five languages', async () => {
    render(<MemoryRouter><UiLanguageProvider><UiLanguageToggle /><TaskRunsPage /></UiLanguageProvider></MemoryRouter>);
    await screen.findByRole('alert');
    for (const language of ['en', 'ko', 'ja', 'zh-TW', 'zh']) {
      fireEvent.change(screen.getAllByRole('combobox')[0], {target: {value: language}});
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(translateSource('任务账本读取失败，请稍后重试。', language)));
      expect(screen.getByRole('option', {name: translateSource('单股分析', language)})).toBeInTheDocument();
      expect(screen.getByRole('option', {name: translateSource('排队中', language)})).toBeInTheDocument();
      expect(screen.getByText(translateSource('提交时的目标与配置', language))).toBeInTheDocument();
      expect(screen.getByText(translateSource('任务运行账本', language))).toBeInTheDocument();
      if (language === 'en' || language === 'ko') {
        expect(screen.getByTestId('task-runs-page').textContent).not.toMatch(/[\u3400-\u9fff]/);
      }
    }
  });
  it('translates loaded run labels while preserving user task names', async () => {
    vi.mocked(workspaceApi.runHistory).mockResolvedValueOnce({
      items: [workspaceRunFixture(workspaceTaskFixture({kind: 'research', name: '我的研究'}), {
        status: 'completed', outcome: {status: 'produced', message: ''},
      })], total: 1, statusCounts: {completed: 1},
    });
    render(<MemoryRouter><UiLanguageProvider><UiLanguageToggle /><TaskRunsPage /></UiLanguageProvider></MemoryRouter>);
    await screen.findByText('我的研究');
    fireEvent.change(screen.getAllByRole('combobox')[0], {target: {value: 'ko'}});
    expect(screen.getByText('我的研究')).toBeInTheDocument();
    expect(screen.getByText(translateSource('已产出', 'ko'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(translateSource('单股分析', 'ko') + ' ·'))).toBeInTheDocument();
  });

});
