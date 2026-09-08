import apiClient from './index';

export type AuthStatusResponse = {
  deploymentMode?: 'local' | 'server' | 'legacy';
  role?: 'admin' | 'member' | null;
  userId?: string | null;
  multiUserEnabled?: boolean;
  registrationMode?: 'invite' | 'closed';
  quota?: { used: number; limit: number; remaining: number } | null;
  accountMode?: boolean;
  accountState?: 'register' | 'migrate' | 'ready';
  email?: string | null;
  authEnabled: boolean;
  loggedIn: boolean;
  passwordSet?: boolean;
  passwordChangeable?: boolean;
  setupState: 'enabled' | 'password_retained' | 'no_password';
};

export const authApi = {
  async register(body: { email: string; password: string; passwordConfirm: string; currentPassword: string; setupToken: string; memberRegistration?: boolean; inviteCode?: string }): Promise<void> {
    await apiClient.post('/api/v1/auth/register', body);
  },
  async changeEmail(email: string, currentPassword: string): Promise<void> {
    await apiClient.post('/api/v1/auth/change-email', { email, currentPassword });
  },
  async getStatus(): Promise<AuthStatusResponse> {
    const { data } = await apiClient.get<AuthStatusResponse>('/api/v1/auth/status');
    return data;
  },

  async updateSettings(
    authEnabled: boolean,
    password?: string,
    passwordConfirm?: string,
    currentPassword?: string
  ): Promise<AuthStatusResponse> {
    const body: {
      authEnabled: boolean;
      password?: string;
      passwordConfirm?: string;
      currentPassword?: string;
    } = { authEnabled };
    if (password !== undefined) {
      body.password = password;
    }
    if (passwordConfirm !== undefined) {
      body.passwordConfirm = passwordConfirm;
    }
    if (currentPassword !== undefined) {
      body.currentPassword = currentPassword;
    }
    const { data } = await apiClient.post<AuthStatusResponse>('/api/v1/auth/settings', body);
    return data;
  },

  async login(password: string, passwordConfirm?: string, email?: string): Promise<void> {
    const body: { password: string; passwordConfirm?: string; email?: string } = { password, email };
    if (passwordConfirm !== undefined) {
      body.passwordConfirm = passwordConfirm;
    }
    await apiClient.post('/api/v1/auth/login', body);
  },

  async changePassword(
    currentPassword: string,
    newPassword: string,
    newPasswordConfirm: string
  ): Promise<void> {
    await apiClient.post('/api/v1/auth/change-password', {
      currentPassword,
      newPassword,
      newPasswordConfirm,
    });
  },

  async logout(): Promise<void> {
    await apiClient.post('/api/v1/auth/logout');
  },
};
