// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undo, redo } from "@codemirror/commands";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { createEditor, setEditorFormat } from "../../src/editor/createEditor";
import { getMarknoteKeyBindings } from "../../src/editor/keymap";
import { createActions } from "../../src/state/actions";
import { documentState, resetDocument } from "../../src/state/document.svelte";
import { markdownFormat, plainFormat, type FormatCapabilities } from "../../src/state/formats.svelte";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const codeFormat: FormatCapabilities = {
  id: "rust",
  label: "Rust",
  defaultExtension: "rs",
  extensions: ["rs"],
  editable: true,
  creatable: true,
  livePreview: false,
  autosave: true,
  lossy: false,
  syntaxMode: "rust",
  template: "fn main() {}\n",
};

describe("Shell-Editor Integration (W50)", () => {
  const views: EditorView[] = [];

  function createTestEditor(
    doc: string,
    format: FormatCapabilities,
    handlers?: ReturnType<typeof createActions>["handlers"],
  ): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = createEditor({
      parent,
      doc,
      format,
      handlers,
      onChange: () => undefined,
      onStats: () => undefined,
    });
    views.push(view);
    return view;
  }

  afterEach(() => {
    while (views.length > 0) views.pop()?.destroy();
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    invoke.mockReset();
    resetDocument(markdownFormat, "");
  });

  it("lets each document choose its own text direction independently of the interface", () => {
    const view = createTestEditor("مرحبا\nHello", markdownFormat);
    expect(view.contentDOM.getAttribute("dir")).toBe("auto");
    expect(getComputedStyle(view.contentDOM).unicodeBidi).toBe("plaintext");
  });

  it("does not highlight the active line in the editor", () => {
    const view = createTestEditor("first line\nsecond line", markdownFormat);
    view.focus();
    expect(view.dom.querySelector(".cm-activeLine")).toBeNull();
  });

  describe("Gap 2: Format switching preserves text, cursor, and undo history", () => {
    it("preserves text, cursor position, and undo/redo stack when switching format via setEditorFormat", async () => {
      const initialText = "fn calculate_total() -> i32 {\n  return 42;\n}\n";
      const view = createTestEditor(initialText, codeFormat);

      // 1. Move cursor inside the function body
      const insertPos = initialText.indexOf("42");
      view.dispatch({ selection: { anchor: insertPos } });
      expect(view.state.selection.main.head).toBe(insertPos);

      // 2. Perform an edit to generate an undo record
      view.dispatch({
        changes: { from: insertPos, to: insertPos, insert: "100 + " },
        selection: { anchor: insertPos + 6 },
      });
      const editedText = "fn calculate_total() -> i32 {\n  return 100 + 42;\n}\n";
      expect(view.state.doc.toString()).toBe(editedText);
      const cursorAfterEdit = insertPos + 6;
      expect(view.state.selection.main.head).toBe(cursorAfterEdit);

      // 3. Switch format using setEditorFormat (as called by handleFormatSelect in App.svelte)
      await setEditorFormat(view, markdownFormat);

      // 4. Verify text and cursor are preserved
      expect(view.state.doc.toString()).toBe(editedText);
      expect(view.state.selection.main.head).toBe(cursorAfterEdit);

      // 5. Verify undo history is completely preserved
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(initialText);

      // 6. Verify redo history is also preserved
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(editedText);
    });

    it("preserves selection range when switching between plain, code, and markdown formats", async () => {
      const text = "Line 1\nSelected line 2\nLine 3\n";
      const view = createTestEditor(text, plainFormat);

      // Select "Selected line 2"
      const from = text.indexOf("Selected line 2");
      const to = from + "Selected line 2".length;
      view.dispatch({ selection: { anchor: from, head: to } });

      // Switch to Markdown
      await setEditorFormat(view, markdownFormat);
      expect(view.state.doc.toString()).toBe(text);
      expect(view.state.selection.main.from).toBe(from);
      expect(view.state.selection.main.to).toBe(to);

      // Switch to Code (Rust)
      await setEditorFormat(view, codeFormat);
      expect(view.state.doc.toString()).toBe(text);
      expect(view.state.selection.main.from).toBe(from);
      expect(view.state.selection.main.to).toBe(to);
    });
  });

  describe("Gap 1: Hotkeys in editor dispatch to shell actions (Ctrl+S vs File ▸ Save)", () => {
    it("triggers the exact same save operation on Ctrl+S as File ▸ Save", async () => {
      let currentView: EditorView | null = null;
      const flushMock = vi.fn().mockResolvedValue({
        path: "C:/notes/test.md",
        savedAt: "2026-09-15T01:00:00.000Z",
        format: markdownFormat,
      });

      const actions = createActions({
        getEditorView: () => currentView,
        autosave: { flush: flushMock },
        notify: vi.fn(),
      });

      currentView = createTestEditor("Document content", markdownFormat, actions.handlers);

      // Simulate document loaded with a path
      documentState.path = "C:/notes/test.md";
      documentState.text = "Document content";
      documentState.dirty = true;

      // Locate Mod-s binding created with editor's handlers
      const bindings = getMarknoteKeyBindings({ handlers: actions.handlers });
      const saveBinding = bindings.find((item: KeyBinding) => item.key === "Mod-s");
      expect(saveBinding).toBeDefined();
      expect(typeof saveBinding?.run).toBe("function");

      // 1. Trigger Ctrl+S in editor
      const handled = saveBinding!.run!(currentView);
      expect(handled).toBe(true);
      expect(flushMock).toHaveBeenCalledTimes(1);
      expect(flushMock).toHaveBeenCalledWith(true);

      // 2. Trigger File ▸ Save (menu action calls actions.save() or onSave())
      await actions.save(currentView);
      expect(flushMock).toHaveBeenCalledTimes(2);
      expect(flushMock).toHaveBeenLastCalledWith(true);
    });

    it("wires all 6 required shell hotkeys from editor keymap to actions.handlers", () => {
      let currentView: EditorView | null = null;
      const mockCloseWindow = vi.fn();
      const mockChooseFormat = vi.fn().mockResolvedValue("rust");

      const actions = createActions({
        getEditorView: () => currentView,
        dialogs: { chooseFormat: mockChooseFormat },
        closeWindow: mockCloseWindow,
        getFormats: () => [markdownFormat, plainFormat, codeFormat],
        notify: vi.fn(),
      });

      currentView = createTestEditor("hello", markdownFormat, actions.handlers);
      const bindings = getMarknoteKeyBindings({ handlers: actions.handlers });

      // Verify all 6 hotkeys exist in the editor bindings:
      // Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+W, Ctrl+Shift+S, Ctrl+Shift+N
      const requiredKeys = [
        "Mod-s",
        "Mod-o",
        "Mod-n",
        "Mod-w",
        "Mod-Shift-s",
        "Mod-Shift-n",
      ];

      for (const key of requiredKeys) {
        const binding = bindings.find((b) => b.key === key);
        expect(binding, `Missing editor binding for ${key}`).toBeDefined();
        expect(typeof binding?.run).toBe("function");
      }

      // Test Ctrl+W dispatches to closeWindow
      const closeBinding = bindings.find((b) => b.key === "Mod-w");
      expect(closeBinding?.run!(currentView)).toBe(true);
      expect(mockCloseWindow).toHaveBeenCalledOnce();
    });
  });
});
