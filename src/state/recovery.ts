import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createDocumentState,
  activeTab,
  notifyDocumentChanged,
  openTab,
  type DocumentState,
  type FileFingerprint,
  type TabId,
} from "./workspace.svelte";
import {
  formatsState,
  loadCreatableFormats,
  markdownFormat,
  type FormatCapabilities,
} from "./formats.svelte";
import type { OpenedFile } from "./document.svelte";

export const RECOVERY_DEBOUNCE_MS = 300;
export const RECOVERY_MAX_WAIT_MS = 1_000;

export type RecoverySnapshot = {
  version: 1;
  windowLabel: string;
  tabId: string;
  path: string | null;
  title: string;
  formatId: string;
  encoding: string;
  bom: boolean;
  lineEnding: "lf" | "crlf";
  text: string;
  updatedAt: string;
  baseFingerprint: FileFingerprint | null;
  recoveredFrom?: string;
};

export type RecoveryEntry = RecoverySnapshot & {
  id: string;
  diskFingerprint: FileFingerprint | null;
};

export type RecoveryDecision = "untitled" | "restore-path" | "untitled-recovered";

export function decideRecovery(
  path: string | null,
  baseFingerprint: FileFingerprint | null,
  diskFingerprint: FileFingerprint | null,
): RecoveryDecision {
  if (path === null) return "untitled";
  if (
    baseFingerprint !== null &&
    diskFingerprint !== null &&
    baseFingerprint.modified !== null &&
    baseFingerprint.size === diskFingerprint.size &&
    baseFingerprint.modified === diskFingerprint.modified
  ) {
    return "restore-path";
  }
  return "untitled-recovered";
}

type RecoveryRuntime = {
  timer?: ReturnType<typeof setTimeout>;
  firstDirtyAt?: number;
  writing: Promise<boolean> | null;
  deleting: Promise<void> | null;
  queued: boolean;
  lastSnapshot: RecoverySnapshot | null;
  deleted: boolean;
  observedDirty: boolean;
};

export type RecoveryJournalOptions = {
  getState: (tabId: TabId) => DocumentState | null;
  getWindowLabel?: () => string;
  createJournalTabId?: (tabId: TabId) => string;
  writeSnapshot?: (snapshot: RecoverySnapshot) => Promise<void>;
  deleteSnapshot?: (tabId: TabId, windowLabel: string) => Promise<void>;
  deleteEntry?: (id: string) => Promise<void>;
  now?: () => number;
  debounceMs?: number;
  maxWaitMs?: number;
  onError?: (error: unknown, tabId: TabId) => void;
};

export type RecoveryJournal = {
  schedule: (tabId: TabId) => void;
  scheduleAll: (tabIds: TabId[]) => void;
  writeNow: (tabId: TabId) => Promise<boolean>;
  remove: (tabId: TabId) => Promise<void>;
  discard: (tabId: TabId) => Promise<void>;
  closed: (tabId: TabId) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  dispose: () => void;
};

export function createRecoveryJournal(options: RecoveryJournalOptions): RecoveryJournal {
  const now = options.now ?? Date.now;
  const debounceMs = options.debounceMs ?? RECOVERY_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? RECOVERY_MAX_WAIT_MS;
  const getWindowLabel = options.getWindowLabel ?? (() => {
    try {
      return getCurrentWindow().label || "browser";
    } catch {
      return "browser";
    }
  });
  const writeSnapshot = options.writeSnapshot ?? ((snapshot: RecoverySnapshot) =>
    invoke<void>("write_recovery_snapshot", { snapshot }));
  const deleteSnapshot = options.deleteSnapshot ?? ((tabId: TabId) =>
    invoke<void>("delete_recovery_snapshot", { tabId }));
  const deleteEntry = options.deleteEntry ?? ((id: string) =>
    invoke<void>("delete_recovery_entry", { id }));
  const runtimes = new Map<TabId, RecoveryRuntime>();
  const sessionId = globalThis.crypto?.randomUUID?.()
    ?? `${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const createJournalTabId = options.createJournalTabId ?? ((tabId) => `${tabId}-${sessionId}`);
  const journalTabIds = new Map<TabId, string>();
  let disposed = false;

  const journalTabId = (tabId: TabId): string => {
    const existing = journalTabIds.get(tabId);
    if (existing) return existing;
    const created = createJournalTabId(tabId);
    journalTabIds.set(tabId, created);
    return created;
  };

  const runtimeFor = (tabId: TabId): RecoveryRuntime => {
    const existing = runtimes.get(tabId);
    if (existing) return existing;
    const created: RecoveryRuntime = {
      writing: null,
      deleting: null,
      queued: false,
      lastSnapshot: null,
      deleted: false,
      observedDirty: false,
    };
    runtimes.set(tabId, created);
    return created;
  };

  const clearTimer = (runtime: RecoveryRuntime): void => {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = undefined;
  };

  const snapshotFor = (tabId: TabId, state: DocumentState): RecoverySnapshot => ({
    version: 1,
    windowLabel: getWindowLabel(),
    tabId: journalTabId(tabId),
    path: state.path,
    title: state.titleOverride ?? (state.path
      ? state.path.split(/[\\/]/u).pop() || state.path
      : `Untitled.${state.format.defaultExtension}`),
    formatId: state.format.id,
    encoding: state.encoding,
    bom: state.bom,
    lineEnding: state.lineEnding,
    text: state.text,
    updatedAt: new Date(now()).toISOString(),
    baseFingerprint: state.baseFingerprint ? { ...state.baseFingerprint } : null,
    ...(state.recoverySourceId ? { recoveredFrom: state.recoverySourceId } : {}),
  });

  const sameSnapshot = (left: RecoverySnapshot | null, right: RecoverySnapshot): boolean =>
    Boolean(left) &&
    left!.tabId === right.tabId &&
    left!.path === right.path &&
    left!.title === right.title &&
    left!.formatId === right.formatId &&
    left!.encoding === right.encoding &&
    left!.bom === right.bom &&
    left!.lineEnding === right.lineEnding &&
    left!.text === right.text &&
    left!.recoveredFrom === right.recoveredFrom &&
    left!.baseFingerprint?.size === right.baseFingerprint?.size &&
    left!.baseFingerprint?.modified === right.baseFingerprint?.modified;

  const schedule = (tabId: TabId): void => {
    if (disposed) return;
    const runtime = runtimeFor(tabId);
    const state = options.getState(tabId);
    if (!state || !state.dirty) {
      if (runtime.lastSnapshot || runtime.observedDirty) void remove(tabId);
      return;
    }
    runtime.observedDirty = true;
    const candidate = snapshotFor(tabId, state);
    if (sameSnapshot(runtime.lastSnapshot, candidate)) return;
    const currentTime = now();
    runtime.firstDirtyAt ??= currentTime;
    clearTimer(runtime);
    const remaining = Math.max(0, maxWaitMs - (currentTime - runtime.firstDirtyAt));
    const delay = Math.min(debounceMs, remaining);
    runtime.timer = setTimeout(() => {
      runtime.timer = undefined;
      void writeNow(tabId);
    }, delay);
  };

  const writeNow = async (tabId: TabId): Promise<boolean> => {
    const runtime = runtimeFor(tabId);
    clearTimer(runtime);
    if (runtime.deleting) {
      await runtime.deleting.catch((error: unknown) => options.onError?.(error, tabId));
    }
    const state = options.getState(tabId);
    if (!state || !state.dirty) return remove(tabId).then(() => false);
    const snapshot = snapshotFor(tabId, state);
    if (sameSnapshot(runtime.lastSnapshot, snapshot)) {
      runtime.firstDirtyAt = undefined;
      return Promise.resolve(true);
    }
    if (runtime.writing) {
      runtime.queued = true;
      return runtime.writing;
    }

    const writeOperation = writeSnapshot(snapshot)
      .then(() => {
        runtime.lastSnapshot = snapshot;
        runtime.deleted = false;
        return true;
      })
      .catch((error: unknown) => {
        options.onError?.(error, tabId);
        return false;
      })
      .then((written) => {
        runtime.writing = null;
        const latest = options.getState(tabId);
        if (!latest || !latest.dirty) {
          runtime.firstDirtyAt = undefined;
          void remove(tabId);
        } else if (written && sameSnapshot(runtime.lastSnapshot, snapshotFor(tabId, latest))) {
          runtime.firstDirtyAt = undefined;
        } else if (runtime.queued) {
          runtime.queued = false;
          runtime.firstDirtyAt ??= now();
          if (!runtime.timer) {
            runtime.timer = setTimeout(() => {
              runtime.timer = undefined;
              void writeNow(tabId);
            }, 0);
          }
        } else if (!written) {
          runtime.firstDirtyAt = now();
          if (!runtime.timer) {
            runtime.timer = setTimeout(() => {
              runtime.timer = undefined;
              void writeNow(tabId);
            }, 1_000);
          }
        }
        return written;
      });
    runtime.writing = writeOperation;
    return writeOperation;
  };

  const remove = async (tabId: TabId, force = false): Promise<void> => {
    const runtime = runtimeFor(tabId);
    clearTimer(runtime);
    runtime.firstDirtyAt = undefined;
    runtime.queued = false;
    if (runtime.writing) await runtime.writing;
    if (runtime.deleting) {
      try {
        await runtime.deleting;
      } catch (error) {
        options.onError?.(error, tabId);
      }
    }
    const state = options.getState(tabId);
    if (state?.dirty && !force) {
      schedule(tabId);
      return;
    }
    if (runtime.deleted) {
      runtime.lastSnapshot = null;
      if (state?.dirty) runtime.observedDirty = true;
      else {
        runtime.firstDirtyAt = undefined;
        runtime.observedDirty = false;
      }
      return;
    }
    try {
      const operation = deleteSnapshot(journalTabId(tabId), getWindowLabel());
      runtime.deleting = operation;
      await operation;
      runtime.lastSnapshot = null;
      runtime.deleted = true;
    } catch (error) {
      options.onError?.(error, tabId);
    } finally {
      runtime.deleting = null;
    }
    const latest = options.getState(tabId);
    if (latest?.dirty) {
      runtime.observedDirty = true;
      if (!runtime.timer) schedule(tabId);
    } else {
      runtime.firstDirtyAt = undefined;
      runtime.observedDirty = false;
    }
  };

  const closed = async (tabId: TabId): Promise<void> => {
    const runtime = runtimeFor(tabId);
    clearTimer(runtime);
    runtime.firstDirtyAt = undefined;
    runtime.queued = false;
    await remove(tabId, true);
    runtimes.delete(tabId);
    journalTabIds.delete(tabId);
  };

  return {
    schedule,
    scheduleAll: (tabIds) => tabIds.forEach(schedule),
    writeNow,
    remove,
    discard: (tabId) => remove(tabId, true),
    closed,
    deleteEntry: async (id) => deleteEntry(id),
    dispose: () => {
      disposed = true;
      for (const runtime of runtimes.values()) clearTimer(runtime);
    },
  };
}

function formatForRecovery(formatId: string, title: string): FormatCapabilities {
  const found = formatsState.items.find((candidate) => candidate.id === formatId);
  if (found) return found;
  const extension = title.split(".").at(-1)?.replace(/[^\w-]/gu, "") || "md";
  return {
    ...markdownFormat,
    id: formatId || markdownFormat.id,
    label: formatId || markdownFormat.label,
    defaultExtension: extension,
    extensions: [extension],
    creatable: false,
    autosave: false,
  };
}

function sameFingerprint(left: FileFingerprint | null, right: FileFingerprint | null): boolean {
  return Boolean(
    left &&
    right &&
    left.modified !== null &&
    left.size === right.size &&
    left.modified === right.modified,
  );
}

/** Restore prior-process journal entries before launch-file requests are handled. */
export async function restoreRecoveryEntries(
  writeTabNow: (tabId: TabId) => Promise<boolean>,
): Promise<TabId[]> {
  let windowLabel: string;
  try {
    const window = getCurrentWindow();
    if (window.label !== "main") return [];
    windowLabel = window.label;
  } catch {
    return [];
  }

  let entries: RecoveryEntry[];
  try {
    entries = await invoke<RecoveryEntry[]>("take_recovery_entries");
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  await loadCreatableFormats();
  const initialTab = activeTab();
  let canReuseInitial =
    initialTab.document.path === null && initialTab.document.text.length === 0 && !initialTab.document.dirty;
  const restoredIds: TabId[] = [];

  for (const entry of entries) {
    const decision = decideRecovery(entry.path, entry.baseFingerprint, entry.diskFingerprint);
    let opened: OpenedFile | null = null;
    if (decision === "restore-path" && entry.path) {
      try {
        const candidate = await invoke<OpenedFile>("open_file", { path: entry.path });
        if (sameFingerprint(entry.baseFingerprint, candidate.baseFingerprint ?? null)) opened = candidate;
      } catch {
        // A path that vanished during restore is recovered as a separate untitled document.
      }
    }

    const detached = entry.path !== null && opened === null;
    const title = detached
      ? `${entry.path!.split(/[\\/]/u).pop() || entry.title} (recovered)`
      : entry.title;
    const titleOverride = detached
      ? title
      : entry.path === null && entry.title.endsWith(" (recovered)")
        ? entry.title
        : null;
    const format = formatsState.items.find((candidate) => candidate.id === entry.formatId)
      ?? opened?.format
      ?? formatForRecovery(entry.formatId, entry.title);
    const document = createDocumentState({
      path: opened?.path ?? null,
      titleOverride,
      format,
      saveStatus: "unsaved",
      lastSavedAt: null,
      encoding: entry.encoding,
      bom: entry.bom,
      lineEnding: entry.lineEnding,
      baseFingerprint: opened?.baseFingerprint ?? null,
      savedText: opened?.text ?? "",
      savedFormatId: opened?.format.id ?? null,
      recoverySourceId: entry.id,
      text: entry.text,
      dirty: true,
      readonly: opened?.readonly ?? !format.editable,
      externalChange: "none",
      externalChangePath: null,
    });

    let tabId: TabId;
    if (canReuseInitial) {
      initialTab.document = document;
      tabId = initialTab.id;
      canReuseInitial = false;
      notifyDocumentChanged(tabId);
    } else {
      tabId = openTab(document);
    }
    restoredIds.push(tabId);

    if (await writeTabNow(tabId)) {
      try {
        await invoke<void>("delete_recovery_entry", { id: entry.id });
      } catch {
        // The child journal carries this source id, so startup deduplicates it if removal fails.
      }
    }
  }

  return restoredIds;
}
