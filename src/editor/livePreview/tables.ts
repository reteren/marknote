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
    span.style.setProperty("--marknote-table-column-width", `${this.width}em`);
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

  const attrs: Record<string, string> = {
    style: `--marknote-table-column-width: ${width}em`,
  };
  if (isHeader) {
    attrs["data-col"] = `${column}`;
  }

  if (to > from) {
    const value = Decoration.mark({
      class: className,
      attributes: attrs,
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

function initColDrag(
  e: MouseEvent,
  view: EditorView,
  tableFrom: number,
  srcCol: number,
  totalCols: number,
  handleEl: HTMLElement,
) {
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;
  let hasMoved = false;
  let currentTargetCol = srcCol;

  const updateHighlights = (dragCol: number, targetCol: number) => {
    const dragCells = view.dom.querySelectorAll(`.cm-marknote-table-column-${dragCol + 1}`);
    dragCells.forEach((el) => el.classList.add("cm-marknote-col-dragging"));

    const allColCells = view.dom.querySelectorAll(".cm-marknote-table-cell");
    allColCells.forEach((el) => {
      el.classList.remove("cm-marknote-col-drop-target-left", "cm-marknote-col-drop-target-right");
    });
    if (targetCol !== dragCol) {
      const targetCells = view.dom.querySelectorAll(`.cm-marknote-table-column-${targetCol + 1}`);
      const dropClass = targetCol > dragCol ? "cm-marknote-col-drop-target-right" : "cm-marknote-col-drop-target-left";
      targetCells.forEach((el) => el.classList.add(dropClass));
    }
  };

  const clearHighlights = () => {
    view.dom.querySelectorAll(".cm-marknote-col-dragging").forEach((el) => el.classList.remove("cm-marknote-col-dragging"));
    view.dom.querySelectorAll(".cm-marknote-col-drop-target-left").forEach((el) => el.classList.remove("cm-marknote-col-drop-target-left"));
    view.dom.querySelectorAll(".cm-marknote-col-drop-target-right").forEach((el) => el.classList.remove("cm-marknote-col-drop-target-right"));
    handleEl.classList.remove("cm-marknote-handle-active");
    if (typeof document !== "undefined" && document.body) {
      document.body.style.cursor = "";
      document.body.classList.remove("cm-marknote-table-dragging");
    }
  };

  handleEl.classList.add("cm-marknote-handle-active");
  if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = "grabbing";
    document.body.classList.add("cm-marknote-table-dragging");
  }

  const onMouseMove = (moveEvent: MouseEvent) => {
    const deltaX = moveEvent.clientX - startX;
    if (Math.abs(deltaX) > 4) {
      hasMoved = true;
    }

    const headerRow = view.dom.querySelector(".cm-marknote-table-header-row");
    if (headerRow) {
      const headerCells = Array.from(headerRow.querySelectorAll(".cm-marknote-table-cell")) as HTMLElement[];
      for (let c = 0; c < headerCells.length; c++) {
        const rect = headerCells[c].getBoundingClientRect();
        if (moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right) {
          currentTargetCol = c;
          break;
        }
      }
    }

    updateHighlights(srcCol, currentTargetCol);
  };

  const onMouseUp = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    clearHighlights();

    if (hasMoved && currentTargetCol !== srcCol) {
      const currentTable = findEnclosingTable(view, tableFrom);
      if (!currentTable) return;
      const text = view.state.doc.sliceString(currentTable.from, currentTable.to);
      const updated = moveTableColumn(text, srcCol, currentTargetCol);
      view.dispatch({
        changes: { from: currentTable.from, to: currentTable.to, insert: updated },
      });
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }
  updateHighlights(srcCol, srcCol);
}

function initRowDrag(
  e: MouseEvent,
  view: EditorView,
  tableFrom: number,
  srcBodyRowIdx: number,
  totalBodyRows: number,
  handleEl: HTMLElement,
) {
  e.preventDefault();
  e.stopPropagation();

  const startY = e.clientY;
  let hasMoved = false;
  let currentTargetRow = srcBodyRowIdx;

  const updateHighlights = (dragRow: number, targetRow: number) => {
    const rowLines = Array.from(view.dom.querySelectorAll(".cm-line.cm-marknote-table-row:not(.cm-marknote-table-header-row)")) as HTMLElement[];
    rowLines.forEach((el, idx) => {
      el.classList.toggle("cm-marknote-row-dragging", idx === dragRow);
      el.classList.toggle("cm-marknote-row-drop-target", idx === targetRow && targetRow !== dragRow);
    });
  };

  const clearHighlights = () => {
    view.dom.querySelectorAll(".cm-marknote-row-dragging").forEach((el) => el.classList.remove("cm-marknote-row-dragging"));
    view.dom.querySelectorAll(".cm-marknote-row-drop-target").forEach((el) => el.classList.remove("cm-marknote-row-drop-target"));
    handleEl.classList.remove("cm-marknote-handle-active");
    if (typeof document !== "undefined" && document.body) {
      document.body.style.cursor = "";
      document.body.classList.remove("cm-marknote-table-dragging");
    }
  };

  handleEl.classList.add("cm-marknote-handle-active");
  if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = "grabbing";
    document.body.classList.add("cm-marknote-table-dragging");
  }

  const onMouseMove = (moveEvent: MouseEvent) => {
    const deltaY = moveEvent.clientY - startY;
    if (Math.abs(deltaY) > 4) {
      hasMoved = true;
    }

    const rowLines = Array.from(view.dom.querySelectorAll(".cm-line.cm-marknote-table-row:not(.cm-marknote-table-header-row)")) as HTMLElement[];
    for (let r = 0; r < rowLines.length; r++) {
      const rect = rowLines[r].getBoundingClientRect();
      if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
        currentTargetRow = r;
        break;
      }
    }

    updateHighlights(srcBodyRowIdx, currentTargetRow);
  };

  const onMouseUp = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    clearHighlights();

    if (hasMoved && currentTargetRow !== srcBodyRowIdx) {
      const currentTable = findEnclosingTable(view, tableFrom);
      if (!currentTable) return;
      const text = view.state.doc.sliceString(currentTable.from, currentTable.to);
      const updated = moveTableRow(text, srcBodyRowIdx, currentTargetRow);
      view.dispatch({
        changes: { from: currentTable.from, to: currentTable.to, insert: updated },
      });
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }
  updateHighlights(srcBodyRowIdx, srcBodyRowIdx);
}

/** Виджет кнопки «Добавить строку снизу» (тонкая полоска во всю ширину с плюсом по центру) */
export class TableAddRowWidget extends WidgetType {
  constructor(readonly tableFrom: number, readonly totalWidthEm: number = 0) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TableAddRowWidget &&
      other.tableFrom === this.tableFrom &&
      other.totalWidthEm === this.totalWidthEm
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-marknote-table-add-row-bar";
    if (this.totalWidthEm > 0) {
      container.style.width = `${this.totalWidthEm}em`;
    }

    const line = document.createElement("div");
    line.className = "cm-marknote-table-add-row-line";
    container.appendChild(line);

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

/** Виджет кнопки «Добавить столбец справа» (тонкая полоска во всю высоту с плюсом по центру) */
export class TableAddColWidget extends WidgetType {
  constructor(
    readonly tableFrom: number,
    readonly totalRows: number = 2,
    readonly totalWidthEm: number = 0,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TableAddColWidget &&
      other.tableFrom === this.tableFrom &&
      other.totalRows === this.totalRows &&
      other.totalWidthEm === this.totalWidthEm
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-marknote-table-add-col-bar";
    container.title = "Добавить столбец справа";
    container.setAttribute("aria-label", "Добавить столбец справа");
    if (this.totalWidthEm > 0) {
      container.style.left = `${this.totalWidthEm}em`;
    }

    const line = document.createElement("div");
    line.className = "cm-marknote-table-add-col-line";
    container.appendChild(line);

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
    container.appendChild(btn);

    const updateHeight = () => {
      const table = findEnclosingTable(view, this.tableFrom);
      if (!table) return;
      try {
        const topCoords = view.coordsAtPos(table.from);
        const bottomCoords = view.coordsAtPos(table.to);
        if (topCoords && bottomCoords && bottomCoords.bottom > topCoords.top) {
          container.style.height = `${bottomCoords.bottom - topCoords.top}px`;
          return;
        }
      } catch {
        // coordsAtPos might fail if unrendered/offscreen
      }
      container.style.height = `${Math.max(2, this.totalRows) * 2.2}em`;
    };

    container.style.height = `${Math.max(2, this.totalRows) * 2.2}em`;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(updateHeight);
    }

    container.addEventListener("mouseenter", () => {
      updateHeight();
      container.classList.add("cm-marknote-add-col-active");
    });
    container.addEventListener("mouseleave", () => {
      container.classList.remove("cm-marknote-add-col-active");
    });

    return container;
  }
}

/** Виджет ручки перемещения строки (толстая линия-ручка на левом краю) */
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
    container.setAttribute("data-row", `${this.rowIndex}`);

    const handle = document.createElement("div");
    handle.className = "cm-marknote-table-row-handle";
    handle.title = "Переместить строку";
    handle.setAttribute("aria-label", "Переместить строку");

    handle.addEventListener("mousedown", (e) => {
      initRowDrag(e, view, this.tableFrom, this.rowIndex, this.totalRows, handle);
    });

    container.appendChild(handle);
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

/** Виджет ручки перемещения столбца (толстая линия-ручка над столбцом) */
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
    container.setAttribute("data-col", `${this.colIndex}`);
    container.style.setProperty("--marknote-col-ctrl-width", `${this.width}em`);

    const hitarea = document.createElement("div");
    hitarea.className = "cm-marknote-table-col-hitarea";
    hitarea.setAttribute("data-col", `${this.colIndex}`);

    const handle = document.createElement("div");
    handle.className = "cm-marknote-table-col-handle";
    handle.title = "Переместить столбец";
    handle.setAttribute("aria-label", "Переместить столбец");

    handle.addEventListener("mousedown", (e) => {
      initColDrag(e, view, this.tableFrom, this.colIndex, this.totalCols, handle);
    });

    hitarea.appendChild(handle);
    container.appendChild(hitarea);
    return container;
  }
}

/** Построитель визуального вида GFM-таблиц. */
export const tableBuilder: BlockBuilder = (ctx) => {
  if (ctx.node.name !== "Table") return false;

  const isPreview = ctx.view.state.doc.sliceString(0, 200).includes("<!-- table-preview-controls -->");
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
    // Use em units so columns scale proportionally with text zoom (Ctrl + '+')
    // while keeping exact alignment between header and body rows.
    return Math.max(6, Math.ceil(maxLen * 0.65 + 2));
  });
  const totalWidthEm = widths.reduce((sum, w) => sum + w, 0);

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
          widget: new TableAddColWidget(ctx.node.from, rows.length, totalWidthEm),
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
        class: (isHeader
          ? "cm-marknote-table-row cm-marknote-table-header-row"
          : isLastRow
          ? "cm-marknote-table-row cm-marknote-table-last-row"
          : "cm-marknote-table-row") + (isPreview ? " cm-marknote-table-preview-controls" : ""),
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
      widget: new TableAddRowWidget(ctx.node.from, totalWidthEm),
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
    minHeight: "1.75em",
    padding: "0.25em 0.5em",
    verticalAlign: "top",
    whiteSpace: "normal",
    wordBreak: "break-word",
    fontFamily: "var(--font-text)",
    lineHeight: "var(--line-height-text)",
    color: "var(--text-normal)",
    backgroundColor: "transparent",
    borderRight: "1px solid var(--bg-modifier-border)",
    borderBottom: "1px solid var(--bg-modifier-border)",
    transition: "background-color 0.15s ease, border-color 0.15s ease",
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

  // Стили кнопок добавления строк и столбцов (тонкие полоски во всю длину/высоту с плюсом по центру)
  ".cm-marknote-table-add-row-bar": {
    position: "absolute",
    top: "100%",
    left: "0",
    width: "100%",
    height: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-in-out",
    zIndex: "10",
  },
  ".cm-line.cm-marknote-table-last-row:hover .cm-marknote-table-add-row-bar, .cm-marknote-table-add-row-bar:hover, .cm-line.cm-marknote-table-preview-controls .cm-marknote-table-add-row-bar": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-marknote-table-add-row-line": {
    position: "absolute",
    left: "0",
    right: "0",
    top: "50%",
    height: "2px",
    background: "var(--accent, #5EACC7)",
    borderRadius: "1px",
    pointerEvents: "none",
  },
  ".cm-marknote-table-btn": {
    fontFamily: "var(--font-interface, inherit)",
    cursor: "pointer",
    userSelect: "none",
    transition: "all 0.15s ease-in-out",
  },
  ".cm-marknote-table-add-row-btn": {
    position: "relative",
    zIndex: "2",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "16px",
    background: "var(--bg-primary, #202020)",
    border: "1px solid var(--accent, #5EACC7)",
    borderRadius: "8px",
    color: "var(--text-normal)",
    fontSize: "12px",
    fontWeight: "bold",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0",
    transition: "all 0.15s ease",
  },
  ".cm-marknote-table-add-row-btn:hover": {
    background: "var(--accent, #5EACC7)",
    color: "var(--text-on-accent, #ffffff)",
    transform: "scale(1.1)",
  },
  ".cm-marknote-table-btn-icon": {
    fontWeight: "bold",
    fontSize: "13px",
    lineHeight: "1",
  },
  ".cm-marknote-table-add-col-bar": {
    position: "absolute",
    top: "0",
    left: "100%",
    width: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-in-out",
    zIndex: "10",
  },
  ".cm-line.cm-marknote-table-header-row:hover .cm-marknote-table-add-col-bar, .cm-marknote-table-add-col-bar:hover, .cm-marknote-table-add-col-bar.cm-marknote-add-col-active, .cm-line.cm-marknote-table-preview-controls .cm-marknote-table-add-col-bar": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-marknote-table-add-col-line": {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "50%",
    width: "2px",
    transform: "translateX(-50%)",
    background: "var(--accent, #5EACC7)",
    borderRadius: "1px",
    pointerEvents: "none",
  },
  ".cm-marknote-table-add-col-btn": {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: "2",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "20px",
    background: "var(--bg-primary, #202020)",
    border: "1px solid var(--accent, #5EACC7)",
    borderRadius: "8px",
    color: "var(--text-normal)",
    fontSize: "12px",
    fontWeight: "bold",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0",
    transition: "all 0.15s ease",
  },
  ".cm-marknote-table-add-col-btn:hover": {
    background: "var(--accent, #5EACC7)",
    color: "var(--text-on-accent, #ffffff)",
    transform: "translate(-50%, -50%) scale(1.1)",
  },

  // Стили ручек перемещения строк и столбцов (толстые линии, HOVER ONLY)
  ".cm-marknote-table-row-controls": {
    position: "absolute",
    left: "-24px",
    top: "50%",
    transform: "translateY(-50%)",
    width: "20px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-in-out",
    userSelect: "none",
    zIndex: "10",
  },
  ".cm-line.cm-marknote-table-row:hover .cm-marknote-table-row-controls, .cm-marknote-table-row-controls:hover, .cm-line.cm-marknote-table-preview-controls .cm-marknote-table-row-controls": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-marknote-table-row-handle": {
    width: "18px",
    height: "4px",
    borderRadius: "2px",
    background: "var(--text-faint, #666)",
    cursor: "grab",
    transition: "background 0.15s ease, transform 0.1s ease",
  },
  ".cm-marknote-table-row-handle:hover": {
    background: "var(--text-muted, #888)",
  },
  ".cm-marknote-table-row-handle.cm-marknote-handle-active": {
    background: "var(--accent, #5EACC7) !important",
    cursor: "grabbing !important",
    transform: "scaleX(1.2)",
    boxShadow: "0 0 6px rgba(94, 172, 199, 0.6)",
  },

  ".cm-marknote-table-header-spacer": {
    display: "none !important",
    width: "0 !important",
    margin: "0 !important",
    padding: "0 !important",
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
    zIndex: "25",
    userSelect: "none",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  ".cm-marknote-table-col-hitarea": {
    position: "absolute",
    top: "-12px",
    left: "0",
    width: "var(--marknote-col-ctrl-width, 8em)",
    height: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
    cursor: "grab",
  },
  ".cm-marknote-table-col-handle": {
    width: "32px",
    height: "4px",
    borderRadius: "2px",
    background: "var(--text-faint, #666)",
    opacity: "0",
    pointerEvents: "auto",
    transition: "opacity 0.15s ease-in-out, background 0.15s ease, transform 0.1s ease",
    cursor: "grab",
  },
  ".cm-marknote-table-col-hitarea:hover .cm-marknote-table-col-handle, .cm-marknote-table-col-controls:hover .cm-marknote-table-col-handle, .cm-line.cm-marknote-table-preview-controls .cm-marknote-table-col-handle": {
    opacity: "1",
    background: "var(--text-muted, #888)",
  },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-1:hover) .cm-marknote-table-col-controls[data-col='0'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-2:hover) .cm-marknote-table-col-controls[data-col='1'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-3:hover) .cm-marknote-table-col-controls[data-col='2'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-4:hover) .cm-marknote-table-col-controls[data-col='3'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-5:hover) .cm-marknote-table-col-controls[data-col='4'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-6:hover) .cm-marknote-table-col-controls[data-col='5'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-7:hover) .cm-marknote-table-col-controls[data-col='6'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-8:hover) .cm-marknote-table-col-controls[data-col='7'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-9:hover) .cm-marknote-table-col-controls[data-col='8'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-line.cm-marknote-table-header-row:has(.cm-marknote-table-column-10:hover) .cm-marknote-table-col-controls[data-col='9'] .cm-marknote-table-col-handle": { opacity: "1" },
  ".cm-marknote-table-col-handle.cm-marknote-handle-active": {
    opacity: "1 !important",
    background: "var(--accent, #5EACC7) !important",
    cursor: "grabbing !important",
    transform: "scaleY(1.3)",
    boxShadow: "0 0 6px rgba(94, 172, 199, 0.6)",
  },

  // Подсветка перетаскиваемого столбца и строки акцентным цветом (#5EACC7)
  ".cm-marknote-table-cell.cm-marknote-col-dragging": {
    backgroundColor: "rgba(94, 172, 199, 0.16) !important",
    borderColor: "var(--accent, #5EACC7) !important",
  },
  ".cm-marknote-table-cell.cm-marknote-col-drop-target-left": {
    borderLeft: "3px solid var(--accent, #5EACC7) !important",
  },
  ".cm-marknote-table-cell.cm-marknote-col-drop-target-right": {
    borderRight: "3px solid var(--accent, #5EACC7) !important",
  },
  ".cm-line.cm-marknote-table-row.cm-marknote-row-dragging .cm-marknote-table-cell": {
    backgroundColor: "rgba(94, 172, 199, 0.16) !important",
    borderTop: "2px solid var(--accent, #5EACC7) !important",
    borderBottom: "2px solid var(--accent, #5EACC7) !important",
  },
  ".cm-line.cm-marknote-table-row.cm-marknote-row-drop-target .cm-marknote-table-cell": {
    borderTop: "3px solid var(--accent, #5EACC7) !important",
  },
});
