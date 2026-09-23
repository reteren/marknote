import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import {
  buildSpellcheckMenuEntries,
  checkSpellcheckLine,
  clearSpellcheckCache,
  spellcheckExcludedRanges,
  spellcheckLineSegments,
} from "../src/editor/spellcheck";
import { suggestSpelling } from "../src/editor/spellEngine";

beforeEach(() => {
  tauri.invoke.mockReset();
  clearSpellcheckCache();
  tauri.invoke.mockResolvedValue([]);
});

describe("spellcheck line filtering", () => {
  it("excludes front matter, code, formulas, links, images, URLs, and HTML tags", () => {
    const state = EditorState.create({
      doc: [
        "---",
        "title: misspelledword",
        "---",
        "plainword " + String.fromCharCode(96) + "codeword" + String.fromCharCode(96) + " $mathword$ [linkword](https://linkword.example) ![imageword](image.png) <b>tagword</b> http://urlword.example",
      ].join("\n"),
      extensions: [markdown()],
    });
    const frontLine = state.doc.line(2);
    expect(spellcheckLineSegments(state, frontLine, true)).toEqual([]);

    const line = state.doc.line(4);
    const segments = spellcheckLineSegments(state, line, true);
    const sentText = segments.map((range) => state.sliceDoc(range.from, range.to)).join("|");
    expect(sentText).toContain("plainword");
    expect(sentText).toContain("tagword");
    for (const excluded of ["codeword", "mathword", "linkword", "imageword", "urlword", "https://", "<b>"]) {
      expect(sentText).not.toContain(excluded);
    }
    expect(spellcheckExcludedRanges(state, line, true).length).toBeGreaterThan(5);
  });

  it("sends only eligible segments and reuses unchanged line results for the same language set", async () => {
    const state = EditorState.create({
      doc: "before " + String.fromCharCode(96) + "codeword" + String.fromCharCode(96) + " after",
      extensions: [markdown()],
    });
    tauri.invoke.mockImplementation(async (command: string, args?: { text?: string }) => {
      if (command !== "spellcheck_check") return [];
      expect(args?.text).not.toContain("codeword");
      return [{ from: 0, to: 6 }];
    });

    const line = state.doc.line(1);
    const first = await checkSpellcheckLine(state, line, ["en"], true);
    const second = await checkSpellcheckLine(state, line, ["en"], true);
    expect(first).toEqual(second);
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke.mock.calls.every(([command]) => command === "spellcheck_check")).toBe(true);

    await checkSpellcheckLine(state, line, ["ru"], true);
    expect(tauri.invoke).toHaveBeenCalledTimes(4);
  });
});

describe("spellcheck context menu entries", () => {
  const context = {
    from: 4,
    to: 8,
    word: "aple",
    languages: ["en"],
  };

  it("puts every backend suggestion before Add to dictionary", () => {
    const entries = buildSpellcheckMenuEntries(context, ["apple", "ample", "maple"], {
      noSuggestions: "No suggestions",
      addToDictionary: "Add to dictionary",
    });
    expect(entries.map((item) => item.label)).toEqual(["apple", "ample", "maple", "Add to dictionary"]);
    expect(entries.map((item) => item.id)).toEqual([
      "spellcheck.replace",
      "spellcheck.replace",
      "spellcheck.replace",
      "spellcheck.addToDictionary",
    ]);
    expect(JSON.parse(entries[0].payload ?? "{}")).toMatchObject({ ...context, suggestion: "apple" });
    expect(entries[0].spellSuggestion).toBe(true);
  });

  it("shows a disabled No suggestions entry before Add to dictionary", () => {
    const entries = buildSpellcheckMenuEntries(context, [], {
      noSuggestions: "No suggestions",
      addToDictionary: "Add to dictionary",
    });
    expect(entries.map((item) => item.label)).toEqual(["No suggestions", "Add to dictionary"]);
    expect(entries[0]).toMatchObject({ id: "spellcheck.noSuggestions", disabled: true });
    expect(entries[1].id).toBe("spellcheck.addToDictionary");
  });
});

describe("spellcheck suggestions", () => {
  it("requests three suggestions and returns the backend result without adding placeholders", async () => {
    tauri.invoke.mockResolvedValue(["apple", "ample"]);
    await expect(suggestSpelling("aple", ["en"])).resolves.toEqual(["apple", "ample"]);
    expect(tauri.invoke).toHaveBeenCalledWith("spellcheck_suggest", {
      word: "aple",
      languages: ["en"],
      limit: 3,
    });
  });
});
