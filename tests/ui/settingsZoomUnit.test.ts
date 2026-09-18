import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";

const mocks = vi.hoisted(() => {
  const base = {
    language: "en",
    spellcheck: { enabled: true, language: "en", skipCodeFormulaLinks: true },
    autoCorrect: { smartQuotes: false, doubleHyphenToEmDash: false, capitalizeAfterPeriod: false, threeDotsToEllipsis: false },
    editor: { fontFamily: "system-serif", fontSize: 15, zoomPercent: 170, columnWidth: "normal", tabWidth: 4, insertSpaces: true, softWrap: true, showInvisibles: false, lineNumbers: false },
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
  "settings.sections": "Settings sections",
  "settings.section.editor": "Editor",
  "settings.editor.zoom": "Editor zoom",
  "settings.editor.zoomDescription": "Zoom level of the editor text.",
  "settings.unit.percent": "%",
  "settings.saved": "Saved",
  "settings.close": "Close",
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/i18n", () => ({
  translate: (key: string) => labels[key] ?? key,
  formatLabel: (_id: string, label: string) => label,
  normalizeLocale: (value: string) => value,
  setInterfaceLanguage: async (value: string) => value,
}));
vi.mock("../../src/editor/zoom", () => ({
  getZoom: () => 170,
  installZoom: () => 170,
  applyZoom: vi.fn(),
  applyZoomValue: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  resetZoom: vi.fn(),
}));

import SettingsWindow from "../../src/ui/SettingsWindow.svelte";

describe("SettingsWindow - zoom unit and output", () => {
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
  });

  it("renders editor zoom with a single unit label next to the input and no duplicate output", async () => {
    render(SettingsWindow, { onClose: vi.fn(), onFocusEditor: vi.fn() });

    await fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

    const zoomRow = document.querySelector('[data-setting-row="settings-editor.zoomPercent"]');
    expect(zoomRow).not.toBeNull();

    // Contains the numeric input
    const input = zoomRow!.querySelector('input[type="number"]');
    expect(input).not.toBeNull();

    // Does NOT contain an output element (no duplicate value text)
    const output = zoomRow!.querySelector("output");
    expect(output).toBeNull();

    // Has exactly one unit span with "%"
    const spans = Array.from(zoomRow!.querySelectorAll(".numeric-control span:not(.sr-only)"));
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("%");
  });
});
