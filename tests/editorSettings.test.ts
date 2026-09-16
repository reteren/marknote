// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { indentUnit } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { createEditor } from "../src/editor/createEditor";
import { applyEditorSettings } from "../src/editor/settings";
import { defaultSettings, type Settings } from "../src/state/settings.svelte";
import type { FormatCapabilities } from "../src/state/formats.svelte";

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

const views: EditorView[] = [];

function createTestEditor(settings: Settings | null = null, doc = "hello world \nsecond line"): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = createEditor({
    parent,
    doc,
    format: plainFormat,
    settings,
    onChange: () => undefined,
    onStats: () => undefined,
  });
  views.push(view);
  return view;
}

function getStyleText(): string {
  return Array.from(document.head.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("editor appearance settings", () => {
  it("applies fontFamily to editor theme", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, fontFamily: "system-serif" },
    });
    expect(view).toBeDefined();
    const styleText = getStyleText();
    expect(styleText).toContain("Georgia");
  });

  it("applies fontSize to editor theme", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, fontSize: 18 },
    });
    expect(view).toBeDefined();
    const styleText = getStyleText();
    expect(styleText).toContain("18px");
  });

  it("applies columnWidth to editor theme", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, columnWidth: "narrow" },
    });
    expect(view).toBeDefined();
    const styleText = getStyleText();
    expect(styleText).toContain("65ch");
  });

  it("applies tabWidth to EditorState.tabSize", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, tabWidth: 8 },
    });
    expect(view.state.tabSize).toBe(8);
  });

  it("applies insertSpaces to indentUnit", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, insertSpaces: false },
    });
    expect(view.state.facet(indentUnit)).toBe("\t");
  });

  it("applies showInvisibles to whitespace decorations", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, showInvisibles: true },
    }, "hello world ");
    expect(view.dom.querySelector(".cm-highlightSpace")).not.toBeNull();
  });

  it("applies highlightCurrentLine to active line", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, highlightCurrentLine: true },
    });
    expect(view.dom.querySelector(".cm-activeLine")).not.toBeNull();
  });

  it("applies lineNumbers to gutters", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, lineNumbers: true },
    });
    expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("applies softWrap to line wrapping", () => {
    const view = createTestEditor({
      ...defaultSettings,
      editor: { ...defaultSettings.editor, softWrap: false },
    });
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);

    applyEditorSettings(view, {
      ...defaultSettings,
      editor: { ...defaultSettings.editor, softWrap: true },
    });
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
  });
});
