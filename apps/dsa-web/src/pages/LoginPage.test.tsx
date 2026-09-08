// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UiLanguageProvider } from '../contexts/UiLanguageContext';
import { authApi } from '../api/auth';
import LoginPage from './LoginPage';

const state = vi.hoisted(() => ({ accountMode: true, accountState: 'register', passwordSet: false, refreshStatus: vi.fn(), registrationMode: 'closed', multiUserEnabled: false }));
vi.mock('../hooks', () => ({ useAuth: () => state }));
vi.mock('../api/auth', () => ({ authApi: { register: vi.fn(), login: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); state.accountState = 'register'; state.passwordSet = false;
  state.registrationMode = 'closed'; state.multiUserEnabled = false;
  localStorage.setItem('dsa.uiLanguage', 'en');
});
const show = () => render(<MemoryRouter><UiLanguageProvider><LoginPage /></UiLanguageProvider></MemoryRouter>);

describe('instance account entry', () => {
  it('offers invited registration without asking for the owner setup token', async () => {
    state.accountState = 'ready'; state.passwordSet = true; state.registrationMode = 'invite';
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Have an invitation? Create your workspace' }));
    expect(screen.getByRole('heading', { name: 'Create your private workspace' })).toBeTruthy();
    expect(screen.queryByLabelText('Setup token')).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } });
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: 'test-invitation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account & continue' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({
      memberRegistration: true, inviteCode: 'test-invitation', setupToken: '',
    })));
  });
  it('submits explicit email, password and bootstrap token', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } });
    fireEvent.change(screen.getByLabelText('Setup token'), { target: { value: 'test-bootstrap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account & continue' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'long-password', passwordConfirm: 'long-password', currentPassword: '', setupToken: 'test-bootstrap' }));
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('migrates with the existing password, without creating another password', async () => {
    state.accountState = 'migrate'; state.passwordSet = true; show();
    expect(screen.queryByLabelText('Setup token')).toBeNull();
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Existing admin password'), { target: { value: 'old-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & save account' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ currentPassword: 'old-password', password: '' })));
  });

  it('shows login only after registration closes', async () => {
    state.accountState = 'ready'; state.passwordSet = true; show();
    expect(screen.queryByLabelText('Setup token')).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith('long-password', undefined, 'owner@example.com'));
  });

  it('blocks password mismatch with an English error', () => {
    show();
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create account & continue' }).closest('form')!);
    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.');
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('renders Chinese labels when selected', () => {
    localStorage.setItem('dsa.uiLanguage', 'zh'); show();
    expect(screen.getByRole('heading', { name: '创建管理员账户' })).toBeTruthy();
    expect(screen.getByLabelText('初始化凭证')).toBeTruthy();
  });
});
