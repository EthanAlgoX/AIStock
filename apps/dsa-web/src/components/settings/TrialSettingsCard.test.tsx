// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { trialApi } from '../../api/trial';
import { TrialSettingsCard } from './TrialSettingsCard';

vi.mock('../../api/trial', () => ({ trialApi: { users: vi.fn(), status: vi.fn(), invite: vi.fn(), enable: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ multiUserEnabled: false }) }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(trialApi.status).mockResolvedValue({enabled: false, user: null, experts: []});
  vi.mocked(trialApi.users).mockResolvedValue([{id:'u', email:'guest@example.com', enabled:true, enrolled:true, used:100, limit:200000}]);
  vi.mocked(trialApi.invite).mockResolvedValue({email:'new@example.com', inviteCode:'one-time-code', limit:200000});
});

it('issues an invitation and exposes a copyable code without sending email', async () => {
  render(<UiLanguageProvider><TrialSettingsCard /></UiLanguageProvider>);
  fireEvent.change(screen.getByLabelText('Invite email'), {target:{value:'new@example.com'}});
  fireEvent.submit(screen.getByRole('button', {name:'Generate invitation'}).closest('form')!);
  await waitFor(() => expect(trialApi.invite).toHaveBeenCalledWith('new@example.com'));
  expect(await screen.findByDisplayValue('one-time-code')).toHaveProperty('readOnly', true);
  expect(screen.getByText(/no automatic email or email verification/)).toBeTruthy();
});

it('suspends the selected identity without resetting its quota', async () => {
  render(<UiLanguageProvider><TrialSettingsCard /></UiLanguageProvider>);
  fireEvent.click(await screen.findByRole('button', {name:'Suspend'}));
  await waitFor(() => expect(trialApi.enable).toHaveBeenCalledWith('u', false));
  expect(screen.getByText('100 / 200,000')).toBeTruthy();
});
