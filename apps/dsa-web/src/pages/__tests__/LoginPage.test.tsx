import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';
import { MemoryRouter } from 'react-router-dom';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { authApi } from '../../api/auth';

vi.mock('../../api/auth', () => ({ authApi: { login: vi.fn() } }));
const mount = () => render(<UiLanguageProvider><MemoryRouter><LoginPage /></MemoryRouter></UiLanguageProvider>);

const { navigate, useSearchParamsMock, useAuthMock } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => useSearchParamsMock(),
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = 'light';
    localStorage.setItem('dsa.uiLanguage', 'zh');
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fsettings')]);
  });

  it('blocks first-time setup when confirmation does not match', async () => {
    const login = vi.fn();
    useAuthMock.mockReturnValue({
      login,
      passwordSet: false,
      setupState: 'no_password',
    });

    mount();

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'passwd6' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'passwd7' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账户并进入' }));

    expect(await screen.findByText('两次输入的密码不一致。')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('navigates to redirect after a successful login', async () => {
    useAuthMock.mockReturnValue({
      login: vi.fn().mockResolvedValue({ success: true }),
      refreshStatus: vi.fn().mockResolvedValue(undefined),
      passwordSet: true,
      setupState: 'enabled',
    });

    vi.mocked(authApi.login).mockResolvedValue(undefined);
    mount();

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings', { replace: true }));
    expect(authApi.login).toHaveBeenCalledWith('passwd6', undefined, undefined);
  });

  it('does not override login theme tokens inline so light mode can take effect', () => {
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    const { container } = mount();
    const pageRoot = container.firstElementChild as HTMLElement | null;

    expect(pageRoot).not.toBeNull();
    expect(pageRoot?.getAttribute('style') ?? '').not.toContain('--login-bg-main');
  });
});
