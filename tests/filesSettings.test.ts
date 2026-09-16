import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  focusChanged: vi.fn(),
  handlers: new Map<string, (event: { payload?: { path?: string; [key: string]: unknown } }) => void>(),
  focusHandler: undefined as ((event: { payload: boolean }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: tauri.focusChanged }),
}));

import {
  documentState,
  replaceDocument,
  resetDocument,
  setDocumentText,
  type OpenedFile,
  type SaveResult,
} from "../src/state/document.svelte";
import { createAutosave, saveAs } from "../src/state/autosave";
import { createActions } from "../src/state/actions";
import { markdownFormat, plainFormat } from "../src/state/formats.svelte";
import { defaultSettings, settingsState, type Settings } from "../src/state/settings.svelte";

function createSettings(filesOverrides: Partial<Settings["files"]> = {}): Settings {
  return {
    ...defaultSettings,
    files: {
      ...defaultSettings.files,
      ...filesOverrides,
    },
  };
}

function opened(overrides: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: "C:\\notes\\doc.md",
    text: "initial",
    encoding: "utf-8",
    bom: false,
    lineEnding: "lf",
    format: markdownFormat,
    readonly: false,
    ...overrides,
  };
}

function result(overrides: Partial<SaveResult> = {}): SaveResult {
  return {
    path: "C:\\notes\\doc.md",
    savedAt: "2026-09-16T12:00:00.000Z",
    format: markdownFormat,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("files settings wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tauri.invoke.mockReset();
    tauri.handlers.clear();
    tauri.focusHandler = undefined;
    tauri.listen.mockImplementation(
      async (name: string, handler: (event: { payload?: { path?: string; [key: string]: unknown } }) => void) => {
        tauri.handlers.set(name, handler);
        return () => tauri.handlers.delete(name);
      },
    );
    tauri.focusChanged.mockImplementation(async (handler: (event: { payload: boolean }) => void) => {
      tauri.focusHandler = handler;
      return () => {
        tauri.focusHandler = undefined;
      };
    });

    const runtime = globalThis as typeof globalThis & {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    };
    runtime.addEventListener = vi.fn();
    runtime.removeEventListener = vi.fn();

    resetDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("files.autosave: disables automatic timer saving when false", async () => {
    replaceDocument(opened());
    setDocumentText("unsaved change");
    tauri.invoke.mockResolvedValue(result());

    const settings = createSettings({ autosave: false });
    const controller = createAutosave({ getSettings: () => settings });

    controller.schedule();
    vi.advanceTimersByTime(10_000);
    await settle();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(documentState.dirty).toBe(true);
    controller.dispose();
  });

  it("files.autosaveDelayMs: respects configured delay before autosaving", async () => {
    replaceDocument(opened());
    setDocumentText("unsaved change");
    tauri.invoke.mockResolvedValue(result());

    const settings = createSettings({ autosave: true, autosaveDelayMs: 4_000 });
    const controller = createAutosave({ getSettings: () => settings });

    controller.schedule();
    vi.advanceTimersByTime(3_999);
    await settle();
    expect(tauri.invoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await settle();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("files.saveOnWindowBlur: ignores blur when saveOnWindowBlur is false", async () => {
    replaceDocument(opened());
    setDocumentText("unsaved change");
    tauri.invoke.mockResolvedValue(result());

    const settings = createSettings({ saveOnWindowBlur: false });
    const controller = createAutosave({ getSettings: () => settings });
    await controller.start();

    tauri.focusHandler?.({ payload: false });
    await settle();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(documentState.dirty).toBe(true);
    controller.dispose();
  });

  it("files.trimTrailingSpaces: trims trailing line spaces on save without altering live editor buffer", async () => {
    const originalText = "alpha   \nbeta \t \r\ngamma  ";
    replaceDocument(opened({ text: "initial" }));
    setDocumentText(originalText);
    tauri.invoke.mockResolvedValue(result());

    const settings = createSettings({ trimTrailingSpaces: true });
    const controller = createAutosave({ getSettings: () => settings });

    await controller.flush(true);

    expect(tauri.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      text: "alpha\nbeta\r\ngamma",
    }));
    // Live editor state in memory is preserved intact — cursor & undo history unaffected
    expect(documentState.text).toBe(originalText);
    expect(documentState.dirty).toBe(false);
    controller.dispose();
  });

  it("files.finalNewline: appends missing trailing newline on save without altering live editor buffer", async () => {
    const originalText = "first line\nsecond line";
    replaceDocument(opened({ text: "initial" }));
    setDocumentText(originalText);
    tauri.invoke.mockResolvedValue(result());

    const settings = createSettings({ finalNewline: true });
    const controller = createAutosave({ getSettings: () => settings });

    await controller.flush(true);

    expect(tauri.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      text: "first line\nsecond line\n",
    }));
    // Live editor state in memory is preserved intact
    expect(documentState.text).toBe(originalText);
    expect(documentState.dirty).toBe(false);
    controller.dispose();
  });

  it("files.newDocumentFormat: respects configured format when creating new document", async () => {
    tauri.invoke.mockImplementation(async (command: string, args?: { formatId?: string }) => {
      if (command === "new_document") {
        const format = args?.formatId === "plain" ? plainFormat : markdownFormat;
        return { text: "", format };
      }
      return undefined;
    });

    const settings = createSettings({ newDocumentFormat: "plain" });
    const actions = createActions({
      getSettings: () => settings,
      getFormats: () => [markdownFormat, plainFormat],
    });

    await actions.newDocument();
    expect(tauri.invoke).toHaveBeenCalledWith("new_document", { formatId: "plain" });
    expect(documentState.format.id).toBe("plain");
  });

  it("files.newDocumentFormat: silently falls back to markdown when format is unknown or invalid", async () => {
    tauri.invoke.mockImplementation(async (command: string, args?: { formatId?: string }) => {
      if (command === "new_document") {
        return { text: "", format: markdownFormat };
      }
      return undefined;
    });

    const settings = createSettings({ newDocumentFormat: "nonexistent-format" });
    const actions = createActions({
      getSettings: () => settings,
      getFormats: () => [markdownFormat, plainFormat],
    });

    await actions.newDocument();
    expect(tauri.invoke).toHaveBeenCalledWith("new_document", { formatId: "markdown" });
    expect(documentState.format.id).toBe("markdown");
  });

  it("files.newDocumentEncoding: initializes new document encoding from settings", () => {
    const previous = settingsState.settings.files.newDocumentEncoding;
    try {
      settingsState.settings.files.newDocumentEncoding = "utf8";
      resetDocument();
      expect(documentState.encoding).toBe("utf-8");
    } finally {
      settingsState.settings.files.newDocumentEncoding = previous;
    }
  });

  it("files.newDocumentLineEnding: applies configured line ending to new document state and save", async () => {
    const previous = settingsState.settings.files.newDocumentLineEnding;
    try {
      // When settings specifies crlf
      settingsState.settings.files.newDocumentLineEnding = "crlf";
      resetDocument();
      expect(documentState.lineEnding).toBe("crlf");

      // When settings specifies lf
      settingsState.settings.files.newDocumentLineEnding = "lf";
      resetDocument();
      expect(documentState.lineEnding).toBe("lf");
    } finally {
      settingsState.settings.files.newDocumentLineEnding = previous;
    }
  });
});
