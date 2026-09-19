// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StartScreen from "../src/ui/StartScreen.svelte";
import SettingsWindow from "../src/ui/SettingsWindow.svelte";
import {
  recentFilesState,
  extractFileName,
  extractDirectory,
  formatOpenedAt,
  type RecentFileEntry,
} from "../src/state/recentFiles.svelte";
import { defaultSettings, settingsState } from "../src/state/settings.svelte";
import { translate as t } from "../src/i18n";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("recentFiles utilities", () => {
  it("extracts file name from Windows and POSIX paths", () => {
    expect(extractFileName("C:\\Users\\notes\\todo.md")).toBe("todo.md");
    expect(extractFileName("/home/user/docs/notes.txt")).toBe("notes.txt");
    expect(extractFileName("single.md")).toBe("single.md");
    expect(extractFileName("")).toBe("");
  });

  it("extracts directory from Windows and POSIX paths", () => {
    expect(extractDirectory("C:\\Users\\notes\\todo.md")).toBe("C:/Users/notes");
    expect(extractDirectory("/home/user/docs/notes.txt")).toBe("/home/user/docs");
    expect(extractDirectory("single.md")).toBe("");
    expect(extractDirectory("")).toBe("");
  });

  it("formats timestamp into localized date string", () => {
    const ts = new Date("2026-09-18T10:30:00Z").getTime();
    const formatted = formatOpenedAt(ts, "en");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatOpenedAt(0)).toBe("");
    expect(formatOpenedAt(NaN)).toBe("");
  });
});

describe("recentFilesState", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads recent files via IPC get_recent_files", async () => {
    const entries: RecentFileEntry[] = [
      { path: "C:\\notes\\a.md", openedAt: 1000 },
      { path: "C:\\notes\\b.md", openedAt: 2000 },
    ];
    mockInvoke.mockResolvedValueOnce(entries);

    const result = await recentFilesState.load();
    expect(mockInvoke).toHaveBeenCalledWith("get_recent_files");
    expect(result).toEqual(entries);
    expect(recentFilesState.items).toEqual(entries);
  });

  it("adds a file and refreshes recent files", async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // add_recent_file
      .mockResolvedValueOnce([{ path: "C:\\notes\\c.md", openedAt: 3000 }]); // get_recent_files

    await recentFilesState.add("C:\\notes\\c.md");
    expect(mockInvoke).toHaveBeenCalledWith("add_recent_file", { path: "C:\\notes\\c.md" });
    expect(recentFilesState.items).toHaveLength(1);
    expect(recentFilesState.items[0]?.path).toBe("C:\\notes\\c.md");
  });

  it("clears recent files", async () => {
    recentFilesState.items = [{ path: "C:\\notes\\c.md", openedAt: 3000 }];
    mockInvoke.mockResolvedValueOnce(undefined);

    await recentFilesState.clear();
    expect(mockInvoke).toHaveBeenCalledWith("clear_recent_files");
    expect(recentFilesState.items).toHaveLength(0);
  });
});

describe("StartScreen in recentFiles mode", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_creatable_formats") return Promise.resolve([]);
      if (command === "get_recent_files") return Promise.resolve(recentFilesState.items);
      return Promise.resolve();
    });
    settingsState.settings = {
      ...defaultSettings,
      windows: { ...defaultSettings.windows, startupAction: "recentFiles" },
    };
  });

  afterEach(() => {
    cleanup();
    settingsState.settings = { ...defaultSettings };
  });

  it("renders recent files and clicks trigger onOpenPath", async () => {
    const onOpenPath = vi.fn();
    recentFilesState.items = [
      { path: "C:\\docs\\work.md", openedAt: Date.now() },
      { path: "C:\\docs\\personal.md", openedAt: Date.now() - 60000 },
    ];

    render(StartScreen, { props: { onOpenPath } });

    expect(document.querySelector(".start-screen h1")?.textContent).toBe(t("start.recentFiles"));
    const items = document.querySelectorAll(".recent-file-item");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("work.md");
    expect(items[1]?.textContent).toContain("personal.md");

    await fireEvent.click(items[0]!);
    expect(onOpenPath).toHaveBeenCalledWith("C:\\docs\\work.md");
  });

  it("renders empty state when there are no recent files", () => {
    recentFilesState.items = [];
    render(StartScreen);

    expect(document.querySelector(".start-screen h1")?.textContent).toBe(t("start.recentFiles"));
    expect(document.querySelector(".empty-recent")?.textContent).toBe(t("start.noRecentFiles"));
  });
});

describe("SettingsWindow Clear recent files button", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => {
      if (command === "get_settings") return Promise.resolve(defaultSettings);
      if (command === "list_creatable_formats") return Promise.resolve([]);
      if (command === "clear_recent_files") return Promise.resolve();
      return Promise.resolve();
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Clear recent files button next to startupAction and calls clear", async () => {
    render(SettingsWindow, { props: { onClose: () => undefined } });

    // Switch to Windows tab
    const windowsTab = document.querySelector<HTMLButtonElement>("[data-settings-tab='windows']");
    expect(windowsTab).not.toBeNull();
    await fireEvent.click(windowsTab!);

    const clearButton = document.querySelector<HTMLButtonElement>(".clear-recent-button");
    expect(clearButton).not.toBeNull();
    expect(clearButton?.textContent?.trim()).toBe(t("settings.windows.clearRecentFiles"));

    await fireEvent.click(clearButton!);
    expect(mockInvoke).toHaveBeenCalledWith("clear_recent_files");
    await waitFor(() => {
      expect(clearButton?.textContent?.trim()).toBe(t("settings.windows.recentFilesCleared"));
    });
  });
});
