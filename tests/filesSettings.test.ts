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
import { markdownFormat } from "../src/state/formats.svelte";
import { defaultSettings, type Settings } from "../src/state/settings.svelte";

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
});
