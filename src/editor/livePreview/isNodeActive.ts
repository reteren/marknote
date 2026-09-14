import type { EditorSelection, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

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
  "TaskMarker",
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
 */
export function isNodeActive(node: SyntaxNode, selection: EditorSelection, doc?: Text): boolean {
  const range = nodeActivationRange(node, doc);
  return selection.ranges.some((selectionRange) =>
    selectionRange.from <= range.to && selectionRange.to >= range.from,
  );
}
