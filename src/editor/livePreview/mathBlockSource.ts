// Общее для плагина предпросмотра и поля состояния: где у блока `$$` формула и
// занимает ли он несколько строк. Оба места должны решать это одинаково,
// иначе блок либо нарисуется дважды, либо не нарисуется вовсе.

import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export function spansSeveralLines(state: EditorState, node: SyntaxNode): boolean {
  // Ровно тот признак, по которому CodeMirror запрещает замену из плагина:
  // диапазон перекрывает перевод строки. Считать по `node.to - 1` нельзя —
  // блок `$$\n` тогда выглядит однострочным, а замена всё равно съедает
  // перевод строки, и редактор падает с RangeError.
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
