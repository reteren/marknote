import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { centerMatch, correctMatchCentering, revealMatchNearCaret } from "../src/editor/search";

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

describe("measured centering correction", () => {
  it("scrolls by the measured offset after CodeMirror's own scroll, until the match is centered", () => {
    vi.useFakeTimers();
    try {
      let lineMid = 900;
      let scrollTop = 0;
      const view = {
        dom: { isConnected: true },
        scrollDOM: {
          getBoundingClientRect: () => ({ top: 100, height: 600 }),
          get scrollTop() { return scrollTop; },
          set scrollTop(value: number) { lineMid -= value - scrollTop; scrollTop = value; },
        },
        coordsAtPos: () => ({ top: lineMid - 10, bottom: lineMid + 10 }),
      } as unknown as EditorView;

      correctMatchCentering(view, 42);
      // Nothing is measured synchronously: CodeMirror has not scrolled yet.
      expect(scrollTop).toBe(0);
      vi.runAllTimers();

      expect(lineMid).toBe(400);
      expect(scrollTop).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops quietly when the editor is gone", () => {
    vi.useFakeTimers();
    try {
      const view = { dom: { isConnected: false }, coordsAtPos: () => { throw new Error("must not measure"); } } as unknown as EditorView;
      correctMatchCentering(view, 1);
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
