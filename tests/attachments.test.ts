// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  isImageExtension,
  extractFileStem,
  encodeMarkdownUrl,
  computeBlockPlacement,
  mapAttachmentError,
  insertImage,
  createImagePasteHandler,
  handlePasteEvent,
} from "../src/editor/attachments";
import { translate as t } from "../src/i18n";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("attachments utility functions", () => {
  it("recognizes accepted image extensions case-insensitively", () => {
    for (const ext of ACCEPTED_IMAGE_EXTENSIONS) {
      expect(isImageExtension(`photo.${ext}`)).toBe(true);
      expect(isImageExtension(`PHOTO.${ext.toUpperCase()}`)).toBe(true);
      expect(isImageExtension(`C:/Users/User/Pictures/pic.${ext}`)).toBe(true);
      expect(isImageExtension(`C:\\Users\\User\\Pictures\\pic.${ext}`)).toBe(true);
    }
    expect(isImageExtension("note.md")).toBe(false);
    expect(isImageExtension("document.txt")).toBe(false);
    expect(isImageExtension("presentation.pdf")).toBe(false);
    expect(isImageExtension("archive.zip")).toBe(false);
    expect(isImageExtension("fileWithoutExtension")).toBe(false);
  });

  it("extracts clean file stems from paths and file names", () => {
    expect(extractFileStem("C:\\Users\\User\\Pictures\\Sunset Photo.png")).toBe("Sunset Photo");
    expect(extractFileStem("/home/user/images/cat.gif")).toBe("cat");
    expect(extractFileStem("photo.jpeg")).toBe("photo");
    expect(extractFileStem("archive.tar.gz")).toBe("archive.tar");
    expect(extractFileStem("")).toBe("image");
    expect(extractFileStem(null as unknown as string)).toBe("image");
  });

  it("percent-encodes markdown URLs correctly", () => {
    expect(encodeMarkdownUrl("diary.assets/my photo (1).png")).toBe(
      "diary.assets/my%20photo%20%281%29.png",
    );
    expect(encodeMarkdownUrl("marknote-cache/photo [draft].png")).toBe(
      "marknote-cache/photo%20%5Bdraft%5D.png",
    );
    expect(encodeMarkdownUrl('path/to/"quoted".jpg')).toBe(
      "path/to/%22quoted%22.jpg",
    );
    expect(encodeMarkdownUrl("relative.assets/clean_photo-1.png")).toBe(
      "relative.assets/clean_photo-1.png",
    );
  });

  it("computes block newline placement to keep image on its own line", () => {
    // Empty line
    const emptyDoc = EditorState.create({ doc: "" }).doc;
    const placementEmpty = computeBlockPlacement(emptyDoc, 0, 0, "![alt](src.png)");
    expect(placementEmpty.insertText).toBe("![alt](src.png)\n");

    // At end of line with text
    const textDoc = EditorState.create({ doc: "First paragraph" }).doc;
    const placementEnd = computeBlockPlacement(textDoc, 15, 15, "![alt](src.png)");
    expect(placementEnd.insertText).toBe("\n![alt](src.png)\n");

    // At start of line with text
    const placementStart = computeBlockPlacement(textDoc, 0, 0, "![alt](src.png)");
    expect(placementStart.insertText).toBe("![alt](src.png)\n");

    // In middle of line
    const placementMiddle = computeBlockPlacement(textDoc, 5, 5, "![alt](src.png)");
    expect(placementMiddle.insertText).toBe("\n![alt](src.png)\n");
  });

  it("maps IPC and system errors to user-friendly notice strings", () => {
    expect(mapAttachmentError("This image is too large to display. The maximum size is 16 MiB.")).toBe(
      t("image.tooLarge"),
    );
    expect(mapAttachmentError("CommandError::ImageTooLarge")).toBe(
      t("image.tooLarge"),
    );
    expect(mapAttachmentError("This image file type is not supported.")).toBe(
      t("image.unsupported"),
    );
    expect(mapAttachmentError("Save the document before using relative image links.")).toBe(
      t("image.needsDocument"),
    );
    expect(mapAttachmentError(new Error("Unknown I/O failure"))).toBe(
      t("image.insertFailed"),
    );
  });
});

describe("insertImage pipeline", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
  });

  it("saves path source via save_attachment_from_path and inserts markdown link", async () => {
    tauriMocks.invoke.mockResolvedValueOnce({
      src: "doc.assets/my photo.png",
      path: "C:/Notes/doc.assets/my photo.png",
      cached: false,
    });

    const state = EditorState.create({ doc: "Hello world" });
    const view = new EditorView({ state });

    const success = await insertImage(view, "C:/Pictures/my photo.png", {
      docPath: "C:/Notes/doc.md",
    });

    expect(success).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("save_attachment_from_path", {
      docPath: "C:/Notes/doc.md",
      sourcePath: "C:/Pictures/my photo.png",
    });
    // Cursor was at 0, so prepended at start of line with trailing newline
    expect(view.state.doc.toString()).toBe("![my photo](doc.assets/my%20photo.png)\nHello world");
    view.destroy();
  });

  it("saves data source via save_attachment and handles batch undo in a single step", async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce({
        src: "doc.assets/image1.png",
        path: "C:/Notes/doc.assets/image1.png",
        cached: false,
      })
      .mockResolvedValueOnce({
        src: "doc.assets/image2.png",
        path: "C:/Notes/doc.assets/image2.png",
        cached: false,
      });

    const state = EditorState.create({ doc: "Existing text" });
    const view = new EditorView({ state });

    // Set cursor at end of document
    view.dispatch({ selection: { anchor: 13 } });

    const success = await insertImage(
      view,
      [
        { type: "data", data: [1, 2, 3], fileName: "pic1.png" },
        { type: "data", data: [4, 5, 6], fileName: "pic2.png" },
      ],
      { docPath: "C:/Notes/doc.md" },
    );

    expect(success).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    expect(view.state.doc.toString()).toBe(
      "Existing text\n![pic1](doc.assets/image1.png)\n![pic2](doc.assets/image2.png)\n",
    );
    view.destroy();
  });

  it("rejects image data exceeding 16 MiB limit and triggers onNotice callback", async () => {
    const onNotice = vi.fn();
    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const largeData = new Uint8Array(17 * 1024 * 1024);
    const success = await insertImage(
      view,
      { type: "data", data: largeData, fileName: "huge.png" },
      { onNotice },
    );

    expect(success).toBe(false);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(t("image.tooLarge"), "error");
    view.destroy();
  });

  it("handles IPC rejection by dispatching mapped error notice", async () => {
    const onNotice = vi.fn();
    tauriMocks.invoke.mockRejectedValueOnce("ImageTooLarge");

    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const success = await insertImage(
      view,
      "C:/Photos/large.gif",
      { onNotice },
    );

    expect(success).toBe(false);
    expect(onNotice).toHaveBeenCalledWith(t("image.tooLarge"), "error");
    view.destroy();
  });

  it("partially failed batch inserts successful images and reports failure notice without leaving orphans", async () => {
    const onNotice = vi.fn();
    tauriMocks.invoke
      .mockResolvedValueOnce({
        src: "doc.assets/valid.png",
        path: "C:/Notes/doc.assets/valid.png",
        cached: false,
      })
      .mockRejectedValueOnce("ImageTooLarge");

    const state = EditorState.create({ doc: "Start text" });
    const view = new EditorView({ state });

    const success = await insertImage(
      view,
      [
        "C:/Pictures/valid.png",
        "C:/Pictures/invalid.gif",
      ],
      { docPath: "C:/Notes/doc.md", onNotice },
    );

    expect(success).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    // The successful image IS inserted into the document so written files are not orphaned
    expect(view.state.doc.toString()).toContain("![valid](doc.assets/valid.png)");
    // The failure notice is honestly reported
    expect(onNotice).toHaveBeenCalledWith(t("image.tooLarge"), "error");
    view.destroy();
  });

  it("partially failed batch handles data source >16MB alongside valid source", async () => {
    const onNotice = vi.fn();
    tauriMocks.invoke.mockResolvedValueOnce({
      src: "doc.assets/small.png",
      path: "C:/Notes/doc.assets/small.png",
      cached: false,
    });

    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const hugeData = new Uint8Array(17 * 1024 * 1024);
    const success = await insertImage(
      view,
      [
        { type: "data", data: hugeData, fileName: "huge.png" },
        { type: "data", data: [1, 2, 3], fileName: "small.png" },
      ],
      { docPath: "C:/Notes/doc.md", onNotice },
    );

    expect(success).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe("![small](doc.assets/small.png)\n");
    expect(onNotice).toHaveBeenCalledWith(t("image.tooLarge"), "error");
    view.destroy();
  });

  it("deduplicates identical failure notices in a multi-image batch", async () => {
    const onNotice = vi.fn();
    tauriMocks.invoke
      .mockRejectedValueOnce("ImageTooLarge")
      .mockRejectedValueOnce("ImageTooLarge");

    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const success = await insertImage(
      view,
      ["C:/bad1.png", "C:/bad2.png"],
      { onNotice },
    );

    expect(success).toBe(false);
    expect(onNotice).toHaveBeenCalledWith(t("image.tooLarge"), "error");
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });
});

describe("createImagePasteHandler and handlePasteEvent", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
  });

  it("ignores paste event when clipboard contains only text", () => {
    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const clipboardData = {
      items: [{ type: "text/plain" }],
      files: [],
      getData: () => "some text",
    } as unknown as DataTransfer;

    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: clipboardData });

    const handled = handlePasteEvent(event, view, () => null);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    view.destroy();
  });

  it("intercepts paste event when clipboard contains image files", async () => {
    tauriMocks.invoke.mockResolvedValueOnce({
      src: "marknote-cache/pasted.png",
      path: "AppData/attachments/pasted.png",
      cached: true,
    });

    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    const file = new File([new Uint8Array([1, 2, 3])], "screenshot.png", { type: "image/png" });
    if (typeof file.arrayBuffer !== "function") {
      file.arrayBuffer = async () => new Uint8Array([1, 2, 3]).buffer;
    }

    const clipboardData = {
      items: [{ type: "image/png", getAsFile: () => file }],
      files: [file],
      getData: () => "",
    } as unknown as DataTransfer;

    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: clipboardData });

    const handled = handlePasteEvent(event, view, () => null);
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("save_attachment", expect.objectContaining({
      docPath: null,
      fileName: "screenshot.png",
    }));
    expect(view.state.doc.toString()).toContain("![screenshot](marknote-cache/pasted.png)");
    view.destroy();
  });
});
