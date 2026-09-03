import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as AuthContext from "./contexts/AuthContext";
import { UI_LANGUAGE_STORAGE_KEY } from "./utils/uiLanguage";

type AuthState = ReturnType<typeof AuthContext.useAuth>;

const { chatPageShouldThrow, setCurrentRoute, useAgentChatStoreMock } =
  vi.hoisted(() => {
    const setCurrentRoute = vi.fn();
    const chatPageShouldThrow = { value: false };
    const state = { completionBadge: false };
    const useAgentChatStoreMock = Object.assign(
      vi.fn((selector?: (value: typeof state) => unknown) =>
        selector ? selector(state) : state,
      ),
      { getState: () => ({ setCurrentRoute }) },
    );
    return { chatPageShouldThrow, setCurrentRoute, useAgentChatStoreMock };
  });

vi.mock("./contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: vi.fn(),
}));

vi.mock("./stores/agentChatStore", () => ({
  useAgentChatStore: useAgentChatStoreMock,
}));

vi.mock("./pages/SkillSettingsPage", () => ({
  default: () => <div data-testid="skill-settings-page">Skill settings</div>,
}));

vi.mock("./pages/McpSettingsPage", () => ({
  default: () => <div data-testid="mcp-settings-page">MCP settings</div>,
}));

vi.mock("./pages/ToolSettingsPage", () => ({
  default: () => <div data-testid="tool-settings-page">Tool settings</div>,
}));

vi.mock("./pages/CapabilityOverviewPage", () => ({
  default: () => <div data-testid="capability-overview-page">Capability overview</div>,
}));

vi.mock("./pages/TaskRunsPage", () => ({
  default: () => <div data-testid="task-runs-page">Tasks and runs</div>,
}));

vi.mock("./pages/ChatPage", () => ({
  default: ({ workspace = "general" }: { workspace?: string }) => {
    if (chatPageShouldThrow.value) {
      throw new Error("chunk load failed");
    }
    return <div data-testid="chat-page" data-workspace={workspace}>Chat</div>;
  },
}));

vi.mock("./pages/MarketIntelligencePage", () => ({
  default: () => <div data-testid="market-intelligence-page">Market intelligence</div>,
}));

vi.mock("./pages/TokenUsagePage", () => ({
  default: () => <div data-testid="token-usage-page">Usage</div>,
}));

vi.mock("./pages/AgentCenterPage", () => ({
  default: () => <div data-testid="agent-center-page">Agent center</div>,
}));

vi.mock("./pages/StockAnalysisPage", () => ({
  default: () => <div data-testid="stock-analysis-page">Stock analysis</div>,
}));

vi.mock("./pages/ScreeningWorkspacePage", () => ({
  default: () => <div data-testid="screening-workspace-page">Screening</div>,
}));

vi.mock("./pages/TradingWorkspacePage", () => ({
  default: () => <div data-testid="trading-strategy-workspace">Trading strategy</div>,
}));

vi.mock("./pages/ScheduledTasksPage", () => ({
  default: () => <div data-testid="scheduled-tasks-page">Scheduled tasks</div>,
}));

vi.mock("./pages/ExpertReviewPage", () => ({
  default: () => <div data-testid="expert-review-page">Expert review</div>,
}));

vi.mock("./pages/PlatformSettingsPage", () => ({
  default: () => <div data-testid="settings-page">Settings</div>,
}));

vi.mock("./pages/NotFoundPage", () => ({
  default: () => <div data-testid="not-found-page">Not Found</div>,
}));

vi.mock("./pages/LoginPage", () => ({
  default: () => <div data-testid="login-page">Login</div>,
}));

function makeAuthState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    authEnabled: false,
    loggedIn: false,
    passwordSet: false,
    passwordChangeable: false,
    setupState: "no_password",
    isLoading: false,
    loadError: null,
    login: vi.fn().mockResolvedValue({ success: true }),
    changePassword: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatPageShouldThrow.value = false;
  window.history.pushState({}, "", "/");
  localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "zh");
  vi.mocked(AuthContext.useAuth).mockReturnValue(makeAuthState());
});

describe("App routing behavior", () => {
  it("shows loading fallback while auth status is initializing", () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(
      makeAuthState({ isLoading: true }),
    );

    const { container } = render(<App />);

    expect(container.querySelector(".border-t-cyan")).toBeInTheDocument();
  });

  it("redirects protected routes to login when auth is enabled but user is not logged in", async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(
      makeAuthState({
        authEnabled: true,
        loggedIn: false,
        setupState: "enabled",
      }),
    );
    window.history.pushState({}, "", "/portfolio");

    render(<App />);

    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?redirect=%2Fportfolio");
  });

  it("canonicalizes the legacy chat route to the primary Agent", async () => {
    window.history.pushState({}, "", "/chat");

    render(<App />);

    expect(await screen.findByTestId("chat-page")).toBeInTheDocument();
    expect(setCurrentRoute).toHaveBeenCalledWith("/overview");
    expect(window.location.pathname).toBe("/overview");
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("routes /usage to the token usage page after auth is ready", async () => {
    window.history.pushState({}, "", "/usage");

    render(<App />);

    expect(await screen.findByTestId("token-usage-page")).toBeInTheDocument();
    expect(setCurrentRoute).toHaveBeenCalledWith("/usage");
  });

  it("routes /runs to the task and run ledger", async () => {
    window.history.pushState({}, "", "/runs");

    render(<App />);

    expect(await screen.findByTestId("task-runs-page")).toBeInTheDocument();
  });

  it("redirects the legacy /agents route to expert capability configuration", async () => {
    window.history.pushState({}, "", "/agents");

    render(<App />);

    expect(await screen.findByTestId("agent-center-page")).toBeInTheDocument();
    expect(setCurrentRoute).toHaveBeenCalledWith("/agents");
    expect(window.location.pathname).toBe("/capabilities/experts");
  });

  it("routes capability configuration pages independently", async () => {
    window.history.pushState({}, "", "/capabilities/mcp");
    render(<App />);
    expect(await screen.findByTestId("mcp-settings-page")).toBeInTheDocument();
  });

  it("routes the capability center to its own overview", async () => {
    window.history.pushState({}, "", "/capabilities");
    render(<App />);
    expect(await screen.findByTestId("capability-overview-page")).toBeInTheDocument();
  });

  it("routes built-in tools separately from MCP services", async () => {
    window.history.pushState({}, "", "/capabilities/tools");
    render(<App />);
    expect(await screen.findByTestId("tool-settings-page")).toBeInTheDocument();
  });

  it("routes market intelligence as an independent page", async () => {
    window.history.pushState({}, "", "/market-intelligence");
    render(<App />);
    expect(await screen.findByTestId("market-intelligence-page")).toBeInTheDocument();
  });

  it("routes stock analysis and screening to structured Agent task workspaces", async () => {
    window.history.pushState({}, "", "/stock-research");
    render(<App />);
    expect(await screen.findByTestId("stock-analysis-page")).toBeInTheDocument();
  });

  it("routes screening to its structured Agent task workspace", async () => {
    window.history.pushState({}, "", "/screening");
    render(<App />);
    expect(await screen.findByTestId("screening-workspace-page")).toBeInTheDocument();
  });

  it("routes trading to the structured strategy and paper runtime workspace", async () => {
    window.history.pushState({}, "", "/trading");
    render(<App />);
    expect(await screen.findByTestId("trading-strategy-workspace")).toBeInTheDocument();
  });

  it("routes scheduled tasks to an independent scheduler workspace", async () => {
    window.history.pushState({}, "", "/schedules");
    render(<App />);
    expect(await screen.findByTestId("scheduled-tasks-page")).toBeInTheDocument();
  });

  it("routes expert review to the single and group review workspace", async () => {
    window.history.pushState({}, "", "/expert-review");
    render(<App />);
    expect(await screen.findByTestId("expert-review-page")).toBeInTheDocument();
  });

  it.each(["/strategies", "/backtest", "/backtests", "/strategy-development"])("retires the legacy strategy route %s", async (path) => {
    window.history.pushState({}, "", path);
    render(<App />);
    expect(await screen.findByTestId("chat-page")).toHaveAttribute("data-workspace", "general");
    expect(window.location.pathname).toBe("/overview");
  });

  it("folds the legacy signal route into the trading workspace", async () => {
    window.history.pushState({}, "", "/decision-signals");

    render(<App />);

    expect(await screen.findByTestId("trading-strategy-workspace")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/trading");
  });

  it("redirects authenticated login visits back to the home page", async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(
      makeAuthState({
        authEnabled: true,
        loggedIn: true,
        setupState: "enabled",
      }),
    );
    window.history.pushState({}, "", "/login");

    render(<App />);

    expect(await screen.findByTestId("chat-page")).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("keeps the shell mounted and resets the route boundary after page render errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    chatPageShouldThrow.value = true;
    window.history.pushState({}, "", "/overview");

    try {
      render(<App />);

      expect(
        await screen.findByRole("heading", { name: "页面加载失败" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: "主导航" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "重新加载页面" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "返回首页" }),
      ).toBeInTheDocument();

      chatPageShouldThrow.value = false;
      const mainNavigation = screen.getByRole("navigation", { name: "主导航" });
      fireEvent.click(within(mainNavigation).getByRole("link", { name: "个股分析" }));

      expect(await screen.findByTestId("stock-analysis-page")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "页面加载失败" }),
      ).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
