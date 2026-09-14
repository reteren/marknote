import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { codeBlockBuilder } from "../src/editor/livePreview/codeBlocks";
import type { BuilderContext } from "../src/editor/livePreview/types";

function codeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM, addKeymap: false })],
  });
}

function buildCode(state: EditorState, active = false) {
  const node = syntaxTree(state).topNode.getChild("FencedCode");
  if (!node) throw new Error("test document did not parse as fenced code");

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
  expect(codeBlockBuilder(context)).toBe(true);
  return { node, decorations, atomic };
}

function rangesByClass(decorations: Array<Range<Decoration>>, className: string) {
  return decorations.filter(({ value }) => value.spec.class?.includes(className));
}

describe("codeBlockBuilder", () => {
  const fence = "```";

  it("hides fenced markers and marks a language tagged block", () => {
    const state = codeState(`${fence}rust\nfn main() {}\n${fence}\n`);
    const { node, decorations, atomic } = buildCode(state);
    const marks = node.getChildren("CodeMark").sort((a, b) => a.from - b.from);
    if (marks.length !== 2) throw new Error("test document did not have opening and closing fences");

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: marks[0].from, to: node.getChild("CodeInfo")?.to }),
        expect.objectContaining({ from: marks[1].from, to: marks[1].to }),
      ]),
    );
    expect(rangesByClass(decorations, "cm-marknote-code-block")).toHaveLength(1);
    expect(atomic).toHaveLength(2);
  });

  it("hides markers for a fenced block without a language", () => {
    const state = codeState(`${fence}\nplain text\n${fence}\n`);
    const { node, decorations } = buildCode(state);
    const marks = node.getChildren("CodeMark").sort((a, b) => a.from - b.from);
    if (marks.length !== 2) throw new Error("test document did not have opening and closing fences");

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: marks[0].from, to: marks[0].to }),
        expect.objectContaining({ from: marks[1].from, to: marks[1].to }),
      ]),
    );
    expect(rangesByClass(decorations, "cm-marknote-code-block")).toHaveLength(1);
  });

  it("hides only the opening marker for an unclosed fenced block", () => {
    const state = codeState(`${fence}rust\nlet value = 1;\n`);
    const { node, decorations, atomic } = buildCode(state);
    const opening = node.getChild("CodeMark");
    const code = node.getChild("CodeText");
    if (!opening || !code) throw new Error("test document did not parse an unclosed block");

    expect(decorations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: opening.from, to: node.getChild("CodeInfo")?.to })]),
    );
    expect(atomic).toHaveLength(1);
    expect(rangesByClass(decorations, "cm-marknote-code-block")).toHaveLength(1);
  });

  it("keeps all source decorations visible while the cursor is inside", () => {
    const state = codeState(`${fence}\nplain text\n${fence}\n`);
    const { decorations, atomic } = buildCode(state, true);
    expect(decorations).toHaveLength(0);
    expect(atomic).toHaveLength(0);
  });
});

