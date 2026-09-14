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
  it("callout без своего заголовка: скрывает маркеры, подставляет имя типа и показывает исходный текст под курсором", () => {
    const doc = "> [!NOTE]\n> Текст заметки Obsidian.";
    const state = createCalloutState(doc);

    // 1. Курсор снаружи — маркеры скрыты, имя типа подставлено в виджет заголовка
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Оформление блока callout
    const blockMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-note"),
    );
    expect(blockMarks.length).toBeGreaterThan(0);

    // Скрыт маркер `>` первой строки (0..1)
    const hiddenQuote = outside.decorations.filter((d) => d.from === 0 && d.to === 1);
    expect(hiddenQuote.length).toBeGreaterThan(0);

    // Заменён маркер [!NOTE] виджетом заголовка с именем типа
    const headerWidgetDecos = outside.decorations.filter(
      (d) => d.value.spec.widget instanceof CalloutHeaderWidget,
    );
    expect(headerWidgetDecos.length).toBe(1);
    const widget = headerWidgetDecos[0].value.spec.widget as CalloutHeaderWidget;
    expect(widget.type).toBe("note");
    expect(widget.title).toBe("Note");

    // Скрыт маркер `>` второй строки (10..11)
    const secondLineQuote = outside.decorations.filter((d) => d.from === 10 && d.to === 11);
    expect(secondLineQuote.length).toBeGreaterThan(0);

    // 2. Курсор внутри — исходный текст, декорации скрытия отсутствуют
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("callout со своим заголовком: скрывает [!TYPE], оставляет свой заголовок и показывает исходный текст под курсором", () => {
    const doc = "> [!TIP] Свой заголовок\n> Текст подсказки.";
    const state = createCalloutState(doc);

    // 1. Курсор снаружи
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Класс нужного типа tip
    const tipMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-tip"),
    );
    expect(tipMarks.length).toBeGreaterThan(0);

    // Виджет иконки для tip
    const iconWidgets = outside.decorations.filter(
      (d) => d.value.spec.widget instanceof CalloutIconWidget,
    );
    expect(iconWidgets.length).toBe(1);
    expect((iconWidgets[0].value.spec.widget as CalloutIconWidget).type).toBe("tip");

    // Свой заголовок помечен стилем callout-title
    const titleMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-title"),
    );
    expect(titleMarks.length).toBeGreaterThan(0);

    // 2. Курсор внутри
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("неизвестный тип [!ЧТОТО]: отображается как note", () => {
    const doc = "> [!ЧТОТО]\n> Тело неизвестного блока.";
    const state = createCalloutState(doc);

    expect(normalizeCalloutType("ЧТОТО")).toBe("note");

    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Неизвестный тип получил оформление note
    const noteMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-callout-note"),
    );
    expect(noteMarks.length).toBeGreaterThan(0);

    // Курсор внутри неизвестного callout
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
  });

  it("обычная цитата: вертикальная линия слева, скрытие маркеров и показ исходного текста под курсором", () => {
    const doc = "> Обычная цитата без типа\n> Вторая строка цитаты.";
    const state = createCalloutState(doc);

    // 1. Курсор снаружи
    const outside = buildCallout(state, false);
    expect(outside.handled).toBe(true);

    // Маркирована как blockquote
    const quoteMarks = outside.decorations.filter((d) =>
      d.value.spec.class?.includes("cm-marknote-blockquote"),
    );
    expect(quoteMarks.length).toBeGreaterThan(0);

    // Маркеры `>` на обеих строках скрыты
    const hiddenMarkers = outside.decorations.filter((d) => d.to === d.from + 1);
    expect(hiddenMarkers.length).toBeGreaterThanOrEqual(2);

    // 2. Курсор внутри
    const inside = buildCallout(state, true);
    expect(inside.handled).toBe(true);
    expect(inside.decorations).toHaveLength(0);
    expect(inside.atomic).toHaveLength(0);
  });

  it("вложенная цитата: поддерживает вложенные уровни и изолированное раскрытие", () => {
    const doc = "> Цитата первого уровня\n> > Вложенная цитата\n> Продолжение первого уровня";
    const state = createCalloutState(doc);

    // Внешняя цитата
    const outer = buildCallout(state, false, 0);
    expect(outer.handled).toBe(true);
    expect(
      outer.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-blockquote")),
    ).toBe(true);

    // Внутренняя цитата (второй узел Blockquote в дереве)
    const inner = buildCallout(state, false, 1);
    expect(inner.handled).toBe(true);
    expect(
      inner.decorations.some((d) => d.value.spec.class?.includes("cm-marknote-blockquote")),
    ).toBe(true);

    // Курсор внутри вложенной цитаты: вложенный узел раскрыт
    const innerActive = buildCallout(state, true, 1);
    expect(innerActive.handled).toBe(true);
    expect(innerActive.decorations).toHaveLength(0);
  });

  it("виджеты callout корректно реализуют метод eq()", () => {
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
