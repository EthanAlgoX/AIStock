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
  it("renders five Agent-first primary destinations in the top and mobile navigation", () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "主 Agent" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "市场情报" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "个股分析" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "选股" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "交易" })).toHaveLength(2);
    expect(screen.getByTestId("chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chat-completion-badge")).toBeInTheDocument();
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
    expect(within(drawer).getByRole("link", { name: "专家评审" })).toHaveAttribute("href", "/expert-review");
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
    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
