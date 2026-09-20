import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getEditorStats } from "../src/editor/createEditor";

describe("editor statistics on document changes", () => {
  it("updates the cached word count from changed ranges", () => {
    const previous = EditorState.create({ doc: "one two three" });
    const transaction = previous.update({ changes: { from: 4, to: 7, insert: "four five" } });

    expect(getEditorStats(transaction.state, previous, transaction.changes).words).toBe(4);
    expect(getEditorStats(transaction.state, previous, transaction.changes).chars).toBe(19);
  });

  it("keeps whole-word selection semantics without flattening the document", () => {
    const previous = EditorState.create({ doc: "one middle two" });
    const transaction = previous.update({ selection: { anchor: 1, head: 13 } });

    expect(getEditorStats(transaction.state, previous, transaction.changes).selection?.words).toBe(1);
  });
});
