import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";

const mocks = vi.hoisted(() => {
  const base = {
    language: "en",
    spellcheck: { enabled: true, languages: ["en"], skipCodeFormulaLinks: true },
    autoCorrect: { smartQuotes: false, doubleHyphenToEmDash: false, capitalizeAfterPeriod: false, threeDotsToEllipsis: false },
    editor: { fontFamily: "system-serif", fontSize: 15, zoomPercent: 100, columnWidth: "normal", tabWidth: 4, insertSpaces: true, softWrap: true, showInvisibles: false, highlightCurrentLine: true, lineNumbers: false },
    livePreview: { enabled: true, revealMarkup: "cursor", renderFormulas: true, renderImages: true, maxImageWidth: "column", disableAboveBytes: 5 * 1024 * 1024 },
    files: { autosave: true, autosaveDelayMs: 2_000, saveOnWindowBlur: true, newDocumentFormat: "markdown", newDocumentEncoding: "utf8", newDocumentLineEnding: "system", trimTrailingSpaces: false, finalNewline: false },
    windows: { rememberSizeAndPosition: true, startupAction: "startScreen", raiseExistingWindow: true },
  };
  const invoke = vi.fn(async (command: string, args?: { settings?: unknown }) => {
    if (command === "get_settings" || command === "reset_settings") return structuredClone(base);
    if (command === "save_settings") return args?.settings;
    if (command === "list_spellcheck_languages") return ["en"];
    if (command === "list_creatable_formats") return [{ id: "markdown", label: "Markdown", creatable: true }];
    return undefined;
  });
  return { invoke, base };
});

const labels: Record<string, string> = {
  "settings.title": "Settings",
  "settings.search": "Search settings",
  "settings.searchPlaceholder": "Search settings…",
  "settings.close": "Close",
  "settings.sections": "Settings sections",
  "settings.section.language": "Language & Region",
  "settings.section.editor": "Editor",
  "settings.section.preview": "Preview",
  "settings.section.spelling": "Spellcheck",
  "settings.section.files": "Files",
  "settings.section.windows": "Windows",
  "settings.section.other": "Other",
  "settings.editor.lineNumbers": "Line numbers",
  "settings.editor.tabWidth": "Tab width",
  "settings.editor.tabWidthDescription": "Number of spaces per indentation level",
  "settings.spelling.languages": "Spellcheck languages",
  "settings.spelling.languagesDescription": "Select dictionaries installed in Windows.",
  "settings.spelling.dictionaryUnavailable": "Windows language dictionary is not installed",
  "settings.language.name.en": "English",
  "settings.language.name.ru": "Russian",
  "settings.modified": "Modified",
  "settings.resetValue": "Restore default",
  "settings.noResults": "No matching settings",
  "settings.other.resetAll": "Reset all settings",
  "settings.other.resetAllConfirmation": "Reset all settings?",
  "settings.other.resetAllWarning": "This cannot be undone.",
  "settings.cancel": "Cancel",
  "settings.other.settingsFile": "Settings file",
  "settings.other.settingsFileDescription": "Open the settings file location.",
  "settings.other.revealSettingsFile": "Show settings file",
  "settings.other.version": "Version",
  "settings.other.versionDescription": "Application version.",
  "settings.other.copyVersion": "Copy version",
  "settings.saved": "Saved",
  "settings.pendingSave": "Saving changes…",
  "settings.saving": "Saving…",
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/i18n", () => ({
  translate: (key: string) => labels[key] ?? key,
  formatLabel: (_id: string, label: string) => label,
  normalizeLocale: (value: string) => value,
  setInterfaceLanguage: async (value: string) => value,
}));
vi.mock("../../src/editor/zoom", () => ({
  getZoom: () => 100,
  installZoom: () => 100,
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  resetZoom: vi.fn(),
}));

import SettingsWindow from "../../src/ui/SettingsWindow.svelte";
import { defaultSettings, settingsState } from "../../src/state/settings.svelte";

function mount(props: { onClose?: () => void; onFocusEditor?: () => void } = {}) {
  return render(SettingsWindow, {
    onClose: props.onClose ?? vi.fn(),
    onFocusEditor: props.onFocusEditor ?? vi.fn(),
  });
}

async function selectSection(name: string): Promise<void> {
  await fireEvent.click(screen.getByRole("tab", { name }));
}

describe("SettingsWindow", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mocks.invoke.mockClear();
    mocks.invoke.mockImplementation(async (command: string, args?: { settings?: unknown }) => {
      if (command === "get_settings" || command === "reset_settings") return structuredClone(mocks.base);
      if (command === "save_settings") return args?.settings;
      if (command === "list_spellcheck_languages") return ["en"];
      if (command === "list_creatable_formats") return [{ id: "markdown", label: "Markdown", creatable: true }];
      return undefined;
    });
    settingsState.settings = structuredClone(defaultSettings);
    settingsState.ready = true;
    settingsState.loading = false;
    settingsState.saving = false;
    settingsState.dirty = false;
    settingsState.error = null;
  });

  it("switches sections by mouse and arrow keys", async () => {
    mount();
    await selectSection("Editor");
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");

    const editorTab = screen.getByRole("tab", { name: "Editor" });
    editorTab.focus();
    await fireEvent.keyDown(editorTab, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-label", "Preview");
  });

  it("applies a changed value immediately and persists it", async () => {
    mount();
    await selectSection("Editor");
    const lineNumbers = screen.getByRole("checkbox", { name: "Line numbers" });
    await fireEvent.click(lineNumbers);
    expect(settingsState.settings.editor.lineNumbers).toBe(true);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("save_settings", expect.anything()), { timeout: 1200 });
  });

  it("filters settings by title and description", async () => {
    mount();
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    await fireEvent.input(search, { target: { value: "indentation level" } });
    expect(search).toHaveValue("indentation level");
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Tab width" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the editor", async () => {
    const onClose = vi.fn();
    const onFocusEditor = vi.fn();
    const { container } = mount({ onClose, onFocusEditor });
    await fireEvent.keyDown(container.querySelector('[role="dialog"]')!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onFocusEditor).toHaveBeenCalledOnce();
  });

  it("asks before resetting every setting", async () => {
    mount();
    await selectSection("Other");
    await fireEvent.click(screen.getByRole("button", { name: "Reset all settings" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("reset_settings");
    await fireEvent.click(screen.getAllByRole("button", { name: "Reset all settings" }).at(-1)!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("reset_settings"));
  });

  it("shows languages without an installed dictionary as unavailable", async () => {
    mount();
    await selectSection("Spellcheck");
    await waitFor(() => expect(screen.getByLabelText("Russian — Windows language dictionary is not installed")).toBeDisabled());
    expect(screen.getAllByText("Windows language dictionary is not installed").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("English")).toBeEnabled();
  });

  it("marks a changed value and removes the marker when restored", async () => {
    mount();
    await selectSection("Editor");
    await fireEvent.click(screen.getByRole("checkbox", { name: "Line numbers" }));
    expect(screen.getByText("Modified")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    expect(settingsState.settings.editor.lineNumbers).toBe(false);
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });
});
