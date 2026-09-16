// @vitest-environment jsdom

import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
}));

import { createEditor } from "../src/editor/createEditor";
import {
  getZoom,
  installZoom,
  resetZoom,
  setZoomPercent,
  zoomIn,
  zoomOut,
} from "../src/editor/zoom";
import type { FormatCapabilities } from "../src/state/formats.svelte";
import { defaultSettings, settingsState } from "../src/state/settings.svelte";

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

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "get_settings") return defaultSettings;
    if (command === "save_settings") return (args as { settings: unknown })?.settings;
    return undefined;
  });
  settingsState.settings.editor.zoomPercent = ZOOM_DEFAULT;
  settingsState.ready = true;
});

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  localStorage.clear();
  settingsState.settings.editor.zoomPercent = ZOOM_DEFAULT;
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
    const menuLabel = document.createElement("span");
    menuLabel.style.fontSize = "var(--font-size-ui)";
    menuLabel.style.width = "72px";
    document.body.append(menuLabel);
    const menuTypography = menuLabel.style.fontSize;
    const menuWidth = menuLabel.style.width;
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
    expect(menuLabel.style.fontSize).toBe(menuTypography);
    expect(menuLabel.style.width).toBe(menuWidth);
    expect(document.documentElement.style.zoom || "").toBe("");

    const styleText = Array.from(document.head.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
    expect(styleText).toContain("var(--line-width)");
    expect(styleText).toContain("var(--font-size-text)");
    expect(view.dom.classList.contains("cm-editor")).toBe(true);
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

  it("rapid zoom series coalesces into a single debounced save", async () => {
    vi.useFakeTimers();
    const view = editor();
    installZoom(view);
    tauri.invoke.mockClear();

    // Fire 20 rapid zoomIn operations
    for (let index = 0; index < 20; index += 1) {
      zoomIn(view);
    }

    expect(getZoom(view)).toBe(ZOOM_MAX);
    expect(settingsState.settings.editor.zoomPercent).toBe(ZOOM_MAX);

    // Save must not fire immediately (preventing disk thrashing)
    expect(tauri.invoke).not.toHaveBeenCalled();

    // 399ms elapsed - still debouncing
    vi.advanceTimersByTime(399);
    expect(tauri.invoke).not.toHaveBeenCalled();

    // Debounce timer (400ms) fires
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("save_settings", expect.objectContaining({
      settings: expect.objectContaining({
        editor: expect.objectContaining({
          zoomPercent: ZOOM_MAX,
        }),
      }),
    }));

    vi.useRealTimers();
  });
});
