// @vitest-environment jsdom
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { tableBuilder, tableKeymap } from "../src/editor/livePreview/tables";
import type { BuilderContext } from "../src/editor/livePreview/types";

function tableState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM, addKeymap: false })],
  });
}

function buildTable(state: EditorState, active = false) {
  const node = syntaxTree(state).topNode.getChild("Table");
  if (!node) throw new Error("test document did not parse as a table");

  const decorations: Array<Range<Decoration>> = [];
  const atomic: Array<Range<Decoration>> = [];
  const view = { state, dispatch: () => undefined } as unknown as EditorView;
  const context: BuilderContext = {
    view,
    node,
    active,
    add: (range) => decorations.push(range),
    atomic: (range) => atomic.push(range),
  };
  expect(tableBuilder(context)).toBe(true);
  return { node, decorations, atomic };
}

describe("tableBuilder", () => {
  const doc = ["| Left | Center | Right |", "| :--- | :---: | ---: |", "| a | b | c |"].join("\n");

  it("marks left, center, and right aligned columns and hides the separator row", () => {
    const state = tableState(doc);
    const { node, decorations, atomic } = buildTable(state);
    const delimiter = node.getChild("TableDelimiter");
    if (!delimiter) throw new Error("test document did not have a delimiter row");

    const cellClasses = decorations
      .map(({ value }) => value.spec.class)
      .filter((className): className is string => typeof className === "string" && className.includes("table-cell"));
    expect(cellClasses).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cm-marknote-table-align-left"),
        expect.stringContaining("cm-marknote-table-align-center"),
        expect.stringContaining("cm-marknote-table-align-right"),
      ]),
    );

    expect(decorations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: delimiter.from, to: delimiter.to })]),
    );
    expect(atomic).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: delimiter.from, to: delimiter.to })]),
    );
  });

  it("hides all vertical delimiter pipes and spacing in header and body rows", () => {
    const state = tableState(doc);
    const { node, decorations, atomic } = buildTable(state);

    const header = node.getChild("TableHeader");
    const bodyRow = node.getChild("TableRow");
    if (!header || !bodyRow) throw new Error("test document missing header or body row");

    const headerDelimiters = header.getChildren("TableDelimiter");
    const bodyDelimiters = bodyRow.getChildren("TableDelimiter");
    expect(headerDelimiters.length).toBeGreaterThanOrEqual(4);
    expect(bodyDelimiters.length).toBeGreaterThanOrEqual(4);

    for (const delim of [...headerDelimiters, ...bodyDelimiters]) {
      expect(decorations).toEqual(
        expect.arrayContaining([expect.objectContaining({ from: delim.from, to: delim.to })]),
      );
      expect(atomic).toEqual(
        expect.arrayContaining([expect.objectContaining({ from: delim.from, to: delim.to })]),
      );
    }
  });

  it("assigns column indices, alignment, and distinguishes header cells", () => {
    const state = tableState(doc);
    const { decorations } = buildTable(state);

    const classes = decorations
      .map(({ value }) => value.spec.class)
      .filter((className): className is string => typeof className === "string");

    // Header cells are highlighted with cm-marknote-table-header-cell
    expect(classes.filter((c) => c.includes("cm-marknote-table-header-cell"))).toHaveLength(3);

    // Columns are assigned 1, 2, 3
    expect(classes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cm-marknote-table-column-1"),
        expect.stringContaining("cm-marknote-table-column-2"),
        expect.stringContaining("cm-marknote-table-column-3"),
      ]),
    );

    // Alignments left, center, right
    expect(classes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cm-marknote-table-align-left"),
        expect.stringContaining("cm-marknote-table-align-center"),
        expect.stringContaining("cm-marknote-table-align-right"),
      ]),
    );
  });

  it("accurately tracks column index when cells are empty", () => {
    const sparseDoc = ["| A |  | C |", "| --- | --- | --- |", "|  | B |  |"].join("\n");
    const state = tableState(sparseDoc);
    const { decorations } = buildTable(state);

    const cellDecorations = decorations.filter(
      ({ value }) => typeof value.spec.class === "string" && value.spec.class.includes("table-cell"),
    );

    // In row 1: A is col 1, C is col 3
    const aDeco = cellDecorations.find((d) => state.doc.sliceString(d.from, d.to) === "A");
    const cDeco = cellDecorations.find((d) => state.doc.sliceString(d.from, d.to) === "C");
    const bDeco = cellDecorations.find((d) => state.doc.sliceString(d.from, d.to) === "B");

    expect(aDeco?.value.spec.class).toContain("cm-marknote-table-column-1");
    expect(cDeco?.value.spec.class).toContain("cm-marknote-table-column-3");
    // In row 2: B is col 2
    expect(bDeco?.value.spec.class).toContain("cm-marknote-table-column-2");
  });

  it("keeps table rendered as an object when the cursor is in the table", () => {
    const state = tableState(doc);
    const { decorations, atomic } = buildTable(state, true);
    expect(decorations.length).toBeGreaterThan(0);
    expect(atomic.length).toBeGreaterThan(0);
  });

  it("attaches add row and add col widgets with correct tooltips", () => {
    const state = tableState(doc);
    const { decorations } = buildTable(state);

    const widgets = decorations
      .map(({ value }) => value.spec.widget)
      .filter(Boolean);

    // Should include TableAddRowWidget and TableAddColWidget
    const addRowWidget = widgets.find((w) => w?.constructor?.name === "TableAddRowWidget");
    const addColWidget = widgets.find((w) => w?.constructor?.name === "TableAddColWidget");

    expect(addRowWidget).toBeDefined();
    expect(addColWidget).toBeDefined();

    // Verify DOM elements produced by widgets
    const view = { state, dispatch: () => undefined } as unknown as EditorView;
    const rowDom = addRowWidget.toDOM(view);
    const colDom = addColWidget.toDOM(view);

    expect(rowDom.querySelector("button")?.getAttribute("title")).toBe("Добавить строку снизу");
    expect(colDom.getAttribute("title")).toBe("Добавить столбец справа");
  });

  it("attaches row and col movement controls with tooltips", () => {
    const multiRowDoc = [
      "| Left | Center | Right |",
      "| :--- | :---:  | ---:  |",
      "| A1   | B1     | C1    |",
      "| A2   | B2     | C2    |",
    ].join("\n");
    const state = tableState(multiRowDoc);
    const { decorations } = buildTable(state);

    const widgets = decorations
      .map(({ value }) => value.spec.widget)
      .filter(Boolean);

    const rowControls = widgets.filter((w) => w?.constructor?.name === "TableRowControlWidget");
    const colControls = widgets.filter((w) => w?.constructor?.name === "TableColControlWidget");

    expect(rowControls.length).toBe(2); // 2 body rows
    expect(colControls.length).toBe(3); // 3 columns

    const view = { state, dispatch: () => undefined } as unknown as EditorView;
    const firstRowDom = rowControls[0].toDOM(view);
    const lastRowDom = rowControls[1].toDOM(view);

    // First row can move down
    expect(firstRowDom.querySelector(".cm-marknote-table-move-down")?.getAttribute("title")).toBe("Переместить строку вниз");
    // Last row can move up
    expect(lastRowDom.querySelector(".cm-marknote-table-move-up")?.getAttribute("title")).toBe("Переместить строку вверх");

    const firstColDom = colControls[0].toDOM(view);
    const lastColDom = colControls[2].toDOM(view);

    // First col can move right
    expect(firstColDom.querySelector(".cm-marknote-table-move-right")?.getAttribute("title")).toBe("Переместить столбец вправо");
    // Last col can move left
    expect(lastColDom.querySelector(".cm-marknote-table-move-left")?.getAttribute("title")).toBe("Переместить столбец влево");
  });

  it("moves Tab and Shift-Tab between table cells", () => {
    const state = tableState(doc);
    const table = syntaxTree(state).topNode.getChild("Table");
    if (!table) throw new Error("test document did not parse as a table");
    const row = table.getChild("TableRow");
    const cells = row?.getChildren("TableCell").sort((a, b) => a.from - b.from);
    if (!cells || cells.length < 3) throw new Error("test document did not have three body cells");

    const dispatches: Array<{ selection?: { anchor: number } }> = [];
    const stateWithCursor = state.update({ selection: { anchor: cells[0].from } }).state;
    const view = {
      state: stateWithCursor,
      dispatch: (spec: { selection?: { anchor: number } }) => dispatches.push(spec),
    } as unknown as EditorView;

    expect(tableKeymap[0].run?.(view)).toBe(true);
    expect(dispatches[0]?.selection?.anchor).toBe(cells[1].from);

    const backState = state.update({ selection: { anchor: cells[1].to } }).state;
    const backView = {
      state: backState,
      dispatch: (spec: { selection?: { anchor: number } }) => dispatches.push(spec),
    } as unknown as EditorView;
    expect(tableKeymap[1].run?.(backView)).toBe(true);
    expect(dispatches[1]?.selection?.anchor).toBe(cells[0].to);
  });
});

