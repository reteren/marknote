import { defineLanguageFacet, Language, syntaxTree } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { isNodeActive } from "../src/editor/livePreview/isNodeActive";
import { buildDecorationSets, decorationRanges } from "../src/editor/livePreview/plugin";
import { blockMathDecorations } from "../src/editor/livePreview/blockMath";

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

  it("не превращает одну-две черты или знака равно Setext в заголовок предпросмотра", () => {
    for (const underline of ["-", "--", " - ", " -- ", "=", "==", " = ", " == "]) {
      const doc = `plain\n${underline}`;
      const level = /=/.test(underline) ? 1 : 2;
      const heading = syntaxTree(state(doc)).topNode.getChild(`SetextHeading${level}`)!;
      expect(heading, underline).toBeTruthy();
      const result = buildDecorationSets(state(doc, 0), [{ from: 0, to: doc.length }]);
      expect(hasRange(result.decorations, heading.from, heading.to, `cm-marknote-heading cm-marknote-heading-${level}`), underline).toBe(false);
      // Сам знак остаётся на экране: его не прячут как разметку заголовка.
      expect(decorationRanges(result.decorations).some((range) => range.from >= heading.from && range.to <= heading.to && range.decoration.spec.widget === undefined && range.decoration.spec.class === undefined), underline).toBe(false);
    }

    for (const underline of ["---", "===="]) {
      const doc = `plain\n${underline}`;
      const heading = syntaxTree(state(doc)).topNode.getChild(/^=/.test(underline) ? "SetextHeading1" : "SetextHeading2")!;
      const result = buildDecorationSets(state(doc, 0), [{ from: 0, to: doc.length }]);
      expect(hasRange(result.decorations, heading.from, heading.to, `cm-marknote-heading cm-marknote-heading-${/^=/.test(underline) ? 1 : 2}`)).toBe(true);
    }
  });

  it("рендерит MathBlock вне блока и раскрывает его под курсором", () => {
    for (const doc of ["$$\nx^2\n$$\n", "before\n$$\nx^2\n$$", "before\n$$\nx^2\n$$\n", "before\n$$\nx^2\n$$\nafter"]) {
      const math = nodes(doc, "MathBlock")[0];
      expect(math, doc).toBeTruthy();
      if (!math) continue;
      // «Снаружи» — это другая строка: курсор на строке с `$$` раскрывает
      // блок, иначе только что набранные знаки сразу прятались бы под виджет.
      const outsideAnchor = math.to < doc.length ? math.to + 1 : math.from - 1;
      if (outsideAnchor < 0) continue;
      // Многострочный блок рисует поле состояния: замена, перекрывающая
      // перевод строки, из плагина вида роняет редактор (см. blockMath.ts).
      const outsideState = state(doc, outsideAnchor);
      const outsideField: Array<{ from: number; to: number }> = [];
      blockMathDecorations(outsideState).between(0, doc.length, (from, to) => outsideField.push({ from, to }));
      expect(outsideField, doc).toEqual([{ from: math.from, to: math.to }]);

      const insideState = state(doc, math.from + 3);
      const inside = buildDecorationSets(insideState, [{ from: 0, to: doc.length }]);
      expect(hasRange(inside.decorations, math.from, math.to, "cm-marknote-math-source"), doc).toBe(true);
      expect(hasWidget(inside.decorations, math.from, math.to, "MathWidget"), doc).toBe(false);
      const insideField: Array<{ from: number; to: number }> = [];
      blockMathDecorations(insideState).between(0, doc.length, (from, to) => insideField.push({ from, to }));
      expect(insideField, doc).toEqual([]);
    }
  });

  it("рендерит строчную формулу вне неё", () => {
    const doc = "before $x^2$ after";
    const math = nodes(doc, "InlineMath")[0];
    expect(hasWidget(buildDecorationSets(state(doc, 0), [{ from: 0, to: doc.length }]).decorations, math.from, math.to, "MathWidget")).toBe(true);
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
    expect(hasWidget(buildDecorationSets(state(list, listMark.from + 2), [{ from: 0, to: list.length }]).decorations, listMark.from, listMark.to, "TextWidget")).toBe(true);

    const emptyList = "- ";
    const emptyListMark = nodes(emptyList, "ListMark")[0];
    expect(hasWidget(buildDecorationSets(state(emptyList, emptyList.length), [{ from: 0, to: emptyList.length }]).decorations, emptyListMark.from, emptyListMark.to, "TextWidget")).toBe(true);

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

  it("отображает чекбокс даже когда курсор находится на той же строке в тексте задачи", () => {
    const task = "- [ ] Hello world";
    const taskMark = nodes(task, "TaskMarker")[0];
    expect(taskMark).toBeDefined();

    // 1. Курсор в тексте задачи ("Hello") — чекбокс остаётся отрендеренным виджетом
    const cursorInText = 10; // "- [ ] Hell|o world"
    const resultCursor = buildDecorationSets(state(task, cursorInText), [{ from: 0, to: task.length }]);
    expect(hasWidget(resultCursor.decorations, taskMark.from, taskMark.to, "CheckboxWidget")).toBe(true);

    // 2. Сразу после маркера на позиции 6 ("- [ ] |Hello world") — чекбокс отображается
    const resultAfterMarker = buildDecorationSets(state(task, 6), [{ from: 0, to: task.length }]);
    expect(hasWidget(resultAfterMarker.decorations, taskMark.from, taskMark.to, "CheckboxWidget")).toBe(true);

    // 3. Даже при режиме revealMarkup: "line" чекбокс остаётся виджетом, когда курсор в тексте
    const resultLineMode = buildDecorationSets(state(task, cursorInText), [{ from: 0, to: task.length }], { revealMarkup: "line" });
    expect(hasWidget(resultLineMode.decorations, taskMark.from, taskMark.to, "CheckboxWidget")).toBe(true);

    // 4. При выделении внутри диапазона маркера ([ ]) разметка раскрывается в текст
    const selectInside = EditorState.create({
      doc: task,
      selection: EditorSelection.single(3), // курсор внутри "[ ]" между "[" и " "
      extensions: language.extension,
    });
    const resultInside = buildDecorationSets(selectInside, [{ from: 0, to: task.length }]);
    expect(hasWidget(resultInside.decorations, taskMark.from, taskMark.to, "CheckboxWidget")).toBe(false);

    // 5. При стирании символов (удаление пробела после ']' -> "- [ ]") узел TaskMarker отсутствует и остаётся чистый текст
    const erasedSpace = "- [ ]";
    expect(nodes(erasedSpace, "TaskMarker")).toHaveLength(0);
    const resultErased = buildDecorationSets(state(erasedSpace, 3), [{ from: 0, to: erasedSpace.length }]);
    expect(hasWidget(resultErased.decorations, 2, 5, "CheckboxWidget")).toBe(false);

    // При удалении скобок -> "- [ hello" TaskMarker отсутствует
    const erasedBrackets = "- [ hello";
    expect(nodes(erasedBrackets, "TaskMarker")).toHaveLength(0);
  });
});
