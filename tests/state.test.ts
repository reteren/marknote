import { vi, describe, expect, it, beforeEach } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import {
  documentState,
  replaceDocument,
  resetDocument,
  setDocumentFormat,
  setDocumentText,
  type OpenedFile,
} from "../src/state/document.svelte";
import { markdownFormat, type FormatCapabilities } from "../src/state/formats.svelte";

function format(overrides: Partial<FormatCapabilities> = {}): FormatCapabilities {
  return {
    ...markdownFormat,
    ...overrides,
  };
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

describe("DocumentState M3.1", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    resetDocument();
  });

  it("starts an untitled document with path === null and Unsaved status", () => {
    resetDocument(markdownFormat, "draft");

    expect(documentState.path).toBeNull();
    expect(documentState.saveStatus).toBe("unsaved");
    expect(documentState.dirty).toBe(true);
    expect(documentState.readonly).toBe(false);
  });

  it("marks non-editable formats as Read-only", () => {
    const pdf = format({ id: "pdf", label: "PDF", editable: false, autosave: false, livePreview: false });
    resetDocument(pdf, "PDF text");

    expect(documentState.text).toBe("PDF text");
    expect(documentState.format).toBe(pdf);
    expect(documentState.readonly).toBe(true);
    expect(documentState.saveStatus).toBe("readonly");
  });

  it("changes only format capabilities without losing text", () => {
    replaceDocument(opened({ text: "preserve me" }));
    const plain = format({
      id: "plain",
      label: "Plain Text",
      defaultExtension: "txt",
      extensions: ["txt"],
      livePreview: false,
    });

    setDocumentFormat(plain);

    expect(documentState.text).toBe("preserve me");
    expect(documentState.format).toBe(plain);
    expect(documentState.format.livePreview).toBe(false);
    expect(documentState.format.autosave).toBe(true);
    expect(documentState.dirty).toBe(true);
    expect(documentState.saveStatus).toBe("unsaved");
  });

  it("recomputes read-only and autosave capabilities when changing type", () => {
    replaceDocument(opened({ text: "content" }));
    const rtf = format({
      id: "rtf",
      label: "Rich Text",
      defaultExtension: "rtf",
      extensions: ["rtf"],
      autosave: false,
      lossy: true,
    });

    setDocumentFormat(rtf);

    expect(documentState.text).toBe("content");
    expect(documentState.format.autosave).toBe(false);
    expect(documentState.format.lossy).toBe(true);
    expect(documentState.readonly).toBe(false);
    expect(documentState.saveStatus).toBe("unsaved");
  });

  it("keeps saved metadata and clears dirty after replacing an opened file", () => {
    replaceDocument(opened({ path: "C:\\work\\readme.md", text: "on disk" }));
    setDocumentText("edited");
    expect(documentState.dirty).toBe(true);

    replaceDocument(opened({ path: "C:\\work\\readme.md", text: "reloaded" }));

    expect(documentState.path).toBe("C:\\work\\readme.md");
    expect(documentState.text).toBe("reloaded");
    expect(documentState.dirty).toBe(false);
    expect(documentState.saveStatus).toBe("saved");
    expect(documentState.externalChange).toBe("none");
  });
});
