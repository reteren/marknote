import { describe, expect, it } from "vitest";
import { safeLinkHref } from "../src/editor/livePreview/inline";

describe("safe link targets", () => {
  it.each([
    ["http://example.test/notes", "http://example.test/notes"],
    ["https://example.test/notes?q=1", "https://example.test/notes?q=1"],
    ["mailto:person@example.test", "mailto:person@example.test"],
  ])("allows %s", (raw, normalized) => {
    expect(safeLinkHref(raw)).toBe(normalized);
  });

  it.each([
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Users/Public/secret.txt",
    "vbscript:msgbox(1)",
    "javascript:alert(1)",
    "custom-scheme:payload",
    "//example.test/relative-to-origin",
    "notes/next.md",
    "",
    "not a URL",
  ])("does not open forbidden or relative target %s", (raw) => {
    expect(safeLinkHref(raw)).toBeNull();
  });

  it.each([
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "%6A%61%76%61%73%63%72%69%70%74:alert(1)",
    "ĵavascript:alert(1)",
    "ｊavascript:alert(1)",
    " \u0000javascript:alert(1)",
  ])("rejects a URL-parser bypass %s", (raw) => {
    expect(safeLinkHref(raw)).toBeNull();
  });

  it("returns null for malformed input without throwing", () => {
    expect(() => safeLinkHref("http://[broken")).not.toThrow();
    expect(safeLinkHref("http://[broken")).toBeNull();
  });
});
