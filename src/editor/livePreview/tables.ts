import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, type KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { BlockBuilder } from "./types";

type TableAlignment = "left" | "center" | "right";

type TableCellInfo = {
  node: SyntaxNode;
  column: number;
};

function rowCells(row: SyntaxNode): SyntaxNode[] {
  return row.getChildren("TableCell").sort((a, b) => a.from - b.from);
}

function tableRows(table: SyntaxNode): SyntaxNode[] {
  const rows: SyntaxNode[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader" || child.name === "TableRow") rows.push(child);
  }
  return rows;
}

function tableCells(table: SyntaxNode): TableCellInfo[] {
  return tableRows(table).flatMap((row) =>
    rowCells(row).map((node, column) => ({ node, column })),
  );
}

function alignmentFor(value: string): TableAlignment {
  const trimmed = value.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function separatorAlignments(state: EditorState, delimiter: SyntaxNode, columnCount: number): TableAlignment[] {
  const source = state.doc.sliceString(delimiter.from, delimiter.to);
  const parts = source.split("|");
  const cells = parts.length > 1 && parts[0].trim() === "" ? parts.slice(1) : parts;
  const withoutTrailing = cells.length > 0 && cells[cells.length - 1].trim() === "" ? cells.slice(0, -1) : cells;
  return Array.from({ length: columnCount }, (_, column) => alignmentFor(withoutTrailing[column] ?? ""));
}

function cellWidth(state: EditorState, cell: SyntaxNode): number {
  const content = state.doc.sliceString(cell.from, cell.to).trim();
  // Ширина хранится CSS-переменной, а класс отвечает только за выравнивание.
  // Это оставляет исходный Markdown неизменным и выравнивает строки визуально.
  return Math.max(4, Array.from(content).length + 2);
}

function addTableCell(
  ctx: Parameters<BlockBuilder>[0],
  cell: SyntaxNode,
  column: number,
  alignment: TableAlignment,
  width: number,
) {
  const className = [
    "cm-marknote-table-cell",
    `cm-marknote-table-column-${column + 1}`,
    `cm-marknote-table-align-${alignment}`,
  ].join(" ");
  const value = Decoration.mark({
    class: className,
    attributes: { style: `--marknote-table-column-width: ${width}ch` },
  });
  if (cell.to > cell.from) ctx.add({ from: cell.from, to: cell.to, value });
}

/** Построитель визуального вида GFM-таблиц. */
export const tableBuilder: BlockBuilder = (ctx) => {
  if (ctx.node.name !== "Table") return false;
  if (ctx.active) return true;

  const rows = tableRows(ctx.node);
  const cells = tableCells(ctx.node);
  const columnCount = Math.max(0, ...rows.map((row) => rowCells(row).length));
  const delimiter = ctx.node.getChild("TableDelimiter");
  const alignments = delimiter
    ? separatorAlignments(ctx.view.state, delimiter, columnCount)
    : Array.from({ length: columnCount }, () => "left" as TableAlignment);
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(4, ...cells.filter((cell) => cell.column === column).map((cell) => cellWidth(ctx.view.state, cell.node))),
  );

  for (const { node, column } of cells) {
    addTableCell(ctx, node, column, alignments[column] ?? "left", widths[column] ?? 4);
  }

  if (delimiter && delimiter.to > delimiter.from) {
    const hidden = Decoration.replace({});
    ctx.add({ from: delimiter.from, to: delimiter.to, value: hidden });
    ctx.atomic({ from: delimiter.from, to: delimiter.to, value: hidden });
  }

  return true;
};

function enclosingTable(view: EditorView, position: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolve(position, -1);
  while (node && node.name !== "Table") node = node.parent;
  return node;
}

function cellsInTable(table: SyntaxNode): SyntaxNode[] {
  return tableCells(table).map(({ node }) => node);
}

function moveToCell(view: EditorView, backward: boolean): boolean {
  const range = view.state.selection.main;
  const table = enclosingTable(view, range.head);
  if (!table) return false;

  const cells = cellsInTable(table);
  const current = cells.findIndex((cell) => range.head >= cell.from && range.head <= cell.to);
  if (current < 0 || cells.length === 0) return false;

  const target = backward
    ? cells[current - 1]
    : cells[current + 1];
  if (!target) return false;

  view.dispatch({
    selection: {
      anchor: backward ? target.to : target.from,
    },
  });
  return true;
}

/** Табличная навигация по ячейкам, подключается владельцем плагина. */
export const tableKeymap: KeyBinding[] = [
  { key: "Tab", run: (view) => moveToCell(view, false) },
  { key: "Shift-Tab", run: (view) => moveToCell(view, true) },
];

/** CSS для ячеек и разделителей таблицы. */
export const tableTheme = EditorView.theme({
  ".cm-marknote-table-cell": {
    display: "inline-block",
    minWidth: "var(--marknote-table-column-width)",
    padding: "0 0.4em",
    verticalAlign: "top",
    fontFamily: "var(--font-text)",
    fontSize: "var(--font-size-text)",
    lineHeight: "var(--line-height-text)",
  },
  ".cm-marknote-table-align-left": { textAlign: "left" },
  ".cm-marknote-table-align-center": { textAlign: "center" },
  ".cm-marknote-table-align-right": { textAlign: "right" },
});
