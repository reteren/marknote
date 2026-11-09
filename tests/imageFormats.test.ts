import { describe, expect, it } from "vitest";
import { acceptsImages } from "../src/state/formats.svelte";

describe("images belong to Markdown only", () => {
  it("accepts images in editable Markdown and nowhere else", () => {
    expect(acceptsImages({ id: "markdown", editable: true })).toBe(true);
    expect(acceptsImages({ id: "markdown", editable: false })).toBe(false);
    expect(acceptsImages({ id: "mdz", editable: true })).toBe(true);
    expect(acceptsImages({ id: "plaintext", editable: true })).toBe(false);
    expect(acceptsImages({ id: "json", editable: true })).toBe(false);
    expect(acceptsImages(null)).toBe(false);
  });
});
