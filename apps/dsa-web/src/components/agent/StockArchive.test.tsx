import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import StockArchive from "./StockArchive";

const runHistory = vi.hoisted(() => vi.fn());
vi.mock("../../api/workspace", () => ({ workspaceApi: { runHistory } }));
vi.mock("./DefaultTaskLauncher", () => ({ default: () => null }));

it("retries the same stock after a failed request and reloads after success", async () => {
  runHistory.mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({items: [], total: 2})
    .mockResolvedValueOnce({items: [], total: 3});
  render(<MemoryRouter initialEntries={["/?stock=600519"]}><StockArchive onRunStarted={() => {}} /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  fireEvent.click(screen.getByRole("button", {name: "查询档案"}));
  await screen.findByText(/共 2 次相关运行/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "查询档案"}));
  await screen.findByText(/共 3 次相关运行/);
  await waitFor(() => expect(runHistory).toHaveBeenCalledTimes(3));
});
