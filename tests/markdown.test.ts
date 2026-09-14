import { defineLanguageFacet, Language, syntaxTree } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { isNodeActive } from "../src/editor/livePreview/isNodeActive";
import { buildDecorationSets, decorationRanges } from "../src/editor/livePreview/plugin";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

function state(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: language.extension,
  });
}

function nodes(doc: string, name: string) {
  const result: Array<{ from: number; to: number }> = [];
  syntaxTree(state(doc)).iterate({
    enter(node) {
      if (node.name === name) result.push({ from: node.from, to: node.to });
    },
  });
  return result;
}

function hasRange(set: ReturnType<typeof buildDecorationSets>["decorations"], from: number, to: number, className?: string) {
  return decorationRanges(set).some((range) => range.from === from && range.to === to && (!className || range.decoration.spec.class === className));
}

function hasWidget(set: ReturnType<typeof buildDecorationSets>["decorations"], from: number, to: number, widgetName: string) {
  return decorationRanges(set).some((range) => range.from === from && range.to === to && range.decoration.spec.widget?.constructor?.name === widgetName);
}

describe("MarkNote Markdown extensions", () => {
  it("разбирает все новые inline-конструкции с точными позициями", () => {
    const doc = "==hi== %%comment%% $x^2$ [^ref]";
    for (const name of ["Highlight", "Comment", "InlineMath", "FootnoteReference"]) {
      expect(nodes(doc, name), name).toHaveLength(1);
    }
    expect(nodes(doc, "Highlight")[0]).toEqual({ from: 0, to: 6 });
    expect(nodes(doc, "Comment")[0]).toEqual({ from: 7, to: 18 });
    expect(nodes(doc, "InlineMath")[0]).toEqual({ from: 19, to: 24 });
    expect(nodes(doc, "FootnoteReference")[0]).toEqual({ from: 25, to: 31 });
  });

  it("разбирает блок формулы, callout и определение сноски", () => {
    const doc = "$$\nx^2\n$$\n\n> [!WARNING] Be careful\n> body\n\n[^ref]: Reference text";
    expect(nodes(doc, "MathBlock")).toEqual([{ from: 0, to: 9 }]);
    expect(nodes(doc, "Callout")).toEqual([{ from: 12, to: 41 }]);
    expect(nodes(doc, "Blockquote")).toEqual([{ from: 11, to: 41 }]);
    expect(nodes(doc, "CalloutBody")).toHaveLength(1);
    expect(nodes(doc, "QuoteMark")).toHaveLength(2);
    expect(nodes(doc, "FootnoteDefinition")).toEqual([{ from: 43, to: 65 }]);
  });

  it("распознаёт все типы Obsidian callout", () => {
    for (const type of ["note", "tip", "warning", "danger", "info", "success", "question", "quote", "example"]) {
      expect(nodes(`> [!${type.toUpperCase()}] Title`, "Callout"), type).toHaveLength(1);
    }
  });

  it("учитывает включительные границы курсора и выделения", () => {
    const doc = "a **x** b";
    const node = syntaxTree(state(doc)).topNode.getChild("Paragraph")!.getChild("StrongEmphasis")!;
    expect([1, 2, 3, 6, 8].map((anchor) => isNodeActive(node, EditorSelection.single(anchor), state(doc).doc))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    const selection = EditorSelection.create([EditorSelection.range(0, 1)]);
    expect(isNodeActive(node, selection, state(doc).doc)).toBe(false);
    expect(isNodeActive(node, EditorSelection.create([EditorSelection.range(0, 3)]), state(doc).doc)).toBe(true);
  });

  it("скрывает маркеры снаружи и раскрывает узел под курсором", () => {
    const doc = "prefix **bold** suffix";
    const outside = state(doc, 0);
    const hidden = buildDecorationSets(outside, [{ from: 0, to: doc.length }]);
    expect(hasRange(hidden.decorations, 7, 9)).toBe(true);
    expect(hasRange(hidden.decorations, 13, 15)).toBe(true);

    const inside = state(doc, 10);
    const shown = buildDecorationSets(inside, [{ from: 0, to: doc.length }]);
    expect(hasRange(shown.decorations, 7, 9)).toBe(false);
    expect(hasRange(shown.decorations, 13, 15)).toBe(false);
    expect(hasRange(shown.decorations, 9, 13, "cm-marknote-bold")).toBe(true);
  });

  it("строит вложенные декорации и atomic ranges", () => {
    const doc = "x **bold *and italic* inside** y";
    const result = buildDecorationSets(state(doc, 0), [{ from: 0, to: doc.length }]);
    expect(hasRange(result.decorations, 2, 4)).toBe(true);
    expect(hasRange(result.decorations, 2, 4, "cm-marknote-bold")).toBe(false);
    expect(hasRange(result.decorations, 9, 10)).toBe(true);
    expect(hasRange(result.decorations, 10, 20, "cm-marknote-italic")).toBe(true);
    expect(result.atomicRanges.size).toBeGreaterThan(0);
  });

  it("строит блочные виджеты и раскрывает их по строке", () => {
    const heading = "x\n# Heading";
    const headingNode = nodes(heading, "ATXHeading1")[0];
    expect(hasRange(buildDecorationSets(state(heading, 0), [{ from: 0, to: heading.length }]).decorations, headingNode.from, headingNode.from + 1)).toBe(true);
    expect(hasRange(buildDecorationSets(state(heading, headingNode.from + 2), [{ from: 0, to: heading.length }]).decorations, headingNode.from, headingNode.from + 1)).toBe(false);

    const list = "x\n- item";
    const listMark = nodes(list, "ListMark")[0];
    expect(hasWidget(buildDecorationSets(state(list, 0), [{ from: 0, to: list.length }]).decorations, listMark.from, listMark.to, "TextWidget")).toBe(true);
    expect(hasWidget(buildDecorationSets(state(list, listMark.from + 2), [{ from: 0, to: list.length }]).decorations, listMark.from, listMark.to, "TextWidget")).toBe(false);

    const quote = "x\n> quote";
    const quoteMark = nodes(quote, "QuoteMark")[0];
    expect(hasWidget(buildDecorationSets(state(quote, 0), [{ from: 0, to: quote.length }]).decorations, quoteMark.from, quoteMark.to, "TextWidget")).toBe(true);

    const task = "x\n- [x] done";
    const taskMark = nodes(task, "TaskMarker")[0];
    expect(hasWidget(buildDecorationSets(state(task, 0), [{ from: 0, to: task.length }]).decorations, taskMark.from, taskMark.to, "CheckboxWidget")).toBe(true);

    const hr = "x\n\n---";
    const hrNode = nodes(hr, "HorizontalRule")[0];
    expect(hasWidget(buildDecorationSets(state(hr, 0), [{ from: 0, to: hr.length }]).decorations, hrNode.from, hrNode.to, "HrWidget")).toBe(true);
  });

  it("полностью скрывает комментарий и заменяет формулу виджетом", () => {
    const doc = "x %%hidden%% $a + b$";
    const result = buildDecorationSets(state(doc, 0), [{ from: 0, to: doc.length }]);
    const comment = nodes(doc, "Comment")[0];
    const math = nodes(doc, "InlineMath")[0];
    expect(hasRange(result.decorations, comment.from, comment.to)).toBe(true);
    expect(hasWidget(result.decorations, math.from, math.to, "MathWidget")).toBe(true);
  });

  it("отключает предпросмотр после maxBytes", () => {
    const result = buildDecorationSets(state("**large**"), [{ from: 0, to: 9 }], { maxBytes: 1 });
    expect(result.disabled).toBe(true);
    expect(result.decorations.size).toBe(0);
    expect(result.atomicRanges.size).toBe(0);
  });
});
