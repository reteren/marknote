// @vitest-environment jsdom

import { language } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, setEditorDocumentFormat } from "../src/editor/createEditor";
import type { FormatCapabilities } from "../src/state/formats.svelte";

const syntaxModes = [
  "yaml",
  "toml",
  "html",
  "xml",
  "css",
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "c",
  "cpp",
  "shell",
  "json",
] as const;

const views: EditorView[] = [];

function format(overrides: Partial<FormatCapabilities> = {}): FormatCapabilities {
  return {
    id: "test",
    label: "Test",
    defaultExtension: "txt",
    extensions: ["txt"],
    editable: true,
    creatable: true,
    livePreview: false,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
    ...overrides,
  };
}

function editor(doc: string, documentFormat: FormatCapabilities): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = createEditor({
    parent,
    doc,
    format: documentFormat,
    onChange: () => undefined,
    onStats: () => undefined,
  });
  views.push(view);
  return view;
}

async function waitForLanguage(view: EditorView): Promise<void> {
  await vi.waitFor(() => {
    expect(view.state.facet(language)).not.toBeNull();
  }, { timeout: 5_000, interval: 10 });
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("format syntax modes", () => {
  it.each(syntaxModes)("loads the restricted language support for %s", async (syntaxMode) => {
    const view = editor("value: 1\n", format({ id: syntaxMode, syntaxMode }));

    // The document is available synchronously; language loading is deferred.
    expect(view.state.doc.toString()).toBe("value: 1\n");
    await waitForLanguage(view);
  });

  it("leaves unknown syntax modes as plain text without throwing", async () => {
    expect(() => editor("opaque", format({ id: "unknown", syntaxMode: "not-a-language" }))).not.toThrow();
    await Promise.resolve();
    expect(views[0]!.state.facet(language)).toBeNull();
  });

  it("uses Markdown and live preview for a live-preview format", () => {
    const view = editor("# heading\n", format({
      id: "markdown",
      syntaxMode: null,
      livePreview: true,
    }));

    expect(view.state.facet(language)?.name).toBe("markdown");
  });

  it("changes format through a compartment without losing text, cursor, or undo history", async () => {
    const view = editor("const value = 1", format({ id: "markdown", livePreview: true }));
    view.dispatch({ selection: { anchor: 6 } });
    view.dispatch({ changes: { from: 6, to: 6, insert: "X" } });
    const expectedText = view.state.doc.toString();
    const expectedCursor = view.state.selection.main.head;

    setEditorDocumentFormat(view, format({ id: "javascript", syntaxMode: "javascript" }));

    expect(view.state.doc.toString()).toBe(expectedText);
    expect(view.state.selection.main.head).toBe(expectedCursor);
    await waitForLanguage(view);
    expect(view.state.doc.toString()).toBe(expectedText);
    expect(view.state.selection.main.head).toBe(expectedCursor);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("const value = 1");
  });
});
