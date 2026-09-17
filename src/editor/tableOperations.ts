export type TableAlignment = "left" | "center" | "right";

export interface ParsedTable {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
  trailingNewline: boolean;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === "\\") {
      current += ch;
      escaped = true;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);

  // Remove leading and trailing empty cell from outer pipes
  if (cells.length > 0 && cells[0].trim() === "") {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") {
    cells.pop();
  }

  return cells.map((c) => c.trim());
}

export function parseAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  const startsWithColon = trimmed.startsWith(":");
  const endsWithColon = trimmed.endsWith(":");
  if (startsWithColon && endsWithColon) return "center";
  if (endsWithColon) return "right";
  return "left";
}

export function formatDelimiterCell(alignment: TableAlignment, minWidth = 3): string {
  const len = Math.max(3, minWidth);
  if (alignment === "center") {
    return ":" + "-".repeat(Math.max(1, len - 2)) + ":";
  }
  if (alignment === "right") {
    return "-".repeat(Math.max(2, len - 1)) + ":";
  }
  return ":" + "-".repeat(Math.max(2, len - 1));
}

export function parseMarkdownTable(text: string): ParsedTable | null {
  const trailingNewline = text.endsWith("\n");
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length < 2) return null;

  const headers = splitRow(rawLines[0]);
  const delimiterCells = splitRow(rawLines[1]);

  if (headers.length === 0 || delimiterCells.length === 0) return null;

  const columnCount = Math.max(headers.length, delimiterCells.length);

  while (headers.length < columnCount) headers.push("");

  const alignments: TableAlignment[] = [];
  for (let c = 0; c < columnCount; c++) {
    const delim = delimiterCells[c] ?? "---";
    alignments.push(parseAlignment(delim));
  }

  const rows: string[][] = [];
  for (let i = 2; i < rawLines.length; i++) {
    const rowCells = splitRow(rawLines[i]);
    while (rowCells.length < columnCount) rowCells.push("");
    rows.push(rowCells.slice(0, columnCount));
  }

  return {
    headers,
    alignments,
    rows,
    trailingNewline,
  };
}

export function formatMarkdownTable(table: ParsedTable): string {
  const colCount = Math.max(table.headers.length, table.alignments.length, 1);

  // Compute column widths for clean formatting
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const headerLen = (table.headers[c] ?? "").length;
    const delimLen = 3;
    const maxRowLen = table.rows.reduce((max, row) => Math.max(max, (row[c] ?? "").length), 0);
    widths.push(Math.max(3, headerLen, delimLen, maxRowLen));
  }

  const formatLine = (cells: string[]) => {
    const parts = [];
    for (let c = 0; c < colCount; c++) {
      const val = cells[c] ?? "";
      parts.push(val.padEnd(widths[c], " "));
    }
    return `| ${parts.join(" | ")} |`;
  };

  const headerLine = formatLine(table.headers);
  const delimParts = table.alignments.map((a, c) => formatDelimiterCell(a, widths[c]));
  while (delimParts.length < colCount) {
    delimParts.push(formatDelimiterCell("left", widths[delimParts.length]));
  }
  const delimiterLine = `| ${delimParts.join(" | ")} |`;

  const rowLines = table.rows.map((row) => formatLine(row));

  const allLines = [headerLine, delimiterLine, ...rowLines];
  return allLines.join("\n") + (table.trailingNewline ? "\n" : "");
}

export function addTableRow(text: string, atIndex?: number): string {
  const table = parseMarkdownTable(text);
  if (!table) return text;

  const colCount = table.headers.length;
  const newRow = new Array(colCount).fill("");

  if (atIndex === undefined || atIndex >= table.rows.length) {
    table.rows.push(newRow);
  } else {
    const idx = Math.max(0, atIndex);
    table.rows.splice(idx, 0, newRow);
  }

  return formatMarkdownTable(table);
}

export function addTableColumn(text: string, atIndex?: number, alignment: TableAlignment = "left"): string {
  const table = parseMarkdownTable(text);
  if (!table) return text;

  const colCount = table.headers.length;
  const idx = atIndex === undefined || atIndex >= colCount ? colCount : Math.max(0, atIndex);

  table.headers.splice(idx, 0, "");
  table.alignments.splice(idx, 0, alignment);
  for (const row of table.rows) {
    row.splice(idx, 0, "");
  }

  return formatMarkdownTable(table);
}

export function moveTableRow(text: string, fromIndex: number, toIndex: number): string {
  const table = parseMarkdownTable(text);
  if (!table) return text;
  if (fromIndex < 0 || fromIndex >= table.rows.length || toIndex < 0 || toIndex >= table.rows.length || fromIndex === toIndex) {
    return text;
  }

  const [moved] = table.rows.splice(fromIndex, 1);
  table.rows.splice(toIndex, 0, moved);

  return formatMarkdownTable(table);
}

export function moveTableColumn(text: string, fromIndex: number, toIndex: number): string {
  const table = parseMarkdownTable(text);
  if (!table) return text;
  const colCount = table.headers.length;
  if (fromIndex < 0 || fromIndex >= colCount || toIndex < 0 || toIndex >= colCount || fromIndex === toIndex) {
    return text;
  }

  const [h] = table.headers.splice(fromIndex, 1);
  table.headers.splice(toIndex, 0, h);

  const [a] = table.alignments.splice(fromIndex, 1);
  table.alignments.splice(toIndex, 0, a);

  for (const row of table.rows) {
    const [c] = row.splice(fromIndex, 1);
    row.splice(toIndex, 0, c ?? "");
  }

  return formatMarkdownTable(table);
}


