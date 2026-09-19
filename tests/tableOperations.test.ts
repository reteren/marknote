import { describe, expect, it } from "vitest";
import {
  parseMarkdownTable,
  formatMarkdownTable,
  addTableRow,
  addTableColumn,
  moveTableRow,
  moveTableColumn,
} from "../src/editor/tableOperations";

describe("tableOperations", () => {
  const sampleTable = [
    "| Left | Center | Right |",
    "| :--- | :---:  |  ---: |",
    "| A1   | B1     | C1    |",
    "| A2   | B2     | C2    |",
  ].join("\n");

  it("parses and formats markdown table accurately", () => {
    const parsed = parseMarkdownTable(sampleTable);
    expect(parsed).not.toBeNull();
    expect(parsed?.headers).toEqual(["Left", "Center", "Right"]);
    expect(parsed?.alignments).toEqual(["left", "center", "right"]);
    expect(parsed?.rows).toEqual([
      ["A1", "B1", "C1"],
      ["A2", "B2", "C2"],
    ]);

    const formatted = formatMarkdownTable(parsed!);
    const reparsed = parseMarkdownTable(formatted);
    expect(reparsed).toEqual(parsed);
  });

  it("adds a row at the end of the table", () => {
    const updated = addTableRow(sampleTable);
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.rows).toHaveLength(3);
    expect(parsed?.rows[0]).toEqual(["A1", "B1", "C1"]);
    expect(parsed?.rows[1]).toEqual(["A2", "B2", "C2"]);
    expect(parsed?.rows[2]).toEqual(["", "", ""]);
  });

  it("adds a row at a specific index", () => {
    const updated = addTableRow(sampleTable, 1);
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.rows).toHaveLength(3);
    expect(parsed?.rows[0]).toEqual(["A1", "B1", "C1"]);
    expect(parsed?.rows[1]).toEqual(["", "", ""]);
    expect(parsed?.rows[2]).toEqual(["A2", "B2", "C2"]);
  });

  it("adds a column at the right edge preserving alignment", () => {
    const updated = addTableColumn(sampleTable, undefined, "center");
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.headers).toEqual(["Left", "Center", "Right", ""]);
    expect(parsed?.alignments).toEqual(["left", "center", "right", "center"]);
    expect(parsed?.rows[0]).toEqual(["A1", "B1", "C1", ""]);
    expect(parsed?.rows[1]).toEqual(["A2", "B2", "C2", ""]);
  });

  it("adds a column at a specific index", () => {
    const updated = addTableColumn(sampleTable, 1, "right");
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.headers).toEqual(["Left", "", "Center", "Right"]);
    expect(parsed?.alignments).toEqual(["left", "right", "center", "right"]);
    expect(parsed?.rows[0]).toEqual(["A1", "", "B1", "C1"]);
    expect(parsed?.rows[1]).toEqual(["A2", "", "B2", "C2"]);
  });

  it("moves rows without corrupting table structure or data", () => {
    const updated = moveTableRow(sampleTable, 0, 1);
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[0]).toEqual(["A2", "B2", "C2"]);
    expect(parsed?.rows[1]).toEqual(["A1", "B1", "C1"]);
    // Headers and alignments must remain intact
    expect(parsed?.headers).toEqual(["Left", "Center", "Right"]);
    expect(parsed?.alignments).toEqual(["left", "center", "right"]);
  });

  it("moves a later body row to the first position", () => {
    const threeRows = `${sampleTable}\n| A3   | B3     | C3    |`;
    const updated = moveTableRow(threeRows, 2, 0);
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.rows).toEqual([
      ["A3", "B3", "C3"],
      ["A1", "B1", "C1"],
      ["A2", "B2", "C2"],
    ]);
  });

  it("moves columns and preserves their alignment across all rows", () => {
    // Move column 0 (Left, align left) to index 2 (at the end)
    const updated = moveTableColumn(sampleTable, 0, 2);
    const parsed = parseMarkdownTable(updated);
    expect(parsed?.headers).toEqual(["Center", "Right", "Left"]);
    expect(parsed?.alignments).toEqual(["center", "right", "left"]);
    expect(parsed?.rows[0]).toEqual(["B1", "C1", "A1"]);
    expect(parsed?.rows[1]).toEqual(["B2", "C2", "A2"]);
  });



  it("handles out of bounds indices gracefully without changing text", () => {
    expect(moveTableRow(sampleTable, -1, 1)).toBe(sampleTable);
    expect(moveTableRow(sampleTable, 0, 5)).toBe(sampleTable);
    expect(moveTableColumn(sampleTable, -1, 1)).toBe(sampleTable);
    expect(moveTableColumn(sampleTable, 0, 10)).toBe(sampleTable);
  });
});
