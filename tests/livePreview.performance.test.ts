import { describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { buildDecorationSets, documentByteLength } from "../src/editor/livePreview/plugin";

describe("live preview document-size accounting", () => {
  it("caches UTF-8 size for the immutable document used by selection updates", () => {
    const doc = Text.of(["ASCII and 😀"]);
    const toString = vi.spyOn(doc, "toString");

    expect(documentByteLength(doc)).toBe(new TextEncoder().encode("ASCII and 😀").byteLength);
    expect(documentByteLength(doc)).toBe(documentByteLength(doc));
    expect(toString).toHaveBeenCalledTimes(1);
  });

  it("short-circuits the UTF-8 flattening once UTF-16 length exceeds the limit", () => {
    const state = EditorState.create({ doc: "a".repeat(1024) });
    const toString = vi.spyOn(state.doc, "toString");

    const result = buildDecorationSets(state, [{ from: 0, to: state.doc.length }], { maxBytes: 1023 });

    expect(result.disabled).toBe(true);
    expect(toString).not.toHaveBeenCalled();
  });
});
