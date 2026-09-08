// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UiLanguageProvider } from '../contexts/UiLanguageContext';
import { trialApi } from '../api/trial';
import TrialPage from './TrialPage';

vi.mock('../api/trial', () => ({ trialApi: { status: vi.fn(), runs: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), run: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(trialApi.status).mockResolvedValue({ enabled: false, user: null, experts: [] });
  vi.mocked(trialApi.runs).mockResolvedValue([]);
});
const show = () => render(<MemoryRouter><UiLanguageProvider><TrialPage /></UiLanguageProvider></MemoryRouter>);

it('lets anonymous visitors explore every demo without model calls or Chinese content', async () => {
  const view = show();
  for (const name of ['Assistant', 'Roundtable', 'Stock research', 'Screening', 'Trade simulation', 'Portfolio']) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByText('Demo data · not live research')).toBeTruthy();
    // The language selector intentionally names Chinese in its native script.
    const content = view.container.querySelector('section')!.textContent!;
    expect(content).not.toMatch(/[\u4e00-\u9fff]/);
  }
  fireEvent.click(screen.getByLabelText('Enable demo alert'));
  expect(screen.getByRole('status').textContent).toContain('No portfolio record');
  await waitFor(() => expect(trialApi.status).toHaveBeenCalled());
  expect(trialApi.run).not.toHaveBeenCalled();
  expect(trialApi.runs).not.toHaveBeenCalled();
});

it('blocks exhausted real trials while keeping reports readable', async () => {
  vi.mocked(trialApi.status).mockResolvedValue({ enabled: true, experts: [], user: { email: 'trial@example.com', limit: 200000, used: 200000, remaining: 0, activeRun: null } });
  vi.mocked(trialApi.runs).mockResolvedValue([{ id: 'r', status: 'completed', topic: 'Saved research', events: [{ role: 'summary', content: 'Evidence remains available.' }], error: null, createdAt: '2026-09-09' }]);
  show();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run live research' })).toHaveProperty('disabled', true));
  expect(screen.getByText('Saved research')).toBeTruthy();
  expect(screen.getByText('Evidence remains available.')).toBeTruthy();
});

it('uses independent invitation credentials and clears them after enrollment', async () => {
  show();
  fireEvent.change(screen.getByLabelText('Trial email'), { target: { value: 'guest@example.com' } });
  fireEvent.change(screen.getByLabelText('Trial password'), { target: { value: 'trial-password' } });
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: 'invite-token' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Claim & sign in', hidden: true }).closest('form')!);
  await waitFor(() => expect(trialApi.authenticate).toHaveBeenCalledWith(true, 'guest@example.com', 'trial-password', 'invite-token'));
  await waitFor(() => expect(screen.getByLabelText('Trial password')).toHaveProperty('value', ''));
});
