import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { getEditorStats } from "../../src/editor/createEditor";
import StatusBar from "../../src/ui/StatusBar.svelte";
import { format } from "./helpers";

afterEach(() => cleanup());

describe("StatusBar statistics", () => {
  it("shows cursor location, document totals, and format restrictions", () => {
    render(StatusBar, {
      props: {
        format: format("pdf", { label: "PDF", editable: false, lossy: true }),
        stats: { line: 2, col: 4, lines: 7, words: 12, chars: 94, selection: null },
      },
    });
    expect(document.body.textContent).toContain("PDF");
    expect(document.body.textContent).toContain("Read-only");
    expect(document.body.textContent).toContain("Lossy");
    expect(document.body.textContent).toContain("Ln 2, Col 4");
    expect(document.body.textContent).toContain("7 lines");
    expect(document.body.textContent).toContain("12 words");
    expect(document.body.textContent).toContain("94 chars");
  });

  it("shows selection range and counts only whole words", () => {
    const text = "one middle two";
    const state = EditorState.create({
      doc: text,
      // [1, 13) cuts the first and last words; only `middle` is whole.
      selection: EditorSelection.single(1, 13),
    });
    const stats = getEditorStats(state);
    render(StatusBar, {
      props: {
        format: format("markdown", { label: "Markdown" }),
        stats,
      },
    });
    expect(document.body.textContent).toContain("Ln 1 selected");
    expect(document.body.textContent).toContain("1 words");
    expect(document.body.textContent).toContain("12 chars");
    expect(document.body.textContent).not.toContain("3 words");
  });
});
