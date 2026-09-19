// Блок `$$ … $$` занимает несколько строк, и замена такого диапазона из
// плагина вида запрещена: CodeMirror бросает RangeError и перестаёт обновлять
// редактор — документ застывает, а формула остаётся сырой. Эти проверки
// держат разделение: многострочный блок рисует поле состояния, однострочный —
// плагин, и ни один из них не отдаёт запрещённую замену.

import { defineLanguageFacet, Language } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
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

describe("блок формулы", () => {
  const doc = "text\n\n$$\nx^2\n$$\n\nafter";
  const cursorAfter = doc.length;

  it("рисуется полем состояния, а плагин не отдаёт замену через перевод строки", () => {
    const editorState = state(doc, cursorAfter);
    expect(fieldRanges(editorState)).toEqual([{ from: 6, to: 15 }]);
    expect(replacementsCrossingLineBreak(editorState)).toEqual([]);
  });

  it("не отдаёт замену и у незакрытого блока, пока его дописывают", () => {
    // `$$` + перевод строки: именно на этом сочетании редактор падал.
    for (const unfinished of ["$$\n", "$$\nx^2\n", "text\n\n$$\n"]) {
      const editorState = state(unfinished, unfinished.length);
      expect(replacementsCrossingLineBreak(editorState)).toEqual([]);
    }
  });

  it("раскрывается в разметку, пока курсор на любой его строке", () => {
    for (const anchor of [6, 9, 12, 15]) {
      expect(fieldRanges(state(doc, anchor))).toEqual([]);
    }
  });

  it("молчит, когда предпросмотр или формулы выключены", () => {
    expect(fieldRanges(state(doc, cursorAfter, { renderFormulas: false }))).toEqual([]);
    expect(fieldRanges(state(doc, cursorAfter, { enabled: false }))).toEqual([]);
  });
});
