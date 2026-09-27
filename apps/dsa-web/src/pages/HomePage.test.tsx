import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./HomePage";
import { UiLanguageProvider } from "../contexts/UiLanguageContext";
import { HOME_COPY } from "../i18n/homeCopy";
import { UI_LANGUAGE_STORAGE_KEY } from "../utils/uiLanguage";
const state = {
  loggedIn: false,
  authEnabled: true,
  isLoading: false,
  loadError: null,
  registrationMode: "open",
};
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => state }));
afterEach(cleanup);
beforeEach(() => {
  Object.assign(state, {
    loggedIn: false,
    authEnabled: true,
    isLoading: false,
    loadError: null,
    registrationMode: "open",
  });
  localStorage.clear();
});
const show = () =>
  render(
    <MemoryRouter>
      <UiLanguageProvider>
        <HomePage />
      </UiLanguageProvider>
    </MemoryRouter>,
  );
describe("Public homepage", () => {
  for (const language of ["zh", "en", "ko", "ja", "zh-TW"] as const)
    it(`renders a complete ${language} tour and keyboard navigation`, () => {
      localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
      show();
      const copy = HOME_COPY[language];
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        copy.title.replace("\n", " "),
      );
      expect(screen.getAllByRole("tab")).toHaveLength(5);
      const selected = screen.getByRole("tab", { name: copy.moduleLabels[3] });
      expect(selected).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(selected, { key: "ArrowRight" });
      expect(
        screen.getByRole("tab", { name: copy.moduleLabels[4] }),
      ).toHaveFocus();
      expect(screen.getByRole("tabpanel")).toHaveTextContent(copy.reviewTitle);
      fireEvent.click(screen.getByRole("tab", { name: copy.moduleLabels[1] }));
      expect(screen.getByRole("tabpanel")).toHaveTextContent(
        copy.researchRows[0],
      );
      expect(screen.getByRole("link", { name: copy.register })).toHaveAttribute(
        "href",
        "/login?mode=register&redirect=%2Foverview",
      );
    });
  it("offers workspace access to signed-in users and hides a signup promise on closed instances", () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    state.registrationMode = "closed";
    show();
    expect(
      screen.queryByRole("link", { name: "Create an account" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(HOME_COPY.en.closed)).toBeInTheDocument();
    cleanup();
    state.loggedIn = true;
    show();
    expect(
      screen.getAllByRole("link", { name: "Open workspace" })[0],
    ).toHaveAttribute("href", "/overview");
  });
  it("does not send visitors into an unprotected workspace while auth is unresolved", () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    state.isLoading = true;
    state.authEnabled = false;
    show();
    expect(
      screen.getByRole("link", { name: "Start researching" }),
    ).toHaveAttribute("href", "/login?redirect=%2Foverview");
  });
});
