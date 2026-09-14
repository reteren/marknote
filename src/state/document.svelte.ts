import type { FormatCapabilities } from "./formats.svelte";
import { markdownFormat } from "./formats.svelte";

export type LineEnding = "lf" | "crlf";
export type SaveStatus = "unsaved" | "pending" | "saved" | "readonly";

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
});

export function replaceDocument(opened: OpenedFile): void {
  documentState.path = opened.path;
  documentState.format = opened.format;
  documentState.saveStatus = opened.readonly ? "readonly" : "saved";
  documentState.lastSavedAt = null;
  documentState.encoding = opened.encoding;
  documentState.bom = opened.bom;
  documentState.lineEnding = opened.lineEnding;
  documentState.text = opened.text;
  documentState.dirty = false;
  documentState.readonly = opened.readonly;
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
  documentState.readonly = false;
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
  documentState.saveStatus = documentState.text === snapshotText ? "saved" : "unsaved";
  documentState.dirty = documentState.text !== snapshotText;
  documentState.readonly = false;
}

export function markSaveFailed(): void {
  if (!documentState.readonly) documentState.saveStatus = "unsaved";
}
