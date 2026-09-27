import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseListLine } from "../src/editor/listCommands";
import { decorationRanges } from "../src/editor/livePreview/plugin";
import { indentLayoutDecorations, indentLayouts } from "../src/editor/livePreview/indentLayout";

describe("list lines in live preview", () => {
  it("accepts only markers followed by whitespace", () => {
    const isListLine = (text: string) => parseListLine(text) !== null;
    expect(isListLine("1.")).toBe(false);
    expect(isListLine("1)")).toBe(false);
    expect(isListLine("1. ")).toBe(true);
    expect(isListLine("1) ")).toBe(true);
    expect(isListLine("1.text")).toBe(false);
    expect(isListLine("1. text")).toBe(true);
    expect(isListLine("1")).toBe(false);
  });

  it("puts one guide per whole indent unit on any indented line", () => {
    const doc = "1. outer\n    8. inner\n        cont\nPlain\n    text\n  two spaces";
    const state = EditorState.create({ doc, extensions: [markdown(), indentUnit.of("    ")] });
    const layouts = indentLayouts(state, [{ from: 0, to: doc.length }]);
    const byLine = (text: string) => layouts.find((layout) => layout.from === doc.indexOf(text));
    expect(byLine("1. outer")).toMatchObject({ levels: 0, bullet: false });
    expect(byLine("    8. inner")).toMatchObject({ levels: 1 });
    expect(byLine("        cont")).toMatchObject({ levels: 2, markerFrom: null });
    expect(byLine("    text")).toMatchObject({ levels: 1, markerFrom: null });
    expect(byLine("Plain")).toBeUndefined();
    expect(byLine("  two spaces")).toBeUndefined();
  });

  it("counts a tab as one level when the unit is a tab", () => {
    const doc = "\t\tdeep\n\t- item";
    const state = EditorState.create({ doc, extensions: [markdown(), indentUnit.of("\t"), EditorState.tabSize.of(4)] });
    const layouts = indentLayouts(state, [{ from: 0, to: doc.length }]);
    expect(layouts.map((layout) => layout.levels)).toEqual([2, 1]);
    expect(layouts[1]).toMatchObject({ bullet: true, markerFrom: doc.indexOf("-") });
  });

  it("leaves fenced code alone and only looks at visible lines", () => {
    const doc = "```\n    code\n```\n" + "    text\n".repeat(20);
    const state = EditorState.create({ doc, extensions: [markdown(), indentUnit.of("    ")] });
    expect(indentLayouts(state, [{ from: 0, to: doc.indexOf("```\n", 4) }])).toEqual([]);
    const firstText = doc.indexOf("    text");
    expect(indentLayouts(state, [{ from: firstText, to: firstText + 8 }])).toHaveLength(1);
  });

  it("marks list lines, gives ordered markers the gap and applies measured hanging indent", () => {
    const doc = "12. item\n- bullet";
    const state = EditorState.create({ doc, extensions: [markdown(), indentUnit.of("    ")] });
    const layouts = indentLayouts(state, [{ from: 0, to: doc.length }]);
    const decorations = decorationRanges(indentLayoutDecorations(layouts, new Map([[0, 31.5]])));
    const lines = decorations.filter((range) => range.from === range.to);
    expect(lines.map((range) => range.decoration.spec.attributes.class)).toEqual(["cm-md-list-line", "cm-md-list-line"]);
    expect(lines[0].decoration.spec.attributes.style).toContain("--md-hang: 31.50px");
    const gaps = decorations.filter((range) => range.decoration.spec.class === "cm-md-list-gap");
    expect(gaps).toEqual([expect.objectContaining({ from: 0, to: 3 })]);
  });
});
