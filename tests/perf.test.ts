/// <reference path="./raw-assets.d.ts" />
import { defineLanguageFacet, Language } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { buildDecorationSets } from "../src/editor/livePreview/plugin";
import source from "../fixtures/big-10k.md?raw";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

function createState(doc: string, anchor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: language.extension,
  });
}

describe("live preview performance", () => {
  it("measures a visible-range rebuild after inserting one character", () => {
    expect(source.split(/\r?\n/).length).toBeGreaterThanOrEqual(10_000);

    const base = createState(source);
    const insertion = base.doc.line(Math.min(120, base.doc.lines)).from;
    const visibleEnd = base.doc.line(Math.min(260, base.doc.lines)).to;
    const visibleRanges = [{ from: 0, to: visibleEnd }];
    const options = { maxBytes: 5 * 1024 * 1024 };

    // Warm the parser and JIT before collecting samples. The transaction is
    // deliberately outside the timed section: this measures the preview
    // rebuild itself, which is the work performed by the view plugin.
    for (let i = 0; i < 3; i++) {
      const changed = base.update({ changes: { from: insertion, insert: "x" } }).state;
      buildDecorationSets(changed, visibleRanges, options);
    }

    const durations: number[] = [];
    for (let i = 0; i < 25; i++) {
      const changed = base.update({ changes: { from: insertion, insert: "x" } }).state;
      const started = performance.now();
      const result = buildDecorationSets(changed, visibleRanges, options);
      durations.push(performance.now() - started);
      expect(result.disabled).toBe(false);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    console.info(`live preview rebuild: median=${median.toFixed(2)}ms worst=${worst.toFixed(2)}ms target=16ms`);

    // The product target is 16ms. Keep CI's assertion generous enough for a
    // busy or slower runner while still catching accidental whole-document
    // decoration walks and pathological regressions.
    expect(worst).toBeLessThan(500);
  });
});
