import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  continueMarkdownList,
  getMarknoteKeyBindings,
  isTableContext,
  marknoteKeyBindings,
  physicalShortcutName,
} from "../src/editor/keymap";

type TestView = Pick<EditorView, "state" | "dispatch">;

function makeView(doc: string, from = 0, to = from, extra: Extension[] = []): TestView {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [markdown(), ...extra],
  });
  return {
    get state() {
      return state;
    },
    dispatch(spec) {
      state = state.update(spec).state;
    },
    lineWrapping: false,
    moveVertically: (range: unknown) => range,
  } as TestView;
}

function binding(key: string, bindings: readonly KeyBinding[] = marknoteKeyBindings): KeyBinding {
  const found = bindings.find((item) => item.key === key);
  if (!found?.run) throw new Error(`No keymap binding for ${key}`);
  return found;
}

function run(key: string, view: TestView, bindings: readonly KeyBinding[] = marknoteKeyBindings): boolean {
  return binding(key, bindings).run!(view as EditorView);
}

describe("MarkNote editor keymap", () => {
  it("supports unlimited undo plus both documented redo shortcuts", () => {
    const undone = makeView("one", 3, 3, [history()]);
    undone.dispatch({ changes: { from: 3, to: 3, insert: "!" } });
    expect(run("Mod-z", undone)).toBe(true);
    expect(undone.state.doc.toString()).toBe("one");
    expect(run("Mod-y", undone)).toBe(true);
    expect(undone.state.doc.toString()).toBe("one!");
    expect(run("Mod-z", undone)).toBe(true);
    expect(run("Mod-Shift-z", undone)).toBe(true);
    expect(undone.state.doc.toString()).toBe("one!");
  });

  it("indents a list item with Tab and uses four spaces outside a list", () => {
    const list = makeView("- item", 2);
    expect(run("Tab", list)).toBe(true);
    expect(list.state.doc.toString()).toBe("    - item");

    const prose = makeView("text", 2);
    expect(run("Tab", prose)).toBe(true);
    expect(prose.state.doc.toString()).toBe("te    xt");
  });

  it("outdents a list item with Shift-Tab", () => {
    const view = makeView("    - item", 6);
    expect(run("Shift-Tab", view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("continues a non-empty list and exits on an empty list item", () => {
    const continued = makeView("- first", 7);
    expect(run("Enter", continued)).toBe(true);
    expect(continued.state.doc.toString()).toBe("- first\n- ");

    const exited = makeView("- ", 2);
    expect(run("Enter", exited)).toBe(true);
    expect(exited.state.doc.toString()).toBe("");
  });

  it("keeps Tab available to tableKeymap inside a Markdown table", () => {
    const view = makeView("| Name | Value |\n| --- | --- |\n| A | B |", 29);
    expect(isTableContext(view.state, view.state.selection.main.head)).toBe(true);
    expect(run("Tab", view)).toBe(false);
    expect(view.state.doc.toString()).toBe("| Name | Value |\n| --- | --- |\n| A | B |");
  });

  it.each([
    ["Mod-b", "**", "**"],
    ["Mod-i", "*", "*"],
    ["Mod-e", "`", "`"],
  ])("wraps and unwraps selected text with %s", (key, open, close) => {
    const view = makeView("word", 0, 4);
    expect(run(key, view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${open}word${close}`);
    expect(run(key, view)).toBe(true);
    expect(view.state.doc.toString()).toBe("word");
  });

  it("removes bold markers when the selection includes both markers", () => {
    const view = makeView("**word**", 0, 8);
    expect(run("Mod-b", view)).toBe(true);
    expect(view.state.doc.toString()).toBe("word");
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(4);
  });

  it("supports the remaining local formatting shortcuts", () => {
    const link = makeView("docs", 0, 4);
    expect(run("Mod-k", link)).toBe(true);
    expect(link.state.doc.toString()).toBe("[docs](url)");

    for (let level = 1; level <= 6; level += 1) {
      const heading = makeView("title", 0);
      expect(run(`Mod-${level}`, heading)).toBe(true);
      expect(heading.state.doc.toString()).toBe(`${"#".repeat(level)} title`);
      expect(run("Mod-0", heading)).toBe(true);
      expect(heading.state.doc.toString()).toBe("title");
    }

    const codeBlock = makeView("const x = 1", 0, 11);
    expect(run("Mod-Shift-k", codeBlock)).toBe(true);
    expect(codeBlock.state.doc.toString()).toBe("```\nconst x = 1\n```");
  });

  it("binds delete-line and move-line commands", () => {
    const deleted = makeView("one\ntwo", 5);
    expect(run("Mod-d", deleted)).toBe(true);
    expect(deleted.state.doc.toString()).toBe("one");

    const movedUp = makeView("one\ntwo", 5);
    expect(run("Alt-ArrowUp", movedUp)).toBe(true);
    expect(movedUp.state.doc.toString()).toBe("two\none");

    const movedDown = makeView("one\ntwo", 1);
    expect(run("Alt-ArrowDown", movedDown)).toBe(true);
    expect(movedDown.state.doc.toString()).toBe("two\none");
  });

  it("uses physical key codes for shortcuts on Cyrillic layouts", () => {
    expect(physicalShortcutName({ code: "KeyB", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("Mod-b");
    expect(physicalShortcutName({ code: "KeyZ", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("Mod-z");
    expect(physicalShortcutName({ code: "Equal", ctrlKey: true, metaKey: false, shiftKey: true })).toBe("Mod-+");
    expect(physicalShortcutName({ code: "KeyB", ctrlKey: false, metaKey: false, shiftKey: false })).toBe(null);
  });

  it("does not claim search shortcuts unless the shell supplies handlers", () => {
    expect(marknoteKeyBindings.some((item) => item.key === "Mod-f")).toBe(false);
    expect(marknoteKeyBindings.some((item) => item.key === "Mod-h")).toBe(false);
    expect(marknoteKeyBindings.some((item) => item.key === "F3")).toBe(false);

    const openSearch = vi.fn(() => true);
    const bindings = getMarknoteKeyBindings({ handlers: { openSearch } });
    const view = makeView("");
    expect(run("Mod-f", view, bindings)).toBe(true);
    expect(openSearch).toHaveBeenCalledOnce();
  });

  it("covers the documented shell shortcuts through explicit extension points", () => {
    const handler = () => {
      const fn = vi.fn(() => true);
      return fn;
    };
    const handlers = {
      newDocument: handler(),
      newDocumentWithPicker: handler(),
      openFile: handler(),
      save: handler(),
      saveAs: handler(),
      closeWindow: handler(),
      openSearch: handler(),
      openReplace: handler(),
      goToLine: handler(),
      zoomIn: handler(),
      zoomOut: handler(),
      resetZoom: handler(),
    };
    for (const key of ["Mod-n", "Mod-Shift-n", "Mod-o", "Mod-s", "Mod-Shift-s", "Mod-w", "Mod-f", "Mod-h", "Mod-g", "Mod-+", "Mod-=", "Mod--", "Mod-0"]) {
      expect(getMarknoteKeyBindings({ handlers }).some((item) => item.key === key)).toBe(true);
    }

    const resetZoom = handlers.resetZoom;
    const injectedBindings = getMarknoteKeyBindings({ handlers });
    const ordinaryText = makeView("text");
    const resetBindings = injectedBindings.filter((item) => item.key === "Mod-0");
    expect(resetBindings).toHaveLength(2);
    expect(resetBindings[1]?.run?.(ordinaryText as EditorView)).toBe(true);
    expect(resetZoom).toHaveBeenCalledOnce();
    const heading = makeView("## title");
    expect(run("Mod-0", heading, getMarknoteKeyBindings({ handlers }))).toBe(true);
    expect(heading.state.doc.toString()).toBe("title");
    expect(resetZoom).toHaveBeenCalledOnce();
  });

  it("retains CodeMirror base editing and document navigation bindings", () => {
    const keys = new Set([...historyKeymap, ...defaultKeymap].map((item) => item.key));
    for (const key of ["Mod-z", "Mod-y", "Mod-a", "Mod-Home", "Mod-End"]) {
      expect(keys.has(key)).toBe(true);
    }
    expect(marknoteKeyBindings.some((item) => item.key === "Mod-Shift-z")).toBe(true);
    expect(marknoteKeyBindings.some((item) => item.key === "Mod-Shift-v")).toBe(true);
    expect(marknoteKeyBindings.some((item) => item.key === "Mod-e")).toBe(true);
    expect(keys.has("Mod-e")).toBe(false);
  });

  it("keeps list Enter command available as a direct CodeMirror command", () => {
    const view = makeView("* ", 2);
    expect(continueMarkdownList(view as EditorView)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });
});
