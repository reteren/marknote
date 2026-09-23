// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  englishDictionary,
  formatLabel,
  formatNumber,
  setInterfaceLanguage,
  translateWith,
} from "../src/i18n";
import type { Dictionary } from "../src/i18n/types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const defaultSettings = () => ({
  language: "en",
  spellcheck: { enabled: true, skipCodeFormulaLinks: true },
  autoCorrect: {
    smartQuotes: false,
    doubleHyphenToEmDash: false,
    capitalizeAfterPeriod: false,
    threeDotsToEllipsis: false,
  },
  editor: {
    fontFamily: "system-serif", fontSize: 15, zoomPercent: 100, columnWidth: "normal",
    tabWidth: 4, insertSpaces: true, softWrap: true, showInvisibles: false,
    lineNumbers: false,
  },
  livePreview: {
    enabled: true, revealMarkup: "cursor", renderFormulas: true, renderImages: true,
    maxImageWidth: "column", disableAboveBytes: 5 * 1024 * 1024,
  },
  files: {
    autosave: true, autosaveDelayMs: 2_000, saveOnWindowBlur: true,
    newDocumentFormat: "markdown", newDocumentEncoding: "utf8", newDocumentLineEnding: "system",
    trimTrailingSpaces: false, finalNewline: false,
  },
  windows: { rememberSizeAndPosition: true, startupAction: "startScreen", raiseExistingWindow: true, openFilesInTabs: false },
});

describe("translation fallback and formatting", () => {
  beforeEach(async () => {
    await setInterfaceLanguage("en");
  });

  it("falls back to English, then returns the missing key itself", () => {
    expect(translateWith("ru", {}, "menu.save")).toBe("Save");
    expect(translateWith("ru", {}, "future.missing-key")).toBe("future.missing-key");
  });

  it("interpolates named values in the translated order and locale-formats numbers", () => {
    const reordered: Dictionary = { "status.saved": "{time} — {count} files" };
    expect(translateWith("de", reordered, "status.saved", { time: "12:04", count: 17 }))
      .toBe("12:04 — 17 files");
    expect(formatNumber(1234, "de")).toBe(new Intl.NumberFormat("de").format(1234));
  });

  it("formats date and time placeholders with Intl for the selected locale", () => {
    const date = new Date("2026-09-15T12:04:00Z");
    const dictionary: Dictionary = { saved: "Saved {date} at {time, time}" };
    expect(translateWith("de", dictionary, "saved", { date, time: date }))
      .toBe(`Saved ${new Intl.DateTimeFormat("de", { dateStyle: "medium" }).format(date)} at ${new Intl.DateTimeFormat("de", { hour: "numeric", minute: "2-digit" }).format(date)}`);
  });

  it("uses the Russian one, few, and many plural forms", () => {
    // The forms are named after their plural category, the way the Arabic case
    // below does it: what is checked here is which category Russian picks for a
    // number, not the wording of the translation.
    const russian: Dictionary = {
      files: { one: "{count} one", few: "{count} few", many: "{count} many", other: "{count} other" },
    };
    expect(translateWith("ru", russian, "files", { count: 1 })).toBe("1 one");
    expect(translateWith("ru", russian, "files", { count: 2 })).toBe("2 few");
    expect(translateWith("ru", russian, "files", { count: 5 })).toBe("5 many");
  });

  it("uses Arabic plural categories and Chinese's single other form", () => {
    const arabic: Dictionary = {
      files: {
        zero: "zero", one: "one", two: "two", few: "few", many: "many", other: "other",
      },
    };
    expect([0, 1, 2, 3, 11, 100].map((count) =>
      translateWith("ar", arabic, "files", { count }),
    )).toEqual(["zero", "one", "two", "few", "many", "other"]);

    const chinese: Dictionary = { files: { other: "{count} 个文件" } };
    expect(translateWith("zh", chinese, "files", { count: 1 })).toBe("1 个文件");
    expect(translateWith("zh", chinese, "files", { count: 50 })).toBe("50 个文件");
  });

  it("ships a substantial, keyed English fallback dictionary", () => {
    expect(Object.keys(englishDictionary).length).toBeGreaterThan(140);
    expect(englishDictionary["dialog.close.save"]).toBe("Save");
    expect(englishDictionary["format.highlight"]).toBe("Highlight");
    expect(formatLabel("rtf", "RTF")).toBe("Rich Text Format");
  });

  it("switches root direction for Arabic and restores LTR for English", async () => {
    await setInterfaceLanguage("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    await setInterfaceLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("settings persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args?: { settings?: unknown }) => {
      if (command === "get_settings") return defaultSettings();
      if (command === "get_resolved_language") return "en";
      if (command === "save_settings") return args?.settings;
      throw new Error(`Unexpected settings IPC: ${command}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads settings once, then coalesces rapid edits into a debounced save", async () => {
    const settings = await import("../src/state/settings.svelte");
    await settings.loadSettings();
    await settings.loadSettings();
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_settings")).toHaveLength(1);

    invokeMock.mockClear();
    settings.updateSettings({ editor: { fontSize: 18 } });
    settings.updateSettings({ editor: { lineNumbers: true } });
    expect(invokeMock).not.toHaveBeenCalledWith("save_settings", expect.anything());

    await vi.advanceTimersByTimeAsync(399);
    expect(invokeMock).not.toHaveBeenCalledWith("save_settings", expect.anything());
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    const saveCalls = invokeMock.mock.calls.filter(([command]) => command === "save_settings");
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0][1]).toMatchObject({ settings: { editor: { fontSize: 18, lineNumbers: true } } });
    expect(settings.settingsState.dirty).toBe(false);
  });

  it("keeps pending edits dirty when save fails", async () => {
    const settings = await import("../src/state/settings.svelte");
    await settings.loadSettings();
    invokeMock.mockRejectedValueOnce(new Error("disk unavailable"));
    settings.updateSettings({ files: { autosave: false } });
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();

    expect(settings.settingsState.dirty).toBe(true);
    expect(settings.settingsState.error).toBe("disk unavailable");
  });
});
