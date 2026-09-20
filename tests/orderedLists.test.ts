import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  continueMarkdownList,
  normalizeOrderedLists,
  orderedListNormalization,
  softBreak,
  getMarknoteKeyBindings,
  isListLine,
} from "../src/editor/keymap";
import { buildDecorationSets, decorationRanges } from "../src/editor/livePreview/plugin";

type TestView = Pick<EditorView, "state" | "dispatch">;

function makeView(doc: string, from = 0): TestView {
  let state = EditorState.create({ doc, selection: { anchor: from }, extensions: [markdown()] });
  return {
    get state() {
      return state;
    },
    dispatch(spec) {
      state = state.update(spec).state;
    },
  } as TestView;
}

function binding(key: string) {
  const found = getMarknoteKeyBindings().find((item) => item.key === key);
  if (!found?.run) throw new Error(`No keymap binding for ${key}`);
  return found.run;
}

describe("Obsidian-style ordered lists", () => {
  it("renumbers arbitrary markers in a contiguous list, including nested lists", () => {
    expect(normalizeOrderedLists("1. first\n15. second\n99. third")).toBe("1. first\n2. second\n3. third");
    expect(normalizeOrderedLists("1. outer\n    8. inner\n    99. inner two\n15. outer two")).toBe(
      "1. outer\n    1. inner\n    2. inner two\n2. outer two",
    );
  });

  it("renumbers inserted and deleted items through the document transaction filter", () => {
    let state = EditorState.create({
      doc: "1. first\n2. second",
      extensions: [markdown(), orderedListNormalization],
    });
    const second = state.doc.line(2);
    state = state.update({ changes: { from: second.from, to: second.from, insert: "15. inserted\n" } }).state;
    expect(state.doc.toString()).toBe("1. first\n2. inserted\n3. second");

    const inserted = state.doc.line(2);
    state = state.update({ changes: { from: inserted.from - 1, to: inserted.to } }).state;
    expect(state.doc.toString()).toBe("1. first\n2. second");
  });

  it("continues non-empty items and exits when the item is empty", () => {
    const continued = makeView("1. first", 8);
    expect(continueMarkdownList(continued as EditorView)).toBe(true);
    expect(continued.state.doc.toString()).toBe("1. first\n2. ");

    const parenthesized = makeView("1) first", 8);
    expect(continueMarkdownList(parenthesized as EditorView)).toBe(true);
    expect(parenthesized.state.doc.toString()).toBe("1) first\n2) ");

    const exited = makeView("1. ", 3);
    expect(continueMarkdownList(exited as EditorView)).toBe(true);
    expect(exited.state.doc.toString()).toBe("");
  });

  it("uses Tab and Shift+Tab for nested numbering and resumes the outer level", () => {
    const indented = makeView("1. outer\n9. second", 11);
    expect(binding("Tab")(indented as EditorView)).toBe(true);
    expect(indented.state.doc.toString()).toBe("1. outer\n    1. second");

    const outdented = makeView("1. outer\n    1. child\n9. outer two", 15);
    expect(binding("Shift-Tab")(outdented as EditorView)).toBe(true);
    expect(outdented.state.doc.toString()).toBe("1. outer\n2. child\n3. outer two");
  });

  it("uses Shift+Enter as a soft break without creating another marker", () => {
    const view = makeView("1. same item", 12);
    expect(softBreak(view as EditorView)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. same item\n");
    expect(view.state.selection.main.head).toBe(13);
  });

  it("renumbers only after digit, delimiter, and space are typed, preserving cursor position", () => {
    let state = EditorState.create({
      doc: "1. first\n",
      selection: { anchor: 9 },
      extensions: [markdown(), orderedListNormalization],
    });

    // User types "3"
    state = state.update({
      changes: { from: 9, to: 9, insert: "3" },
      selection: { anchor: 10 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n3");
    expect(state.selection.main.head).toBe(10);

    // User types "." - delimiter typed, but spacing not yet typed: no renumbering
    state = state.update({
      changes: { from: 10, to: 10, insert: "." },
      selection: { anchor: 11 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n3.");
    expect(state.selection.main.head).toBe(11);

    // User types " " - delimiter and spacing complete: renumbers to 2. and preserves cursor
    state = state.update({
      changes: { from: 11, to: 11, insert: " " },
      selection: { anchor: 12 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n2. ");
    expect(state.selection.main.head).toBe(12);

    // User continues typing item content
    state = state.update({
      changes: { from: 12, to: 12, insert: "s" },
      selection: { anchor: 13 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n2. s");
    expect(state.selection.main.head).toBe(13);
  });

  it("renumbers multi-digit markers after space and maps cursor correctly", () => {
    let state = EditorState.create({
      doc: "1. first\n",
      selection: { anchor: 9 },
      extensions: [markdown(), orderedListNormalization],
    });

    state = state.update({
      changes: { from: 9, to: 9, insert: "99." },
      selection: { anchor: 12 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n99.");
    expect(state.selection.main.head).toBe(12);

    // Space completes marker: 99. shrinks to 2.
    state = state.update({
      changes: { from: 12, to: 12, insert: " " },
      selection: { anchor: 13 },
      userEvent: "input.type",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n2. ");
    expect(state.selection.main.head).toBe(12);
  });

  it("undoes Tab indentation on an ordered list item with a single Ctrl+Z", () => {
    let state = EditorState.create({
      doc: "1. first\n2. second",
      selection: { anchor: 11 },
      extensions: [markdown(), history(), orderedListNormalization],
    });

    // Indent second item: becomes sublist item "    1. second"
    state = state.update({
      changes: { from: 9, to: 9, insert: "    " },
      selection: { anchor: 15 },
      userEvent: "input.indent",
    }).state;
    expect(state.doc.toString()).toBe("1. first\n    1. second");

    // Single undo restores the previous state
    let undone = undo({
      state,
      dispatch: (tr) => {
        state = state.update(tr).state;
      },
    });
    expect(undone).toBe(true);
    expect(state.doc.toString()).toBe("1. first\n2. second");
    expect(state.selection.main.head).toBe(11);
  });

  it("starts after one at a heading or blank line and only accepts separated markers", () => {
    expect(normalizeOrderedLists("1. first\n\n15. second\n# Heading\n8. third")).toBe(
      "1. first\n\n1. second\n# Heading\n1. third",
    );
    expect(normalizeOrderedLists("1. first\n9. second\n\n1) third\n9) fourth\n1 plain\n2 plain")).toBe(
      "1. first\n2. second\n\n1) third\n2) fourth\n1 plain\n2 plain",
    );
    expect(isListLine("1.")).toBe(false);
    expect(isListLine("1)")).toBe(false);
    expect(isListLine("1. ")).toBe(true);
    expect(isListLine("1) ")).toBe(true);
    expect(isListLine("1.text")).toBe(false);
    expect(isListLine("1. text")).toBe(true);
    expect(isListLine("1")).toBe(false);
  });

  it("draws a quiet guide beside every line of a nested live-preview list", () => {
    const doc = "1. outer\n    8. inner\n    9. inner two\n2. outer two";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const result = buildDecorationSets(state, [{ from: 0, to: doc.length }]);
    const guides = decorationRanges(result.decorations).filter((range) =>
      range.decoration.spec.class?.includes("cm-marknote-nested-list-line"),
    );
    expect(guides).toHaveLength(2);
    expect(guides.every((range) => range.from === range.to)).toBe(true);
  });

  it("draws an indentation guide beside plain text indented with Tab or 4 spaces", () => {
    const doc = "Plain text\n    123123\n        456456";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const result = buildDecorationSets(state, [{ from: 0, to: doc.length }]);
    const guides = decorationRanges(result.decorations).filter((range) =>
      range.decoration.spec.class?.includes("cm-marknote-nested-list-line"),
    );
    expect(guides).toHaveLength(2);
    expect(guides[0].from).toBe(11); // start of "    123123"
    expect(guides[0].decoration.spec.class).toContain("cm-marknote-nested-list-indent-4");
    expect(guides[1].from).toBe(22); // start of "        456456"
    expect(guides[1].decoration.spec.class).toContain("cm-marknote-nested-list-indent-8");
  });

  it("does not build list guides outside the visible ranges", () => {
    const doc = `1. outer\n${"    1. inner\n".repeat(20)}`;
    const visibleTo = doc.indexOf("\n", doc.indexOf("\n") + 1);
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const result = buildDecorationSets(state, [{ from: 0, to: visibleTo }]);
    const guides = decorationRanges(result.decorations).filter((range) =>
      range.decoration.spec.class?.includes("cm-marknote-nested-list-line"),
    );
    expect(guides).toHaveLength(1);
    expect(guides[0].from).toBeLessThan(visibleTo);
  });
});
