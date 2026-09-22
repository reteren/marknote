import { describe, expect, it } from "vitest";
import { MAX_IMAGE_DIMENSION, parseImageAlt, serializeImageAlt } from "../src/editor/imageSize";

describe("image alt dimensions", () => {
  it("parses width and width-height suffixes while cleaning the alt text", () => {
    expect(parseImageAlt("cat|400")).toEqual({ alt: "cat", size: { width: 400 } });
    expect(parseImageAlt("cat|400x300")).toEqual({ alt: "cat", size: { width: 400, height: 300 } });
  });

  it("leaves a nonnumeric suffix as ordinary alt text", () => {
    expect(parseImageAlt("a|b")).toEqual({ alt: "a|b" });
    expect(parseImageAlt("a|400x")).toEqual({ alt: "a|400x" });
    expect(parseImageAlt("a|1x2x")).toEqual({ alt: "a|1x2x" });
  });

  it("rejects zero and dimensions beyond the conservative limit", () => {
    expect(parseImageAlt("a|0")).toEqual({ alt: "a|0" });
    expect(parseImageAlt("a|0x200")).toEqual({ alt: "a|0x200" });
    expect(parseImageAlt("a|1x0")).toEqual({ alt: "a|1x0" });
    expect(parseImageAlt(`a|${MAX_IMAGE_DIMENSION + 1}`)).toEqual({ alt: `a|${MAX_IMAGE_DIMENSION + 1}` });
  });

  it("accepts leading zeroes but serializes them canonically", () => {
    expect(parseImageAlt("a|040x003")).toEqual({ alt: "a", size: { width: 40, height: 3 } });
    expect(serializeImageAlt("a", { width: 40, height: 3 })).toBe("a|40x3");
  });

  it("only consumes the final numeric pipe segment", () => {
    expect(parseImageAlt("a|draft|400")).toEqual({ alt: "a|draft", size: { width: 400 } });
    expect(parseImageAlt("a|400|300x200")).toEqual({ alt: "a|400", size: { width: 300, height: 200 } });
    expect(parseImageAlt("a|1x2|3x4")).toEqual({ alt: "a|1x2", size: { width: 3, height: 4 } });
  });

  it("round-trips the canonical model", () => {
    const values = [
      { alt: "cat" },
      { alt: "a|b", size: { width: 400 } },
      { alt: "cat", size: { width: 400, height: 300 } },
    ];
    for (const value of values) {
      expect(parseImageAlt(serializeImageAlt(value.alt, value.size))).toEqual(value);
    }
  });
});
