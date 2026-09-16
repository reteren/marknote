// Раздел settings.editor: шрифт, размер, ширина колонки, табуляция,
// невидимые символы, нумерация строк, мягкий перенос.
//
// Поле zoomPercent сюда не входит: масштаб живёт в src/editor/zoom.ts и
// работает по Ctrl +/- отдельно.
//
// Владелец файла — W85. Сборка расширений в ../settings.ts, туда не пишем.

import { EditorState, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import {
  EditorView,
  highlightTrailingWhitespace,
  highlightWhitespace,
  lineNumbers,
} from "@codemirror/view";
import type { ColumnWidth, Settings } from "../../state/settings.svelte";

function resolveFontFamily(fontFamily?: string): string {
  switch (fontFamily) {
    case "system-serif":
      return 'Georgia, Cambria, "Times New Roman", serif';
    case "system-sans":
      return '"Inter", "Segoe UI Variable", "Segoe UI", sans-serif';
    case "monospace":
      return "var(--font-mono)";
    default:
      return fontFamily && fontFamily.trim().length > 0
        ? fontFamily
        : '"Inter", "Segoe UI Variable", "Segoe UI", sans-serif';
  }
}

function resolveColumnWidth(columnWidth?: ColumnWidth): string {
  switch (columnWidth) {
    case "narrow":
      return "65ch";
    case "normal":
      return "81ch";
    case "wide":
      return "100ch";
    case "fullWidth":
      return "none";
    default:
      return "81ch";
  }
}

export function editorAppearanceExtensions(settings: Settings | null): Extension[] {
  const editor = settings?.editor;
  const extensions: Extension[] = [];

  // Мягкий перенос: без него появляется горизонтальная прокрутка. Раньше
  // EditorView.lineWrapping стоял в createEditor безусловно, поэтому
  // отсутствие настройки означает «включён».
  if (editor?.softWrap !== false) {
    extensions.push(EditorView.lineWrapping);
  }

  // Нумерация строк: по умолчанию выключена, включается явно.
  if (editor?.lineNumbers === true) {
    extensions.push(lineNumbers());
  }

  // Невидимые символы: пробелы и хвостовые пробелы при редактировании.
  if (editor?.showInvisibles === true) {
    extensions.push(highlightWhitespace(), highlightTrailingWhitespace());
  }

  // Табуляция и отступы: ширина табуляции и вставка пробелов/табов.
  const tabWidth = typeof editor?.tabWidth === "number" && editor.tabWidth > 0 ? editor.tabWidth : 4;
  extensions.push(EditorState.tabSize.of(tabWidth));

  const insertSpaces = editor?.insertSpaces !== false;
  extensions.push(indentUnit.of(insertSpaces ? " ".repeat(tabWidth) : "\t"));

  // Оформление: шрифт, кегль и ширина колонки задаются через тему.
  const fontFamily = resolveFontFamily(editor?.fontFamily);
  const fontSize = typeof editor?.fontSize === "number" && editor.fontSize > 0
    ? `${editor.fontSize}px`
    : "16px";
  const maxWidth = resolveColumnWidth(editor?.columnWidth);

  extensions.push(
    EditorView.theme({
      "&": {
        "--font-text": fontFamily,
        "--font-size-text": fontSize,
        "--line-width": maxWidth,
      },
    }),
  );

  return extensions;
}
