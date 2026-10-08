import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../theme/ThemeProvider";
import { Shell } from "../Shell";

const mockLogout = vi.fn().mockResolvedValue(undefined);
const auth = { role: "admin" };

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    authEnabled: true,
    role: auth.role,
    logout: mockLogout,
  }),
}));

vi.mock("../../../stores/agentChatStore", () => ({
  useAgentChatStore: (selector: (state: { completionBadge: boolean }) => unknown) =>
    selector({ completionBadge: true }),
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("Shell", () => {
  it("provides a keyboard shortcut to the single main content landmark", () => {
    render(<MemoryRouter><ThemeProvider><Shell><div>content</div></Shell></ThemeProvider></MemoryRouter>);
    expect(screen.getByRole("link", { name: "跳至主要内容" })).toHaveAttribute("href", "#workspace-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "workspace-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("organizes seven top modules and shows only the active module's pages while keeping mobile shortcuts", () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "投研助理" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "市场雷达" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "专家圆桌" })).toHaveLength(2);
    const mobile = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(within(mobile).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/overview", "/expert-review", "/stock-research", "/screening", "/trading"]);
    const desktop = screen.getByRole("navigation", { name: "主导航" });
    expect(within(desktop).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/market-intelligence", "/overview", "/screening", "/trading", "/portfolio", "/runs", "/capabilities"]);
    expect(within(desktop).getByRole("link", { name: "投研工作台" })).toHaveAttribute("aria-current", "page");
    const sections = screen.getByRole("navigation", { name: "模块页面" });
    expect(within(sections).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/overview", "/expert-review", "/stock-research"]);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "个股研究" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "策略选股" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "交易推演" })).toHaveLength(2);
    expect(screen.getByTestId("chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByTestId("module-chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "切换界面语言" })).toBeInTheDocument();
  });

  it("marks capability child routes active and names member settings as their account", () => {
    auth.role = 'member';
    render(<MemoryRouter initialEntries={["/capabilities/skills"]}><ThemeProvider><Shell><div>content</div></Shell></ThemeProvider></MemoryRouter>);
    expect(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "工作区设置" })).toHaveAttribute("aria-current", "page");
    const navigation = screen.getByRole("navigation", { name: "模块页面" });
    expect(within(navigation).getByRole("link", { name: "能力中心" })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "我的账户" })).toHaveAttribute("href", "/settings");
    expect(within(navigation).queryByRole("link", { name: "平台设置" })).not.toBeInTheDocument();
    auth.role = 'admin';
  });

  it.each([
    ["/trading", "模拟总览"],
    ["/trading?portfolio=-2&strategy=-1", "策略管理"],
    ["/trading?view=source&sourceStrategy=12", "来源策略研究"],
    ["/trading?sourceRun=old-run", "历史研究提案"],
  ])("keeps trading destinations findable and resolves active state for %s", (path, activeLabel) => {
    render(<MemoryRouter initialEntries={[path]}><ThemeProvider><Shell><div>content</div></Shell></ThemeProvider></MemoryRouter>);
    const sections = screen.getByRole("navigation", { name: "模块页面" });
    expect(within(sections).getAllByRole("link")).toHaveLength(4);
    expect(within(sections).getByRole("link", { name: activeLabel })).toHaveAttribute("aria-current", "page");
    expect(within(sections).getByRole("link", { name: "模拟总览" })).toHaveAttribute("href", "/trading");
    expect(within(sections).getByRole("link", { name: "来源策略研究" })).toHaveAttribute("href", "/trading?view=source");
  });

  it("distinguishes the account ledger from the holdings page", () => {
    render(<MemoryRouter initialEntries={["/portfolio/ledger"]}><ThemeProvider><Shell><div>content</div></Shell></ThemeProvider></MemoryRouter>);
    const sections = screen.getByRole("navigation", { name: "模块页面" });
    expect(within(sections).getByRole("link", { name: "账户与流水" })).toHaveAttribute("aria-current", "page");
    expect(within(sections).getByRole("link", { name: "持仓管理" })).not.toHaveAttribute("aria-current");
  });

  it("opens the utility drawer from the header", () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开工作区与设置" }));

    const drawer = screen.getByRole("dialog", { name: "工作区与设置" });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "市场雷达" })).toHaveAttribute("href", "/market-intelligence");
    expect(within(drawer).getByRole("link", { name: "模型用量" })).toHaveAttribute("href", "/usage");
  });

  it("shows a confirmation dialog before logout", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开工作区与设置" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "工作区与设置" })).getByRole("button", { name: "退出" }));

    expect(await screen.findByRole("heading", { name: "退出登录" })).toBeInTheDocument();
    const confirmation = screen.getByRole("dialog", { name: "退出登录" });
    expect(confirmation.parentElement).toHaveClass("z-[110]");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "取消" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "退出登录" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "工作区与设置" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "工作区与设置" })).getByRole("button", { name: "退出" }));
    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
