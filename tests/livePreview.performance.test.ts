import { describe, expect, it, vi } from "vitest";
import { Text } from "@codemirror/state";
import { documentByteLength } from "../src/editor/livePreview/plugin";

describe("live preview document-size accounting", () => {
  it("caches UTF-8 size for the immutable document used by selection updates", () => {
    const doc = Text.of(["ASCII and 😀"]);
    const toString = vi.spyOn(doc, "toString");

    expect(documentByteLength(doc)).toBe(new TextEncoder().encode("ASCII and 😀").byteLength);
    expect(documentByteLength(doc)).toBe(documentByteLength(doc));
    expect(toString).toHaveBeenCalledTimes(1);
  });
});
