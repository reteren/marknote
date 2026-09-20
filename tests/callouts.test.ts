import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  calloutBuilder,
  CalloutHeaderWidget,
  CalloutIconWidget,
  normalizeCalloutType,
} from "../src/editor/livePreview/callouts";
import type { BuilderContext } from "../src/editor/livePreview/types";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";

function createCalloutState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: marknoteMarkdown, addKeymap: false })],
  });
}

function buildCallout(state: EditorState, active = false, index = 0) {
  const tree = syntaxTree(state);
  const nodes: Array<any> = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Blockquote") {
        nodes.push(node.node);
      }
    },
  });

  if (nodes.length <= index) {
    throw new Error(`test document did not find Blockquote node at index ${index}`);
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

  const handled = calloutBuilder(context);
  return { handled, node, decorations, atomic };
}

describe("calloutBuilder", () => {
  it("callout without a custom heading hides markers, inserts the type name, and shows source under the cursor", () => {
    const doc = "> [!NOTE]\n> Text from the Obsidian note.";
    const state = createCalloutState(doc);

    // 1. Cursor outside: markers are hidden and the type name is inserted in the heading widget.
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Callout block styling.
    const blockMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-note"),
    );
    expect(blockMarks.length).toBeGreaterThan(0);

    // The first-line `>` marker is hidden (0..1).
    const hiddenQuote = outside.decorations.filter((d) => d.from === 0 && d.to === 1);
    expect(hiddenQuote.length).toBeGreaterThan(0);

    // The [!NOTE] marker is replaced by a heading widget with the type name.
    const headerWidgetDecos = outside.decorations.filter(
      (d) => d.value.spec.widget instanceof CalloutHeaderWidget,
    );
    expect(headerWidgetDecos.length).toBe(1);
    const widget = headerWidgetDecos[0].value.spec.widget as CalloutHeaderWidget;
    expect(widget.type).toBe("note");
    expect(widget.title).toBe("Note");

    // The second-line `>` marker is hidden (10..11).
    const secondLineQuote = outside.decorations.filter((d) => d.from === 10 && d.to === 11);
    expect(secondLineQuote.length).toBeGreaterThan(0);

    // 2. Cursor inside: source text, with no hiding decorations.
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("callout with a custom heading hides [!TYPE], keeps the heading, and shows source under the cursor", () => {
    const doc = "> [!TIP] Custom heading\n> Hint text.";
    const state = createCalloutState(doc);

    // 1. Cursor outside.
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Class for the tip type.
    const tipMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-tip"),
    );
    expect(tipMarks.length).toBeGreaterThan(0);

    // Icon widget for tip.
    const iconWidgets = outside.decorations.filter(
      (d) => d.value.spec.widget instanceof CalloutIconWidget,
    );
    expect(iconWidgets.length).toBe(1);
    expect((iconWidgets[0].value.spec.widget as CalloutIconWidget).type).toBe("tip");

    // Custom heading has the callout-title style.
    const titleMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-title"),
    );
    expect(titleMarks.length).toBeGreaterThan(0);

    // 2. Cursor inside.
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("unknown type [!UNKNOWN] is displayed as note", () => {
    const doc = "> [!WHATEVER]\n> Unknown callout body.";
    const state = createCalloutState(doc);

    expect(normalizeCalloutType("WHATEVER")).toBe("note");

    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // The unknown type receives note styling.
    const noteMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-note"),
    );
    expect(noteMarks.length).toBeGreaterThan(0);

    // Cursor inside the unknown callout.
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
  });

  it("ordinary quote has a left rule, hidden markers, and source text under the cursor", () => {
    const doc = "> Ordinary quote without a type\n> Second quote line.";
    const state = createCalloutState(doc);

    // 1. Cursor outside.
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Marked as blockquote.
    const quoteMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-blockquote"),
    );
    expect(quoteMarks.length).toBeGreaterThan(0);

    // `>` markers on both lines are hidden.
    const hiddenMarkers = outside.decorations.filter((d) => d.to === d.from + 1);
    expect(hiddenMarkers.length).toBeGreaterThanOrEqual(2);

    // 2. Cursor inside.
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("nested quote supports nested levels and isolated revealing", () => {
    const doc = "> First-level quote\n> > Nested quote\n> Continued first level";
    const state = createCalloutState(doc);

    // Outer quote.
    const outer = buildCallout(state, false, 0);
    expect(outer.handled).toBe(true);
    expect(
      outer.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-blockquote")),
    ).toBe(true);

    // Inner quote (the second Blockquote node in the tree).
    const inner = buildCallout(state, false, 1);
    expect(inner.handled).toBe(true);
    expect(
      inner.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-blockquote")),
    ).toBe(true);

    // Cursor inside the nested quote: the nested node is revealed.
    const innerActive = buildCallout(state, true, 1);
    expect(innerActive.handled).toBe(true);
    expect(innerActive.decorations).toHaveLength(0);
  });

  it("callout widgets implement eq() correctly", () => {
    const icon1 = new CalloutIconWidget("tip");
    const icon2 = new CalloutIconWidget("tip");
    const iconDiff = new CalloutIconWidget("note");

    expect(icon1.eq(icon2)).toBe(true);
    expect(icon1.eq(iconDiff)).toBe(false);

    const head1 = new CalloutHeaderWidget("note", "Note");
    const head2 = new CalloutHeaderWidget("note", "Note");
    const headDiff = new CalloutHeaderWidget("note", "Different");

    expect(head1.eq(head2)).toBe(true);
    expect(head1.eq(headDiff)).toBe(false);
  });
});
