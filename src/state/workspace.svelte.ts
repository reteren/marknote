import type { FormatCapabilities } from "./formats.svelte";
import { markdownFormat } from "./formats.svelte";
import {
  settingsState,
  type NewDocumentEncoding,
  type NewDocumentLineEnding,
} from "./settings.svelte";

export type TabId = string;

export type LineEnding = "lf" | "crlf";
export type SaveStatus = "unsaved" | "pending" | "saved" | "readonly";
export type ExternalChangeStatus = "none" | "changed" | "deleted";

/** The complete document metadata and buffer owned by one workspace tab. */
export type DocumentState = {
  path: string | null;
  format: FormatCapabilities;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  encoding: string;
  bom: boolean;
  lineEnding: LineEnding;
  text: string;
  dirty: boolean;
  readonly: boolean;
  externalChange: ExternalChangeStatus;
  externalChangePath: string | null;
};

export type WorkspaceTab = { id: TabId; document: DocumentState };

export type WorkspaceEvent =
  | { type: "opened"; id: TabId }
  | { type: "activated"; id: TabId; previousId: TabId }
  | { type: "closed"; id: TabId; activeId: TabId }
  | { type: "changed"; id: TabId };

export type WorkspaceListener = (event: WorkspaceEvent) => void;

export function resolveNewDocumentLineEnding(preference?: NewDocumentLineEnding): LineEnding {
  if (preference === "crlf") return "crlf";
  if (preference === "lf") return "lf";
  // "system": on Windows platforms default to CRLF, elsewhere to LF.
  const isWindows =
    typeof navigator !== "undefined" &&
    /windows|win32|win64/i.test(navigator.userAgent || navigator.platform || "");
  return isWindows ? "crlf" : "lf";
}

export function resolveNewDocumentEncoding(preference?: NewDocumentEncoding): string {
  if (preference === "utf8") return "utf-8";
  return "utf-8";
}

function defaultDocument(): DocumentState {
  return {
    path: null,
    format: markdownFormat,
    saveStatus: "unsaved",
    lastSavedAt: null,
    encoding: resolveNewDocumentEncoding(settingsState?.settings?.files?.newDocumentEncoding),
    bom: false,
    lineEnding: resolveNewDocumentLineEnding(settingsState?.settings?.files?.newDocumentLineEnding),
    text: "",
    dirty: false,
    readonly: false,
    externalChange: "none",
    externalChangePath: null,
  };
}

/** Creates a complete tab document while keeping omitted fields at defaults. */
export function createDocumentState(overrides: Partial<DocumentState> = {}): DocumentState {
  const document = { ...defaultDocument(), ...overrides };
  if (overrides.readonly === undefined) document.readonly = !document.format.editable;
  if (overrides.dirty === undefined) {
    document.dirty = document.path === null && document.text.length > 0;
  }
  if (overrides.saveStatus === undefined) {
    document.saveStatus = document.readonly
      ? "readonly"
      : document.dirty || document.path === null
        ? "unsaved"
        : "saved";
  }
  return document;
}

let nextTabNumber = 1;
const firstTabId = (): TabId => `tab-${nextTabNumber++}`;

export const workspace = $state<{
  tabs: WorkspaceTab[];
  activeId: TabId;
}>({
  tabs: [{ id: firstTabId(), document: createDocumentState() }],
  activeId: "tab-1",
});

const listeners = new Set<WorkspaceListener>();

function emit(event: WorkspaceEvent): void {
  for (const listener of listeners) listener(event);
}

/** Subscribe to tab lifecycle changes (used by autosave and the tab UI). */
export function subscribeWorkspace(listener: WorkspaceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify tab-owned services that a document buffer changed. */
export function notifyDocumentChanged(id: TabId): void {
  emit({ type: "changed", id });
}

export function activeTab(): WorkspaceTab {
  const current = workspace.tabs.find((tab) => tab.id === workspace.activeId);
  if (current) return current;

  // Keep the invariant required by the API even if a caller restored a stale
  // activeId from persisted state.
  const fallback = workspace.tabs[0];
  if (fallback) {
    workspace.activeId = fallback.id;
    return fallback;
  }

  // `closeTab` never removes the final tab, but retaining a defensive branch
  // makes the accessor total if a consumer mutates workspace.tabs directly.
  const recreated = { id: firstTabId(), document: createDocumentState() };
  workspace.tabs = [recreated];
  workspace.activeId = recreated.id;
  return recreated;
}

export function tabById(id: TabId): WorkspaceTab | undefined {
  return workspace.tabs.find((tab) => tab.id === id);
}

export function tabIdForDocument(document: DocumentState): TabId | undefined {
  return workspace.tabs.find((tab) => tab.document === document)?.id;
}

/** Opens and activates a new tab. */
export function openTab(document: Partial<DocumentState> = {}): TabId {
  const id = firstTabId();
  workspace.tabs.push({ id, document: createDocumentState(document) });
  const previousId = workspace.activeId;
  workspace.activeId = id;
  emit({ type: "opened", id });
  if (previousId !== id) emit({ type: "activated", id, previousId });
  return id;
}

/**
 * Closes a tab while preserving the one-tab-per-window invariant.  The UI
 * closes the native window when the final tab is requested; state itself keeps
 * that tab available so existing documentState consumers remain safe.
 */
export function closeTab(id: TabId): void {
  const index = workspace.tabs.findIndex((tab) => tab.id === id);
  if (index < 0 || workspace.tabs.length <= 1) return;

  const wasActive = workspace.activeId === id;
  workspace.tabs.splice(index, 1);
  if (wasActive) {
    workspace.activeId = workspace.tabs[Math.min(index, workspace.tabs.length - 1)]!.id;
  }
  emit({ type: "closed", id, activeId: workspace.activeId });
}

export function activateTab(id: TabId): void {
  if (!workspace.tabs.some((tab) => tab.id === id) || workspace.activeId === id) return;
  const previousId = workspace.activeId;
  workspace.activeId = id;
  emit({ type: "activated", id, previousId });
}

/** Returns the display name and format label shown by the tab strip. */
export function tabLabel(tab: WorkspaceTab): { name: string; format: string } {
  const document = tab.document;
  const name = document.path
    ? document.path.split(/[\\/]/u).pop() || document.path
    : document.text.trim().replace(/\s+/gu, " ").slice(0, 48) || "Untitled";
  return { name, format: document.format.label || document.format.id };
}
