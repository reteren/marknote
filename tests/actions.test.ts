import { markdownFormat, plainFormat, type FormatCapabilities } from "../src/state/formats.svelte";
import type { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { createActions } from "../src/state/actions";
import { createMenuModel, type MenuItem } from "../src/ui/menuModel";
import { documentState, replaceDocument, resetDocument, setDocumentText } from "../src/state/document.svelte";
import { createAutosave } from "../src/state/autosave";

const editableFormat: FormatCapabilities = {
  ...markdownFormat,
  id: "markdown",
  label: "Markdown",
};

const readOnlyFormat: FormatCapabilities = {
  ...markdownFormat,
  id: "pdf",
  label: "PDF",
  editable: false,
  creatable: false,
  livePreview: false,
  autosave: false,
};

const opened = {
  path: "C:/notes/readme.md",
  text: "saved text",
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf" as const,
  format: editableFormat,
  readonly: false,
};

const saved = {
  path: opened.path,
  savedAt: "2026-09-14T12:00:00.000Z",
  format: editableFormat,
};

function viewFor(doc = documentState.text): EditorView {
  let state = EditorState.create({ doc });
  return {
    get state() {
      return state;
    },
    dispatch(spec) {
      state = state.update(spec).state;
    },
  } as EditorView;
}

function allItems(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.submenu ? allItems(item.submenu) : [])]);
}

function makeActions(view?: EditorView) {
  return createActions({
    getEditorView: () => view ?? null,
    autosave: createAutosave({ getState: () => documentState }),
    getFormats: () => [editableFormat, plainFormat],
    notify: vi.fn(),
  });
}

beforeEach(() => {
  invoke.mockReset();
  resetDocument(editableFormat, "");
});

describe("application actions", () => {
  it("routes the File → Settings command to the injected settings-window action", async () => {
    const openSettings = vi.fn();
    const actions = createActions({ openSettings });

    expect(actions.hasAction("file.settings")).toBe(true);
    expect(actions.isAvailable("file.settings")).toBe(true);
    expect(await actions.run("file.settings")).toBe(true);
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("creates a document through new_document and updates the shared state", async () => {
    invoke.mockResolvedValueOnce({ text: "", format: plainFormat });
    const view = viewFor("");
    const actions = makeActions(view);

    expect(await actions.newDocument("plain", view)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("new_document", { formatId: "plain" });
    expect(documentState.path).toBeNull();
    expect(documentState.format.id).toBe("plain");
    expect(view.state.doc.toString()).toBe("");
  });

  it("picks a path and opens it, or opens an explicit path directly", async () => {
    invoke.mockResolvedValueOnce("C:/notes/picked.md").mockResolvedValueOnce(opened);
    const actions = makeActions(viewFor());

    expect(await actions.openFile()).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "pick_file");
    expect(invoke).toHaveBeenNthCalledWith(2, "open_file", { path: "C:/notes/picked.md" });
    expect(documentState.path).toBe(opened.path);
    expect(documentState.text).toBe(opened.text);

    invoke.mockReset();
    invoke.mockResolvedValueOnce(opened);
    expect(await actions.openFile(opened.path)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_file", { path: opened.path });
  });

  it("saves a named document through the autosave controller and save_file", async () => {
    replaceDocument(opened);
    setDocumentText("changed");
    invoke.mockResolvedValueOnce(saved);
    const actions = makeActions();

    expect(await actions.save()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_file", {
      path: opened.path,
      text: "changed",
      encoding: "utf-8",
      bom: false,
      lineEnding: "lf",
    });
    expect(documentState.saveStatus).toBe("saved");
  });

  it("routes Save for an untitled document to save_as with the suggested extension", async () => {
    resetDocument(plainFormat, "draft");
    invoke.mockResolvedValueOnce({ ...saved, path: "C:/notes/draft.txt", format: plainFormat });
    const actions = makeActions();

    expect(await actions.save()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_as", {
      text: "draft",
      formatId: "plain",
      suggestedName: "Untitled.txt",
    });
    expect(documentState.path).toBe("C:/notes/draft.txt");
  });

  it("does not call save_file for a read-only document", async () => {
    replaceDocument({ ...opened, path: "C:/notes/report.pdf", format: readOnlyFormat, readonly: true });
    setDocumentText("not writable");
    const actions = makeActions();

    expect(await actions.save()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(actions.isAvailable("file.save")).toBe(false);
    expect(actions.isAvailable("file.saveAs")).toBe(true);
  });

  it("opens a new window and reveals only documents with paths", async () => {
    resetDocument(editableFormat, "draft");
    const actions = makeActions();
    expect(await actions.newWindow()).toBe(false);
    expect(await actions.revealInExplorer()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    replaceDocument(opened);
    invoke.mockResolvedValue(undefined);
    expect(await actions.openInNewWindow()).toBe(true);
    expect(await actions.revealInExplorer()).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "open_in_new_window", { path: opened.path });
    expect(invoke).toHaveBeenNthCalledWith(2, "reveal_in_explorer", { path: opened.path });
  });

  it("uses searchCommands for search actions and exposes the same command handlers to keymap", () => {
    const view = viewFor("query");
    const actions = makeActions(view);
    expect(actions.openSearch(view)).toBe(true);
    expect(actions.openReplace(view)).toBe(true);
    expect(actions.handlers.openSearch?.(view)).toBe(true);
    expect(actions.handlers.openReplace?.(view)).toBe(true);
  });

  it("reports availability for untitled, read-only, and normal documents", () => {
    const actions = makeActions();
    expect(actions.isAvailable("file.save")).toBe(false);
    expect(actions.isAvailable("file.saveAs")).toBe(false);
    expect(actions.isAvailable("file.revealInExplorer")).toBe(false);

    resetDocument(editableFormat, "draft");
    expect(actions.isAvailable("file.save")).toBe(true);
    expect(actions.isAvailable("file.saveAs")).toBe(true);

    replaceDocument({ ...opened, format: readOnlyFormat, readonly: true });
    expect(actions.isAvailable("file.save")).toBe(false);
    expect(actions.isAvailable("file.saveAs")).toBe(true);
    expect(actions.isAvailable("file.revealInExplorer")).toBe(true);
  });

  it("has an action for every menu and context-menu command identifier", () => {
    const actions = makeActions();
    const menuItems = allItems(createMenuModel([editableFormat, plainFormat]).flatMap((section) => section.items));
    for (const item of menuItems.filter((item) => !item.separator)) {
      expect(actions.hasAction(item.id), item.id).toBe(true);
    }

    for (const id of [
      "cut", "copy", "paste", "delete", "select-all", "bold", "italic", "code", "strikethrough", "highlight", "link",
      "open-link", "copy-link", "edit-link", "open-image", "copy-image", "insert-table", "insert-callout",
      "insert-code-block", "insert-math-block", "insert-hr",
    ]) {
      expect(actions.hasAction(id), id).toBe(true);
    }
  });
});
