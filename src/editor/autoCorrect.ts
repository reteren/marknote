// Поддержка автозамены при наборе текста (settings.autoCorrect).
//
// Включает четыре правила:
// - smartQuotes: замена прямых кавычек "" и '' на парные «типографские»
// - doubleHyphenToEmDash: замена двух дефисов -- на длинное тире —
// - capitalizeAfterPeriod: заглавная буква после точки с пробелом
// - threeDotsToEllipsis: замена трёх точек ... на знак многоточия …
//
// Каждое правило срабатывает при наборе и отменяется одним нажатием Ctrl+Z
// (восстанавливая исходно набранные символы).
// Внутри блоков кода, инлайн-кода, формул и ссылок автозамена отключена.

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
      // Автозамена работает только для одиночных вводимых символов
      if (text.length !== 1) return false;

      // Внутри блоков кода, инлайн-кода, формул и ссылок замена не выполняется
      if (isInsideCodeFormulaOrLink(view.state, from)) return false;

      // 1. Двойной дефис в длинное тире (-- -> —)
      if (options.doubleHyphenToEmDash && text === "-" && from === to && from > 0) {
        if (view.state.sliceDoc(from - 1, from) === "-") {
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from: from - 1, to: from + 1, insert: "—" }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 2. Три точки в многоточие (... -> …)
      if (options.threeDotsToEllipsis && text === "." && from === to && from >= 2) {
        if (view.state.sliceDoc(from - 2, from) === "..") {
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from: from - 2, to: from + 1, insert: "…" }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 3. Заглавная буква после точки с пробелом (. + пробелы + строчная -> заглавная)
      if (options.capitalizeAfterPeriod && /^\p{Ll}$/u.test(text)) {
        const before = view.state.sliceDoc(Math.max(0, from - 20), from);
        if (/(?:^|[^\.\p{N}])\.\s+$/u.test(before)) {
          const upper = text.toUpperCase();
          view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.type" });
          view.dispatch({ changes: { from, to: from + 1, insert: upper }, userEvent: "input.autocorrect" });
          return true;
        }
      }

      // 4. Типографские кавычки (smart quotes: " -> “/” и ' -> ‘/’)
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
