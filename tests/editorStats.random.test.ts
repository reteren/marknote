// Счёт слов считается по изменённому куску, а не по всему документу. Правка
// может разрезать слово, склеить два слова, удалить пробел или вставить целый
// абзац, и каждый такой случай меняет счёт по-разному. Проверка держит одно:
// после любой последовательности правок число совпадает с честным пересчётом.

import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getEditorStats } from "../src/editor/createEditor";

function fullWordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

function randomInsert(random: () => number): string {
  const alphabet = ["a", "b", " ", "\n", "слово", "  ", "x y", ""];
  return alphabet[Math.floor(random() * alphabet.length)];
}

/** Тот же генератор при том же зерне — падение можно повторить. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

describe("счёт слов после правок", () => {
  it("совпадает с полным пересчётом после случайных правок", () => {
    const random = seeded(20260920);
    let state = EditorState.create({ doc: "первое слово и ещё\nвторая строка тут" });

    for (let step = 0; step < 300; step += 1) {
      const from = Math.floor(random() * (state.doc.length + 1));
      const to = Math.min(state.doc.length, from + Math.floor(random() * 4));
      const insert = randomInsert(random);
      const change: ChangeSpec = { from, to, insert };
      const next = state.update({ changes: change });

      const stats = getEditorStats(next.state, state, next.changes);
      const expected = fullWordCount(next.state.doc.toString());
      expect(stats.words, `шаг ${step}: правка ${from}-${to} «${insert}» в «${next.state.doc.toString().slice(0, 60)}»`)
        .toBe(expected);

      state = next.state;
    }
  });

  it("совпадает с полным пересчётом при вставке и удалении больших кусков", () => {
    const paragraph = "абзац из нескольких слов, повторённый много раз. ".repeat(50);
    let state = EditorState.create({ doc: "начало" });

    const inserted = state.update({ changes: { from: 6, insert: `\n\n${paragraph}` } });
    expect(getEditorStats(inserted.state, state, inserted.changes).words)
      .toBe(fullWordCount(inserted.state.doc.toString()));

    state = inserted.state;
    const removed = state.update({ changes: { from: 3, to: state.doc.length - 3, insert: "" } });
    expect(getEditorStats(removed.state, state, removed.changes).words)
      .toBe(fullWordCount(removed.state.doc.toString()));
  });
});
