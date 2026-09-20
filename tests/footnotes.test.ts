import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  footnoteBuilder,
  footnoteTooltip,
  FootnoteRefWidget,
  getFootnoteDefinitions,
} from "../src/editor/livePreview/footnotes";
import type { BuilderContext } from "../src/editor/livePreview/types";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";

function createFootnoteState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: marknoteMarkdown, addKeymap: false })],
  });
}

function buildFootnote(state: EditorState, nodeName: string, active = false, index = 0) {
  const tree = syntaxTree(state);
  const nodes: Array<any> = [];
  tree.iterate({
    enter(node) {
      if (node.name === nodeName) {
        nodes.push(node.node);
      }
    },
  });

  if (nodes.length <= index) {
    throw new Error(`test document did not find node ${nodeName} at index ${index}`);
  }

  const node = nodes[index];
  const decorations: Array<Range<Decoration>> = [];
  const atomic: Array<Range<Decoration>> = [];
  const view = { state, dispatch: () => undefined } as unknown as EditorView;
  const context: BuilderContext = {
    view,
    node,
    active,
    add: (range) => decorations.push(range),
    atomic: (range) => atomic.push(range),
  };

  const handled = footnoteBuilder(context);
  return { handled, node, decorations, atomic };
}

describe("footnoteBuilder", () => {
  const sampleDoc = [
    "Text with footnote[^1] and second footnote[^note], plus footnote without a definition[^missing].",
    "",
    "[^1]: First numbered footnote text.",
    "[^note]: Named footnote text.",
  ].join("\n");

  it("extracts footnote definitions from the document correctly", () => {
    const state = createFootnoteState(sampleDoc);
    const defs = getFootnoteDefinitions(state);

    expect(defs.get("1")).toBe("First numbered footnote text.");
    expect(defs.get("note")).toBe("Named footnote text.");
    expect(defs.has("missing")).toBe(false);
  });

  it("a defined footnote becomes a superscript widget and reveals under the cursor", () => {
    const state = createFootnoteState(sampleDoc);

    // 1. Cursor outside: [^1] becomes a superscript FootnoteRefWidget label.
    const ref1 = buildFootnote(state, "FootnoteReference", false, 0);
    expect(ref1.handled).toBe(true);
    expect(ref1.decorations).toHaveLength(1);
    expect(ref1.atomic).toHaveLength(1);
    const widget = ref1.decorations[0].value.spec.widget as FootnoteRefWidget;
    expect(widget).toBeInstanceOf(FootnoteRefWidget);
    expect(widget.label).toBe("1");

    // Named footnote [^note].
    const refNote = buildFootnote(state, "FootnoteReference", false, 1);
    expect(refNote.handled).toBe(true);
    expect(refNote.decorations).toHaveLength(1);
    const noteWidget = refNote.decorations[0].value.spec.widget as FootnoteRefWidget;
    expect(noteWidget.label).toBe("note");

    // 2. Cursor inside the reference: source text, without replacement decorations.
    const ref1Active = buildFootnote(state, "FootnoteReference", true, 0);
    expect(ref1Active.handled).toBe(true);
    expect(ref1Active.decorations).toHaveLength(0);
    expect(ref1Active.atomic).toHaveLength(0);
  });

  it("an undefined footnote does not break rendering and remains ordinary text", () => {
    const state = createFootnoteState(sampleDoc);

    // [^missing] is the third FootnoteReference node.
    const refMissing = buildFootnote(state, "FootnoteReference", false, 2);
    expect(refMissing.handled).toBe(true);
    // Without a definition, there is no widget replacement; ordinary text remains.
    expect(refMissing.decorations).toHaveLength(0);
    expect(refMissing.atomic).toHaveLength(0);
  });

  it("a footnote definition has muted styling, an emphasized label, and cursor reveal", () => {
    const state = createFootnoteState(sampleDoc);

    // 1. Cursor outside.
    const def1 = buildFootnote(state, "FootnoteDefinition", false, 0);
    expect(def1.handled).toBe(true);

    // Muted style for the entire definition.
    expect(
      def1.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-footnote-definition")),
    ).toBe(true);

    // Emphasized label [^1]:
    expect(
      def1.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-footnote-def-label")),
    ).toBe(true);

    // 2. Cursor inside the definition: source text without decorations.
    const def1Active = buildFootnote(state, "FootnoteDefinition", true, 0);
    expect(def1Active.handled).toBe(true);
    expect(def1Active.decorations).toHaveLength(0);
  });

  it("FootnoteRefWidget implements eq() and stores its label", () => {
    const w1 = new FootnoteRefWidget("1");
    const w2 = new FootnoteRefWidget("1");
    const wDiff = new FootnoteRefWidget("2");

    expect(w1.eq(w2)).toBe(true);
    expect(w1.eq(wDiff)).toBe(false);
    expect(w1.label).toBe("1");
  });

  it("footnoteTooltip is exported as a CodeMirror extension", () => {
    expect(footnoteTooltip).toBeDefined();
  });
});
