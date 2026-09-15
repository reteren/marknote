import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  documentState,
  markExternalChange,
  markFileDeleted,
  markPending,
  markSaved,
  markSaveFailed,
  replaceDocument,
  type DocumentState,
  type OpenedFile,
  type SaveResult,
} from "./document.svelte";

const AUTOSAVE_DELAY_MS = 2_000;

export type AutosaveController = {
  start: () => Promise<void>;
  schedule: () => void;
  flush: (force?: boolean) => Promise<SaveResult | null>;
  dispose: () => void;
};

type AutosaveOptions = {
  getState?: () => DocumentState;
  onSaved?: (result: SaveResult) => void;
  onError?: (error: unknown) => void;
};

function snapshot(state: DocumentState): DocumentState {
  return {
    ...state,
    format: state.format,
    lastSavedAt: state.lastSavedAt ? new Date(state.lastSavedAt) : null,
  };
}

/** Автосохранение — единственная точка, где проверяется path перед таймером. */
export function createAutosave(options: AutosaveOptions = {}): AutosaveController {
  const getState = options.getState ?? (() => documentState);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focusUnlisten: UnlistenFn | undefined;
  let externalChangeUnlisten: UnlistenFn | undefined;
  let fileDeletedUnlisten: UnlistenFn | undefined;
  let saving = false;
  let activeSave: Promise<SaveResult | null> | null = null;
  let queued = false;
  let disposed = false;
  const handleBlur = (): void => void save();

  const save = (force = false): Promise<SaveResult | null> => {
    const current = getState();

    // path === null — единственное безусловное отключение автосохранения.
    if (
      current.path === null ||
      current.readonly ||
      current.externalChange === "changed" ||
      (!current.format.autosave && !force) ||
      !current.dirty
    ) {
      return Promise.resolve(null);
    }

    if (saving) {
      queued = true;
      return activeSave ?? Promise.resolve(null);
    }

    saving = true;
    const beforeSave = snapshot(current);
    markPending();

    const operation = (async (): Promise<SaveResult | null> => {
      try {
        const result = await invoke<SaveResult>("save_file", {
          path: beforeSave.path,
          text: beforeSave.text,
          encoding: beforeSave.encoding,
          bom: beforeSave.bom,
          lineEnding: beforeSave.lineEnding,
        });
        markSaved(result, beforeSave.text);
        options.onSaved?.(result);
        return result;
      } catch (error) {
        markSaveFailed();
        options.onError?.(error);
        return null;
      } finally {
        saving = false;
        activeSave = null;
        if (queued) {
          queued = false;
          schedule();
        }
      }
    })();
    activeSave = operation;
    return operation;
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const current = getState();
    if (current.path === null || current.readonly || !current.dirty) return;
    timer = setTimeout(() => {
      timer = undefined;
      void save();
    }, AUTOSAVE_DELAY_MS);
  };

  const handleFocus = (focused: boolean): void => {
    if (!focused) void save();
  };

  const samePath = (left: string, right: string): boolean =>
    left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();

  const handleExternalChange = async (event: { payload?: { path?: string } }): Promise<void> => {
    const path = event.payload?.path;
    const current = getState();
    if (!path || current.path === null || !samePath(current.path, path)) return;

    if (current.dirty) {
      markExternalChange(path);
      return;
    }

    try {
      const opened = await invoke<OpenedFile>("open_file", { path });
      const latest = getState();
      // A local edit may have happened while open_file was in flight. Never
      // overwrite that newer buffer with an external reload.
      if (latest.path !== null && samePath(latest.path, path) && !latest.dirty) replaceDocument(opened);
    } catch (error) {
      markExternalChange(path);
      options.onError?.(error);
    }
  };

  const handleFileDeleted = (event: { payload?: { path?: string } }): void => {
    const path = event.payload?.path;
    const current = getState();
    if (path && current.path !== null && samePath(current.path, path)) markFileDeleted(path);
  };

  const start = async (): Promise<void> => {
    if (disposed) return;

    globalThis.addEventListener("blur", handleBlur);
    try {
      const currentWindow = getCurrentWindow();
      focusUnlisten = await currentWindow.onFocusChanged(({ payload }) => handleFocus(payload));
      externalChangeUnlisten = await listen<{ path: string }>(
        "file-changed-externally",
        (event) => void handleExternalChange(event),
      );
      fileDeletedUnlisten = await listen<{ path: string }>("file-deleted", handleFileDeleted);
      if (disposed) {
        focusUnlisten?.();
        externalChangeUnlisten?.();
        fileDeletedUnlisten?.();
      }
    } catch {
      // В обычном браузере Tauri-события отсутствуют, но DOM blur всё равно работает.
    }
  };

  const dispose = (): void => {
    disposed = true;
    clearTimeout(timer);
    timer = undefined;
    globalThis.removeEventListener("blur", handleBlur);
    focusUnlisten?.();
    externalChangeUnlisten?.();
    fileDeletedUnlisten?.();
    focusUnlisten = undefined;
    externalChangeUnlisten = undefined;
    fileDeletedUnlisten = undefined;
  };

  return {
    start,
    schedule,
    flush: async (force = false) => {
      let result: SaveResult | null = null;
      for (;;) {
        clearTimeout(timer);
        timer = undefined;
        const beforeSave = getState();
        if (!beforeSave.dirty || beforeSave.path === null) return result;
        result = await save(force);
        const afterSave = getState();
        if (!afterSave.dirty) return result;
        if (
          result === null ||
          afterSave.path === null ||
          afterSave.readonly ||
          afterSave.externalChange === "changed" ||
          (!afterSave.format.autosave && !force)
        ) return null;
      }
    },
    dispose,
  };
}

export async function saveAs(
  state: Pick<DocumentState, "text" | "format">,
  suggestedName: string,
): Promise<SaveResult | null> {
  return invoke<SaveResult | null>("save_as", {
    text: state.text,
    formatId: state.format.id,
    suggestedName,
  });
}
