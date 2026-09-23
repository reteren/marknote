import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { centerMatch, revealMatchNearCaret } from "../src/editor/search";

type ScrollTarget = { range: { from: number; to: number }; y: string };

describe("search scrolling", () => {
  it("centers a match vertically instead of scrolling it to the nearest edge", () => {
    const target = centerMatch(4, 9).value as ScrollTarget;
    expect(target.y).toBe("center");
    expect([target.range.from, target.range.to]).toEqual([4, 9]);
  });

  it("reveals the first match after the caret while typing without moving the selection", () => {
    const state = EditorState.create({ doc: "alpha beta alpha gamma", selection: { anchor: 6 } });
    const dispatched: Array<{ effects?: { value: ScrollTarget }; selection?: unknown }> = [];
    const view = { state, dispatch: (spec: (typeof dispatched)[number]) => dispatched.push(spec) } as unknown as EditorView;

    revealMatchNearCaret(view, { search: "alpha" });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.selection).toBeUndefined();
    const target = dispatched[0]!.effects!.value;
    expect([target.range.from, target.range.to, target.y]).toEqual([11, 16, "center"]);
  });

  it("wraps to the first match when none follows the caret", () => {
    const state = EditorState.create({ doc: "alpha beta gamma", selection: { anchor: 12 } });
    const dispatched: Array<{ effects: { value: ScrollTarget } }> = [];
    const view = { state, dispatch: (spec: (typeof dispatched)[number]) => dispatched.push(spec) } as unknown as EditorView;

    revealMatchNearCaret(view, { search: "alpha" });

    expect(dispatched[0]!.effects.value.range.from).toBe(0);
  });
});
