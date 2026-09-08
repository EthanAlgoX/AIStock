import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../theme/ThemeProvider";
import { Shell } from "../Shell";

const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    authEnabled: true,
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

  it("places market intelligence immediately left of Agent and keeps the mobile workflow concise", () => {
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
    expect(within(desktop).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/market-intelligence", "/overview", "/expert-review", "/stock-research", "/screening", "/trading"]);
    expect(screen.getAllByRole("link", { name: "个股研究" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "策略选股" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "交易推演" })).toHaveLength(2);
    expect(screen.getByTestId("chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换界面语言" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    expect(await screen.findByRole("heading", { name: "退出登录" })).toBeInTheDocument();
    const confirmation = screen.getByRole("dialog", { name: "退出登录" });
    expect(confirmation.parentElement).toHaveClass("z-[110]");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "取消" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "退出登录" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "工作区与设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出" }));
    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
