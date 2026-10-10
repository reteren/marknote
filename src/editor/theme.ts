import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * The text never moves sideways. overflow-x: hidden removes the scrollbar but
 * still lets the browser shift the content when a selection or a jump to the
 * caret reaches past the edge, so any horizontal offset is put straight back.
 */
const noHorizontalScroll = EditorView.domEventHandlers({
  scroll(_event, view) {
    if (view.scrollDOM.scrollLeft !== 0) view.scrollDOM.scrollLeft = 0;
    return false;
  },
});

/** CodeMirror uses only tokens from MarkNote's shared dark theme. */
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
      // Set height, not only min-height: without it the editor root grows with
      // the text, .cm-scroller never overflows, no scrollbar appears, and the
      // mouse wheel does nothing — documents longer than the window become inaccessible.
      height: "100%",
      minHeight: "100%",
    },
    ".cm-scroller": {
      // Everything wraps, so the text never needs a horizontal scrollbar.
      overflowX: "hidden",
      overflowY: "auto",
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
      // The text column may shrink to the window: nothing inside it, a table
      // included, can make it wider than the editor.
      minWidth: "0",
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
    ".cm-lineNumbers": {
      // Keep the gutter stable through four-digit documents; `ch` follows the
      // editor font and therefore scales with Ctrl + '+'.
      minWidth: "4ch",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      color: "var(--text-faint)",
      minWidth: "4ch",
      padding: "0 0.5ch",
      textAlign: "right",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-secondary)",
      color: "var(--text-normal)",
      border: "1px solid var(--bg-modifier-border)",
    },
  }, { dark: true }),
  EditorView.contentAttributes.of({ dir: "auto" }),
  noHorizontalScroll,
];
