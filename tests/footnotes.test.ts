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
    "Текст со сноской[^1] и второй сноской[^note], а также сноской без определения[^missing].",
    "",
    "[^1]: Текст первой числовой сноски.",
    "[^note]: Текст именованной сноски.",
  ].join("\n");

  it("корректно извлекает определения сносок из документа", () => {
    const state = createFootnoteState(sampleDoc);
    const defs = getFootnoteDefinitions(state);

    expect(defs.get("1")).toBe("Текст первой числовой сноски.");
    expect(defs.get("note")).toBe("Текст именованной сноски.");
    expect(defs.has("missing")).toBe(false);
  });

  it("сноска с определением: заменяется на надстрочный виджет и раскрывается при курсоре внутри", () => {
    const state = createFootnoteState(sampleDoc);

    // 1. Курсор снаружи — [^1] заменяется на надстрочную метку FootnoteRefWidget
    const ref1 = buildFootnote(state, "FootnoteReference", false, 0);
    expect(ref1.handled).toBe(true);
    expect(ref1.decorations).toHaveLength(1);
    expect(ref1.atomic).toHaveLength(1);
    const widget = ref1.decorations[0].value.spec.widget as FootnoteRefWidget;
    expect(widget).toBeInstanceOf(FootnoteRefWidget);
    expect(widget.label).toBe("1");

    // Именованная сноска [^note]
    const refNote = buildFootnote(state, "FootnoteReference", false, 1);
    expect(refNote.handled).toBe(true);
    expect(refNote.decorations).toHaveLength(1);
    const noteWidget = refNote.decorations[0].value.spec.widget as FootnoteRefWidget;
    expect(noteWidget.label).toBe("note");

    // 2. Курсор внутри ссылки — исходный текст, без декораций замены
    const ref1Active = buildFootnote(state, "FootnoteReference", true, 0);
    expect(ref1Active.handled).toBe(true);
    expect(ref1Active.decorations).toHaveLength(0);
    expect(ref1Active.atomic).toHaveLength(0);
  });

  it("сноска без определения: не ломает отображение и остаётся обычным текстом", () => {
    const state = createFootnoteState(sampleDoc);

    // Сноска [^missing] — третий узел FootnoteReference
    const refMissing = buildFootnote(state, "FootnoteReference", false, 2);
    expect(refMissing.handled).toBe(true);
    // Без определения — никаких замен на виджет, остаётся обычным текстом
    expect(refMissing.decorations).toHaveLength(0);
    expect(refMissing.atomic).toHaveLength(0);
  });

  it("определение сноски: приглушённый стиль, выделенная метка, раскрытие под курсором", () => {
    const state = createFootnoteState(sampleDoc);

    // 1. Курсор снаружи
    const def1 = buildFootnote(state, "FootnoteDefinition", false, 0);
    expect(def1.handled).toBe(true);

    // Приглушённый стиль для всего определения
    expect(
      def1.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-footnote-definition")),
    ).toBe(true);

    // Выделенная метка [^1]:
    expect(
      def1.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-footnote-def-label")),
    ).toBe(true);

    // 2. Курсор внутри определения — исходный текст без декораций
    const def1Active = buildFootnote(state, "FootnoteDefinition", true, 0);
    expect(def1Active.handled).toBe(true);
    expect(def1Active.decorations).toHaveLength(0);
  });

  it("виджет FootnoteRefWidget реализует метод eq() и хранит метку", () => {
    const w1 = new FootnoteRefWidget("1");
    const w2 = new FootnoteRefWidget("1");
    const wDiff = new FootnoteRefWidget("2");

    expect(w1.eq(w2)).toBe(true);
    expect(w1.eq(wDiff)).toBe(false);
    expect(w1.label).toBe("1");
  });

  it("footnoteTooltip экспортируется как расширение CodeMirror", () => {
    expect(footnoteTooltip).toBeDefined();
  });
});
