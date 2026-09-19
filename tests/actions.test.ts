import { markdownFormat, plainFormat, type FormatCapabilities } from "../src/state/formats.svelte";
import type { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { createActions } from "../src/state/actions";
import { createContextFormatGroups, createMenuModel, type MenuItem } from "../src/ui/menuModel";
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

const jsonFormat: FormatCapabilities = {
  ...editableFormat,
  id: "json",
  label: "JSON",
  defaultExtension: "json",
};

const lossyFormat: FormatCapabilities = {
  ...editableFormat,
  id: "rtf",
  label: "RTF",
  defaultExtension: "rtf",
  autosave: false,
  lossy: true,
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

function viewFor(doc = documentState.text, selection?: { anchor: number; head?: number }): EditorView {
  let state = EditorState.create({ doc, ...(selection ? { selection } : {}) });
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

  it("opens a fresh window for new-document actions without replacing the current state", async () => {
    const openNewDocumentWindow = vi.fn().mockResolvedValue(undefined);
    const chooseFormat = vi.fn().mockResolvedValue("plain");
    const actions = createActions({
      openNewDocumentWindow,
      dialogs: { chooseFormat },
      getFormats: () => [editableFormat, plainFormat],
      notify: vi.fn(),
    });

    resetDocument(editableFormat, "unsaved text");
    expect(await actions.run("file.newWindow")).toBe(true);
    expect(await actions.newDocument("markdown")).toBe(true);
    expect(await actions.newDocumentWithPicker()).toBe(true);
    expect(openNewDocumentWindow).toHaveBeenNthCalledWith(1, "markdown");
    expect(openNewDocumentWindow).toHaveBeenNthCalledWith(2, "markdown");
    expect(openNewDocumentWindow).toHaveBeenNthCalledWith(3, "plain");
    expect(documentState.text).toBe("unsaved text");
  });

  it("uses the keymap toggle commands for formatting menu actions", async () => {
    const boldView = viewFor("**word**");
    boldView.dispatch({ selection: { anchor: 0, head: 8 } });
    const actions = createActions({ getEditorView: () => boldView });
    expect(await actions.run("format.bold")).toBe(true);
    expect(boldView.state.doc.toString()).toBe("word");

    const blockView = viewFor("word");
    blockView.dispatch({ selection: { anchor: 0, head: 4 } });
    const blockActions = createActions({ getEditorView: () => blockView });
    expect(await blockActions.run("format.codeBlock")).toBe(true);
    expect(blockView.state.doc.toString()).toBe("```\nword\n```");
  });

  it("rejects Markdown actions for non-Markdown formats", async () => {
    resetDocument(plainFormat, "word");
    const view = viewFor("word");
    const actions = createActions({ state: documentState, getEditorView: () => view });

    expect(actions.isAvailable("format.bold")).toBe(false);
    expect(await actions.run("format.bold")).toBe(false);
    expect(view.state.doc.toString()).toBe("word");
  });

  it("connects Ctrl+G to the shell go-to-line dialog and exposes JSON context actions", async () => {
    const goToLine = vi.fn();
    const actions = createActions({ goToLine, state: documentState });
    expect(actions.handlers.goToLine?.()).toBe(true);
    expect(goToLine).toHaveBeenCalledOnce();

    const markdownGroups = createContextFormatGroups({ formatId: "markdown" });
    expect(markdownGroups.flatMap((group) => group.items).some((item) => item.id === "format.jsonValidate")).toBe(false);
    const jsonGroups = createContextFormatGroups({ formatId: "json" });
    expect(jsonGroups.flatMap((group) => group.items).map((item) => item.id)).toContain("format.jsonValidate");
    expect(jsonGroups.flatMap((group) => group.items).map((item) => item.id)).toContain("format.jsonFormat");
  });

  it("validates and formats JSON through the IPC actions", async () => {
    resetDocument(jsonFormat, '{"b":1}');
    const view = viewFor(documentState.text);
    const notify = vi.fn();
    invoke.mockResolvedValueOnce(null).mockResolvedValueOnce('{\n  "b": 1\n}\n');
    const actions = createActions({ state: documentState, getEditorView: () => view, notify });

    expect(await actions.run("format.jsonValidate")).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "validate_json", { text: '{"b":1}' });
    expect(await actions.run("format.jsonFormat")).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(2, "format_json", { text: '{"b":1}' });
    expect(view.state.doc.toString()).toBe('{\n  "b": 1\n}\n');
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

  it("shows the lossy-save decision once per document", async () => {
    replaceDocument({ ...opened, format: lossyFormat });
    setDocumentText("changed");
    const confirmLossySave = vi.fn().mockResolvedValue("save-lossy" as const);
    invoke.mockResolvedValue(saved);
    const actions = createActions({ state: documentState, confirmLossySave });

    expect(await actions.save()).toBe(true);
    setDocumentText("changed again");
    expect(await actions.save()).toBe(true);
    expect(confirmLossySave).toHaveBeenCalledOnce();
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
    // Строки-подписи (kind: "label") командами не являются: по ним не щёлкают
    // и клавиатура их пропускает. Такая сейчас одна — текущий масштаб над
    // пунктами меню View. Проверка по-прежнему требует действие для каждой
    // настоящей команды, иначе она перестала бы что-либо ловить.
    for (const item of menuItems.filter((item) => item.kind === "item")) {
      expect(actions.hasAction(item.id), item.id).toBe(true);
    }

    const contextItems = createContextFormatGroups().flatMap((group) => group.items).filter((item) => !item.separator);
    for (const item of contextItems) {
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

  it("inserts bullet list, numbered list, and task list across lines", async () => {
    const view = viewFor("First\nSecond\nThird", { anchor: 0, head: 18 });
    const actions = makeActions(view);

    await actions.run("format.list");
    expect(view.state.doc.toString()).toBe("- First\n- Second\n- Third");

    await actions.run("format.orderedList");
    expect(view.state.doc.toString()).toBe("1. First\n2. Second\n3. Third");

    await actions.run("format.taskList");
    expect(view.state.doc.toString()).toBe("- [ ] First\n- [ ] Second\n- [ ] Third");
  });

  it("puts the cursor after wrappers inserted by the formatting panel", async () => {
    for (const [action, wrapper] of [
      ["format.bold", "**"],
      ["format.italic", "*"],
      ["format.strikethrough", "~~"],
      ["format.highlight", "=="],
    ] as const) {
      const view = viewFor("word", { anchor: 0, head: 4 });
      const actions = makeActions(view);
      await actions.run(action);
      expect(view.state.doc.toString()).toBe(`${wrapper}word${wrapper}`);
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.from).toBe(wrapper.length + 4 + wrapper.length);
    }

    const view = viewFor("**word**", { anchor: 2, head: 6 });
    await makeActions(view).run("format.bold");
    expect(view.state.doc.toString()).toBe("word");
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.from).toBe(4);
  });

  it("places heading text cursor after the inserted hashes", async () => {
    const empty = viewFor("", { anchor: 0 });
    await makeActions(empty).run("format.heading2");
    expect(empty.state.doc.toString()).toBe("## ");
    expect(empty.state.selection.main.from).toBe(3);
    expect(empty.state.selection.main.empty).toBe(true);

    const text = viewFor("title", { anchor: 0 });
    await makeActions(text).run("format.heading2");
    expect(text.state.doc.toString()).toBe("## title");
    expect(text.state.selection.main.from).toBe(3);

    const existing = viewFor("# title", { anchor: 0 });
    await makeActions(existing).run("format.heading3");
    expect(existing.state.doc.toString()).toBe("### title");
    expect(existing.state.selection.main.from).toBe(4);
  });

  it("clears formatting on selection without stripping headings or list markers", async () => {
    const doc = [
      "# Heading with **bold** and *italic*",
      "- [ ] Task with ~~strike~~ and ==highlight==",
      "1. Numbered with `code` and ***both***",
      "Normal text with **bold**",
    ].join("\n");

    const view = viewFor(doc, { anchor: 0, head: doc.length });
    const actions = makeActions(view);

    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe([
      "# Heading with bold and italic",
      "- [ ] Task with strike and highlight",
      "1. Numbered with code and both",
      "Normal text with bold",
    ].join("\n"));
  });

  it("clears formatting on word under cursor without selection like toggleWrapper", async () => {
    // Bold
    let view = viewFor("Hello **world** test", { anchor: 8 });
    let actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello world test");
    expect(view.state.selection.main.from).toBe(6);
    expect(view.state.selection.main.to).toBe(11);

    // Code
    view = viewFor("Hello `code` test", { anchor: 8 });
    actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello code test");

    // Highlight
    view = viewFor("Hello ==highlight== test", { anchor: 10 });
    actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello highlight test");

    // Strikethrough
    view = viewFor("Hello ~~strike~~ test", { anchor: 10 });
    actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello strike test");

    // Italic
    view = viewFor("Hello *italic* test", { anchor: 9 });
    actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello italic test");

    // Nested wrappers
    view = viewFor("Hello ***nested*** test", { anchor: 11 });
    actions = makeActions(view);
    await actions.run("format.clearFormatting");
    expect(view.state.doc.toString()).toBe("Hello nested test");
  });

  it("inserts horizontal rule, table, callout, and math block via action system", async () => {
    const view = viewFor("");
    const actions = makeActions(view);

    await actions.run("format.horizontalRule");
    expect(view.state.doc.toString()).toBe("---\n");
    expect(view.state.selection.main.from).toBe(4);

    const hrView = viewFor("");
    const hrActions = makeActions(hrView);
    await hrActions.run("insert-hr");
    expect(hrView.state.doc.toString()).toBe("---\n");
    expect(hrView.state.selection.main.from).toBe(4);

    const textHrView = viewFor("Some text", { anchor: 9 });
    const textHrActions = makeActions(textHrView);
    await textHrActions.run("format.horizontalRule");
    expect(textHrView.state.doc.toString()).toBe("Some text\n\n---\n");
    expect(textHrView.state.selection.main.from).toBe(15);

    const endOfLine = viewFor("Some text\n", { anchor: 10 });
    await makeActions(endOfLine).run("format.horizontalRule");
    expect(endOfLine.state.doc.toString()).toBe("Some text\n\n---\n");

    const beforeText = viewFor("Some text\nnext", { anchor: 10 });
    await makeActions(beforeText).run("format.horizontalRule");
    expect(beforeText.state.doc.toString()).toBe("Some text\n\n---\nnext");

    const tableView = viewFor("");
    const tableActions = makeActions(tableView);
    await tableActions.run("format.table");
    expect(tableView.state.doc.toString()).toBe("|  |  |\n| --- | --- |\n|  |  |\n\n");

    const tableBeforeText = viewFor("after", { anchor: 0 });
    await makeActions(tableBeforeText).run("format.table");
    expect(tableBeforeText.state.doc.toString()).toBe("|  |  |\n| --- | --- |\n|  |  |\n\nafter");

    const calloutView = viewFor("");
    const calloutActions = makeActions(calloutView);
    await calloutActions.run("format.callout");
    expect(calloutView.state.doc.toString()).toContain("> [!NOTE]");

    const mathView = viewFor("");
    const mathActions = makeActions(mathView);
    await mathActions.run("format.mathBlock");
    expect(mathView.state.doc.toString()).toContain("$$");
  });

  it("inserts a horizontal rule with exactly one following newline", async () => {
    const cases = [
      ["", 0, "---\n"],
      ["Some text", 9, "Some text\n\n---\n"],
      ["Some text\n", 10, "Some text\n\n---\n"],
      ["Some text\n\n", 11, "Some text\n\n---\n"],
      ["Some text\nnext", 10, "Some text\n\n---\nnext"],
    ] as const;
    for (const [doc, cursor, expected] of cases) {
      const view = viewFor(doc, { anchor: cursor });
      await makeActions(view).run("format.horizontalRule");
      expect(view.state.doc.toString()).toBe(expected);
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.from).toBe(cursor + expected.length - doc.length);
    }
  });

  it("positions cursor immediately after marker when inserting task, bullet, and ordered lists", async () => {
    // 1. Task list on empty line
    const taskView = viewFor("", { anchor: 0 });
    const taskActions = makeActions(taskView);
    await taskActions.run("format.taskList");
    expect(taskView.state.doc.toString()).toBe("- [ ] ");
    expect(taskView.state.selection.main.from).toBe(6);
    expect(taskView.state.selection.main.to).toBe(6);

    // 2. Bullet list on empty line
    const bulletView = viewFor("", { anchor: 0 });
    const bulletActions = makeActions(bulletView);
    await bulletActions.run("format.list");
    expect(bulletView.state.doc.toString()).toBe("- ");
    expect(bulletView.state.selection.main.from).toBe(2);
    expect(bulletView.state.selection.main.to).toBe(2);

    // 3. Ordered list on empty line
    const orderedView = viewFor("", { anchor: 0 });
    const orderedActions = makeActions(orderedView);
    await orderedActions.run("format.orderedList");
    expect(orderedView.state.doc.toString()).toBe("1. ");
    expect(orderedView.state.selection.main.from).toBe(3);
    expect(orderedView.state.selection.main.to).toBe(3);

    // 4. Task list with cursor at column 0 of existing line
    const textTaskView = viewFor("Buy milk", { anchor: 0 });
    const textTaskActions = makeActions(textTaskView);
    await textTaskActions.run("format.taskList");
    expect(textTaskView.state.doc.toString()).toBe("- [ ] Buy milk");
    expect(textTaskView.state.selection.main.from).toBe(6);
    expect(textTaskView.state.selection.main.to).toBe(6);

    // 5. Task list with cursor already inside body text keeps relative offset
    const offsetView = viewFor("Buy milk", { anchor: 4 }); // "Buy |milk"
    const offsetActions = makeActions(offsetView);
    await offsetActions.run("format.taskList");
    expect(offsetView.state.doc.toString()).toBe("- [ ] Buy milk");
    expect(offsetView.state.selection.main.from).toBe(10); // "- [ ] Buy |milk"

    // 6. Focus is called on view
    let focused = false;
    (taskView as unknown as { focus: () => void }).focus = () => { focused = true; };
    await taskActions.run("format.taskList");
    expect(focused).toBe(true);
  });
});
