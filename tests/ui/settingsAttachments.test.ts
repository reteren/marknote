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
    windows: { rememberSizeAndPosition: true, startupAction: "startScreen", raiseExistingWindow: true, openFilesInTabs: false },
    attachments: { folder: "" },
  };
  const invoke = vi.fn();
  const openDialog = vi.fn();
  return { invoke, base, openDialog };
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
  "settings.attachments.title": "Attachments",
  "settings.attachments.folder": "Image folder",
  "settings.attachments.folderDescription": "Every image you insert is stored here.",
  "settings.attachments.cacheEmpty": "Empty",
  "settings.attachments.change": "Change…",
  "settings.attachments.useDefault": "Use default",
  "settings.attachments.reveal": "Open folder",
  "settings.saved": "Saved",
  "settings.pendingSave": "Saving changes…",
  "settings.saving": "Saving…",
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));
vi.mock("../../src/i18n", () => ({
  translate: (key: string, params?: Record<string, any>) => {
    if (key === "settings.attachments.cacheSize" && params) {
      return `${params.files} files, ${params.size}`;
    }
    return labels[key] ?? key;
  },
  interfaceLanguage: { locale: "en", dictionary: {} },
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

describe("SettingsWindow - Attachments Section", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "get_settings" || command === "reset_settings") return structuredClone(mocks.base);
      if (command === "save_settings") return args?.settings;
      if (command === "list_creatable_formats") return [{ id: "markdown", label: "Markdown", creatable: true }];
      if (command === "attachment_cache_stats") return { files: 3, bytes: 1536, path: "C:\Data\attachments" };
      if (command === "move_attachments_folder") return { files: 3, bytes: 1536, path: args?.folder || "C:\Data\attachments", skipped: 0 };
      if (command === "reveal_attachment_cache") return undefined;
      return undefined;
    });
    settingsState.settings = structuredClone(defaultSettings);
  });

  it("renders the attachments section in navigation", () => {
    mount();
    const tab = screen.getByRole("tab", { name: "Attachments" });
    expect(tab).toBeInTheDocument();
  });

  it("shows the image folder, its path and size when opened", async () => {
    mount();
    const tab = screen.getByRole("tab", { name: "Attachments" });
    await fireEvent.click(tab);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("attachment_cache_stats");
    });

    expect(screen.getByText("Image folder")).toBeInTheDocument();
    expect(screen.getByText("Every image you insert is stored here.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3 files, 1.5 KB")).toBeInTheDocument());
    expect(screen.getByText("C:\Data\attachments")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear cache" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull();
  });

  it("displays Empty when cache has 0 files", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_settings") return structuredClone(mocks.base);
      if (command === "attachment_cache_stats") return { files: 0, bytes: 0 };
      return undefined;
    });

    mount();
    await fireEvent.click(screen.getByRole("tab", { name: "Attachments" }));

    await waitFor(() => {
      expect(screen.getByText("Empty")).toBeInTheDocument();
    });
  });

  it("moves the images to a chosen folder, then stores the folder in the settings", async () => {
    mocks.openDialog.mockResolvedValue("D:\Pictures\MarkNote");
    mount();
    await fireEvent.click(screen.getByRole("tab", { name: "Attachments" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Change…" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("move_attachments_folder", { folder: "D:\Pictures\MarkNote" });
      expect(settingsState.settings.attachments.folder).toBe("D:\Pictures\MarkNote");
    });
    const moveCall = mocks.invoke.mock.calls.findIndex(([command]) => command === "move_attachments_folder");
    const saveCall = mocks.invoke.mock.calls.findIndex(([command, args]) => command === "save_settings" && args?.settings?.attachments?.folder);
    expect(moveCall).toBeGreaterThanOrEqual(0);
    expect(saveCall).toBeGreaterThan(moveCall);

    await fireEvent.click(await screen.findByRole("button", { name: "Use default" }));
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("move_attachments_folder", { folder: "" });
      expect(settingsState.settings.attachments.folder).toBe("");
    });
  });

  it("changes nothing when the folder dialog is cancelled", async () => {
    mocks.openDialog.mockResolvedValue(null);
    mount();
    await fireEvent.click(screen.getByRole("tab", { name: "Attachments" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("move_attachments_folder", expect.anything());
  });

  it("opens folder on Open folder click", async () => {
    mount();
    await fireEvent.click(screen.getByRole("tab", { name: "Attachments" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();
    });

    const revealButton = screen.getByRole("button", { name: "Open folder" });
    await fireEvent.click(revealButton);

    expect(mocks.invoke).toHaveBeenCalledWith("reveal_attachment_cache");
  });
});
