// Word counts are calculated from the changed region rather than the whole
// document. An edit may split a word, join two words, remove whitespace, or
// insert a whole paragraph, and each case changes the count differently. This
// check ensures that after any sequence of edits the count matches a full recount.

import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getEditorStats } from "../src/editor/createEditor";

function fullWordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

function randomInsert(random: () => number): string {
  const alphabet = ["a", "b", " ", "\n", "word", "  ", "x y", ""];
  return alphabet[Math.floor(random() * alphabet.length)];
}

/** The same generator with the same seed makes failures reproducible. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

describe("word counts after edits", () => {
  it("match a full recount after random edits", () => {
    const random = seeded(20260920);
    let state = EditorState.create({ doc: "first word and more\nsecond line here" });

    for (let step = 0; step < 300; step += 1) {
      const from = Math.floor(random() * (state.doc.length + 1));
      const to = Math.min(state.doc.length, from + Math.floor(random() * 4));
      const insert = randomInsert(random);
      const change: ChangeSpec = { from, to, insert };
      const next = state.update({ changes: change });

      const stats = getEditorStats(next.state, state, next.changes);
      const expected = fullWordCount(next.state.doc.toString());
      expect(stats.words, `step ${step}: edit ${from}-${to} "${insert}" in "${next.state.doc.toString().slice(0, 60)}"`)
        .toBe(expected);

      state = next.state;
    }
  });

  it("match a full recount when inserting and deleting large chunks", () => {
    const paragraph = "paragraph with several words, repeated many times. ".repeat(50);
    let state = EditorState.create({ doc: "origin" });

    const inserted = state.update({ changes: { from: state.doc.length, insert: `\n\n${paragraph}` } });
    expect(getEditorStats(inserted.state, state, inserted.changes).words)
      .toBe(fullWordCount(inserted.state.doc.toString()));

    state = inserted.state;
    const removed = state.update({ changes: { from: 3, to: state.doc.length - 3, insert: "" } });
    expect(getEditorStats(removed.state, state, removed.changes).words)
      .toBe(fullWordCount(removed.state.doc.toString()));
  });
});
