// Shared by the preview plugin and state field: where a `$$` block's formula is
// and whether it spans multiple lines. Both locations must decide identically,
// or the block is either rendered twice or not at all.

import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export function spansSeveralLines(state: EditorState, node: SyntaxNode): boolean {
  // This is exactly the condition that makes CodeMirror forbid a plugin
  // replacement: the range covers a line break. Do not calculate it from
  // `node.to - 1`: `$$\n` would then look single-line even though the replacement
  // still consumes the line break, causing a RangeError in the editor.
  const first = state.doc.lineAt(Math.min(node.from, state.doc.length)).number;
  const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
  return last > first;
}

export function mathBlockSource(state: EditorState, node: SyntaxNode): string {
  const marks = node.getChildren("MathMark").sort((a, b) => a.from - b.from);
  const from = marks[0]?.to ?? node.from + 2;
  const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
  return state.doc.sliceString(from, to).replace(/^\r?\n|\r?\n$/g, "");
}
