// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../contexts/UiLanguageContext';
import apiClient from '../api';
import MemberSettingsPage from './MemberSettingsPage';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ email: 'member@example.com', quota: { used: 500, limit: 200000, remaining: 199500 }, refreshStatus: vi.fn() }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../components/settings/ChangePasswordCard', () => ({ ChangePasswordCard: () => <div>Change password</div> }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: String(url).endsWith('/model-settings') ? { provider: '', model: '', configured: false, providers: [{ id: 'openai', name: 'OpenAI' }, { id: 'deepseek', name: 'DeepSeek' }] } : { enabled: false, email: 'member@example.com' } }));
});

it('shows only private account preferences and posts no recipient override', async () => {
  render(<UiLanguageProvider><MemberSettingsPage /></UiLanguageProvider>);
  expect(screen.getByRole('heading', { name: 'My account' })).toBeTruthy();
  expect(screen.getByText('member@example.com')).toBeTruthy();
  expect(screen.getByText(/199,500/)).toBeTruthy();
  const checkbox = screen.getByRole('checkbox');
  await waitFor(() => expect(checkbox).not.toBeDisabled());
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Save notification preference' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/v1/workspace/notification-settings', { enabled: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Notification preference saved.');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});

it('renders Chinese copy and offers retry for failed preference loading', async () => {
  localStorage.setItem('dsa.uiLanguage', 'zh');
  vi.mocked(apiClient.get).mockRejectedValue(new Error('offline'));
  render(<UiLanguageProvider><MemberSettingsPage /></UiLanguageProvider>);
  expect(screen.getByRole('heading', { name: '我的账户' })).toBeTruthy();
  expect(await screen.findAllByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('saves a private API and clears the key from the form', async () => {
  vi.mocked(apiClient.put).mockResolvedValue({ data: { provider: 'openai', model: 'my-model', configured: true, providers: [{ id: 'openai', name: 'OpenAI' }] } });
  render(<UiLanguageProvider><MemberSettingsPage /></UiLanguageProvider>);
  const model = await screen.findByLabelText('Model ID');
  fireEvent.change(model, { target: { value: 'my-model' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'personal-key' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save personal API' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/v1/workspace/model-settings', { provider: 'openai', model: 'my-model', apiKey: 'personal-key' }));
  await waitFor(() => expect(screen.getByLabelText('API Key')).toHaveValue(''));
  expect(screen.getByRole('button', { name: 'Remove personal API' })).toBeTruthy();
});
