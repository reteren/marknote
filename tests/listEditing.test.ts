import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  continueMarkdownList,
  removeIndentUnit,
  shiftIndentation,
  softBreak,
} from "../src/editor/listCommands";

type TestView = Pick<EditorView, "state" | "dispatch">;

/** `|` marks the caret; `«` and `»` mark a selection. */
function makeView(marked: string, unit = "    "): TestView {
  const caret = marked.indexOf("|");
  const open = marked.indexOf("«");
  const doc = marked.replace(/[|«»]/gu, "");
  const selection = caret >= 0
    ? { anchor: caret }
    : { anchor: open, head: marked.indexOf("»") - 1 };
  let state = EditorState.create({
    doc,
    selection,
    extensions: [markdown(), history(), indentUnit.of(unit), EditorState.tabSize.of(4)],
  });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as TestView;
}

/** The document with `|` at the caret. */
function show(view: TestView): string {
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return doc.slice(0, head) + "|" + doc.slice(head);
}

const run = (command: (view: EditorView) => boolean, view: TestView) => command(view as EditorView);
const tab = (view: TestView) => run((v) => shiftIndentation(v, 1), view);
const shiftTab = (view: TestView) => run((v) => shiftIndentation(v, -1), view);
const enter = (view: TestView) => run(continueMarkdownList, view);
const shiftEnter = (view: TestView) => run(softBreak, view);
const backspace = (view: TestView) => run(removeIndentUnit, view);

function type(view: TestView, text: string): void {
  for (const character of text) {
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: character }, selection: { anchor: head + 1 }, userEvent: "input.type" });
  }
}

describe("R1 Tab indents the whole line, wherever the caret is", () => {
  it("adds one unit at the line start and keeps the caret in the text", () => {
    const view = makeView("some| text");
    tab(view);
    expect(show(view)).toBe("    some| text");
    tab(view);
    expect(show(view)).toBe("        some| text");
    shiftTab(view);
    expect(show(view)).toBe("    some| text");
  });

  it("indents an empty line and keeps a caret at the line start with the text", () => {
    const empty = makeView("|");
    tab(empty);
    expect(show(empty)).toBe("    |");
    const start = makeView("|word");
    tab(start);
    expect(show(start)).toBe("    |word");
  });

  it("uses the configured unit, a tab character included", () => {
    const view = makeView("te|xt", "\t");
    tab(view);
    expect(show(view)).toBe("\tte|xt");
    shiftTab(view);
    expect(show(view)).toBe("te|xt");
  });

  it("indents every line a selection touches, skipping blank ones", () => {
    const view = makeView("«one\n\ntwo»");
    tab(view);
    expect(view.state.doc.toString()).toBe("    one\n\n    two");
  });

  it("is undone by a single undo", () => {
    let state = EditorState.create({ doc: "1. a\n2. b", selection: { anchor: 8 }, extensions: [markdown(), history(), indentUnit.of("    ")] });
    const view = {
      get state() { return state; },
      dispatch(...specs: TransactionSpec[]) { state = state.update(...specs).state; },
    } as TestView;
    tab(view);
    expect(state.doc.toString()).toBe("1. a\n    1. b");
    undo({ state, dispatch: (tr) => { state = tr.state; } });
    expect(state.doc.toString()).toBe("1. a\n2. b");
  });
});

describe("R3 typed numbers are never rewritten", () => {
  it("keeps a number typed under a Tab-indented line", () => {
    const view = makeView("1. a|");
    enter(view);
    expect(show(view)).toBe("1. a\n2. |");
    tab(view);
    expect(show(view)).toBe("1. a\n    1. |");
    // Replace the suggested number by hand.
    view.dispatch({ changes: { from: 9, to: 10, insert: "6" } });
    type(view, "x");
    expect(view.state.doc.toString()).toBe("1. a\n    6. x");
  });

  it("keeps any number typed at the start of a line", () => {
    for (const before of ["", "debug:\n", "text\n\n", "1. a\n2. b\n", "1. a\n2. b\n\n"]) {
      const view = makeView(before + "|");
      type(view, "6. x");
      expect(view.state.doc.toString()).toBe(before + "6. x");
    }
  });
});

describe("R4/R5 Enter in a list", () => {
  it("continues with the next number, the same bullet or a fresh task", () => {
    const ordered = makeView("8. x|");
    enter(ordered);
    expect(show(ordered)).toBe("8. x\n9. |");
    const bullet = makeView("- x|");
    enter(bullet);
    expect(show(bullet)).toBe("- x\n- |");
    const task = makeView("- [x] done|");
    enter(task);
    expect(show(task)).toBe("- [x] done\n- [ ] |");
    const paren = makeView("3) x|");
    enter(paren);
    expect(show(paren)).toBe("3) x\n4) |");
  });

  it("splits an item at the caret", () => {
    const view = makeView("1. ab|cd");
    enter(view);
    expect(show(view)).toBe("1. ab\n2. |cd");
  });

  it("shifts the following items only while they were consecutive", () => {
    const view = makeView("1. a|\n2. b\n3. c\n7. d");
    enter(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. \n3. b\n4. c\n7. d");
  });

  it("removes an empty top-level item entirely", () => {
    const view = makeView("8. x\n9. |");
    enter(view);
    expect(show(view)).toBe("8. x\n|");
  });

  it("moves an empty nested item out one level", () => {
    const view = makeView("1. a\n    1. b\n    2. |");
    enter(view);
    expect(show(view)).toBe("1. a\n    1. b\n2. |");
  });
});

describe("R6/R7 Shift+Enter and Enter on indented lines", () => {
  it("continues an item one full unit deeper without a marker, and Enter keeps that depth", () => {
    const view = makeView("8. x|");
    shiftEnter(view);
    expect(show(view)).toBe("8. x\n    |");
    type(view, "cont");
    enter(view);
    expect(show(view)).toBe("8. x\n    cont\n    |");
    type(view, "more");
    shiftEnter(view);
    expect(show(view)).toBe("8. x\n    cont\n    more\n    |");
  });

  it("goes one unit under a nested item", () => {
    const view = makeView("1. a\n    1. b|");
    shiftEnter(view);
    expect(show(view)).toBe("1. a\n    1. b\n        |");
  });

  it("keeps the current indentation outside lists", () => {
    const view = makeView("    plain|");
    shiftEnter(view);
    expect(show(view)).toBe("    plain\n    |");
  });
});

describe("R8 Tab and Shift+Tab on list items", () => {
  it("opens a nested list at 1 and closes the gap in the outer list", () => {
    const view = makeView("1. a\n2. b|\n3. c");
    tab(view);
    expect(view.state.doc.toString()).toBe("1. a\n    1. b\n2. c");
  });

  it("continues an existing nested list", () => {
    const view = makeView("1. a\n    1. x\n2. b|");
    tab(view);
    expect(view.state.doc.toString()).toBe("1. a\n    1. x\n    2. b");
  });

  it("moves an item back out after its parent and renumbers the outer list", () => {
    const view = makeView("1. a\n    1. b|\n2. c");
    shiftTab(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. b\n3. c");
  });
});

describe("R9 Backspace at the start of indented text", () => {
  it("removes one unit per press", () => {
    const view = makeView("        |text");
    expect(backspace(view)).toBe(true);
    expect(show(view)).toBe("    |text");
    expect(backspace(view)).toBe(true);
    expect(show(view)).toBe("|text");
    expect(backspace(view)).toBe(false);
  });

  it("leaves ordinary Backspace alone inside the text or with a selection", () => {
    expect(backspace(makeView("    te|xt"))).toBe(false);
    expect(backspace(makeView("«    text»"))).toBe(false);
  });
});
