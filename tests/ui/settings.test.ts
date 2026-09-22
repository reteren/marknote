import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";

const mocks = vi.hoisted(() => {
  const base = {
    language: "en",
    spellcheck: { enabled: true, skipCodeFormulaLinks: true },
    autoCorrect: { smartQuotes: false, doubleHyphenToEmDash: false, capitalizeAfterPeriod: false, threeDotsToEllipsis: false },
    editor: { fontFamily: "system-serif", fontSize: 15, zoomPercent: 100, columnWidth: "normal", tabWidth: 4, insertSpaces: true, softWrap: true, showInvisibles: false, lineNumbers: false },
    livePreview: { enabled: true, revealMarkup: "cursor", renderFormulas: true, renderImages: true, maxImageWidth: "column", disableAboveBytes: 5 * 1024 * 1024 },
    files: { autosave: true, autosaveDelayMs: 2_000, saveOnWindowBlur: true, newDocumentFormat: "markdown", newDocumentEncoding: "utf8", newDocumentLineEnding: "system", trimTrailingSpaces: false, finalNewline: false },
    windows: { rememberSizeAndPosition: true, startupAction: "startScreen", raiseExistingWindow: true },
  };
  const invoke = vi.fn(async (command: string, args?: { settings?: unknown }) => {
    if (command === "get_settings" || command === "reset_settings") return structuredClone(base);
    if (command === "save_settings") return args?.settings;
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
  "settings.files.autosave": "Autosave",
  "settings.files.autosaveDelay": "Autosave delay",
  "settings.files.autosaveDelay.1m": "1 minute",
  "settings.files.autosaveDelay.2s": "2 seconds",
  "settings.files.autosaveDelay.10s": "10 seconds",
  "settings.files.autosaveDelay.30s": "30 seconds",
  "settings.files.autosaveDelay.custom": "Custom ({seconds} s)",
  "settings.files.autosaveDelayDescription": "Time to wait after the last edit before automatically saving.",
  "settings.saved": "Saved",
  "settings.pendingSave": "Saving changes…",
  "settings.saving": "Saving…",
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/i18n", () => ({
  translate: (key: string, params?: Record<string, unknown>) => {
    let text = labels[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  },
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

  it("renders every numeric setting with a native spinner control", async () => {
    mount();

    await selectSection("Editor");
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);

    await selectSection("Preview");
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);

    await selectSection("Files");
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
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

  it("offers only the spellcheck toggle and explains the system dictionary", async () => {
    mount();
    await selectSection("Spellcheck");

    expect(screen.getByRole("checkbox", { name: "settings.spelling.enabled" })).toBeInTheDocument();
    expect(screen.getByText("settings.spelling.enabledDescription")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "settings.spelling.language" })).not.toBeInTheDocument();
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

  it("renders autosave delay presets and updates value when changed", async () => {
    mount();
    await selectSection("Files");

    const select = screen.getByRole("combobox", { name: "Autosave delay" }) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("2000");

    const options = Array.from(select.options).map((opt) => ({ value: opt.value, text: opt.text }));
    expect(options).toEqual([
      { value: "2000", text: "2 seconds" },
      { value: "10000", text: "10 seconds" },
      { value: "30000", text: "30 seconds" },
      { value: "60000", text: "1 minute" },
    ]);

    await fireEvent.change(select, { target: { value: "10000" } });
    expect(settingsState.settings.files.autosaveDelayMs).toBe(10000);
    expect(typeof settingsState.settings.files.autosaveDelayMs).toBe("number");
  });

  it("disables autosave delay when autosave is toggled off", async () => {
    mount();
    await selectSection("Files");

    const autosaveCheckbox = screen.getByRole("checkbox", { name: "Autosave" });
    const delaySelect = screen.getByRole("combobox", { name: "Autosave delay" });

    expect(delaySelect).not.toBeDisabled();

    await fireEvent.click(autosaveCheckbox);
    expect(settingsState.settings.files.autosave).toBe(false);
    expect(delaySelect).toBeDisabled();

    const row = delaySelect.closest(".setting-row");
    expect(row).toHaveClass("row-disabled");

    await fireEvent.click(autosaveCheckbox);
    expect(settingsState.settings.files.autosave).toBe(true);
    expect(delaySelect).not.toBeDisabled();
    expect(row).not.toHaveClass("row-disabled");
  });

  it("handles arbitrary legacy autosave delay without crashing", async () => {
    settingsState.settings.files.autosaveDelayMs = 7500;
    mount();
    await selectSection("Files");

    const select = screen.getByRole("combobox", { name: "Autosave delay" }) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("7500");

    const customOption = select.querySelector('option[value="7500"]');
    expect(customOption).toBeInTheDocument();
    expect(customOption?.textContent).toBe("Custom (7.5 s)");

    await fireEvent.change(select, { target: { value: "30000" } });
    expect(settingsState.settings.files.autosaveDelayMs).toBe(30000);
  });

  it("finds autosave delay through settings search", async () => {
    mount();
    const search = screen.getByRole("searchbox", { name: "Search settings" });

    await fireEvent.input(search, { target: { value: "1 minute" } });
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Autosave delay" })).toBeInTheDocument();

    await fireEvent.input(search, { target: { value: "automatically saving" } });
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Autosave delay" })).toBeInTheDocument();
  });
});
