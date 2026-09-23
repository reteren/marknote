import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
  clearExternalChange,
  documentState,
  getDocumentTitle,
  markExternalChange,
  replaceDocument,
  resetDocument,
  setDocumentText,
  type OpenedFile,
  type SaveResult,
} from "../src/state/document.svelte";
import { createAutosave } from "../src/state/autosave";
import { markdownFormat, type FormatCapabilities } from "../src/state/formats.svelte";

function format(overrides: Partial<FormatCapabilities> = {}): FormatCapabilities {
  return { ...markdownFormat, ...overrides };
}

function opened(overrides: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: "C:\\notes\\draft.md",
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
    path: "C:\\notes\\draft.md",
    savedAt: "2026-09-14T12:34:56.000Z",
    format: markdownFormat,
    ...overrides,
  };
}

function makeDirty(formatValue = markdownFormat): void {
  replaceDocument(opened({ format: formatValue }));
  setDocumentText("edited");
}

function saveCalls(): typeof tauri.invoke.mock.calls {
  return tauri.invoke.mock.calls.filter(([command]) => command === "save_file");
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function emit(name: string, event: { payload?: { path?: string; [key: string]: unknown } } = {}): void {
  tauri.handlers.get(name)?.(event);
}

function configureEvents(): void {
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
}

describe("document state and autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tauri.invoke.mockReset();
    configureEvents();
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

  it("never autosaves an untitled document without a path", async () => {
    resetDocument(markdownFormat, "draft without a path");
    tauri.invoke.mockResolvedValue(result());
    const controller = createAutosave();
    controller.schedule();
    vi.advanceTimersByTime(10_000);
    await controller.start();
    tauri.focusHandler?.({ payload: false });
    emit("save-before-close");
    await settle();

    expect(documentState.path).toBeNull();
    expect(documentState.dirty).toBe(true);
    expect(saveCalls()).toHaveLength(0);
    controller.dispose();
  });

  it("does not autosave a path-backed format with autosave disabled", async () => {
    const rtf = format({ id: "rtf", label: "RTF", autosave: false, lossy: true });
    makeDirty(rtf);
    tauri.invoke.mockResolvedValue(result({ format: rtf }));
    const controller = createAutosave();
    controller.schedule();
    vi.advanceTimersByTime(10_000);
    await controller.start();
    tauri.focusHandler?.({ payload: false });
    emit("save-before-close");
    await settle();

    expect(saveCalls()).toHaveLength(0);
    expect(documentState.dirty).toBe(true);
    controller.dispose();
  });

  it("does not save non-editable formats and reports Read-only", async () => {
    const pdf = format({ id: "pdf", label: "PDF", editable: false, autosave: false, livePreview: false });
    replaceDocument(opened({ format: pdf, readonly: true, text: "read-only text" }));
    setDocumentText("attempted edit");
    const controller = createAutosave();

    await controller.flush(true);

    expect(saveCalls()).toHaveLength(0);
    expect(documentState.readonly).toBe(true);
    expect(documentState.saveStatus).toBe("readonly");
    controller.dispose();
  });

  it("marks a file clean when its text is reverted to the loaded version", () => {
    replaceDocument(opened({ text: "saved text" }));
    setDocumentText("edited text");
    expect(documentState.dirty).toBe(true);

    setDocumentText("saved text");
    expect(documentState.dirty).toBe(false);
  });

  it("waits two seconds after the last edit and resets the idle timer", async () => {
    makeDirty();
    tauri.invoke.mockResolvedValue(result());
    const controller = createAutosave();
    controller.schedule();
    vi.advanceTimersByTime(1_999);
    await settle();
    expect(saveCalls()).toHaveLength(0);

    setDocumentText("edited again");
    controller.schedule();
    vi.advanceTimersByTime(1);
    await settle();
    expect(saveCalls()).toHaveLength(0);
    vi.advanceTimersByTime(1_999);
    await settle();

    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0]?.[1]).toMatchObject({ text: "edited again" });
    controller.dispose();
  });

  it("saves immediately when the window loses focus", async () => {
    makeDirty();
    tauri.invoke.mockResolvedValue(result());
    const controller = createAutosave();
    await controller.start();

    tauri.focusHandler?.({ payload: false });
    await settle();

    expect(saveCalls()).toHaveLength(1);
    controller.dispose();
  });

  it("leaves native close decisions to the App close handler", async () => {
    makeDirty();
    const controller = createAutosave();
    await controller.start();

    expect(tauri.handlers.has("save-before-close")).toBe(false);
    emit("save-before-close");
    await settle();

    expect(saveCalls()).toHaveLength(0);
    controller.dispose();
  });

  it("queues a second edit instead of writing concurrently", async () => {
    makeDirty();
    let resolveFirst: (value: SaveResult) => void = () => undefined;
    const firstSave = new Promise<SaveResult>((resolve) => {
      resolveFirst = resolve;
    });
    tauri.invoke.mockImplementationOnce(() => firstSave).mockResolvedValueOnce(result());
    const controller = createAutosave();

    const first = controller.flush();
    expect(saveCalls()).toHaveLength(1);
    setDocumentText("second edit while saving");
    const second = controller.flush();
    expect(saveCalls()).toHaveLength(1);

    resolveFirst(result());
    await Promise.all([first, second]);
    await settle();

    expect(saveCalls()).toHaveLength(2);
    expect(saveCalls()[1]?.[1]).toMatchObject({ text: "second edit while saving" });
    expect(documentState.dirty).toBe(false);
    controller.dispose();
  });

  it("keeps the dirty flag and Unsaved status after a save error", async () => {
    makeDirty();
    tauri.invoke.mockRejectedValue(new Error("disk is full"));
    const errors: unknown[] = [];
    const controller = createAutosave({ onError: (error) => errors.push(error) });

    const pending = controller.flush();
    expect(documentState.saveStatus).toBe("pending");
    await pending;

    expect(documentState.dirty).toBe(true);
    expect(documentState.saveStatus).toBe("unsaved");
    expect(errors).toHaveLength(1);
    controller.dispose();
  });

  it("transitions Unsaved to Pending to Saved and records the save time", async () => {
    makeDirty();
    const saved = result({ savedAt: "2026-09-14T15:45:12.000Z" });
    tauri.invoke.mockResolvedValue(saved);
    const controller = createAutosave();

    expect(documentState.saveStatus).toBe("unsaved");
    const pending = controller.flush();
    expect(documentState.saveStatus).toBe("pending");
    await pending;

    expect(documentState.saveStatus).toBe("saved");
    expect(documentState.dirty).toBe(false);
    expect(getDocumentTitle(documentState)).toBe("draft.md — MarkNote");
    expect(documentState.lastSavedAt).toEqual(new Date(saved.savedAt));
    controller.dispose();
  });

  it("reloads a clean buffer on an external change without marking it dirty", async () => {
    replaceDocument(opened({ text: "old on disk" }));
    const reloaded = opened({ text: "new on disk" });
    tauri.invoke.mockResolvedValue(reloaded);
    const controller = createAutosave();
    await controller.start();

    emit("file-changed-externally", { payload: { path: "c:/NOTES/draft.md" } });
    await settle();

    expect(tauri.invoke).toHaveBeenCalledWith("open_file", { path: "c:/NOTES/draft.md" });
    expect(documentState.text).toBe("new on disk");
    expect(documentState.dirty).toBe(false);
    expect(documentState.externalChange).toBe("none");
    controller.dispose();
  });

  it("pauses autosave and records a conflict when a dirty buffer changes externally", async () => {
    makeDirty();
    tauri.invoke.mockResolvedValue(result());
    const controller = createAutosave();
    await controller.start();

    emit("file-changed-externally", { payload: { path: "C:\\notes\\draft.md" } });
    await settle();
    controller.schedule();
    vi.advanceTimersByTime(10_000);
    await settle();

    expect(documentState.externalChange).toBe("changed");
    expect(documentState.externalChangePath).toBe("C:\\notes\\draft.md");
    expect(saveCalls()).toHaveLength(0);
    clearExternalChange();
    controller.dispose();
  });

  it("marks a matching deleted file while retaining path and text", async () => {
    replaceDocument(opened({ text: "keep this in memory" }));
    const controller = createAutosave();
    await controller.start();

    emit("file-deleted", { payload: { path: "C:\\notes\\draft.md" } });

    expect(documentState.externalChange).toBe("deleted");
    expect(documentState.path).toBe("C:\\notes\\draft.md");
    expect(documentState.text).toBe("keep this in memory");
    controller.dispose();
  });

  it("ignores external events for another file", async () => {
    replaceDocument(opened({ path: "C:\\notes\\draft.md" }));
    const controller = createAutosave();
    await controller.start();

    emit("file-deleted", { payload: { path: "C:\\notes\\other.md" } });
    emit("file-changed-externally", { payload: { path: "C:\\notes\\other.md" } });
    await settle();

    expect(documentState.externalChange).toBe("none");
    expect(saveCalls()).toHaveLength(0);
    controller.dispose();
  });

  it("marks an externally changed path through the state API", () => {
    replaceDocument(opened());

    expect(markExternalChange("C:\\notes\\draft.md")).toBe(true);
    expect(documentState.externalChange).toBe("changed");
    expect(markExternalChange("C:\\notes\\other.md")).toBe(false);
  });
});
