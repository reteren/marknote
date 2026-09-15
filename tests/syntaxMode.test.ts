// @vitest-environment jsdom

import { language } from "@codemirror/language";
import { undo, redo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditor,
  setEditorFormat,
  setEditorDocumentFormat,
  findLanguageDescription,
  SYNTAX_MODE_MAP,
} from "../src/editor/createEditor";
import type { FormatCapabilities } from "../src/state/formats.svelte";

/** Все 14 syntaxMode из src-tauri/src/formats/code.rs */
const codeRsSyntaxModes = [
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

async function waitForLanguage(view: EditorView, expectedName?: string): Promise<void> {
  await vi.waitFor(() => {
    const current = view.state.facet(language);
    expect(current).not.toBeNull();
    if (expectedName) {
      expect(current?.name).toBe(expectedName);
    }
  }, { timeout: 5_000, interval: 10 });
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("format syntax modes mapping (@codemirror/language-data)", () => {
  it.each(codeRsSyntaxModes)("maps code.rs syntax_mode '%s' to a valid LanguageDescription", (mode) => {
    const desc = findLanguageDescription(mode);
    expect(desc).not.toBeNull();
    expect(desc?.name).toBeDefined();
  });

  it("maps jsonc to JSON language description", () => {
    const desc = findLanguageDescription("jsonc");
    expect(desc).not.toBeNull();
    expect(desc?.name).toBe("JSON");
  });

  it.each([
    ["yml", "YAML"],
    ["js", "JavaScript"],
    ["ts", "TypeScript"],
    ["py", "Python"],
    ["rs", "Rust"],
    ["c++", "C++"],
    ["sh", "Shell"],
    ["bash", "Shell"],
  ])("maps alias '%s' to '%s'", (alias, expectedName) => {
    const desc = findLanguageDescription(alias);
    expect(desc).not.toBeNull();
    expect(desc?.name).toBe(expectedName);
  });

  it("returns null for plain text, empty or unknown syntax modes", () => {
    expect(findLanguageDescription(null)).toBeNull();
    expect(findLanguageDescription(undefined)).toBeNull();
    expect(findLanguageDescription("")).toBeNull();
    expect(findLanguageDescription("   ")).toBeNull();
    expect(findLanguageDescription("plain")).toBeNull();
    expect(findLanguageDescription("text")).toBeNull();
    expect(findLanguageDescription("txt")).toBeNull();
    expect(findLanguageDescription("unknown-syntax-xyz")).toBeNull();
  });

  it("exports complete SYNTAX_MODE_MAP containing code.rs modes", () => {
    expect(SYNTAX_MODE_MAP).toBeDefined();
    for (const mode of codeRsSyntaxModes) {
      expect(SYNTAX_MODE_MAP[mode]).toBeDefined();
    }
    expect(SYNTAX_MODE_MAP.jsonc).toBe("json");
  });
});

describe("createEditor with syntax modes", () => {
  it.each(codeRsSyntaxModes)("loads the language support for %s", async (syntaxMode) => {
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
});

describe("setEditorFormat and Compartment dynamic reconfiguration", () => {
  it("exports setEditorFormat and setEditorDocumentFormat alias", () => {
    expect(typeof setEditorFormat).toBe("function");
    expect(setEditorDocumentFormat).toBe(setEditorFormat);
  });

  it("changes format through a compartment without losing text, cursor, or undo history", async () => {
    const view = editor("const value = 1", format({ id: "markdown", livePreview: true }));
    view.dispatch({ selection: { anchor: 6 } });
    view.dispatch({ changes: { from: 6, to: 6, insert: "X" } });
    const expectedText = view.state.doc.toString();
    const expectedCursor = view.state.selection.main.head;

    setEditorFormat(view, format({ id: "javascript", syntaxMode: "javascript" }));

    expect(view.state.doc.toString()).toBe(expectedText);
    expect(view.state.selection.main.head).toBe(expectedCursor);
    await waitForLanguage(view, "javascript");
    expect(view.state.doc.toString()).toBe(expectedText);
    expect(view.state.selection.main.head).toBe(expectedCursor);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("const value = 1");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expectedText);
  });

  it("switches from code format to plain text without crashing and clears language", async () => {
    const view = editor("def foo(): pass", format({ id: "python", syntaxMode: "python" }));
    await waitForLanguage(view, "python");

    setEditorFormat(view, format({ id: "plain", syntaxMode: null, livePreview: false }));
    expect(view.state.doc.toString()).toBe("def foo(): pass");
    expect(view.state.facet(language)).toBeNull();
  });

  it("switches between multiple languages in sequence preserving edits", async () => {
    const view = editor("let x = 10;", format({ id: "rust", syntaxMode: "rust" }));
    await waitForLanguage(view, "rust");

    view.dispatch({ changes: { from: 11, to: 11, insert: " // added" } });
    expect(view.state.doc.toString()).toBe("let x = 10; // added");

    await setEditorFormat(view, format({ id: "python", syntaxMode: "python" }));
    await waitForLanguage(view, "python");
    expect(view.state.doc.toString()).toBe("let x = 10; // added");

    await setEditorFormat(view, format({ id: "markdown", livePreview: true, syntaxMode: null }));
    expect(view.state.facet(language)?.name).toBe("markdown");
    expect(view.state.doc.toString()).toBe("let x = 10; // added");

    // Verify undo still works across multiple format changes
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("let x = 10;");
  });
});
