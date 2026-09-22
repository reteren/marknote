import { describe, expect, it, vi, beforeEach } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
}));

import {
  extractImageSrcs,
  rewriteAttachmentSrcs,
  resetDocument,
  documentState,
} from "../src/state/document.svelte";
import { createActions } from "../src/state/actions";
import { markdownFormat } from "../src/state/formats.svelte";

describe("Attachment Promotion & Rewriting", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    resetDocument(markdownFormat, "");
  });

  it("extracts image srcs from markdown syntax and html tags", () => {
    const text = `
# Title
![First](marknote-cache/image-1.png)
Some text with a link [Link](https://example.com) that should not be extracted.
![With Title](marknote-cache/image-2.jpg "A pretty picture")
![Angle Brackets](<marknote-cache/image-3.gif>)
Duplicate: ![Duplicate](marknote-cache/image-1.png)
HTML tag: <img src="marknote-cache/image-4.webp" alt="web picture">
Remote image: ![Remote](https://example.com/banner.png)
`;
    const srcs = extractImageSrcs(text);
    expect(srcs).toContain("marknote-cache/image-1.png");
    expect(srcs).toContain("marknote-cache/image-2.jpg");
    expect(srcs).toContain("marknote-cache/image-3.gif");
    expect(srcs).toContain("marknote-cache/image-4.webp");
    expect(srcs).toContain("https://example.com/banner.png");
    // Deduplicated
    expect(srcs.filter((s) => s === "marknote-cache/image-1.png")).toHaveLength(1);
    expect(srcs).toHaveLength(5);
  });

  it("applies promotion rewrites to document text including duplicates and non-cache srcs", () => {
    const text = `# Notes
Here is a photo: ![Photo](marknote-cache/photo-1.png)
And here is the same photo again: ![Photo again](marknote-cache/photo-1.png)
And an external image that is not a cache src: ![Logo](https://example.com/logo.png)
And an existing local asset: ![Chart](./assets/chart.png)
`;

    const rewrites = [
      { from: "marknote-cache/photo-1.png", to: "notes.assets/photo-1.png" },
    ];

    const result = rewriteAttachmentSrcs(text, rewrites);

    // Both instances of the cache src must be rewritten
    expect(result).toContain("![Photo](notes.assets/photo-1.png)");
    expect(result).toContain("![Photo again](notes.assets/photo-1.png)");
    expect(result).not.toContain("marknote-cache/photo-1.png");

    // Non-cache srcs must remain unchanged
    expect(result).toContain("![Logo](https://example.com/logo.png)");
    expect(result).toContain("![Chart](./assets/chart.png)");
  });

  it("promotes attachments on saveAs, rewrites document text, and leaves document clean", async () => {
    const initialText = "Hello ![Pic](marknote-cache/pic.png)";
    resetDocument(markdownFormat, initialText);

    tauri.invoke.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "save_as") {
        return {
          path: "C:\\notes\\doc.md",
          savedAt: new Date().toISOString(),
          format: markdownFormat,
        };
      }
      if (cmd === "promote_attachments") {
        expect(args.docPath).toBe("C:\\notes\\doc.md");
        expect(args.srcs).toContain("marknote-cache/pic.png");
        return [{ from: "marknote-cache/pic.png", to: "doc.assets/pic.png" }];
      }
      if (cmd === "save_file") {
        expect(args.path).toBe("C:\\notes\\doc.md");
        expect(args.text).toBe("Hello ![Pic](doc.assets/pic.png)");
        return {
          path: "C:\\notes\\doc.md",
          savedAt: new Date().toISOString(),
          format: markdownFormat,
        };
      }
      return null;
    });

    const notify = vi.fn();
    const actions = createActions({ state: documentState, notify });

    const success = await actions.saveAs();
    expect(success).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    // Document state should hold the rewritten text and be marked clean
    expect(documentState.text).toBe("Hello ![Pic](doc.assets/pic.png)");
    expect(documentState.dirty).toBe(false);
    expect(documentState.saveStatus).toBe("saved");
    expect(documentState.path).toBe("C:\\notes\\doc.md");
  });

  it("surfaces promotion failure as a notice while still reporting save as successful", async () => {
    const initialText = "Hello ![Pic](marknote-cache/pic.png)";
    resetDocument(markdownFormat, initialText);

    tauri.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "save_as") {
        return {
          path: "C:\\notes\\doc.md",
          savedAt: new Date().toISOString(),
          format: markdownFormat,
        };
      }
      if (cmd === "promote_attachments") {
        throw new Error("Failed to copy attachment to target directory");
      }
      return null;
    });

    const notify = vi.fn();
    const actions = createActions({ state: documentState, notify });

    const success = await actions.saveAs();
    // The initial save was written to disk, so save is still reported successful
    expect(success).toBe(true);
    // Failure is surfaced via notice
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Failed to copy attachment"));
    expect(documentState.saveStatus).toBe("saved");
  });
});
