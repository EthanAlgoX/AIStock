import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataSourceAccessConfigPanel } from "../DataSourceAccessConfigPanel";

const { load, save, resetDraft, setDraftValue } = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  resetDraft: vi.fn(),
  setDraftValue: vi.fn(),
}));

vi.mock("../../../hooks", () => ({
  useSystemConfig: () => ({
    itemsByCategory: {
      data_source: [
        {
          key: "TUSHARE_TOKEN",
          value: "******",
          rawValueExists: true,
          schema: {
            key: "TUSHARE_TOKEN",
            title: "Tushare Token",
            description: "Token for Tushare Pro API.",
            category: "data_source",
            dataType: "string",
            uiControl: "password",
            isSensitive: true,
            isRequired: false,
            isEditable: true,
            options: [],
            validation: {},
            displayOrder: 10,
          },
        },
        {
          key: "BOCHA_API_KEYS",
          value: "",
          schema: { key: "BOCHA_API_KEYS", category: "data_source" },
        },
      ],
    },
    issueByKey: {},
    isLoading: false,
    isSaving: false,
    loadError: null,
    saveError: null,
    hasDirty: true,
    load,
    save,
    resetDraft,
    setDraftValue,
  }),
}));

describe("DataSourceAccessConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    load.mockResolvedValue(true);
    save.mockResolvedValue({ success: true });
  });

  it("renders only the configuration fields declared by the selected adapter", async () => {
    const onSaved = vi.fn();
    render(
      <DataSourceAccessConfigPanel
        source={{
          sourceId: "kline:tushare",
          name: "Tushare 行情",
          kind: "kline",
          connectionKey: "kline:tushare",
          required: false,
          builtIn: true,
          selectable: false,
          availability: "unconfigured",
          setupUrl: "https://tushare.pro/document/1?doc_id=37",
          accessMode: "token",
          configurationKeys: ["TUSHARE_TOKEN"],
        }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Tushare Token")).toBeInTheDocument();
    expect(screen.queryByText("BOCHA_API_KEYS")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开官方接入说明" })).toHaveAttribute(
      "href",
      "https://tushare.pro/document/1?doc_id=37",
    );

    fireEvent.click(screen.getByRole("button", { name: "保存并刷新状态" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
