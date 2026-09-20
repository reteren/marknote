// settings.editor section: font, size, column width, tabs, invisible
// characters, line numbers, and soft wrapping.
//
// The zoomPercent field does not belong here: zoom lives in src/editor/zoom.ts
// and works independently through Ctrl +/-.
//
// File owner: W85. Extensions are assembled in ../settings.ts; do not edit there.

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

export function editorAppearanceExtensions(settings: Settings | null, formatHasSyntaxMode = false): Extension[] {
  const editor = settings?.editor;
  const extensions: Extension[] = [];

  // Code formats always show their gutter; the setting extends that choice to
  // Markdown and plain text. Keep the extension here so the OR expression
  // produces exactly one line-number gutter in every combination.
  if (formatHasSyntaxMode || editor?.lineNumbers === true) {
    extensions.push(lineNumbers());
  }

  // Soft wrapping: without it, horizontal scrolling appears. EditorView.lineWrapping
  // used to be unconditional in createEditor, so a missing setting means enabled.
  if (editor?.softWrap !== false) {
    extensions.push(EditorView.lineWrapping);
  }

  // Invisible characters: spaces and trailing whitespace while editing.
  if (editor?.showInvisibles === true) {
    extensions.push(highlightWhitespace(), highlightTrailingWhitespace());
  }

  // Tabs and indentation: tab width and insertion of spaces/tabs.
  const tabWidth = typeof editor?.tabWidth === "number" && editor.tabWidth > 0 ? editor.tabWidth : 4;
  extensions.push(EditorState.tabSize.of(tabWidth));

  const insertSpaces = editor?.insertSpaces !== false;
  extensions.push(indentUnit.of(insertSpaces ? " ".repeat(tabWidth) : "\t"));

  // Appearance: font, text size, and column width are set through the theme.
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
