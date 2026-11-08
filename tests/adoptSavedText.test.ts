import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { adoptSavedText } from "../src/state/actions";
import { documentState, resetDocument, type SaveResult } from "../src/state/document.svelte";
import { markdownFormat, markdownPackageFormat } from "../src/state/formats.svelte";

/** A view stand-in that applies dispatched changes to a real EditorState. */
function fakeView(text: string, caret: number) {
  let state = EditorState.create({ doc: text, selection: { anchor: caret } });
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  };
  return view as unknown as EditorView;
}

const result = (text?: string): SaveResult => ({
  path: "C:/out/note.mdz",
  savedAt: new Date(0).toISOString(),
  format: markdownPackageFormat,
  ...(text === undefined ? {} : { text }),
});

describe("adopting the text a package save hands back", () => {
  it("relinks only the changed span, keeps the caret and leaves the document saved", () => {
    const before = "# T\n\n![pic|200](pic.png)\n\nEnd.";
    const after = "# T\n\n![pic|200](marknote-images/pic.png)\n\nEnd.";
    resetDocument(markdownFormat, before);
    const caret = before.indexOf("End");
    const view = fakeView(before, caret);

    adoptSavedText(documentState, result(after), view);

    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(after.indexOf("End"));
    expect(documentState.text).toBe(after);
    expect(documentState.dirty).toBe(false);
    expect(documentState.path).toBe("C:/out/note.mdz");
  });

  it("does nothing when the save handed back no text or the same text", () => {
    resetDocument(markdownFormat, "same");
    const view = fakeView("same", 2);
    const dispatch = vi.spyOn(view, "dispatch");

    adoptSavedText(documentState, result(), view);
    adoptSavedText(documentState, result("same"), view);

    expect(dispatch).not.toHaveBeenCalled();
  });
});
