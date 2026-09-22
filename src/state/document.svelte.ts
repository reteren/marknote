import { markdownFormat, type FormatCapabilities } from "./formats.svelte";
import { settingsState } from "./settings.svelte";
import {
  activeTab,
  notifyDocumentChanged,
  resolveNewDocumentEncoding,
  resolveNewDocumentLineEnding,
  tabIdForDocument,
  type DocumentState,
  type ExternalChangeStatus,
  type LineEnding,
  type SaveStatus,
} from "./workspace.svelte";

export type { DocumentState, ExternalChangeStatus, LineEnding, SaveStatus } from "./workspace.svelte";
export { resolveNewDocumentEncoding, resolveNewDocumentLineEnding } from "./workspace.svelte";

export type OpenedFile = {
  path: string;
  text: string;
  encoding: string;
  bom: boolean;
  lineEnding: LineEnding;
  format: FormatCapabilities;
  readonly: boolean;
};

export type SaveResult = {
  path: string;
  savedAt: string;
  format: FormatCapabilities;
};

export type NewDocument = {
  text: string;
  format: FormatCapabilities;
};

/**
 * Stable compatibility view over the active workspace tab.  Existing callers
 * keep importing and mutating `documentState`; Proxy traps forward every field
 * read and write to the active tab without creating a second text store.
 */
const documentProxyTarget = Object.create(null) as DocumentState;
export const documentState: DocumentState = new Proxy(documentProxyTarget, {
  get(_target, property: string | symbol) {
    if (property === Symbol.toStringTag) return "DocumentState";
    return activeTab().document[property as keyof DocumentState];
  },
  set(_target, property: string | symbol, value: unknown) {
    if (typeof property !== "string") return false;
    const tab = activeTab();
    const previous = tab.document[property as keyof DocumentState];
    tab.document[property as keyof DocumentState] = value as never;
    if (property === "text" && previous !== value) notifyDocumentChanged(tab.id);
    return true;
  },
  has(_target, property: string | symbol) {
    return typeof property === "string" && property in activeTab().document;
  },
  ownKeys() {
    return Reflect.ownKeys(activeTab().document);
  },
  getOwnPropertyDescriptor(_target, property: string | symbol) {
    if (typeof property !== "string" || !(property in activeTab().document)) return undefined;
    return { enumerable: true, configurable: true };
  },
});

/** UI labels derived from the same document identity stored in DocumentState. */
export function getDocumentTitle(state: Pick<DocumentState, "path" | "format">): string {
  const name = state.path
    ? state.path.split(/[\\/]/u).pop() || state.path
    : `Untitled.${state.format.defaultExtension}`;
  return `${name} — MarkNote`;
}

export function getClosePromptMessage(state: Pick<DocumentState, "path">): string {
  return state.path
    ? "This document has unsaved changes."
    : "This untitled document has unsaved changes.";
}

export function replaceDocument(opened: OpenedFile, target: DocumentState = documentState): void {
  const readonly = opened.readonly || !opened.format.editable;
  target.path = opened.path;
  target.format = opened.format;
  target.saveStatus = readonly ? "readonly" : "saved";
  target.lastSavedAt = null;
  target.encoding = opened.encoding;
  target.bom = opened.bom;
  target.lineEnding = opened.lineEnding;
  target.text = opened.text;
  target.dirty = false;
  target.readonly = readonly;
  target.externalChange = "none";
  target.externalChangePath = null;
}

export function resetDocument(
  format: FormatCapabilities = markdownFormat,
  text = "",
  options?: { encoding?: string; lineEnding?: LineEnding },
  target: DocumentState = documentState,
): void {
  target.path = null;
  target.format = format;
  target.saveStatus = "unsaved";
  target.lastSavedAt = null;
  const files = settingsState?.settings?.files;
  target.encoding = options?.encoding ?? resolveNewDocumentEncoding(files?.newDocumentEncoding);
  target.bom = false;
  target.lineEnding = options?.lineEnding ?? resolveNewDocumentLineEnding(files?.newDocumentLineEnding);
  target.text = text;
  target.dirty = text.length > 0;
  target.readonly = !format.editable;
  target.saveStatus = target.readonly ? "readonly" : "unsaved";
  target.externalChange = "none";
  target.externalChangePath = null;
}

/**
 * Changes only the format capabilities, leaving the document text untouched.
 * A saved document becomes dirty because the new type requires a separate Save as.
 */
export function setDocumentFormat(format: FormatCapabilities, target: DocumentState = documentState): void {
  const changed = target.format.id !== format.id;
  target.format = format;
  target.readonly = !format.editable;

  if (target.readonly) {
    target.saveStatus = "readonly";
    return;
  }

  if (changed && target.path !== null) target.dirty = true;
  target.saveStatus = target.dirty || target.path === null ? "unsaved" : "saved";
}

export function setDocumentText(text: string, target: DocumentState = documentState): void {
  if (text === target.text) return;

  target.text = text;
  target.dirty = true;
  if (!target.readonly) {
    target.saveStatus = "unsaved";
  }
  const tabId = target === documentState ? activeTab().id : tabIdForDocument(target);
  if (tabId) notifyDocumentChanged(tabId);
}

export function markPending(target: DocumentState = documentState): void {
  if (!target.readonly) target.saveStatus = "pending";
}

export function markSaved(
  result: SaveResult,
  snapshotText = documentState.text,
  target: DocumentState = documentState,
): void {
  target.path = result.path;
  target.format = result.format;
  target.lastSavedAt = new Date(result.savedAt);
  target.saveStatus = !result.format.editable
    ? "readonly"
    : target.text === snapshotText
      ? "saved"
      : "unsaved";
  target.dirty = target.text !== snapshotText;
  target.readonly = !result.format.editable;
  target.externalChange = "none";
  target.externalChangePath = null;
}

export function markSaveFailed(target: DocumentState = documentState): void {
  if (!target.readonly) target.saveStatus = "unsaved";
}

/** Marks an external-change conflict for the current file. */
export function markExternalChange(path: string, target: DocumentState = documentState): boolean {
  if (target.path === null || !samePath(target.path, path)) return false;
  target.externalChange = "changed";
  target.externalChangePath = path;
  return true;
}

/** Marks a deleted file while keeping its text and path for a later Save. */
export function markFileDeleted(path: string, target: DocumentState = documentState): boolean {
  if (target.path === null || !samePath(target.path, path)) return false;
  target.externalChange = "deleted";
  target.externalChangePath = path;
  return true;
}

export function clearExternalChange(target: DocumentState = documentState): void {
  target.externalChange = "none";
  target.externalChangePath = null;
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
}

/**
 * Extracts all image source paths from Markdown image syntax and HTML <img> tags.
 */
export function extractImageSrcs(text: string): string[] {
  const srcs = new Set<string>();
  if (!text) return [];

  const mdRegex = /!\[(?:[^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(text)) !== null) {
    const src = match[1] ?? match[2];
    if (src) srcs.add(src);
  }

  const htmlRegex = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/giu;
  while ((match = htmlRegex.exec(text)) !== null) {
    const src = match[1] ?? match[2] ?? match[3];
    if (src) srcs.add(src);
  }

  return Array.from(srcs);
}

/**
 * Rewrites image sources in document text according to { from, to } mapping.
 */
export function rewriteAttachmentSrcs(text: string, rewrites: Array<{ from: string; to: string }>): string {
  if (!text || !rewrites || rewrites.length === 0) return text;
  let result = text;
  for (const { from, to } of rewrites) {
    if (!from || from === to) continue;
    result = result.replaceAll(from, to);
  }
  return result;
}
