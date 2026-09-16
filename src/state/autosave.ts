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
import { settingsState, type Settings } from "./settings.svelte";
import {
  subscribeWorkspace,
  tabById,
  workspace,
  type TabId,
} from "./workspace.svelte";

export const AUTOSAVE_DELAY_MS = 2_000;

export type AutosaveController = {
  start: () => Promise<void>;
  /** Schedule the active tab, or an explicit tab when supplied. */
  schedule: (tabId?: TabId) => void;
  /** Flush the active tab, or an explicit tab when supplied. */
  flush: (force?: boolean, tabId?: TabId) => Promise<SaveResult | null>;
  /** Flush every dirty tab in this window (used by close-all flows). */
  flushAll: (force?: boolean) => Promise<SaveResult | null>;
  dispose: () => void;
};

export type AutosaveOptions = {
  getState?: () => DocumentState;
  getSettings?: () => Settings;
  onSaved?: (result: SaveResult, tabId?: TabId) => void;
  onError?: (error: unknown, tabId?: TabId) => void;
};

function snapshot(state: DocumentState): DocumentState {
  return {
    ...state,
    format: state.format,
    lastSavedAt: state.lastSavedAt ? new Date(state.lastSavedAt) : null,
  };
}

/**
 * Применяет модификаторы текста перед сохранением:
 * - trimTrailingSpaces: удаляет хвостовые пробелы и табуляции в конце строк
 * - finalNewline: добавляет завершающий перевод строки в непустом файле, если его нет
 *
 * Модификация выполняется над сохраняемой строкой и не затрагивает живой буфер
 * CodeMirror, чтобы не смещать курсор и не засорять историю отмены (undo).
 */
export function applySaveTextTransforms(
  text: string,
  settingsOrFiles?: Settings | Settings["files"] | null,
  preferredLineEnding?: string,
): string {
  const files =
    settingsOrFiles && "files" in settingsOrFiles
      ? settingsOrFiles.files
      : settingsOrFiles;
  let result = text;
  if (files?.trimTrailingSpaces) {
    result = result.replace(/[ \t]+(?=\r?$)/gm, "");
  }
  if (files?.finalNewline) {
    if (result.length > 0 && !result.endsWith("\n") && !result.endsWith("\r")) {
      const newline =
        preferredLineEnding === "crlf" || (!preferredLineEnding && result.includes("\r\n"))
          ? "\r\n"
          : "\n";
      result += newline;
    }
  }
  return result;
}

/** Автосохранение — единственная точка, где проверяется path перед таймером. */
export function createAutosave(options: AutosaveOptions = {}): AutosaveController {
  const getState = options.getState ?? (() => documentState);
  const getSettings = options.getSettings ?? (() => settingsState.settings);
  const workspaceMode = options.getState === undefined;
  const legacyKey = "__document__";
  type Runtime = {
    timer?: ReturnType<typeof setTimeout>;
    saving: boolean;
    activeSave: Promise<SaveResult | null> | null;
    queued: boolean;
  };
  const runtimes = new Map<string, Runtime>();
  let focusUnlisten: UnlistenFn | undefined;
  let externalChangeUnlisten: UnlistenFn | undefined;
  let fileDeletedUnlisten: UnlistenFn | undefined;
  let workspaceUnsubscribe: (() => void) | undefined;
  let disposed = false;

  const runtimeFor = (tabId: string): Runtime => {
    const existing = runtimes.get(tabId);
    if (existing) return existing;
    const runtime: Runtime = { saving: false, activeSave: null, queued: false };
    runtimes.set(tabId, runtime);
    return runtime;
  };

  const tabIds = (): string[] => workspaceMode ? workspace.tabs.map((tab) => tab.id) : [legacyKey];

  const stateFor = (tabId: string): DocumentState | null => {
    if (!workspaceMode) return getState();
    return tabById(tabId)?.document ?? null;
  };

  const clearTimer = (tabId: string): void => {
    const runtime = runtimes.get(tabId);
    if (!runtime) return;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = undefined;
  };

  const save = (
    force = false,
    source?: "blur" | "timer" | "flush",
    tabId = workspaceMode ? workspace.activeId : legacyKey,
  ): Promise<SaveResult | null> => {
    const current = stateFor(tabId);
    if (!current) return Promise.resolve(null);
    const settings = getSettings();
    const runtime = runtimeFor(tabId);

    const autosaveAllowed =
      force ||
      (source === "blur"
        ? settings?.files?.saveOnWindowBlur !== false
        : settings?.files?.autosave !== false);

    // path === null — единственное безусловное отключение автосохранения.
    if (
      current.path === null ||
      current.readonly ||
      current.externalChange === "changed" ||
      (!current.format.autosave && !force) ||
      !autosaveAllowed ||
      !current.dirty
    ) {
      return Promise.resolve(null);
    }

    if (runtime.saving) {
      runtime.queued = true;
      return runtime.activeSave ?? Promise.resolve(null);
    }

    runtime.saving = true;
    const beforeSave = snapshot(current);
    markPending(current);

    const operation = (async (): Promise<SaveResult | null> => {
      try {
        const textToSave = applySaveTextTransforms(
          beforeSave.text,
          settings,
          beforeSave.lineEnding,
        );
        const result = await invoke<SaveResult>("save_file", {
          path: beforeSave.path,
          text: textToSave,
          encoding: beforeSave.encoding,
          bom: beforeSave.bom,
          lineEnding: beforeSave.lineEnding,
        });
        markSaved(result, beforeSave.text, current);
        // The legacy App callback updates the live editor path.  Restrict it
        // to the active tab so an inactive save cannot retarget that editor;
        // the tab document itself is already updated above.
        if (!workspaceMode || tabId === workspace.activeId) {
          options.onSaved?.(result, workspaceMode ? tabId : undefined);
        }
        return result;
      } catch (error) {
        markSaveFailed(current);
        options.onError?.(error, workspaceMode ? tabId : undefined);
        return null;
      } finally {
        runtime.saving = false;
        runtime.activeSave = null;
        if (runtime.queued) {
          runtime.queued = false;
          schedule(tabId);
        }
      }
    })();
    runtime.activeSave = operation;
    return operation;
  };

  const schedule = (tabId = workspaceMode ? workspace.activeId : legacyKey): void => {
    clearTimer(tabId);
    const settings = getSettings();
    if (settings?.files?.autosave === false) return;
    const current = stateFor(tabId);
    if (!current) return;
    if (current.path === null || current.readonly || !current.dirty) return;
    const delay = settings?.files?.autosaveDelayMs ?? AUTOSAVE_DELAY_MS;
    const runtime = runtimeFor(tabId);
    runtime.timer = setTimeout(() => {
      runtime.timer = undefined;
      void save(false, "timer", tabId);
    }, delay);
  };

  const scheduleAll = (): void => {
    for (const tabId of tabIds()) schedule(tabId);
  };

  const scheduleUnscheduled = (): void => {
    for (const tabId of tabIds()) {
      const runtime = runtimeFor(tabId);
      if (!runtime.timer && !runtime.saving) schedule(tabId);
    }
  };

  const handleBlur = (): void => {
    const settings = getSettings();
    if (settings?.files?.saveOnWindowBlur === false) return;
    for (const tabId of tabIds()) void save(false, "blur", tabId);
  };

  const handleFocus = (focused: boolean): void => {
    if (!focused) {
      const settings = getSettings();
      if (settings?.files?.saveOnWindowBlur === false) return;
      for (const tabId of tabIds()) void save(false, "blur", tabId);
    }
  };

  const samePath = (left: string, right: string): boolean =>
    left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();

  const handleExternalChange = async (event: { payload?: { path?: string } }): Promise<void> => {
    const path = event.payload?.path;
    if (!path) return;

    for (const tabId of tabIds()) {
      const current = stateFor(tabId);
      if (!current || current.path === null || !samePath(current.path, path)) continue;

      if (current.dirty) {
        markExternalChange(path, current);
        continue;
      }

      try {
        const opened = await invoke<OpenedFile>("open_file", { path });
        const latest = stateFor(tabId);
        // A local edit may have happened while open_file was in flight. Never
        // overwrite that newer buffer with the newer disk copy.
        if (latest && latest.path !== null && samePath(latest.path, path) && !latest.dirty) {
          replaceDocument(opened, latest);
        }
      } catch (error) {
        markExternalChange(path, current);
        options.onError?.(error, workspaceMode ? tabId : undefined);
      }
    }
  };

  const handleFileDeleted = (event: { payload?: { path?: string } }): void => {
    const path = event.payload?.path;
    if (!path) return;
    for (const tabId of tabIds()) {
      const current = stateFor(tabId);
      if (current && current.path !== null && samePath(current.path, path)) markFileDeleted(path, current);
    }
  };

  const start = async (): Promise<void> => {
    if (disposed) return;

    globalThis.addEventListener("blur", handleBlur);
    if (workspaceMode) {
      workspaceUnsubscribe = subscribeWorkspace((event) => {
        if (event.type === "closed") {
          clearTimer(event.id);
          runtimes.delete(event.id);
        } else if (event.type === "changed") {
          schedule(event.id);
        } else {
          scheduleUnscheduled();
        }
      });
      scheduleAll();
    }
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
    for (const tabId of runtimes.keys()) clearTimer(tabId);
    workspaceUnsubscribe?.();
    workspaceUnsubscribe = undefined;
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
    flush: async (force = false, tabId = workspaceMode ? workspace.activeId : legacyKey) => {
      let result: SaveResult | null = null;
      for (;;) {
        clearTimer(tabId);
        const beforeSave = stateFor(tabId);
        if (!beforeSave) return result;
        if (!beforeSave.dirty || beforeSave.path === null) return result;
        result = await save(force, "flush", tabId);
        const afterSave = stateFor(tabId);
        if (!afterSave) return result;
        if (!afterSave.dirty) return result;
        if (
          result === null ||
          afterSave.path === null ||
          afterSave.readonly ||
          afterSave.externalChange === "changed" ||
          (!afterSave.format.autosave && !force) ||
          (getSettings()?.files?.autosave === false && !force)
        ) return null;
      }
    },
    flushAll: async (force = false) => {
      let result: SaveResult | null = null;
      for (const tabId of tabIds()) {
        const saved = await (async () => {
          for (;;) {
            const state = stateFor(tabId);
            if (!state || !state.dirty || state.path === null) return null;
            const current = await save(force, "flush", tabId);
            const after = stateFor(tabId);
            if (!after || !after.dirty || current === null) return current;
          }
        })();
        if (saved) result = saved;
      }
      return result;
    },
    dispose,
  };
}

export async function saveAs(
  state: Pick<DocumentState, "text" | "format">,
  suggestedName: string,
  settingsOrFiles?: Settings | Settings["files"] | null,
): Promise<SaveResult | null> {
  const settings = settingsOrFiles ?? settingsState.settings;
  const textToSave = applySaveTextTransforms(state.text, settings);
  return invoke<SaveResult | null>("save_as", {
    text: textToSave,
    formatId: state.format.id,
    suggestedName,
  });
}
