// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { trialApi } from '../../api/trial';
import { TrialSettingsCard } from './TrialSettingsCard';

vi.mock('../../api/trial', () => ({ trialApi: { invitations: vi.fn(), setDailyLimit: vi.fn(), status: vi.fn(), invite: vi.fn(), enable: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ multiUserEnabled: false }) }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(trialApi.status).mockResolvedValue({enabled: false, user: null, experts: []});
  vi.mocked(trialApi.invitations).mockResolvedValue([{id:'i', userId:'u', email:'guest@example.com', enabled:true, state:'claimed', used:100, dailyLimit:200000, lifetimeUsed:100, timezone:'UTC', history:[{date:'2026-09-10',used:100,estimatedCalls:0}]}]);
  vi.mocked(trialApi.invite).mockResolvedValue({inviteCode:'one-time-code', inviteCodes:['one-time-code', 'second-code'], limit:200000, expiresAt:'2026-09-16T00:00:00'});
});

it('issues reusable-email invitation codes in a batch', async () => {
  render(<UiLanguageProvider><TrialSettingsCard /></UiLanguageProvider>);
  fireEvent.change(screen.getByLabelText('Number of invitations'), {target:{value:'2'}});
  fireEvent.submit(screen.getByRole('button', {name:'Generate invitation'}).closest('form')!);
  await waitFor(() => expect(trialApi.invite).toHaveBeenCalledWith(2, 200000));
  const output = await screen.findByLabelText('Invitations (copy now; not shown again after leaving)');
  expect(output).toHaveProperty('readOnly', true);
  expect(output).toHaveProperty('value', 'one-time-code\nsecond-code');
  expect(screen.getByText(/recipients choose their email/)).toBeTruthy();
});

it('suspends the selected identity without resetting its quota', async () => {
  render(<UiLanguageProvider><TrialSettingsCard /></UiLanguageProvider>);
  fireEvent.click(await screen.findByRole('button', {name:'Suspend'}));
  await waitFor(() => expect(trialApi.enable).toHaveBeenCalledWith('u', false));
  expect(screen.getByRole('progressbar')).toHaveProperty('value', 100);
});


it('saves a precise daily limit and shows daily history', async () => {
  render(<UiLanguageProvider><TrialSettingsCard /></UiLanguageProvider>);
  const input = await screen.findByLabelText('Exact limit (tokens)');
  fireEvent.change(input, {target:{value:'300000'}});
  fireEvent.click(screen.getByRole('button', {name:'Save limit'}));
  await waitFor(() => expect(trialApi.setDailyLimit).toHaveBeenCalledWith('i', 300000));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Daily limit saved.');
  expect(screen.getByText('2026-09-10')).toBeTruthy();
});
