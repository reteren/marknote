import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  createSearchQuery,
  findMatches,
  findNextMatch,
  findPreviousMatch,
  getInitialSearchText,
  getRegExpError,
  getSearchStats,
  isValidRegExp,
  replaceAllMatches,
} from "../src/editor/search";

function createState(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.anchor, selection.head ?? selection.anchor)
      : EditorSelection.single(0),
  });
}

describe("MarkNote Search logic (search.ts)", () => {
  describe("1. Search with and without case sensitivity", () => {
    const doc = "Alpha alpha ALPHA beta";

    it("without case sensitivity finds all variants", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "alpha", caseSensitive: false });
      expect(matches).toHaveLength(3);
      expect(matches).toEqual([
        { from: 0, to: 5 },
        { from: 6, to: 11 },
        { from: 12, to: 17 },
      ]);
    });

    it("with case sensitivity finds only exact matches", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "alpha", caseSensitive: true });
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ from: 6, to: 11 });

      const matchesUpper = findMatches(state, { search: "ALPHA", caseSensitive: true });
      expect(matchesUpper).toHaveLength(1);
      expect(matchesUpper[0]).toEqual({ from: 12, to: 17 });
    });
  });

  describe("2. Whole-word matching (wholeWord)", () => {
    const doc = "cat catalog concatenate cat";

    it("without whole-word mode finds a substring inside other words", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "cat", wholeWord: false });
      expect(matches).toHaveLength(4);
      expect(matches.map((m) => doc.slice(m.from, m.to))).toEqual(["cat", "cat", "cat", "cat"]);
    });

    it("with whole-word mode finds only isolated words", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "cat", wholeWord: true });
      expect(matches).toHaveLength(2);
      expect(matches).toEqual([
        { from: 0, to: 3 },
        { from: 24, to: 27 },
      ]);
    });
  });

  describe("3. Regular expressions (regexp)", () => {
    const doc = "item-12 and item-456 plus item-7890";

    it("finds matches for a regular-expression pattern", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "item-\\d+", regexp: true });
      expect(matches).toHaveLength(3);
      expect(matches.map((m) => doc.slice(m.from, m.to))).toEqual([
        "item-12",
        "item-456",
        "item-7890",
      ]);
    });

    it("supports case sensitivity together with a regular expression", () => {
      const state = createState("ITEM-1 item-2");
      const sensitive = findMatches(state, {
        search: "item-\\d+",
        regexp: true,
        caseSensitive: true,
      });
      expect(sensitive).toHaveLength(1);
      expect(sensitive[0]).toEqual({ from: 7, to: 13 });

      const insensitive = findMatches(state, {
        search: "item-\\d+",
        regexp: true,
        caseSensitive: false,
      });
      expect(insensitive).toHaveLength(2);
    });
  });

  describe("4. Match counter (getSearchStats)", () => {
    const doc = "apple banana apple orange apple";
    // apple: [0..5], [13..18], [26..31]

    it("shows the total and current match from the selection", () => {
      // Cursor at the beginning (the first apple is selected: [0, 5]).
      const state1 = createState(doc, { anchor: 0, head: 5 });
      const stats1 = getSearchStats(state1, { search: "apple" });
      expect(stats1).toEqual({ total: 3, current: 1 });

      // Second apple selected: [13, 18].
      const state2 = createState(doc, { anchor: 13, head: 18 });
      const stats2 = getSearchStats(state2, { search: "apple" });
      expect(stats2).toEqual({ total: 3, current: 2 });

      // Cursor inside the third apple (for example, position 28).
      const state3 = createState(doc, { anchor: 28 });
      const stats3 = getSearchStats(state3, { search: "apple" });
      expect(stats3).toEqual({ total: 3, current: 3 });

      // Cursor on banana (not on apple).
      const state4 = createState(doc, { anchor: 8 });
      const stats4 = getSearchStats(state4, { search: "apple" });
      expect(stats4).toEqual({ total: 3, current: 0 });
    });

    it("returns 0 when there are no matches or the query is empty", () => {
      const state = createState(doc);
      expect(getSearchStats(state, { search: "pear" })).toEqual({ total: 0, current: 0 });
      expect(getSearchStats(state, { search: "" })).toEqual({ total: 0, current: 0 });
    });
  });

  describe("5. Wrap-around from last to first match", () => {
    const doc = "one two one three one";
    // "one" matches: [0..3], [8..11], [18..21].

    it("findNextMatch wraps from the last match to the first", () => {
      const query = { search: "one" };

      // Position 0 -> first match [0, 3].
      const state0 = createState(doc, { anchor: 0 });
      expect(findNextMatch(state0, query)).toEqual({ from: 0, to: 3 });

      // First match selected [0, 3] -> next [8, 11].
      const state1 = createState(doc, { anchor: 0, head: 3 });
      expect(findNextMatch(state1, query)).toEqual({ from: 8, to: 11 });

      // Second match selected [8, 11] -> next [18, 21].
      const state2 = createState(doc, { anchor: 8, head: 11 });
      expect(findNextMatch(state2, query)).toEqual({ from: 18, to: 21 });

      // Last match selected [18, 21] -> wrap to the first [0, 3]!
      const stateLast = createState(doc, { anchor: 18, head: 21 });
      expect(findNextMatch(stateLast, query)).toEqual({ from: 0, to: 3 });
    });

    it("findPreviousMatch wraps from the first match to the last", () => {
      const query = { search: "one" };

      // Second match selected [8, 11] -> previous [0, 3].
      const state2 = createState(doc, { anchor: 8, head: 11 });
      expect(findPreviousMatch(state2, query)).toEqual({ from: 0, to: 3 });

      // First match selected [0, 3] -> wrap to the last [18, 21]!
      const stateFirst = createState(doc, { anchor: 0, head: 3 });
      expect(findPreviousMatch(stateFirst, query)).toEqual({ from: 18, to: 21 });
    });
  });

  describe("6. Replace all with overlapping candidates", () => {
    it("correctly replaces non-overlapping pairs in 'aaaa'", () => {
      const state = createState("aaaa");
      const result = replaceAllMatches(state, { search: "aa" }, "b");
      expect(result.count).toBe(2);
      expect(result.newDoc).toBe("bb");
      expect(result.changes).toEqual([
        { from: 0, to: 2, insert: "b" },
        { from: 2, to: 4, insert: "b" },
      ]);
    });

    it("replaces occurrences in 'banana' without damaging adjacent characters", () => {
      const state = createState("banana");
      const result = replaceAllMatches(state, { search: "ana" }, "X");
      // "ana" occurs at [1..4] and [3..6], but the second overlaps [1..4], so only the first is replaced.
      expect(result.count).toBe(1);
      expect(result.newDoc).toBe("bXna");
    });

    it("supports regular-expression replacements with capture groups", () => {
      const state = createState("cat=1 dog=2");
      const result = replaceAllMatches(
        state,
        { search: "(\\w+)=(\\d+)", regexp: true },
        "$2:$1",
      );
      expect(result.count).toBe(2);
      expect(result.newDoc).toBe("1:cat 2:dog");
    });
  });

  describe("7. Invalid regular expressions do not throw outward", () => {
    const invalidPatterns = ["(", "[", "*", "\\", "(?="];

    for (const pattern of invalidPatterns) {
    it(`safely handles an invalid pattern: ${pattern}`, () => {
        expect(isValidRegExp(pattern)).toBe(false);
        expect(getRegExpError(pattern)).toBeTruthy();

        const query = createSearchQuery({ search: pattern, regexp: true });
        expect(query.valid).toBe(false);

        const state = createState("test document (with brackets) and * stars");
        expect(() => findMatches(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findMatches(state, { search: pattern, regexp: true })).toEqual([]);

        expect(() => getSearchStats(state, { search: pattern, regexp: true })).not.toThrow();
        expect(getSearchStats(state, { search: pattern, regexp: true })).toEqual({
          total: 0,
          current: 0,
        });

        expect(() => findNextMatch(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findNextMatch(state, { search: pattern, regexp: true })).toBeNull();

        expect(() => findPreviousMatch(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findPreviousMatch(state, { search: pattern, regexp: true })).toBeNull();

        expect(() =>
          replaceAllMatches(state, { search: pattern, regexp: true }, "replacement"),
        ).not.toThrow();
        const rep = replaceAllMatches(state, { search: pattern, regexp: true }, "replacement");
        expect(rep.count).toBe(0);
        expect(rep.newDoc).toBe(state.doc.toString());
      });
    }
  });

  describe("8. getInitialSearchText", () => {
    it("extracts a non-empty single-line selection", () => {
      const doc = "first line\nsecond line";
      const state = createState(doc, { anchor: 6, head: 10 }); // "line"
      expect(getInitialSearchText(state)).toBe("line");
    });

    it("ignores an empty selection", () => {
      const state = createState("some text", { anchor: 2 });
      expect(getInitialSearchText(state)).toBeNull();
    });

    it("ignores a multiline selection", () => {
      const doc = "first line\nsecond line";
      const state = createState(doc, { anchor: 0, head: 15 });
      expect(getInitialSearchText(state)).toBeNull();
    });
  });

  describe("9. Large-file test (fixtures/big-10k.md, 1 MiB)", () => {
    const fixturePath = resolve(__dirname, "../fixtures/big-10k.md");
    const content = readFileSync(fixturePath, "utf-8");
    const state = createState(content);

    // Measure growth, not seconds. The old check required finishing within
    // 200 ms wall-clock and failed when the machine was busy; it measured
    // system load rather than our code. False alarms cost more than missed
    // slowness because they consume attention every time.
    //
    // Run the same search on a small slice and the whole file. Both samples
    // suffer equally from load, so their ratio is stable. Linear search gives
    // a ratio close to the size ratio; quadratic search gives a much larger one,
    // which is what this check catches.
    it("searches in time that grows linearly rather than quadratically", () => {
      const smallDoc = content.slice(0, Math.floor(content.length / 10));
      const smallState = createState(smallDoc);
      const query = { search: "Line", caseSensitive: true };

      const measure = (target: EditorState): number => {
        const started = performance.now();
        getSearchStats(target, query);
        return Math.max(performance.now() - started, 0.05);
      };

      // Warm-up: the first call pays for compilation and cache warm-up.
      measure(smallState);
      measure(state);

      const small = Math.min(measure(smallState), measure(smallState));
      const full = Math.min(measure(state), measure(state));

      expect(getSearchStats(state, query).total).toBeGreaterThan(0);
      // The document is ten times larger. The margin is generous: the check
      // should catch a change in complexity class, not modest fluctuations.
      expect(full / small).toBeLessThan(40);
    });
  });
});
