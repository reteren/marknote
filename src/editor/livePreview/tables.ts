import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { BlockBuilder } from "./types";
import {
  addTableRow,
  addTableColumn,
  moveTableRow,
  moveTableColumn,
  parseMarkdownTable,
  formatMarkdownTable,
  type TableAlignment,
} from "../tableOperations";

export {
  addTableRow,
  addTableColumn,
  moveTableRow,
  moveTableColumn,
  parseMarkdownTable,
  formatMarkdownTable,
  type TableAlignment,
};

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

function getCellColumn(row: SyntaxNode, cell: SyntaxNode): number {
  const delimiters = row.getChildren("TableDelimiter").sort((a, b) => a.from - b.from);
  if (delimiters.length === 0) return 0;
  const hasLeading = delimiters[0].from <= row.from + 1;
  const pipesBefore = delimiters.filter((d) => d.to <= cell.from).length;
  return Math.max(0, hasLeading ? pipesBefore - 1 : pipesBefore);
}

function tableCells(table: SyntaxNode): TableCellInfo[] {
  return tableRows(table).flatMap((row) =>
    rowCells(row).map((node) => ({ node, column: getCellColumn(row, node) })),
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

interface RowCellItem {
  col: number;
  from: number;
  to: number;
  node: SyntaxNode | null;
}

function getRowCellItems(row: SyntaxNode): RowCellItem[] {
  const delimiters = row.getChildren("TableDelimiter").sort((a, b) => a.from - b.from);
  const textNodes = row.getChildren("TableCell").sort((a, b) => a.from - b.from);
  const items: RowCellItem[] = [];

  if (delimiters.length === 0) {
    textNodes.forEach((node, col) => {
      items.push({ col, from: node.from, to: node.to, node });
    });
    return items;
  }

  let colIdx = 0;
  if (delimiters[0].from > row.from) {
    const from = row.from;
    const to = delimiters[0].from;
    const node = textNodes.find((tn) => tn.from >= from && tn.to <= to) ?? null;
    items.push({ col: colIdx++, from: node ? node.from : from, to: node ? node.to : to, node });
  }

  for (let i = 0; i < delimiters.length - 1; i++) {
    const from = delimiters[i].to;
    const to = delimiters[i + 1].from;
    const node = textNodes.find((tn) => tn.from >= from && tn.to <= to) ?? null;
    items.push({ col: colIdx++, from: node ? node.from : from, to: node ? node.to : to, node });
  }

  const lastDelim = delimiters[delimiters.length - 1];
  if (lastDelim.to < row.to) {
    const from = lastDelim.to;
    const to = row.to;
    const node = textNodes.find((tn) => tn.from >= from && tn.to <= to) ?? null;
    items.push({ col: colIdx++, from: node ? node.from : from, to: node ? node.to : to, node });
  }

  return items;
}

export class TableEmptyCellWidget extends WidgetType {
  constructor(readonly className: string, readonly width: number) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof TableEmptyCellWidget && other.className === this.className && other.width === this.width;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.style.setProperty("--marknote-table-column-width", `${this.width}px`);
    return span;
  }
}

function addTableCell(
  ctx: Parameters<BlockBuilder>[0],
  from: number,
  to: number,
  column: number,
  alignment: TableAlignment,
  width: number,
  isHeader: boolean,
) {
  const className = [
    "cm-marknote-table-cell",
    ...(isHeader ? ["cm-marknote-table-header-cell"] : []),
    `cm-marknote-table-column-${column + 1}`,
    `cm-marknote-table-align-${alignment}`,
  ].join(" ");

  if (to > from) {
    const value = Decoration.mark({
      class: className,
      attributes: { style: `--marknote-table-column-width: ${width}px` },
    });
    ctx.add({ from, to, value });
  } else {
    const value = Decoration.widget({
      widget: new TableEmptyCellWidget(className, width),
      side: 1,
    });
    ctx.add({ from, to: from, value });
  }
}

function hideRowDelimitersAndGaps(
  ctx: Parameters<BlockBuilder>[0],
  row: SyntaxNode,
  delimiters: SyntaxNode[],
  cellItems: RowCellItem[],
) {
  const hide = Decoration.replace({});

  // 1. Скрываем все вертикальные черты таблицы (|)
  for (const delim of delimiters) {
    if (delim.to > delim.from) {
      ctx.add({ from: delim.from, to: delim.to, value: hide });
      ctx.atomic({ from: delim.from, to: delim.to, value: hide });
    }
  }

  // 2. Скрываем промежутки между разделителями и текстом ячейки (пробелы разметки)
  if (delimiters.length > 1) {
    for (let i = 0; i < delimiters.length - 1; i++) {
      const dLeft = delimiters[i];
      const dRight = delimiters[i + 1];
      const item = cellItems[i];
      if (!item) continue;

      if (item.node) {
        if (item.from > dLeft.to) {
          ctx.add({ from: dLeft.to, to: item.from, value: hide });
          ctx.atomic({ from: dLeft.to, to: item.from, value: hide });
        }
        if (dRight.from > item.to) {
          ctx.add({ from: item.to, to: dRight.from, value: hide });
          ctx.atomic({ from: item.to, to: dRight.from, value: hide });
        }
      }
    }
  }
}

function findEnclosingTable(view: EditorView, position: number): SyntaxNode | null {
  const tree = syntaxTree(view.state);
  const safePos = Math.max(0, Math.min(position, view.state.doc.length));
  let node: SyntaxNode | null = tree.resolve(safePos, 1);
  while (node && node.name !== "Table") node = node.parent;
  if (!node) {
    node = tree.resolve(safePos, -1);
    while (node && node.name !== "Table") node = node.parent;
  }
  return node;
}

/** Виджет кнопки «Добавить строку снизу» */
export class TableAddRowWidget extends WidgetType {
  constructor(readonly tableFrom: number) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof TableAddRowWidget && other.tableFrom === this.tableFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-marknote-table-add-row-bar";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-marknote-table-btn cm-marknote-table-add-row-btn";
    btn.title = "Добавить строку снизу";
    btn.setAttribute("aria-label", "Добавить строку снизу");

    const icon = document.createElement("span");
    icon.className = "cm-marknote-table-btn-icon";
    icon.textContent = "+";
    btn.appendChild(icon);

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const table = findEnclosingTable(view, this.tableFrom);
      if (!table) return;
      const text = view.state.doc.sliceString(table.from, table.to);
      const updated = addTableRow(text);
      view.dispatch({
        changes: { from: table.from, to: table.to, insert: updated },
      });
    });

    container.appendChild(btn);
    return container;
  }
}

/** Виджет кнопки «Добавить столбец справа» */
export class TableAddColWidget extends WidgetType {
  constructor(readonly tableFrom: number) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof TableAddColWidget && other.tableFrom === this.tableFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-marknote-table-btn cm-marknote-table-add-col-btn";
    btn.title = "Добавить столбец справа";
    btn.setAttribute("aria-label", "Добавить столбец справа");
    btn.textContent = "+";

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const table = findEnclosingTable(view, this.tableFrom);
      if (!table) return;
      const text = view.state.doc.sliceString(table.from, table.to);
      const updated = addTableColumn(text);
      view.dispatch({
        changes: { from: table.from, to: table.to, insert: updated },
      });
    });

    return btn;
  }
}

/** Виджет ручки перемещения строки */
export class TableRowControlWidget extends WidgetType {
  constructor(
    readonly tableFrom: number,
    readonly rowIndex: number,
    readonly totalRows: number,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TableRowControlWidget &&
      other.tableFrom === this.tableFrom &&
      other.rowIndex === this.rowIndex &&
      other.totalRows === this.totalRows
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-marknote-table-row-controls";

    if (this.rowIndex > 0) {
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "cm-marknote-table-move-btn cm-marknote-table-move-up";
      upBtn.title = "Переместить строку вверх";
      upBtn.setAttribute("aria-label", "Переместить строку вверх");
      upBtn.textContent = "▲";
      upBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const table = findEnclosingTable(view, this.tableFrom);
        if (!table) return;
        const text = view.state.doc.sliceString(table.from, table.to);
        const updated = moveTableRow(text, this.rowIndex, this.rowIndex - 1);
        view.dispatch({
          changes: { from: table.from, to: table.to, insert: updated },
        });
      });
      container.appendChild(upBtn);
    } else {
      const ph = document.createElement("span");
      ph.className = "cm-marknote-table-btn-placeholder";
      container.appendChild(ph);
    }

    const grip = document.createElement("span");
    grip.className = "cm-marknote-table-grip cm-marknote-table-row-grip";
    grip.textContent = "⠿";
    grip.title = "Переместить строку";
    container.appendChild(grip);

    if (this.rowIndex < this.totalRows - 1) {
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "cm-marknote-table-move-btn cm-marknote-table-move-down";
      downBtn.title = "Переместить строку вниз";
      downBtn.setAttribute("aria-label", "Переместить строку вниз");
      downBtn.textContent = "▼";
      downBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const table = findEnclosingTable(view, this.tableFrom);
        if (!table) return;
        const text = view.state.doc.sliceString(table.from, table.to);
        const updated = moveTableRow(text, this.rowIndex, this.rowIndex + 1);
        view.dispatch({
          changes: { from: table.from, to: table.to, insert: updated },
        });
      });
      container.appendChild(downBtn);
    } else {
      const ph = document.createElement("span");
      ph.className = "cm-marknote-table-btn-placeholder";
      container.appendChild(ph);
    }

    return container;
  }
}

/** Спейсер для выравнивания шапки с ручками строк */
export class TableColSpacerWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-marknote-table-header-spacer";
    return el;
  }
}

/** Виджет ручки перемещения столбца */
export class TableColControlWidget extends WidgetType {
  constructor(
    readonly tableFrom: number,
    readonly colIndex: number,
    readonly totalCols: number,
    readonly width: number = 8,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TableColControlWidget &&
      other.tableFrom === this.tableFrom &&
      other.colIndex === this.colIndex &&
      other.totalCols === this.totalCols &&
      other.width === this.width
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-marknote-table-col-controls";
    container.style.setProperty("--marknote-col-ctrl-width", `${this.width}px`);

    if (this.colIndex > 0) {
      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "cm-marknote-table-move-btn cm-marknote-table-move-left";
      leftBtn.title = "Переместить столбец влево";
      leftBtn.setAttribute("aria-label", "Переместить столбец влево");
      leftBtn.textContent = "◀";
      leftBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const table = findEnclosingTable(view, this.tableFrom);
        if (!table) return;
        const text = view.state.doc.sliceString(table.from, table.to);
        const updated = moveTableColumn(text, this.colIndex, this.colIndex - 1);
        view.dispatch({
          changes: { from: table.from, to: table.to, insert: updated },
        });
      });
      container.appendChild(leftBtn);
    } else {
      const ph = document.createElement("span");
      ph.className = "cm-marknote-table-btn-placeholder";
      container.appendChild(ph);
    }

    const grip = document.createElement("span");
    grip.className = "cm-marknote-table-grip cm-marknote-table-col-grip";
    grip.textContent = "⋯";
    grip.title = "Переместить столбец";
    container.appendChild(grip);

    if (this.colIndex < this.totalCols - 1) {
      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "cm-marknote-table-move-btn cm-marknote-table-move-right";
      rightBtn.title = "Переместить столбец вправо";
      rightBtn.setAttribute("aria-label", "Переместить столбец вправо");
      rightBtn.textContent = "▶";
      rightBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const table = findEnclosingTable(view, this.tableFrom);
        if (!table) return;
        const text = view.state.doc.sliceString(table.from, table.to);
        const updated = moveTableColumn(text, this.colIndex, this.colIndex + 1);
        view.dispatch({
          changes: { from: table.from, to: table.to, insert: updated },
        });
      });
      container.appendChild(rightBtn);
    } else {
      const ph = document.createElement("span");
      ph.className = "cm-marknote-table-btn-placeholder";
      container.appendChild(ph);
    }

    return container;
  }
}

/** Построитель визуального вида GFM-таблиц. */
export const tableBuilder: BlockBuilder = (ctx) => {
  if (ctx.node.name !== "Table") return false;

  const rows = tableRows(ctx.node);
  const bodyRows = rows.filter((r) => r.name === "TableRow");
  const delimiter = ctx.node.getChild("TableDelimiter");

  const rowCellList = rows.map((r) => getRowCellItems(r));
  const columnCount = Math.max(2, ...rowCellList.map((cells) => cells.length));
  const alignments = delimiter
    ? separatorAlignments(ctx.view.state, delimiter, columnCount)
    : Array.from({ length: columnCount }, () => "left" as TableAlignment);

  const widths = Array.from({ length: columnCount }, (_, col) => {
    const colCells = rowCellList.flatMap((cells) => cells.filter((c) => c.col === col));
    const maxLen = colCells.reduce((max, cell) => {
      const text = ctx.view.state.doc.sliceString(cell.from, cell.to).trim();
      return Math.max(max, text.length);
    }, 0);
    // Use consistent pixel widths so font-weight differences between header (600) and body (400)
    // do not cause column misalignment (which happens if using 'ch' units).
    return Math.max(100, maxLen * 10 + 24);
  });

  let bodyRowIdx = 0;
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const isHeader = row.name === "TableHeader";
    const rCells = rowCellList[rIdx];
    const rDelimiters = row.getChildren("TableDelimiter").sort((a, b) => a.from - b.from);

    // Скрываем вертикальные черты и пробелы разметки в строке
    hideRowDelimitersAndGaps(ctx, row, rDelimiters, rCells);

    // Для строки шапки добавляем спейсер
    if (isHeader) {
      ctx.add({
        from: row.from,
        to: row.from,
        value: Decoration.widget({
          widget: new TableColSpacerWidget(),
          side: -1,
        }),
      });
    }

    // Для строк данных добавляем ручку перемещения строки
    if (!isHeader) {
      const curIdx = bodyRowIdx++;
      ctx.add({
        from: row.from,
        to: row.from,
        value: Decoration.widget({
          widget: new TableRowControlWidget(ctx.node.from, curIdx, bodyRows.length),
          side: -1,
        }),
      });
    }

    // Оформляем ячейки строки
    for (const cell of rCells) {
      const col = cell.col;

      // Для шапки добавляем ручку перемещения столбца
      if (isHeader) {
        ctx.add({
          from: cell.from,
          to: cell.from,
          value: Decoration.widget({
            widget: new TableColControlWidget(ctx.node.from, col, columnCount, widths[col]),
            side: 1,
          }),
        });
      }

      addTableCell(ctx, cell.from, cell.to, col, alignments[col] ?? "left", widths[col] ?? 8, isHeader);
    }

    // В шапке добавляем кнопку добавления столбца справа
    if (isHeader) {
      ctx.add({
        from: row.to,
        to: row.to,
        value: Decoration.widget({
          widget: new TableAddColWidget(ctx.node.from),
          side: -1,
        }),
      });
    }

    // Класс строки
    const isLastRow = row === rows[rows.length - 1];
    const lineStart = ctx.view.state.doc.lineAt(row.from).from;
    ctx.add({
      from: lineStart,
      to: lineStart,
      value: Decoration.line({
        class: isHeader
          ? "cm-marknote-table-row cm-marknote-table-header-row"
          : isLastRow
          ? "cm-marknote-table-row cm-marknote-table-last-row"
          : "cm-marknote-table-row",
      }),
    });
  }

  // Скрываем строку-разделитель (синтаксическую строку Markdown)
  if (delimiter && delimiter.to > delimiter.from) {
    const hidden = Decoration.replace({});
    ctx.add({ from: delimiter.from, to: delimiter.to, value: hidden });
    ctx.atomic({ from: delimiter.from, to: delimiter.to, value: hidden });

    const lineStart = ctx.view.state.doc.lineAt(delimiter.from).from;
    ctx.add({
      from: lineStart,
      to: lineStart,
      value: Decoration.line({ class: "cm-marknote-table-delimiter-row" }),
    });
  }

  // Внизу таблицы добавляем кнопку добавления строки снизу
  const lastRow = rows[rows.length - 1];
  const addRowPos = lastRow ? lastRow.to : ctx.node.to;
  ctx.add({
    from: addRowPos,
    to: addRowPos,
    value: Decoration.widget({
      widget: new TableAddRowWidget(ctx.node.from),
      side: -1,
    }),
  });

  return true;
};

function enclosingTable(view: EditorView, position: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolve(position, -1);
  while (node && node.name !== "Table") node = node.parent;
  return node;
}

function cellsInTable(table: SyntaxNode): Array<{ from: number; to: number }> {
  const rows = tableRows(table);
  return rows.flatMap((row) => {
    const items = getRowCellItems(row);
    return items.map((item) => ({ from: item.from, to: item.to }));
  });
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
  if (!target) {
    if (!backward && current === cells.length - 1) {
      // Tab на последней ячейке добавляет новую строку
      const text = view.state.doc.sliceString(table.from, table.to);
      const updated = addTableRow(text);
      view.dispatch({
        changes: { from: table.from, to: table.to, insert: updated },
      });
      const newTable = enclosingTable(view, range.head);
      if (newTable) {
        const newCells = cellsInTable(newTable);
        const nextCell = newCells[current + 1];
        if (nextCell) {
          view.dispatch({ selection: { anchor: nextCell.from } });
        }
      }
      return true;
    }
    return false;
  }

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

/** CSS для ячеек, разделителей, ручек и кнопок таблицы. */
export const tableTheme = EditorView.theme({
  ".cm-line.cm-marknote-table-row": {
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "stretch",
    position: "relative",
  },
  ".cm-line.cm-marknote-table-last-row": {
    flexWrap: "wrap",
  },
  ".cm-line.cm-marknote-table-delimiter-row": {
    display: "none",
    height: "0 !important",
    lineHeight: "0 !important",
    fontSize: "0 !important",
    margin: "0 !important",
    padding: "0 !important",
    overflow: "hidden !important",
    border: "none !important",
  },
  ".cm-marknote-table-cell": {
    display: "inline-block",
    boxSizing: "border-box",
    width: "var(--marknote-table-column-width)",
    minWidth: "var(--marknote-table-column-width)",
    minHeight: "28px",
    padding: "4px 8px",
    verticalAlign: "top",
    whiteSpace: "normal",
    wordBreak: "break-word",
    fontFamily: "var(--font-text)",
    fontSize: "var(--font-size-text)",
    lineHeight: "var(--line-height-text)",
    color: "var(--text-normal)",
    backgroundColor: "transparent",
    borderRight: "1px solid var(--bg-modifier-border)",
    borderBottom: "1px solid var(--bg-modifier-border)",
  },
  ".cm-marknote-table-column-1": {
    borderLeft: "1px solid var(--bg-modifier-border)",
  },
  ".cm-marknote-table-header-cell": {
    fontWeight: "600",
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-normal)",
    borderTop: "1px solid var(--bg-modifier-border)",
    borderBottom: "1px solid var(--bg-modifier-border)",
  },
  ".cm-marknote-table-align-left": { textAlign: "left" },
  ".cm-marknote-table-align-center": { textAlign: "center" },
  ".cm-marknote-table-align-right": { textAlign: "right" },

  // Стили кнопок добавления строк и столбцов (HOVER ONLY)
  ".cm-marknote-table-add-row-bar": {
    position: "absolute",
    top: "100%",
    left: "0",
    width: "100%",
    height: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    pointerEvents: "auto",
    transition: "opacity 0.15s ease-in-out",
    zIndex: "10",
  },
  ".cm-line.cm-marknote-table-last-row:hover .cm-marknote-table-add-row-bar, .cm-marknote-table-add-row-bar:hover": {
    opacity: "1",
  },
  ".cm-marknote-table-btn": {
    fontFamily: "var(--font-interface, inherit)",
    cursor: "pointer",
    userSelect: "none",
    transition: "all 0.15s ease-in-out",
  },
  ".cm-marknote-table-add-row-btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "18px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--bg-modifier-border)",
    borderRadius: "3px",
    color: "var(--text-muted)",
    fontSize: "12px",
    fontWeight: "bold",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0",
  },
  ".cm-marknote-table-add-row-btn:hover": {
    background: "var(--bg-modifier-hover)",
    borderColor: "var(--interactive-accent)",
    color: "var(--text-normal)",
  },
  ".cm-marknote-table-btn-icon": {
    fontWeight: "bold",
    fontSize: "13px",
    lineHeight: "1",
  },
  ".cm-marknote-table-add-col-btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    marginLeft: "4px",
    alignSelf: "center",
    flexShrink: "0",
    background: "var(--bg-secondary)",
    border: "1px solid var(--bg-modifier-border)",
    borderRadius: "3px",
    color: "var(--text-muted)",
    fontSize: "12px",
    fontWeight: "bold",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0",
    opacity: "0",
    pointerEvents: "auto",
    transition: "opacity 0.15s ease-in-out, background-color 0.1s ease",
  },
  ".cm-line.cm-marknote-table-header-row:hover .cm-marknote-table-add-col-btn, .cm-marknote-table-add-col-btn:hover": {
    opacity: "1",
  },
  ".cm-marknote-table-add-col-btn:hover": {
    background: "var(--bg-modifier-hover)",
    borderColor: "var(--interactive-accent)",
    color: "var(--text-normal)",
  },

  // Стили ручек и кнопок перемещения строк и столбцов (HOVER ONLY)
  ".cm-marknote-table-row-controls": {
    position: "absolute",
    right: "100%",
    top: "50%",
    transform: "translateY(-50%)",
    marginRight: "4px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "1px",
    width: "30px",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-in-out",
    userSelect: "none",
    zIndex: "10",
  },
  ".cm-line.cm-marknote-table-row:hover .cm-marknote-table-row-controls, .cm-marknote-table-row-controls:hover": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-marknote-table-header-spacer": {
    display: "none !important",
    width: "0 !important",
    margin: "0 !important",
    padding: "0 !important",
  },
  ".cm-marknote-table-btn-placeholder": {
    display: "inline-block",
    width: "11px",
    height: "11px",
  },
  ".cm-marknote-table-col-controls": {
    position: "relative",
    width: "0 !important",
    minWidth: "0 !important",
    maxWidth: "0 !important",
    height: "0 !important",
    margin: "0 !important",
    padding: "0 !important",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-in-out",
    zIndex: "20",
    userSelect: "none",
    whiteSpace: "nowrap",
    left: "calc(var(--marknote-col-ctrl-width, 8ch) / 2)",
    top: "-3px",
    transform: "translate(-50%, -100%)",
  },
  ".cm-line.cm-marknote-table-header-row:hover .cm-marknote-table-col-controls, .cm-marknote-table-col-controls:hover": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-marknote-table-grip": {
    color: "var(--text-faint)",
    fontSize: "11px",
    cursor: "grab",
    padding: "0 1px",
  },
  ".cm-marknote-table-move-btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "11px",
    height: "11px",
    padding: "0",
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: "7px",
    lineHeight: "1",
    cursor: "pointer",
    borderRadius: "2px",
    transition: "all 0.1s ease",
  },
  ".cm-marknote-table-move-btn:hover": {
    background: "var(--bg-modifier-hover)",
    color: "var(--text-normal)",
  },
});
