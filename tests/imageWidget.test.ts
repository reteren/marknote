// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { defineLanguageFacet, Language, syntaxTree } from "@codemirror/language";
import { parser } from "@lezer/markdown";
import { ImageWidget } from "../src/editor/livePreview/widgets/Image";
import { imageSelectionEffect, imageSelectionField } from "../src/editor/imageResize";
import { marknoteMarkdown } from "../src/editor/markdownExtensions";
import { translate as t } from "../src/i18n";

const language = new Language(defineLanguageFacet(), parser.configure(marknoteMarkdown));

describe("ImageWidget", () => {
  it("implements eq correctly to avoid rebuilding decorations unnecessarily", () => {
    const resolver = vi.fn().mockResolvedValue("http://marknote.localhost/img.png");
    const otherResolver = vi.fn().mockResolvedValue("http://marknote.localhost/img.png");

    const w1 = new ImageWidget("test.png", "alt", resolver);
    const w2 = new ImageWidget("test.png", "alt", resolver);
    const w3 = new ImageWidget("diff.png", "alt", resolver);
    const w4 = new ImageWidget("test.png", "diff-alt", resolver);
    const w5 = new ImageWidget("test.png", "alt", otherResolver);
    const w6 = new ImageWidget("test.png", "alt", resolver, { width: 200 });
    const w7 = new ImageWidget("test.png", "alt", resolver, { width: 300 });

    expect(w1.eq(w2)).toBe(true);
    expect(w1.eq(w3)).toBe(false);
    expect(w1.eq(w4)).toBe(false);
    expect(w1.eq(w5)).toBe(false);
    expect(w6.eq(w7)).toBe(false);
  });

  it("starts an unsized image at half its natural width after load", () => {
    const widget = new ImageWidget("photo.png", "photo", vi.fn().mockResolvedValue("photo.png"), undefined, true);
    const dom = widget.toDOM({} as any);
    const image = dom.querySelector("img")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 170 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 170 });

    image.dispatchEvent(new Event("load"));

    expect(image.style.width).toBe("85px");
    // The wrapper deliberately remains auto-sized: an inline-block with a
    // block child follows the child's rendered width, including column clamps,
    // so the selected frame cannot be wider than the visible image.
    expect(dom.style.width).toBe("");
    expect(dom.classList.contains("is-selected")).toBe(true);
    expect(dom.getBoundingClientRect().width).toBe(image.getBoundingClientRect().width);
    expect(image.style.height).toBe("auto");
  });

  it("uses an explicit width and height when the alt text carries dimensions", () => {
    const widget = new ImageWidget("photo.png", "photo", vi.fn().mockResolvedValue("photo.png"), { width: 120, height: 80 });
    const dom = widget.toDOM({} as any);
    const image = dom.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 400 },
      naturalHeight: { configurable: true, value: 300 },
    });
    image.dispatchEvent(new Event("load"));

    expect(image.style.width).toBe("120px");
    expect(image.style.height).toBe("80px");
  });

  it("clears image selection when the document is edited", () => {
    const selected = EditorState.create({ doc: "![cat](cat.png)", extensions: [imageSelectionField] }).update({
      effects: imageSelectionEffect.of({ from: 0, to: 15 }),
    }).state;
    const edited = selected.update({ changes: { from: 0, insert: "note\n" } }).state;
    expect(edited.field(imageSelectionField)).toBeNull();
  });

  it("renders DOM with loading state and transitions to loaded on img load", async () => {
    const resolver = vi.fn().mockResolvedValue("http://marknote.localhost/stream/pic.png");
    const widget = new ImageWidget("pic.png", "A nice picture", resolver);

    const dom = widget.toDOM({} as any);
    expect(dom.classList.contains("cm-marknote-image")).toBe(true);
    expect(dom.classList.contains("is-loading")).toBe(true);

    const img = dom.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.alt).toBe("A nice picture");

    await Promise.resolve(); // Wait for promise resolution
    expect(img?.src).toBe("http://marknote.localhost/stream/pic.png");

    // Simulate img load event
    img?.dispatchEvent(new Event("load"));
    expect(dom.classList.contains("is-loading")).toBe(false);
    expect(dom.classList.contains("is-loaded")).toBe(true);
  });

  it("renders distinguished error message when image file is missing", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("File not found on disk"));
    const widget = new ImageWidget("missing.png", "missing", resolver);

    const dom = widget.toDOM({} as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(dom.classList.contains("is-broken")).toBe(true);
    expect(dom.classList.contains("is-missing")).toBe(true);
    expect(dom.textContent).toContain("Image not found: missing.png");
  });

  it("renders distinguished error message when image exceeds 16 MB", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("Image is too large (>16 MB)"));
    const widget = new ImageWidget("giant.jpg", "giant", resolver);

    const dom = widget.toDOM({} as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(dom.classList.contains("is-broken")).toBe(true);
    expect(dom.classList.contains("is-too-large")).toBe(true);
    expect(dom.textContent).toContain(`${t("image.tooLarge")}: giant.jpg`);
  });

  it("renders distinguished error message when document is not saved", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("Cannot resolve a relative image path without a saved document path"));
    const widget = new ImageWidget("./local.png", "local", resolver);

    const dom = widget.toDOM({} as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(dom.classList.contains("is-broken")).toBe(true);
    expect(dom.classList.contains("is-unsaved")).toBe(true);
    expect(dom.textContent).toContain(`${t("image.needsDocument")}: ./local.png`);
  });

  it("renders animated GIFs through streaming URL directly on img element", async () => {
    const gifUrl = "http://marknote.localhost/stream/animation.gif";
    const resolver = vi.fn().mockResolvedValue(gifUrl);
    const widget = new ImageWidget("animation.gif", "Animated GIF", resolver);

    const dom = widget.toDOM({} as any);
    await Promise.resolve();

    const img = dom.querySelector("img");
    expect(img?.src).toBe(gifUrl);
    // No canvas or frame-dropping wrappers attached
    expect(dom.querySelector("canvas")).toBeNull();
  });

  it("commits one resize after a pointer press, move, and release on the second image", () => {
    const initial = "![one](one.png)\n![two](two.png \"title\")";
    let state = EditorState.create({ doc: initial, extensions: [language.extension, imageSelectionField] });
    let dispatches = 0;
    const view = {
      get state() { return state; },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
        dispatches += 1;
      },
      posAtDOM: () => secondImage().from,
    } as any;
    const secondImage = () => {
      let second: ReturnType<typeof syntaxTree>["topNode"] | null = null;
      syntaxTree(state).iterate({ enter: (ref) => { if (ref.node.name === "Image") second = ref.node; } });
      return second!;
    };

    // Move the document above the target before starting the drag. The DOM
    // mapping supplied by the view points at the newly parsed second image.
    state = state.update({ changes: { from: 0, insert: "note\n" } }).state;
    const node = secondImage();
    const widget = new ImageWidget("two.png", "two", vi.fn().mockResolvedValue("two.png"), undefined, true, node.from, node.to);
    const dom = widget.toDOM(view);
    const image = dom.querySelector("img")!;
    const handle = dom.querySelector(".cm-marknote-image-resize-handle")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 300 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ width: 200 } as DOMRect);

    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { clientX: number; pointerId: number };
      Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: 1 } });
      return event;
    };
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 180));
    window.dispatchEvent(pointer("pointerup", 180));

    expect(dispatches).toBe(1);
    expect(state.doc.toString()).toBe("note\n![one](one.png)\n![two|280](two.png \"title\")");
  });
});
