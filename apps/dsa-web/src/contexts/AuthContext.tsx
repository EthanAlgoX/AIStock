import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createParsedApiError, getParsedApiError, type ParsedApiError } from '../api/error';
import { authApi } from '../api/auth';
import { useStockPoolStore } from '../stores';
import { useAgentChatStore } from '../stores/agentChatStore';
import { useWorkspaceRunStore } from '../stores/workspaceRunStore';
import { useAnalysisStore } from '../stores/analysisStore';
import { clearPrivateWorkspaceStorage } from '../utils/privateWorkspaceState';
import type { AuthStatusResponse } from '../api/auth';

type AuthContextValue = {
  deploymentMode?: AuthStatusResponse['deploymentMode'];
  role: 'admin' | 'member' | null;
  multiUserEnabled: boolean;
  registrationMode: 'invite' | 'closed';
  quota: AuthStatusResponse['quota'];
  accountMode: boolean;
  accountState: 'register' | 'migrate' | 'ready';
  email: string;
  authEnabled: boolean;
  loggedIn: boolean;
  passwordSet: boolean;
  passwordChangeable: boolean;
  setupState: 'enabled' | 'password_retained' | 'no_password';
  isLoading: boolean;
  loadError: ParsedApiError | null;
  login: (password: string, passwordConfirm?: string, email?: string) => Promise<{ success: boolean; error?: ParsedApiError }>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
    newPasswordConfirm: string
  ) => Promise<{ success: boolean; error?: ParsedApiError }>;
  logout: () => Promise<void>;
  refreshStatus: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function extractLoginError(err: unknown): ParsedApiError {
  const parsed = getParsedApiError(err);
  if (parsed.status === 429) {
    return createParsedApiError({
      title: '登录尝试过于频繁',
      message: '尝试次数过多，请稍后再试。',
      rawMessage: parsed.rawMessage,
      status: parsed.status,
      category: parsed.category,
    });
  }
  return parsed;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [deploymentMode, setDeploymentMode] = useState<AuthStatusResponse['deploymentMode']>();
  const [role, setRole] = useState<'admin' | 'member' | null>(null);
  const [multiUserEnabled, setMultiUserEnabled] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<'invite' | 'closed'>('closed');
  const [quota, setQuota] = useState<AuthStatusResponse['quota']>(null);
  const [accountMode, setAccountMode] = useState(false);
  const [accountState, setAccountState] = useState<'register' | 'migrate' | 'ready'>('register');
  const [email, setEmail] = useState('');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [passwordChangeable, setPasswordChangeable] = useState(false);
  const [setupState, setSetupState] = useState<'enabled' | 'password_retained' | 'no_password'>('no_password');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<ParsedApiError | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const status = await authApi.getStatus();
      setDeploymentMode(status.deploymentMode);
      setRole(status.role || null);
      setMultiUserEnabled(Boolean(status.multiUserEnabled));
      setRegistrationMode(status.registrationMode || 'closed');
      setQuota(status.quota || null);
      const identity = status.deploymentMode === 'local' ? 'local-owner' : status.userId || (status.loggedIn ? 'owner' : '');
      if ((status.multiUserEnabled || status.deploymentMode) && localStorage.getItem('investcrew.activeIdentity') !== identity) {
        clearPrivateWorkspaceStorage();
        useAgentChatStore.getState().abortController?.abort();
        useAgentChatStore.setState(useAgentChatStore.getInitialState());
        useAgentChatStore.getState().startNewChat();
        useStockPoolStore.getState().resetDashboardState();
        useWorkspaceRunStore.setState(useWorkspaceRunStore.getInitialState());
        useAnalysisStore.getState().reset();
        localStorage.setItem('investcrew.activeIdentity', identity);
      }
      setAccountMode(Boolean(status.accountMode));
      setAccountState(status.accountState || 'register');
      setEmail(status.email || '');
      setAuthEnabled(status.authEnabled);
      setLoggedIn(status.loggedIn);
      setPasswordSet(status.passwordSet ?? false);
      setPasswordChangeable(status.passwordChangeable ?? false);
      setSetupState(status.setupState);
      if (status.authEnabled && !status.loggedIn) {
        useStockPoolStore.getState().resetDashboardState();
      }
    } catch (err) {
      setRole(null);
      setQuota(null);
      setLoadError(getParsedApiError(err));
      setAuthEnabled(false);
      setLoggedIn(false);
      setPasswordSet(false);
      setPasswordChangeable(false);
      setSetupState('no_password');
      useStockPoolStore.getState().resetDashboardState();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === 'investcrew.activeIdentity' && event.oldValue !== event.newValue) {
        clearPrivateWorkspaceStorage();
        window.location.assign('/login');
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  const login = useCallback(
    async (
      password: string,
      passwordConfirm?: string,
      email?: string
    ): Promise<{ success: boolean; error?: ParsedApiError }> => {
      try {
        await authApi.login(password, passwordConfirm, email);
        await fetchStatus();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: extractLoginError(err) };
      }
    },
    [fetchStatus]
  );

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      newPasswordConfirm: string
    ): Promise<{ success: boolean; error?: ParsedApiError }> => {
      try {
        await authApi.changePassword(currentPassword, newPassword, newPasswordConfirm);
        if (role === 'member') await fetchStatus();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: getParsedApiError(err) };
      }
    },
    [role, fetchStatus]
  );

  const logout = useCallback(async () => {
    let logoutError: unknown = null;
    try {
      await authApi.logout();
    } catch (err) {
      logoutError = err;
    } finally {
      await fetchStatus();
    }

    if (logoutError && getParsedApiError(logoutError).status !== 401) {
      throw logoutError;
    }
    if (multiUserEnabled) window.location.assign('/login');
  }, [fetchStatus, multiUserEnabled]);

  return (
    <AuthContext.Provider
      value={{
        deploymentMode,
        role,
        multiUserEnabled,
        registrationMode,
        quota,
        accountMode,
        accountState,
        email,
        authEnabled,
        loggedIn,
        passwordSet,
        passwordChangeable,
        setupState,
        isLoading,
        loadError,
        login,
        changePassword,
        logout,
        refreshStatus: fetchStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useAuth is a hook, co-located for context access
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
