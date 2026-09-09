import apiClient from './api';
import type React from "react";
import { lazy, useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  Link,
} from "react-router-dom";
import { ApiErrorAlert, Shell, AppPage, PageHeader } from "./components/common";
import {
  PageLoadingFallback,
  RouteOutletBoundary,
  StandaloneRouteBoundary,
} from "./components/layout/RouteBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import {
  UiLanguageProvider,
  useUiLanguage,
} from "./contexts/UiLanguageContext";
import { useAgentChatStore } from "./stores/agentChatStore";
import "./App.css";

const SettingsPage = lazy(() => import("./pages/PlatformSettingsPage"));
const MemberSettingsPage = lazy(() => import('./pages/MemberSettingsPage'));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const TrialPage = lazy(() => import("./pages/TrialPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const MarketIntelligencePage = lazy(() => import("./pages/MarketIntelligencePage"));
const TokenUsagePage = lazy(() => import("./pages/TokenUsagePage"));
const DataSourcesPage = lazy(() => import("./pages/DataSourcesPage"));
const CapabilityOverviewPage = lazy(() => import("./pages/CapabilityOverviewPage"));
const SkillSettingsPage = lazy(() => import("./pages/SkillSettingsPage"));
const ToolSettingsPage = lazy(() => import("./pages/ToolSettingsPage"));
const McpSettingsPage = lazy(() => import("./pages/McpSettingsPage"));
const AgentCenterPage = lazy(() => import("./pages/AgentCenterPage"));
const StockAnalysisPage = lazy(() => import("./pages/StockAnalysisPage"));
const HoldingsPage = lazy(() => import("./pages/HoldingsPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const HoldingsLedgerPage = lazy(() => import("./pages/HoldingsLedgerPage"));
const ScreeningWorkspacePage = lazy(() => import("./pages/ScreeningWorkspacePage"));
const TradingWorkspacePage = lazy(() => import("./pages/TradingWorkspacePage"));
const ScheduledTasksPage = lazy(() => import("./pages/ScheduledTasksPage"));
const ExpertReviewPage = lazy(() => import("./pages/ExpertReviewPage"));
const TaskRunsPage = lazy(() => import("./pages/TaskRunsPage"));
const TaskRunDetailPage = lazy(() => import("./pages/TaskRunDetailPage"));

function ManagedCapabilitiesPage() {
  const { localize: l } = useUiLanguage();
  return <AppPage>
    <PageHeader title={l('平台托管能力', 'Platform-managed capabilities')} description={l('公共数据源和运行工具由平台管理员维护。你可以在研究页面选择可用的 Skill 与专家；持仓、报告和个人配置仍只属于你。', 'Public data sources and runtime tools are maintained by the platform administrator. Choose available Skills and experts on your research pages; your holdings, reports and personal settings remain private.')} />
    <Link className="btn-secondary mt-6 inline-flex min-h-11 items-center" to="/overview">{l('返回投研助理', 'Back to research assistant')}</Link>
  </AppPage>;
}

const AppContent: React.FC = () => {
  const location = useLocation();
  const { authEnabled, loggedIn, isLoading, loadError, refreshStatus, role } =
    useAuth();
  const { t } = useUiLanguage();

  useEffect(() => {
    useAgentChatStore.getState().setCurrentRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const pages = new Set(['/overview', '/stock-research', '/screening', '/trading', '/portfolio', '/portfolio/ledger', '/market-intelligence', '/expert-review', '/settings', '/usage', '/runs', '/alerts', '/schedules', '/runs/:runId', '/capabilities', '/capabilities/skills', '/capabilities/tools', '/capabilities/mcp', '/capabilities/data', '/capabilities/experts']);
    const page = /^\/runs\/[^/]+$/.test(location.pathname) ? '/runs/:runId' : location.pathname;
    if (loggedIn && !isLoading && pages.has(page)) {
      // Delay cancels the StrictMode probe; never retry a page event automatically.
      const timer = window.setTimeout(() => { void apiClient.post('/api/v1/usage/activity', { page }).catch(() => console.warn('Page activity could not be recorded')); }, 100);
      return () => window.clearTimeout(timer);
    }
  }, [loggedIn, isLoading, location.pathname]);

  if (location.pathname === '/try') {
    return <StandaloneRouteBoundary><TrialPage /></StandaloneRouteBoundary>;
  }

  if (isLoading) {
    return <PageLoadingFallback />;
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-4">
        <div className="w-full max-w-lg">
          <ApiErrorAlert error={loadError} />
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void refreshStatus()}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (authEnabled && !loggedIn) {
    if (location.pathname === "/login") {
      return (
        <StandaloneRouteBoundary>
          <LoginPage />
        </StandaloneRouteBoundary>
      );
    }
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  if (location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route
        element={
          <Shell>
            <RouteOutletBoundary />
          </Shell>
        }
      >
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<ChatPage workspace="general" defaultDiscussion />} />
        <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
        <Route path="/stock-research" element={<StockAnalysisPage />} />
        <Route path="/chat" element={<Navigate to="/overview" replace />} />
        <Route path="/portfolio" element={<HoldingsPage />} />
        <Route path="/portfolio/ledger" element={<HoldingsLedgerPage />} />
        <Route path="/decision-signals" element={<Navigate to="/trading" replace />} />
        <Route path="/screening" element={<ScreeningWorkspacePage />} />
        <Route path="/trading" element={<TradingWorkspacePage />} />
        <Route path="/schedules" element={<ScheduledTasksPage />} />
        <Route path="/expert-review" element={<ExpertReviewPage />} />
        <Route path="/backtest" element={<Navigate to="/overview" replace />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/runs" element={<TaskRunsPage />} />
        <Route path="/runs/:runId" element={<TaskRunDetailPage />} />
        <Route path="/usage" element={<TokenUsagePage />} />
        <Route path="/simulation" element={<Navigate to="/trading" replace />} />
        <Route path="/strategy-editor" element={<Navigate to="/overview" replace />} />
        <Route path="/strategies/*" element={<Navigate to="/overview" replace />} />
        <Route path="/agents" element={<Navigate to="/capabilities/experts" replace />} />
        <Route path="/strategy-development" element={<Navigate to="/overview" replace />} />
        <Route path="/validation" element={<Navigate to="/overview" replace />} />
        <Route path="/research" element={<Navigate to="/stock-research" replace />} />
        <Route path="/backtests" element={<Navigate to="/overview" replace />} />
        <Route path="/legacy-strategy-overview" element={<Navigate to="/overview" replace />} />
        <Route path="/legacy-dashboard" element={<Navigate to="/overview" replace />} />
        <Route path="/news" element={<Navigate to="/market-intelligence" replace />} />
        <Route path="/data-sources" element={<Navigate to="/capabilities/data" replace />} />
        <Route path="/data" element={<Navigate to="/capabilities/data" replace />} />
        <Route path="/capabilities" element={<CapabilityOverviewPage />} />
        <Route path="/capabilities/skills" element={<SkillSettingsPage />} />
        <Route path="/capabilities/tools" element={<ToolSettingsPage />} />
        <Route path="/capabilities/mcp" element={role === 'member' ? <ManagedCapabilitiesPage /> : <McpSettingsPage />} />
        <Route path="/capabilities/data" element={role === 'member' ? <ManagedCapabilitiesPage /> : <DataSourcesPage />} />
        <Route path="/capabilities/experts" element={<AgentCenterPage />} />
        <Route path="/settings" element={role === 'member' ? <MemberSettingsPage /> : <SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <UiLanguageProvider>
      <Router>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </Router>
    </UiLanguageProvider>
  );
};

export default App;
