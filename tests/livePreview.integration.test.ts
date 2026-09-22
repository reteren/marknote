/// <reference path="./raw-assets.d.ts" />
import { defineLanguageFacet, Language, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import showcase from "../fixtures/showcase.md?raw";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { livePreview } from "../src/editor/livePreview";
import {
  decorationRanges,
  LivePreviewValue,
  livePreviewBlockBuilders,
} from "../src/editor/livePreview/plugin";
import { ImageWidget } from "../src/editor/livePreview/widgets/Image";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

function fullPreview(doc: string) {
  // EditorState accepts the complete livePreview extension tree, while the
  // view plugin can be exercised with a small DOM-free view adapter.
  const state = EditorState.create({
    doc,
    extensions: [language.extension, livePreview()],
  });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    dispatch: () => undefined,
  } as unknown as EditorView;
  return { state, value: new LivePreviewValue(view), view };
}

function classes(value: LivePreviewValue): string[] {
  return decorationRanges(value.decorations)
    .map(({ decoration }) => decoration.spec.class)
    .filter((className): className is string => typeof className === "string");
}

function widgetNames(value: LivePreviewValue): string[] {
  return decorationRanges(value.decorations)
    .map(({ decoration }) => decoration.spec.widget?.constructor?.name)
    .filter((name): name is string => typeof name === "string");
}

function nodes(state: EditorState, name: string) {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.node.name === name) found.push(ref.node);
    },
  });
  return found;
}

describe("livePreview full builder integration", () => {
  it("assembles every available builder and theme through livePreview", () => {
    const { state, value } = fullPreview(showcase);
    const renderedClasses = classes(value);
    const widgets = widgetNames(value);

    expect(state.doc.length).toBe(showcase.length);
    expect(renderedClasses.filter((name) => name.includes("cm-marknote-callout-")).length).toBeGreaterThanOrEqual(3);
    expect(renderedClasses).toEqual(expect.arrayContaining(["cm-marknote-blockquote"]));
    expect(renderedClasses).toEqual(expect.arrayContaining([
      "cm-marknote-table-cell cm-marknote-table-column-1 cm-marknote-table-align-left",
      "cm-marknote-table-cell cm-marknote-table-column-2 cm-marknote-table-align-center",
      "cm-marknote-table-cell cm-marknote-table-column-3 cm-marknote-table-align-right",
    ]));
    expect(renderedClasses.filter((name) => name === "cm-marknote-code-block")).toHaveLength(2);
    expect(renderedClasses.filter((name) => name === "cm-marknote-footnote-definition")).toHaveLength(2);
    expect(widgets.filter((name) => name === "FootnoteRefWidget")).toHaveLength(2);
    // The plugin returns only the inline formula: a `$$ … $$` block spans
    // multiple lines and is rendered by the blockMathField state field.
    expect(widgets.filter((name) => name === "MathWidget")).toHaveLength(1);
    expect(widgets.filter((name) => name === "CheckboxWidget")).toHaveLength(3);
    expect(widgets.filter((name) => name === "HrWidget")).toHaveLength(1);
  });

  it("does not let neighboring builders swallow citations, links, or foreign nodes", () => {
    const { state, value } = fullPreview(showcase);
    const renderedClasses = classes(value);
    const renderedWidgets = decorationRanges(value.decorations);
    const ordinaryLink = nodes(state, "Link")[0];
    const ordinaryUrl = ordinaryLink?.getChild("URL");
    const ordinaryCitation = renderedClasses.includes("cm-marknote-blockquote");
    const callout = renderedClasses.some((name) => name.startsWith("cm-marknote-callout-"));

    expect(ordinaryCitation).toBe(true);
    expect(callout).toBe(true);
    expect(ordinaryLink).toBeDefined();
    expect(ordinaryUrl).toBeDefined();
    expect(renderedClasses).toContain("cm-marknote-link");

    // A normal Link reaches inline rendering, while only FootnoteReference
    // nodes become FootnoteRefWidget instances.
    const footnoteRanges = renderedWidgets.filter(({ decoration }) => decoration.spec.widget?.constructor?.name === "FootnoteRefWidget");
    expect(footnoteRanges.every((range) => !ordinaryUrl || range.to <= ordinaryUrl.from || range.from >= ordinaryUrl.to)).toBe(true);

    // Every builder rejects an unrelated Link node; this also guards against
    // an over-broad fallback being added to a future builder.
    const linkNode = ordinaryLink!;
    const context = {
      view: { state, dispatch: () => undefined } as unknown as EditorView,
      node: linkNode,
      active: false,
      add: () => undefined,
      atomic: () => undefined,
    };
    expect(livePreviewBlockBuilders.every((builder) => !builder(context))).toBe(true);
  });

  it("passes an image alt dimension to its widget without changing the source text", () => {
    const doc = "![cat|400](cat.png)\ntext";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [language.extension, livePreview()],
    });
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      dispatch: () => undefined,
    } as unknown as EditorView;
    const { value } = { value: new LivePreviewValue(view) };
    const image = decorationRanges(value.decorations)
      .map(({ decoration }) => decoration.spec.widget)
      .find((widget): widget is ImageWidget => widget instanceof ImageWidget);

    expect(image?.alt).toBe("cat");
    expect(image?.size).toEqual({ width: 400 });
  });
});
