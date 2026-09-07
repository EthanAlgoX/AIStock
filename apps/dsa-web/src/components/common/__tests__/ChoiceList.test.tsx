import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChoiceList from "../ChoiceList";

const items = [
  { id: "quality", name: "盈利质量", description: "检查现金流与利润", badge: "内置" },
  { id: "trend", name: "趋势研究", description: "分析价格与成交量" },
  { id: "event", name: "事件驱动", description: "关注新闻催化" },
];
function Harness({ multiple = true, initial = ["quality"] }: { multiple?: boolean; initial?: string[] }) {
  const [selected, setSelected] = useState(initial);
  return <><ChoiceList label="研究方法" items={items} selectedIds={selected} multiple={multiple} limit={2}
    onSelect={(id) => setSelected((current) => multiple ? current.includes(id) ? current.filter((key) => key !== id) : [...current, id] : [id])} /><button type="button">其他配置</button></>;
}

describe("ChoiceList", () => {
  it("keeps the summary visible and the option list collapsed by default", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "研究方法" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("盈利质量")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("searches descriptions without losing selections and enforces the limit", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "研究方法" }));
    const search = screen.getByRole("searchbox");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "成交量" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "趋势研究" }));
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "盈利质量" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "趋势研究" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "事件驱动" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "盈利质量" }));
    expect(screen.getByRole("checkbox", { name: "事件驱动" })).toBeEnabled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByRole("button", { name: "研究方法" })).toHaveFocus();
    expect(screen.getByText("趋势研究")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("closes single selection and restores focus to its summary", () => {
    render(<Harness multiple={false} />);
    fireEvent.click(screen.getByRole("button", { name: "研究方法" }));
    fireEvent.click(screen.getByRole("radio", { name: "事件驱动" }));
    expect(screen.getByRole("button", { name: "研究方法" })).toHaveValue("event");
    expect(screen.getByRole("button", { name: "研究方法" })).toHaveFocus();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("supports zero results, completion, and cancelling a missing saved selection", () => {
    render(<Harness initial={["missing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "研究方法" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByText("没有匹配项，试试其他关键词。")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "missing（目录未列出）" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByText("请选择")).toBeVisible();
  });

  it("closes when keyboard focus leaves the control", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "研究方法" }));
    fireEvent.blur(screen.getByRole("searchbox"), { relatedTarget: screen.getByRole("button", { name: "其他配置" }) });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
