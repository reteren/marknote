import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { getEditorStats } from "../../src/editor/createEditor";
import StatusBar from "../../src/ui/StatusBar.svelte";
import { format } from "./helpers";
import { formatLabel, translate as t } from "../../src/i18n";

afterEach(() => cleanup());

describe("StatusBar statistics", () => {
  it("shows cursor location, document totals, and format restrictions", () => {
    render(StatusBar, {
      props: {
        format: format("pdf", { label: "PDF", editable: false, lossy: true }),
        stats: { line: 2, col: 4, lines: 7, words: 12, chars: 94, selection: null },
      },
    });
    expect(document.body.textContent).toContain(formatLabel("pdf", "PDF"));
    expect(document.body.textContent).toContain(t("save.readOnly"));
    expect(document.body.textContent).toContain(t("status.lossy"));
    expect(document.body.textContent).toContain(t("status.position", { line: 2, column: 4 }));
    expect(document.body.textContent).toContain(t("status.lines", { count: 7 }));
    expect(document.body.textContent).toContain(t("status.words", { count: 12 }));
    expect(document.body.textContent).toContain(t("status.characters", { count: 94 }));
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
    expect(document.body.textContent).toContain(t("status.selectionLine", { line: 1 }));
    expect(document.body.textContent).toContain(t("status.words", { count: 1 }));
    expect(document.body.textContent).toContain(t("status.characters", { count: 12 }));
    expect(document.body.textContent).not.toContain(t("status.words", { count: 3 }));
  });

  it("can hide the document format while the start screen is active", () => {
    render(StatusBar, {
      props: {
        format: format("markdown", { label: "Markdown" }),
        stats: { line: 1, col: 1, lines: 1, words: 0, chars: 0, selection: null },
        showFormat: false,
      },
    });
    expect(document.querySelector(".format-info")).toBeNull();
    expect(document.querySelector(".stats")?.textContent).toContain(t("status.position", { line: 1, column: 1 }));
  });
});
