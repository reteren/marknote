import { describe, expect, it } from "vitest";
import { createContextFormatGroups, createMenuModel, type MenuItem } from "../src/ui/menuModel";
import type { FormatCapabilities } from "../src/state/formats.svelte";

const format = (id: string, label: string, extension: string, creatable = true): FormatCapabilities => ({
  id,
  label,
  defaultExtension: extension,
  extensions: [extension],
  editable: true,
  creatable,
  livePreview: false,
  autosave: true,
  lossy: false,
  syntaxMode: null,
  template: "",
});

function allItems(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.submenu ? allItems(item.submenu) : [])]);
}

describe("menu model", () => {
  it("contains File, Edit, View, and Help without a top-level Format section", () => {
    expect(createMenuModel([]).map((section) => section.id)).toEqual(["file", "edit", "view", "help"]);
  });

  it("builds File → New from the supplied creatable format registry", () => {
    const model = createMenuModel([format("markdown", "Markdown", "md"), format("json", "JSON", "json"), format("pdf", "PDF", "pdf", false)]);
    const newItem = model[0].items.find((item) => item.id === "file.new");
    expect(newItem?.submenu?.map((item) => [item.id, item.label, item.formatId])).toEqual([
      ["file.new.markdown", "Markdown", "markdown"],
      ["file.new.json", "JSON", "json"],
    ]);
  });

  it("keeps every item id unique, including separators and dynamic formats", () => {
    const model = createMenuModel([format("markdown", "Markdown", "md"), format("markdown", "Duplicate", "md")]);
    const ids = allItems(model.flatMap((section) => section.items)).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the documented shortcut labels", () => {
    const items = allItems(createMenuModel([]).flatMap((section) => section.items));
    const shortcuts = new Map(items.filter((item) => item.shortcut).map((item) => [item.id, item.shortcut]));
    expect(shortcuts.get("file.newWindow")).toBe("Ctrl+N");
    expect(shortcuts.get("file.open")).toBe("Ctrl+O");
    expect(shortcuts.get("file.save")).toBe("Ctrl+S");
    expect(shortcuts.get("file.saveAs")).toBe("Ctrl+Shift+S");
    expect(shortcuts.get("file.close")).toBe("Ctrl+W");
    expect(shortcuts.get("file.settings")).toBe("Ctrl+,");
    expect(shortcuts.get("view.zoomIn")).toBe('Ctrl + “+”');
    expect(shortcuts.get("view.zoomOut")).toBe('Ctrl + “-”');
    expect(shortcuts.get("edit.undo")).toBe("Ctrl+Z");
    expect(shortcuts.get("edit.redo")).toBe("Ctrl+Shift+Z / Ctrl+Y");
    expect(shortcuts.get("edit.cut")).toBe("Ctrl+X");
    expect(shortcuts.get("edit.copy")).toBe("Ctrl+C");
    expect(shortcuts.get("edit.paste")).toBe("Ctrl+V");
    expect(shortcuts.get("edit.pastePlainText")).toBe("Ctrl+Shift+V");
    expect(shortcuts.get("edit.selectAll")).toBe("Ctrl+A");
    expect(shortcuts.get("edit.find")).toBe("Ctrl+F");
    expect(shortcuts.get("edit.replace")).toBe("Ctrl+H");
    expect(shortcuts.has("format.bold")).toBe(false);
    expect(shortcuts.get("view.resetZoom")).toBe("Ctrl+0");
  });

  it("keeps formatting actions and their established IDs in the three context groups", () => {
    const groups = createContextFormatGroups();
    expect(groups.map((group) => group.label)).toEqual(["Formatting", "Paragraph", "Insert"]);
    const groupIds = groups.map((group) => group.items.filter((item) => !item.separator).map((item) => item.id));
    expect(groupIds).toEqual([
      ["format.bold", "format.italic", "format.strikethrough", "format.highlight", "format.code", "format.link"],
      ["format.heading1", "format.heading2", "format.heading3", "format.heading4", "format.heading5", "format.heading6", "format.clearHeading", "format.list"],
      ["format.table", "format.callout", "format.codeBlock", "format.mathBlock", "format.horizontalRule"],
    ]);
  });

  it("marks unavailable items and leaves them unselectable", () => {
    const model = createMenuModel([format("markdown", "Markdown", "md")], { editable: false, canUndo: false });
    const items = allItems(model.flatMap((section) => section.items));
    expect(items.find((item) => item.id === "edit.undo")?.disabled).toBe(true);
    expect(createContextFormatGroups({ editable: false })[0].items.find((item) => item.id === "format.bold")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "file.new.markdown")?.disabled).toBe(false);
  });
});
