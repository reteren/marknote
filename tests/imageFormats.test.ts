import { describe, expect, it } from "vitest";
import { acceptsImages, containsImages } from "../src/state/formats.svelte";

describe("images belong to Markdown only", () => {
  it("accepts images in editable Markdown and nowhere else", () => {
    expect(acceptsImages({ id: "markdown", editable: true })).toBe(true);
    expect(acceptsImages({ id: "markdown", editable: false })).toBe(false);
    expect(acceptsImages({ id: "plaintext", editable: true })).toBe(false);
    expect(acceptsImages({ id: "json", editable: true })).toBe(false);
    expect(acceptsImages(null)).toBe(false);
  });

  it("notices image references, not links or broken syntax", () => {
    expect(containsImages("text ![alt|400](note.assets/a.png) more")).toBe(true);
    expect(containsImages("![](x.gif)")).toBe(true);
    expect(containsImages("a [link](https://e.com) only")).toBe(false);
    expect(containsImages("![alt\n](x.png)")).toBe(false);
  });
});
