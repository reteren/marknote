import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** CodeMirror использует только токены общей тёмной темы MarkNote. */
export const marknoteTheme: Extension = [
  EditorView.theme({
    "&": {
      color: "var(--text-normal)",
      backgroundColor: "var(--bg-primary)",
      fontFamily: "var(--font-text)",
      fontSize: "var(--font-size-text)",
      lineHeight: "var(--line-height-text)",
      maxWidth: "var(--line-width)",
      margin: "var(--editor-margin, 0 auto)",
      minHeight: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
      padding: "var(--editor-padding) 0",
      fontFamily: "var(--font-text)",
      outline: "none",
    },
    ".cm-scroller:focus, .cm-scroller:focus-visible": {
      outline: "none",
    },
    ".cm-content": {
      padding: "0",
      caretColor: "var(--caret-color)",
      fontFamily: "var(--font-text)",
      fontSize: "var(--font-size-text)",
      lineHeight: "var(--line-height-text)",
      unicodeBidi: "plaintext",
      outline: "none",
    },
    ".cm-content:focus, .cm-content:focus-visible": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderInlineStartColor: "var(--caret-color)",
      borderInlineStartWidth: "2px",
    },
    "&.cm-focused, &:focus, &:focus-visible": {
      outline: "none",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "var(--text-selection)",
    },
    "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
      backgroundColor: "var(--text-selection)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-primary)",
      color: "var(--text-faint)",
      border: "0",
    },
    ".cm-gutterElement": {
      color: "var(--text-faint)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-secondary)",
      color: "var(--text-normal)",
      border: "1px solid var(--bg-modifier-border)",
    },
  }, { dark: true }),
  EditorView.contentAttributes.of({ dir: "auto" }),
];
