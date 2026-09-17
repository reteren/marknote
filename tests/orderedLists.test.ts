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
  });

  it("starts after one at a heading or blank line and only accepts separated markers", () => {
    expect(normalizeOrderedLists("1. first\n\n15. second\n# Heading\n8. third")).toBe(
      "1. first\n\n1. second\n# Heading\n1. third",
    );
    expect(normalizeOrderedLists("1. first\n9. second\n\n1) third\n9) fourth\n1 plain\n2 plain")).toBe(
      "1. first\n2. second\n\n1) third\n2) fourth\n1 plain\n2 plain",
    );
    expect(isListLine("1.")).toBe(true);
    expect(isListLine("1)")).toBe(true);
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
});
