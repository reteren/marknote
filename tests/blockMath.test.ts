// A `$$ … $$` block spans multiple lines, and a replacement for that range is
// forbidden from a view plugin: CodeMirror throws RangeError and stops updating
// the editor, freezing the document with a raw formula. These checks preserve
// the split: a multiline block is rendered by a state field, a single-line one
// by the plugin, and neither returns a forbidden replacement.

import { defineLanguageFacet, Language } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { describe, expect, it, vi } from "vitest";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { blockMathDecorations } from "../src/editor/livePreview/blockMath";
import { buildDecorationSets, decorationRanges } from "../src/editor/livePreview/plugin";
import { livePreviewSettings } from "../src/editor/livePreview/settings";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

function state(doc: string, anchor = 0, settings?: Parameters<typeof livePreviewSettings>[0]) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: [language.extension, livePreviewSettings(settings)],
  });
}

function replacementsCrossingLineBreak(editorState: EditorState) {
  const { decorations } = buildDecorationSets(editorState, [{ from: 0, to: editorState.doc.length }]);
  return decorationRanges(decorations).filter((range) => {
    if (range.decoration.spec.widget === undefined && !range.decoration.spec.block) return false;
    const text = editorState.doc.sliceString(range.from, range.to);
    return text.includes("\n");
  });
}

function fieldRanges(editorState: EditorState) {
  const ranges: Array<{ from: number; to: number }> = [];
  blockMathDecorations(editorState).between(0, editorState.doc.length, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}

describe("formula block", () => {
  const doc = "text\n\n$$\nx^2\n$$\n\nafter";
  const cursorAfter = doc.length;

  it("is rendered by a state field, while the plugin returns no line-break replacement", () => {
    const editorState = state(doc, cursorAfter);
    expect(fieldRanges(editorState)).toEqual([{ from: 6, to: 15 }]);
    expect(replacementsCrossingLineBreak(editorState)).toEqual([]);
  });

  it("returns no replacement for an unclosed block while it is being typed", () => {
    // `$$` + line break: this exact combination used to crash the editor.
    for (const unfinished of ["$$\n", "$$\nx^2\n", "text\n\n$$\n"]) {
      const editorState = state(unfinished, unfinished.length);
      expect(replacementsCrossingLineBreak(editorState)).toEqual([]);
    }
  });

  it("reveals markup while the cursor is on any of its lines", () => {
    for (const anchor of [6, 9, 12, 15]) {
      expect(fieldRanges(state(doc, anchor))).toEqual([]);
    }
  });

  it("is silent when preview or formulas are disabled", () => {
    expect(fieldRanges(state(doc, cursorAfter, { renderFormulas: false }))).toEqual([]);
    expect(fieldRanges(state(doc, cursorAfter, { enabled: false }))).toEqual([]);
  });

  it("does not flatten a large document before disabling formulas at the limit", () => {
    const editorState = state("x".repeat(1024), 0, { disableAboveBytes: 1023 });
    const toString = vi.spyOn(editorState.doc, "toString");

    expect(fieldRanges(editorState)).toEqual([]);
    expect(toString).not.toHaveBeenCalled();
  });
});
