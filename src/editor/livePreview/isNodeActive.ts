import type { EditorSelection, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { MarkupRevealMode } from "../../state/settings.svelte";

const lineScopedNames = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "HeaderMark",
  "ListMark",
  "QuoteMark",
  "Callout",
  "CalloutMark",
  "CalloutTitle",
]);

/** Возвращает зону, которую нужно считать раскрытой для конкретного узла. */
export function nodeActivationRange(node: SyntaxNode, doc?: Text): { from: number; to: number } {
  if (!doc || !lineScopedNames.has(node.name)) return { from: node.from, to: node.to };
  const fromLine = doc.lineAt(Math.min(node.from, doc.length));
  const toLine = doc.lineAt(Math.min(node.to, doc.length));
  return { from: fromLine.from, to: toLine.to };
}

/**
 * Единое правило живого предпросмотра: выделение пересекает узел, включая
 * обе границы. Для маркеров заголовка, списка и цитаты берётся вся строка.
 *
 * Режим revealMarkup управляет тем, когда разметка раскрывается:
 * - "cursor": узел раскрывается только когда курсор пересекает его зону;
 * - "line": раскрывается вся строка с курсором;
 * - "never": разметка не прячется вообще (узел всегда активен).
 *
 * Исключение: TaskMarker остаётся виджетом-чекбоксом даже когда курсор находится
 * на той же строке в тексте задачи, и раскрывается в исходный текст только при
 * взаимодействии с самим маркером.
 */
export function isNodeActive(
  node: SyntaxNode,
  selection: EditorSelection,
  doc?: Text,
  mode: MarkupRevealMode = "cursor",
): boolean {
  if (mode === "never") return true;

  if (node.name === "TaskMarker") {
    return selection.ranges.some((selectionRange) =>
      selectionRange.empty
        ? selectionRange.from > node.from && selectionRange.from < node.to
        : selectionRange.from < node.to && selectionRange.to > node.from,
    );
  }

  const range = mode === "line" && doc
    ? {
        from: doc.lineAt(Math.min(node.from, doc.length)).from,
        to: doc.lineAt(Math.min(node.to, doc.length)).to,
      }
    : nodeActivationRange(node, doc);

  return selection.ranges.some((selectionRange) =>
    selectionRange.from <= range.to && selectionRange.to >= range.from,
  );
}
