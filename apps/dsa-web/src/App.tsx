import type React from "react";
import { lazy, useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ApiErrorAlert, Shell } from "./components/common";
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
const LoginPage = lazy(() => import("./pages/LoginPage"));
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
const ScreeningWorkspacePage = lazy(() => import("./pages/ScreeningWorkspacePage"));
const TradingWorkspacePage = lazy(() => import("./pages/TradingWorkspacePage"));
const ScheduledTasksPage = lazy(() => import("./pages/ScheduledTasksPage"));
const ExpertReviewPage = lazy(() => import("./pages/ExpertReviewPage"));
const TaskRunsPage = lazy(() => import("./pages/TaskRunsPage"));

const AppContent: React.FC = () => {
  const location = useLocation();
  const { authEnabled, loggedIn, isLoading, loadError, refreshStatus } =
    useAuth();
  const { t } = useUiLanguage();

  useEffect(() => {
    useAgentChatStore.getState().setCurrentRoute(location.pathname);
  }, [location.pathname]);

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
        <Route path="/overview" element={<ChatPage workspace="general" />} />
        <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
        <Route path="/stock-research" element={<StockAnalysisPage />} />
        <Route path="/chat" element={<Navigate to="/overview" replace />} />
        <Route path="/portfolio" element={<Navigate to="/trading" replace />} />
        <Route path="/decision-signals" element={<Navigate to="/trading" replace />} />
        <Route path="/screening" element={<ScreeningWorkspacePage />} />
        <Route path="/trading" element={<TradingWorkspacePage />} />
        <Route path="/schedules" element={<ScheduledTasksPage />} />
        <Route path="/expert-review" element={<ExpertReviewPage />} />
        <Route path="/backtest" element={<Navigate to="/overview" replace />} />
        <Route path="/alerts" element={<Navigate to="/schedules" replace />} />
        <Route path="/runs/*" element={<TaskRunsPage />} />
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
        <Route path="/capabilities/mcp" element={<McpSettingsPage />} />
        <Route path="/capabilities/data" element={<DataSourcesPage />} />
        <Route path="/capabilities/experts" element={<AgentCenterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
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
