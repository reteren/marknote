// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createEditor } from "../src/editor/createEditor";
import { applyEditorSettings } from "../src/editor/settings";
import { previewDecorations, decorationRanges } from "../src/editor/livePreview/plugin";
import { markdownFormat } from "../src/state/formats.svelte";
import { defaultSettings, type Settings } from "../src/state/settings.svelte";

const views: EditorView[] = [];

function createTestEditor(
  settings: Settings | null = null,
  doc = "**hello world**",
  cursorPos = 0,
): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = createEditor({
    parent,
    doc,
    format: markdownFormat,
    settings,
    onChange: () => undefined,
    onStats: () => undefined,
  });
  if (cursorPos > 0) {
    view.dispatch({ selection: { anchor: cursorPos } });
  }
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("live preview settings", () => {
  it("disables live preview completely when enabled is false", () => {
    const view = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, enabled: false },
      },
      "**bold text**",
    );
    expect(previewDecorations(view).size).toBe(0);

    applyEditorSettings(view, {
      ...defaultSettings,
      livePreview: { ...defaultSettings.livePreview, enabled: true },
    });
    expect(previewDecorations(view).size).toBeGreaterThan(0);
  });

  it("applies revealMarkup modes: cursor, line, and never", () => {
    const doc = "**bold** and regular text\nsecond line";
    const cursorOutside = 15;

    // Mode "cursor": cursor outside bold node keeps markup hidden
    const viewCursor = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, revealMarkup: "cursor" },
      },
      doc,
      cursorOutside,
    );
    const rangesCursor = decorationRanges(previewDecorations(viewCursor));
    const hasHiddenMarksCursor = rangesCursor.some(
      (r) => r.decoration.spec.class === undefined && r.from === 0 && r.to === 2,
    );
    expect(hasHiddenMarksCursor).toBe(true);

    // Mode "line": cursor anywhere on line 1 reveals markup on that line
    applyEditorSettings(viewCursor, {
      ...defaultSettings,
      livePreview: { ...defaultSettings.livePreview, revealMarkup: "line" },
    });
    const rangesLine = decorationRanges(previewDecorations(viewCursor));
    const hasHiddenMarksLine = rangesLine.some(
      (r) => r.decoration.spec.class === undefined && r.from === 0 && r.to === 2,
    );
    expect(hasHiddenMarksLine).toBe(false);

    // Mode "never": cursor on line 2 still leaves markup on line 1 revealed
    const viewNever = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, revealMarkup: "never" },
      },
      doc,
      doc.length,
    );
    const rangesNever = decorationRanges(previewDecorations(viewNever));
    const hasHiddenMarksNever = rangesNever.some(
      (r) => r.decoration.spec.class === undefined && r.from === 0 && r.to === 2,
    );
    expect(hasHiddenMarksNever).toBe(false);
  });

  it("skips formula widgets when renderFormulas is false", () => {
    const doc = "formula $E=mc^2$ inline";
    const viewWithFormulas = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, renderFormulas: true },
      },
      doc,
    );
    const widgetsWith = decorationRanges(previewDecorations(viewWithFormulas))
      .map((r) => r.decoration.spec.widget?.constructor?.name)
      .filter(Boolean);
    expect(widgetsWith).toContain("MathWidget");

    const viewWithoutFormulas = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, renderFormulas: false },
      },
      doc,
    );
    const widgetsWithout = decorationRanges(previewDecorations(viewWithoutFormulas))
      .map((r) => r.decoration.spec.widget?.constructor?.name)
      .filter(Boolean);
    expect(widgetsWithout).not.toContain("MathWidget");
  });

  it("skips image widgets when renderImages is false", () => {
    const doc = "image ![photo](https://example.com/pic.png) preview";
    const viewWithImages = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, renderImages: true },
      },
      doc,
    );
    const widgetsWith = decorationRanges(previewDecorations(viewWithImages))
      .map((r) => r.decoration.spec.widget?.constructor?.name)
      .filter(Boolean);
    expect(widgetsWith).toContain("ImageWidget");

    const viewWithoutImages = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, renderImages: false },
      },
      doc,
    );
    const widgetsWithout = decorationRanges(previewDecorations(viewWithoutImages))
      .map((r) => r.decoration.spec.widget?.constructor?.name)
      .filter(Boolean);
    expect(widgetsWithout).not.toContain("ImageWidget");
  });

  it("disables live preview when document exceeds disableAboveBytes threshold", () => {
    const doc = "**bold text that is somewhat long**";
    const view = createTestEditor(
      {
        ...defaultSettings,
        livePreview: { ...defaultSettings.livePreview, disableAboveBytes: 10 },
      },
      doc,
    );
    expect(previewDecorations(view).size).toBe(0);

    applyEditorSettings(view, {
      ...defaultSettings,
      livePreview: { ...defaultSettings.livePreview, disableAboveBytes: 1000 },
    });
    expect(previewDecorations(view).size).toBeGreaterThan(0);
  });
});
