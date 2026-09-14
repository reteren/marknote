// @vitest-environment jsdom

import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/editor/createEditor";
import {
  getZoom,
  installZoom,
  resetZoom,
  zoomIn,
  zoomOut,
} from "../src/editor/zoom";
import type { FormatCapabilities } from "../src/state/formats.svelte";

const views: EditorView[] = [];
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_STORAGE_KEY = "marknote.editor.zoom";

const plainFormat: FormatCapabilities = {
  id: "plain",
  label: "Plain Text",
  defaultExtension: "txt",
  extensions: ["txt"],
  editable: true,
  creatable: true,
  livePreview: false,
  autosave: true,
  lossy: false,
  syntaxMode: null,
  template: "",
};

function editor(doc = "hello"): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = createEditor({
    parent,
    doc,
    format: plainFormat,
    onChange: () => undefined,
    onStats: () => undefined,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("editor zoom", () => {
  it("uses bounded ten-percent steps and reset", () => {
    const view = editor();
    expect(installZoom(view)).toBe(ZOOM_DEFAULT);

    zoomIn(view);
    expect(getZoom(view)).toBe(ZOOM_DEFAULT + ZOOM_STEP);
    zoomOut(view);
    expect(getZoom(view)).toBe(ZOOM_DEFAULT);

    for (let index = 0; index < 30; index += 1) zoomIn(view);
    expect(getZoom(view)).toBe(ZOOM_MAX);
    for (let index = 0; index < 30; index += 1) zoomOut(view);
    expect(getZoom(view)).toBe(ZOOM_MIN);

    resetZoom(view);
    expect(getZoom(view)).toBe(ZOOM_DEFAULT);
    expect(document.documentElement.style.zoom || "").toBe("");
  });

  it("persists the last value and restores it for the next editor", () => {
    const first = editor();
    installZoom(first);
    zoomIn(first);
    expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe(String(ZOOM_DEFAULT + ZOOM_STEP));

    first.destroy();
    const second = editor();
    expect(installZoom(second)).toBe(ZOOM_DEFAULT + ZOOM_STEP);
    expect(getZoom(second)).toBe(ZOOM_DEFAULT + ZOOM_STEP);
  });

  it("keeps text, cursor, and undo history while changing only editor typography", () => {
    const view = editor("hello");
    installZoom(view);
    view.dispatch({ selection: { anchor: 2 } });
    view.dispatch({ changes: { from: 2, to: 2, insert: "!" } });
    const text = view.state.doc.toString();
    const cursor = view.state.selection.main.head;

    zoomIn(view);

    expect(view.state.doc.toString()).toBe(text);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
    expect(document.documentElement.style.zoom || "").toBe("");

    const styleText = Array.from(document.head.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
    expect(styleText).toContain("var(--line-width)");
    expect(styleText).toContain("var(--font-size-text)");
  });

  it("does not fail when localStorage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const view = editor();

    expect(() => installZoom(view)).not.toThrow();
    expect(() => zoomIn(view)).not.toThrow();
    expect(getZoom(view)).toBe(ZOOM_DEFAULT + ZOOM_STEP);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
