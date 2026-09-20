import type { EditorSelection, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { MarkupRevealMode } from "../../state/settings.svelte";

const lineScopedNames = new Set([
  // A formula block stays open while the cursor is on any of its lines:
  // otherwise newly typed `$$` would hide under the widget and could not be completed.
  "MathBlock",
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

/** Returns the zone considered active for a specific node. */
export function nodeActivationRange(node: SyntaxNode, doc?: Text): { from: number; to: number } {
  if (!doc || !lineScopedNames.has(node.name)) return { from: node.from, to: node.to };
  const fromLine = doc.lineAt(Math.min(node.from, doc.length));
  const toLine = doc.lineAt(Math.min(node.to, doc.length));
  return { from: fromLine.from, to: toLine.to };
}

/**
 * Live preview has one rule: a selection intersects a node, including both
 * boundaries. For heading, list, and quote markers, the whole line is used.
 *
 * The revealMarkup mode controls when markup is shown:
 * - "cursor": the node opens only when the cursor crosses its zone;
 * - "line": the entire cursor line opens;
 * - "never": markup is never hidden (the node is always active).
 *
 * Exception: TaskMarker remains a checkbox widget even when the cursor is on
 * the task's text line and opens into source text only when the marker itself is used.
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
