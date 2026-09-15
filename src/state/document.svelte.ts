import type { FormatCapabilities } from "./formats.svelte";
import { markdownFormat } from "./formats.svelte";

export type LineEnding = "lf" | "crlf";
export type SaveStatus = "unsaved" | "pending" | "saved" | "readonly";
export type ExternalChangeStatus = "none" | "changed" | "deleted";

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
  /** Состояние watcher-событий, которое App отображает полосой уведомления. */
  externalChange: ExternalChangeStatus;
  externalChangePath: string | null;
};

export const documentState = $state<DocumentState>({
  path: null,
  format: markdownFormat,
  saveStatus: "unsaved",
  lastSavedAt: null,
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf",
  text: "",
  dirty: false,
  readonly: false,
  externalChange: "none",
  externalChangePath: null,
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

export function replaceDocument(opened: OpenedFile): void {
  const readonly = opened.readonly || !opened.format.editable;
  documentState.path = opened.path;
  documentState.format = opened.format;
  documentState.saveStatus = readonly ? "readonly" : "saved";
  documentState.lastSavedAt = null;
  documentState.encoding = opened.encoding;
  documentState.bom = opened.bom;
  documentState.lineEnding = opened.lineEnding;
  documentState.text = opened.text;
  documentState.dirty = false;
  documentState.readonly = readonly;
  documentState.externalChange = "none";
  documentState.externalChangePath = null;
}

export function resetDocument(format: FormatCapabilities = markdownFormat, text = ""): void {
  documentState.path = null;
  documentState.format = format;
  documentState.saveStatus = "unsaved";
  documentState.lastSavedAt = null;
  documentState.encoding = "utf-8";
  documentState.bom = false;
  documentState.lineEnding = "lf";
  documentState.text = text;
  documentState.dirty = text.length > 0;
  documentState.readonly = !format.editable;
  documentState.saveStatus = documentState.readonly ? "readonly" : "unsaved";
  documentState.externalChange = "none";
  documentState.externalChangePath = null;
}

/**
 * Меняет только возможности формата, не трогая текст документа. Сохранённый
 * документ становится грязным: новый тип требует отдельного Save as.
 */
export function setDocumentFormat(format: FormatCapabilities): void {
  const changed = documentState.format.id !== format.id;
  documentState.format = format;
  documentState.readonly = !format.editable;

  if (documentState.readonly) {
    documentState.saveStatus = "readonly";
    return;
  }

  if (changed && documentState.path !== null) documentState.dirty = true;
  documentState.saveStatus = documentState.dirty || documentState.path === null ? "unsaved" : "saved";
}

export function setDocumentText(text: string): void {
  if (text === documentState.text) return;

  documentState.text = text;
  documentState.dirty = true;
  if (!documentState.readonly) {
    documentState.saveStatus = "unsaved";
  }
}

export function markPending(): void {
  if (!documentState.readonly) documentState.saveStatus = "pending";
}

export function markSaved(result: SaveResult, snapshotText = documentState.text): void {
  documentState.path = result.path;
  documentState.format = result.format;
  documentState.lastSavedAt = new Date(result.savedAt);
  documentState.saveStatus = !result.format.editable
    ? "readonly"
    : documentState.text === snapshotText
      ? "saved"
      : "unsaved";
  documentState.dirty = documentState.text !== snapshotText;
  documentState.readonly = !result.format.editable;
  documentState.externalChange = "none";
  documentState.externalChangePath = null;
}

export function markSaveFailed(): void {
  if (!documentState.readonly) documentState.saveStatus = "unsaved";
}

/** Устанавливает конфликт с внешним изменением для текущего файла. */
export function markExternalChange(path: string): boolean {
  if (documentState.path === null || !samePath(documentState.path, path)) return false;
  documentState.externalChange = "changed";
  documentState.externalChangePath = path;
  return true;
}

/** Помечает удалённый файл, сохраняя текст и путь для последующего Save. */
export function markFileDeleted(path: string): boolean {
  if (documentState.path === null || !samePath(documentState.path, path)) return false;
  documentState.externalChange = "deleted";
  documentState.externalChangePath = path;
  return true;
}

export function clearExternalChange(): void {
  documentState.externalChange = "none";
  documentState.externalChangePath = null;
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
}
