import { defineLanguageFacet, Language } from "@codemirror/language";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import {
  Direction,
  EditorView,
} from "@codemirror/view";
import {
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
} from "@codemirror/commands";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { buildDecorationSets, decorationRanges } from "../src/editor/livePreview/plugin";
import { isNodeActive } from "../src/editor/livePreview/isNodeActive";
import { syntaxTree } from "@codemirror/language";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

function state(doc: string, anchor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: language.extension,
  });
}

/**
 * The movement commands are view commands, but their document/selection work
 * is entirely state based. This tiny view adapter lets the tests exercise the
 * real CodeMirror commands in Vitest's DOM-free environment.
 */
function commandView(initial: EditorState): EditorView & { current: EditorState } {
  const view = {
    current: initial,
    get state() {
      return view.current;
    },
    dispatch(transaction: Transaction) {
      view.current = transaction.state;
    },
    textDirectionAt: () => Direction.LTR,
    lineBlockAt: (pos: number) => view.current.doc.lineAt(pos),
    moveToLineBoundary: (range: EditorSelection["main"], forward: boolean) => {
      const line = view.current.doc.lineAt(range.head);
      return EditorSelection.cursor(forward ? line.to : line.from);
    },
    moveByGroup: (range: EditorSelection["main"], forward: boolean) => {
      const line = view.current.doc.lineAt(range.head);
      const categorize = view.current.charCategorizer(range.head);
      let pos = range.head;
      if (forward) {
        const first = view.current.sliceDoc(pos, Math.min(pos + 1, line.to));
        if (!first) return EditorSelection.cursor(pos);
        let category = categorize(first);
        while (pos < line.to) {
          const next = view.current.sliceDoc(pos, pos + 1);
          const nextCategory = categorize(next);
          if (category === 0) category = nextCategory;
          if (category !== nextCategory) break;
          pos++;
        }
      } else {
        const first = view.current.sliceDoc(Math.max(line.from, pos - 1), pos);
        if (!first) return EditorSelection.cursor(pos);
        let category = categorize(first);
        while (pos > line.from) {
          const previous = view.current.sliceDoc(pos - 1, pos);
          const previousCategory = categorize(previous);
          if (category === 0) category = previousCategory;
          if (category !== previousCategory) break;
          pos--;
        }
      }
      return EditorSelection.cursor(pos);
    },
  } as unknown as EditorView & { current: EditorState };
  return view;
}

describe("live preview M2.5 polish", () => {
  it("keeps the document cursor position while a strong node reveals and hides", () => {
    const doc = "prefix **bold** suffix";
    const cursor = doc.indexOf("bold") + 2;
    const activeState = state(doc, cursor);
    const node = syntaxTree(activeState).topNode.getChild("Paragraph")!.getChild("StrongEmphasis")!;

    const active = buildDecorationSets(activeState, [{ from: 0, to: doc.length }]);
    expect(isNodeActive(node, activeState.selection, activeState.doc)).toBe(true);
    expect(activeState.selection.main.head).toBe(cursor);
    expect(decorationRanges(active.decorations).some(({ from, to }) => from === node.from && to === node.from + 2)).toBe(false);

    const inactiveState = activeState.update({ selection: { anchor: 0 } }).state;
    const inactive = buildDecorationSets(inactiveState, [{ from: 0, to: doc.length }]);
    expect(inactiveState.selection.main.head).toBe(0);
    expect(decorationRanges(inactive.decorations).some(({ from, to }) => from === node.from && to === node.from + 2)).toBe(true);
  });

  it("keeps a selection intact when it crosses hidden syntax markers", () => {
    const doc = "before **bold** after";
    const from = doc.indexOf("before");
    const to = doc.indexOf("after") + "after".length;
    const current = state(doc).update({ selection: EditorSelection.range(from, to) }).state;
    const result = buildDecorationSets(current, [{ from: 0, to: doc.length }]);

    expect(current.selection.main.from).toBe(from);
    expect(current.selection.main.to).toBe(to);
    // The intersecting selection reveals the whole node, so the mouse-like
    // range is not split by either marker.
    expect(decorationRanges(result.decorations).some(({ from: start, to: end }) => start === 7 && end === 9)).toBe(false);
    expect(decorationRanges(result.decorations).some(({ from: start, to: end }) => start === 13 && end === 15)).toBe(false);
  });

  it("uses CodeMirror Home, End, and Ctrl-arrow commands on the source state", () => {
    const doc = "prefix **bold** suffix";
    const cursor = doc.indexOf("bold") + 1;
    const view = commandView(state(doc, cursor));
    const hidden = buildDecorationSets(state(doc), [{ from: 0, to: doc.length }]);
    expect(hidden.atomicRanges.size).toBeGreaterThan(0);

    expect(cursorLineBoundaryBackward(view)).toBe(true);
    expect(view.current.selection.main.head).toBe(0);
    view.current = view.current.update({ selection: { anchor: cursor } }).state;
    expect(cursorLineBoundaryForward(view)).toBe(true);
    expect(view.current.selection.main.head).toBe(doc.length);

    view.current = view.current.update({ selection: { anchor: cursor } }).state;
    expect(cursorGroupLeft(view)).toBe(true);
    expect(view.current.selection.main.head).toBeLessThan(cursor);
    view.current = view.current.update({ selection: { anchor: cursor } }).state;
    expect(cursorGroupRight(view)).toBe(true);
    expect(view.current.selection.main.head).toBeGreaterThan(cursor);

    // The command transactions change only selection; the source document and
    // its hidden-marker positions remain stable.
    expect(view.current.doc.toString()).toBe(doc);
  });
});
