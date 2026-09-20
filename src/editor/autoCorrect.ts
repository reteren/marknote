// Support for autocorrection while typing (settings.autoCorrect).
//
// It enables four rules:
// - smartQuotes: replace straight "" and '' quotes with paired “typographic” quotes
// - doubleHyphenToEmDash: replace two hyphens -- with an em dash —
// - capitalizeAfterPeriod: capitalize the letter after a period and whitespace
// - threeDotsToEllipsis: replace three dots ... with an ellipsis …
//
// Each rule runs while typing and is undone with one Ctrl+Z press
// (restoring the originally typed characters).
// Autocorrection is disabled inside code blocks, inline code, formulas, and links.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isInsideCodeFormulaOrLink } from "./spellcheck";

export type AutoCorrectOptions = {
  smartQuotes: boolean;
  doubleHyphenToEmDash: boolean;
  capitalizeAfterPeriod: boolean;
  threeDotsToEllipsis: boolean;
};

export function autoCorrectExtension(options: AutoCorrectOptions): Extension[] {
  if (
    !options.smartQuotes &&
    !options.doubleHyphenToEmDash &&
    !options.capitalizeAfterPeriod &&
    !options.threeDotsToEllipsis
  ) {
    return [];
  }

  return [
    EditorView.inputHandler.of((view, from, to, text) => {
      // Autocorrection only handles single-character insertions.
      if (text.length !== 1) return false;

      // Do not replace text inside code blocks, inline code, formulas, or links.
      if (isInsideCodeFormulaOrLink(view.state, from)) return false;

      // 1. Double hyphen to em dash (-- -> —)
      if (options.doubleHyphenToEmDash && text === "-" && from === to && from > 0) {
        if (view.state.sliceDoc(from - 1, from) === "-") {
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from: from - 1, to: from + 1, insert: "—" }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 2. Three dots to ellipsis (... -> …)
      if (options.threeDotsToEllipsis && text === "." && from === to && from >= 2) {
        if (view.state.sliceDoc(from - 2, from) === "..") {
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from: from - 2, to: from + 1, insert: "…" }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 3. Capitalize after a period and whitespace (. + whitespace + lowercase -> uppercase)
      if (options.capitalizeAfterPeriod && /^\p{Ll}$/u.test(text)) {
        const before = view.state.sliceDoc(Math.max(0, from - 20), from);
        if (/(?:^|[^\.\p{N}])\.\s+$/u.test(before)) {
          const upper = text.toUpperCase();
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from, to: from + 1, insert: upper }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 4. Typographic quotes (smart quotes: " -> “/” and ' -> ‘/’)
      if (options.smartQuotes && (text === '"' || text === "'")) {
        const prevChar = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
        const isOpening = from === 0 || /\s/u.test(prevChar) || /[(\[{<«"'—–-]/.test(prevChar);
        const replacement = text === '"'
          ? (isOpening ? "“" : "”")
          : (isOpening ? "‘" : "’");

        view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
        view.dispatch({ changes: { from, to: from + 1, insert: replacement }, userEvent: "input.autocorrect" });
        return true;
      }

      return false;
    }),
  ];
}
