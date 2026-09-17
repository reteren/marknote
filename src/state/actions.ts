import { invoke } from "@tauri-apps/api/core";
import { redo, deleteLine, moveLineDown, moveLineUp, selectAll, undo } from "@codemirror/commands";
import type { Command, EditorView } from "@codemirror/view";
import { searchCommands } from "../editor/search";
import { toggleCodeBlock, toggleWrapper } from "../editor/keymap";
import { safeLinkHref } from "../editor/livePreview/inline";
import {
  documentState,
  markSaved,
  replaceDocument,
  resetDocument,
  setDocumentText,
  type DocumentState,
  type NewDocument,
  type OpenedFile,
  type SaveResult,
} from "./document.svelte";
import { saveAs as saveAsFile, type AutosaveController } from "./autosave";
import type { FormatCapabilities } from "./formats.svelte";
import { markdownFormat } from "./formats.svelte";
import { settingsState, type Settings } from "./settings.svelte";
import type { MarknoteKeymapHandlers } from "../editor/keymap";

export type ActionResult = boolean;

export type LossySaveDecision = "save-lossy" | "save-markdown" | "cancel";

export type ClipboardAdapter = {
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
};

export type ActionDialog = {
  chooseFormat?: (formats: readonly FormatCapabilities[]) => Promise<string | null>;
  showHelp?: (topic: "shortcuts" | "markdownReference" | "about") => void | Promise<void>;
  openLink?: (url: string) => void | Promise<void>;
  openImage?: (src: string) => void | Promise<void>;
};

export type ActionsDependencies = {
  /** Live state object; by default this is the shared Svelte 5 state. */
  state?: DocumentState;
  /** Returning null is valid while the editor is being rebuilt. */
  getEditorView?: () => EditorView | null;
  /** Autosave owns the save_file IPC path and the 2-second policy. */
  autosave?: Pick<AutosaveController, "flush"> | null;
  /** UI adapters are injected so this module remains a Node-testable module. */
  dialogs?: ActionDialog;
  clipboard?: ClipboardAdapter;
  getFormats?: () => readonly FormatCapabilities[];
  getSettings?: () => Settings;
  notify?: (message: string) => void;
  /** Ask once before writing a lossy format. */
  confirmLossySave?: () => Promise<LossySaveDecision>;
  /** Used by the lossy warning's Markdown escape hatch. */
  saveAsMarkdown?: () => Promise<ActionResult>;
  onDocumentReplaced?: () => void;
  closeWindow?: () => void | Promise<void>;
  openSettings?: () => void | Promise<void>;
  goToLine?: () => void | Promise<void>;
  zoomIn?: () => void | Promise<void>;
  zoomOut?: () => void | Promise<void>;
  resetZoom?: () => void | Promise<void>;
  /** Opens a fresh untitled window without mutating the current document. */
  openNewDocumentWindow?: (formatId: string) => void | Promise<void>;
};

export type AppActions = {
  handlers: MarknoteKeymapHandlers;
  run: (id: string, payload?: string) => Promise<ActionResult>;
  isAvailable: (id: string, payload?: string) => boolean;
  hasAction: (id: string) => boolean;
  newDocument: (formatId?: string, view?: EditorView | null) => Promise<ActionResult>;
  newDocumentWithPicker: (view?: EditorView | null) => Promise<ActionResult>;
  pickFile: () => Promise<string | null>;
  openFile: (path?: string, view?: EditorView | null) => Promise<ActionResult>;
  save: (view?: EditorView | null) => Promise<ActionResult>;
  saveAs: (view?: EditorView | null) => Promise<ActionResult>;
  newWindow: (path?: string) => Promise<ActionResult>;
  openInNewWindow: (path?: string) => Promise<ActionResult>;
  revealInExplorer: () => Promise<ActionResult>;
  undo: (view?: EditorView | null) => ActionResult;
  redo: (view?: EditorView | null) => ActionResult;
  cut: (view?: EditorView | null) => Promise<ActionResult>;
  copy: (view?: EditorView | null) => Promise<ActionResult>;
  paste: (view?: EditorView | null) => Promise<ActionResult>;
  pastePlainText: (view?: EditorView | null) => Promise<ActionResult>;
  selectAll: (view?: EditorView | null) => ActionResult;
  deleteLine: (view?: EditorView | null) => ActionResult;
  moveLineUp: (view?: EditorView | null) => ActionResult;
  moveLineDown: (view?: EditorView | null) => ActionResult;
  bold: (view?: EditorView | null) => ActionResult;
  italic: (view?: EditorView | null) => ActionResult;
  code: (view?: EditorView | null) => ActionResult;
  link: (view?: EditorView | null) => ActionResult;
  strikethrough: (view?: EditorView | null) => ActionResult;
  highlight: (view?: EditorView | null) => ActionResult;
  heading: (level: number, view?: EditorView | null) => ActionResult;
  list: (view?: EditorView | null) => ActionResult;
  orderedList: (view?: EditorView | null) => ActionResult;
  taskList: (view?: EditorView | null) => ActionResult;
  clearFormatting: (view?: EditorView | null) => ActionResult;
  table: (view?: EditorView | null) => ActionResult;
  callout: (view?: EditorView | null) => ActionResult;
  codeBlock: (view?: EditorView | null) => ActionResult;
  mathBlock: (view?: EditorView | null) => ActionResult;
  horizontalRule: (view?: EditorView | null) => ActionResult;
  openSearch: (view?: EditorView | null) => ActionResult;
  openReplace: (view?: EditorView | null) => ActionResult;
  openLink: (url: string) => Promise<ActionResult>;
  copyLink: (url: string) => Promise<ActionResult>;
  editLink: (url: string, view?: EditorView | null) => ActionResult;
  openImage: (src: string) => Promise<ActionResult>;
  copyImage: (src: string) => Promise<ActionResult>;
  resetLossyWarning: () => void;
};

const menuActionIds = new Set([
  "file.new",
  "file.newWindow",
  "file.open",
  "file.save",
  "file.saveAs",
  "file.close",
  "file.settings",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.pastePlainText",
  "edit.selectAll",
  "edit.find",
  "edit.replace",
  "edit.deleteLine",
  "edit.moveLineUp",
  "edit.moveLineDown",
  "format.bold",
  "format.italic",
  "format.strikethrough",
  "format.highlight",
  "format.code",
  "format.link",
  "format.clearFormatting",
  "format.heading1",
  "format.heading2",
  "format.heading3",
  "format.heading4",
  "format.heading5",
  "format.heading6",
  "format.clearHeading",
  "format.list",
  "format.orderedList",
  "format.taskList",
  "format.table",
  "format.callout",
  "format.codeBlock",
  "format.mathBlock",
  "format.horizontalRule",
  "format.jsonValidate",
  "format.jsonFormat",
  "view.zoomIn",
  "view.zoomOut",
  "view.resetZoom",
  "help.shortcuts",
  "help.markdownReference",
  "help.about",
]);

const contextActionIds = new Set([
  "cut",
  "copy",
  "paste",
  "delete",
  "select-all",
  "bold",
  "italic",
  "code",
  "strikethrough",
  "highlight",
  "link",
  "open-link",
  "copy-link",
  "edit-link",
  "open-image",
  "copy-image",
  "insert-table",
  "insert-callout",
  "insert-code-block",
  "insert-math-block",
  "insert-hr",
]);

function command(view: EditorView | null | undefined, run: Command): ActionResult {
  return view ? run(view) : false;
}

function replaceEditorText(view: EditorView | null | undefined, text: string): void {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
}

function selectedText(view: EditorView): { from: number; to: number; text: string } {
  const range = view.state.selection.main;
  return { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
}

function insertAtSelection(view: EditorView, text: string, selection?: { anchor: number; head?: number }): void {
  const range = view.state.selection.main;
  view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection });
}

function applyLines(view: EditorView, update: (text: string) => string): ActionResult {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = view.state.doc.line(number);
      const next = update(line.text);
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (changes.length) view.dispatch({ changes });
  return true;
}

function formatHeading(view: EditorView, level: number): ActionResult {
  return applyLines(view, (text) => {
    const indent = text.match(/^\s*/)?.[0] ?? "";
    const body = text.slice(indent.length).replace(/^#{1,6}(?:\s+|$)/, "").replace(/^\s+/, "");
    return level === 0 ? indent + body : `${indent}${"#".repeat(level)} ${body}`;
  });
}

function applyNumberedLines(view: EditorView, update: (text: string, index: number) => string): ActionResult {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  let lineIndex = 0;
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = view.state.doc.line(number);
      const next = update(line.text, lineIndex);
      lineIndex += 1;
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (changes.length) view.dispatch({ changes });
  return true;
}

function formatBulletList(view: EditorView): ActionResult {
  return applyNumberedLines(view, (text) => {
    const indent = text.match(/^\s*/)?.[0] ?? "";
    const listMatch = text.match(/^(\s*)(?:[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+)/u);
    const body = listMatch ? text.slice(listMatch[0].length) : text.slice(indent.length);
    return `${indent}- ${body}`;
  });
}

function formatOrderedList(view: EditorView): ActionResult {
  return applyNumberedLines(view, (text, index) => {
    const indent = text.match(/^\s*/)?.[0] ?? "";
    const listMatch = text.match(/^(\s*)(?:[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+)/u);
    const body = listMatch ? text.slice(listMatch[0].length) : text.slice(indent.length);
    return `${indent}${index + 1}. ${body}`;
  });
}

function formatTaskList(view: EditorView): ActionResult {
  return applyNumberedLines(view, (text) => {
    const indent = text.match(/^\s*/)?.[0] ?? "";
    const listMatch = text.match(/^(\s*)(?:[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+)/u);
    const body = listMatch ? text.slice(listMatch[0].length) : text.slice(indent.length);
    return `${indent}- [ ] ${body}`;
  });
}

function isInlineWordChar(ch: string): boolean {
  return /[^\s*_`~=\[\]()]/u.test(ch);
}

function stripInlineMarkup(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const prefixMatch = line.match(/^(\s*(?:#{1,6}\s+|[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+))/u);
      const prefix = prefixMatch ? prefixMatch[1] : "";
      let body = prefixMatch ? line.slice(prefix.length) : line;

      let prev: string;
      do {
        prev = body;
        body = body
          .replace(/`([^`\n]+)`/g, "$1")
          .replace(/==([^=\n]+)==/g, "$1")
          .replace(/~~([^~\n]+)~~/g, "$1")
          .replace(/\*\*([^\n]+?)\*\*/g, "$1")
          .replace(/\*([^\n]+?)\*/g, "$1");
      } while (body !== prev);

      return prefix + body;
    })
    .join("\n");
}

function clearFormattingInView(view: EditorView): ActionResult {
  const state = view.state;
  const inlinePairs = ["**", "~~", "==", "*", "`"];

  if (!state.selection.main.empty) {
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const range of state.selection.ranges) {
      if (range.empty) continue;
      let from = range.from;
      let to = range.to;

      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const p of inlinePairs) {
          if (
            from >= p.length &&
            to + p.length <= state.doc.length &&
            state.sliceDoc(from - p.length, from) === p &&
            state.sliceDoc(to, to + p.length) === p
          ) {
            from -= p.length;
            to += p.length;
            expanded = true;
            break;
          }
        }
      }

      const original = state.sliceDoc(from, to);
      const stripped = stripInlineMarkup(original);
      if (stripped !== original || from !== range.from || to !== range.to) {
        changes.push({ from, to, insert: stripped });
      }
    }

    if (changes.length > 0) {
      view.dispatch({ changes });
      return true;
    }
    return false;
  }

  const cursor = state.selection.main.from;
  const line = state.doc.lineAt(cursor);
  const col = cursor - line.from;

  let wordFrom = col;
  let wordTo = col;
  while (wordFrom > 0 && isInlineWordChar(line.text[wordFrom - 1] ?? "")) wordFrom -= 1;
  while (wordTo < line.text.length && isInlineWordChar(line.text[wordTo] ?? "")) wordTo += 1;

  if (wordFrom === wordTo) {
    if (wordFrom > 0 && isInlineWordChar(line.text[wordFrom - 1] ?? "")) {
      wordFrom -= 1;
      while (wordFrom > 0 && isInlineWordChar(line.text[wordFrom - 1] ?? "")) wordFrom -= 1;
    } else if (wordTo < line.text.length && isInlineWordChar(line.text[wordTo] ?? "")) {
      wordTo += 1;
      while (wordTo < line.text.length && isInlineWordChar(line.text[wordTo] ?? "")) wordTo += 1;
    } else {
      let left = col;
      while (left > 0 && /[*_`~=]/u.test(line.text[left - 1] ?? "")) left -= 1;
      let right = col;
      while (right < line.text.length && /[*_`~=]/u.test(line.text[right] ?? "")) right += 1;
      if (left > 0 && isInlineWordChar(line.text[left - 1] ?? "")) {
        wordTo = left;
        wordFrom = left - 1;
        while (wordFrom > 0 && isInlineWordChar(line.text[wordFrom - 1] ?? "")) wordFrom -= 1;
      } else if (right < line.text.length && isInlineWordChar(line.text[right] ?? "")) {
        wordFrom = right;
        wordTo = right + 1;
        while (wordTo < line.text.length && isInlineWordChar(line.text[wordTo] ?? "")) wordTo += 1;
      }
    }
  }

  if (wordFrom === wordTo) return false;

  let left = wordFrom;
  let right = wordTo;
  let stripped = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of inlinePairs) {
      if (
        left >= p.length &&
        right + p.length <= line.text.length &&
        line.text.slice(left - p.length, left) === p &&
        line.text.slice(right, right + p.length) === p
      ) {
        left -= p.length;
        right += p.length;
        changed = true;
        stripped = true;
        break;
      }
    }
  }

  if (!stripped) return false;

  const unwrapped = line.text.slice(wordFrom, wordTo);
  const from = line.from + left;
  const to = line.from + right;
  view.dispatch({
    changes: { from, to, insert: unwrapped },
    selection: { anchor: from, head: from + unwrapped.length },
  });
  return true;
}

function formatLink(view: EditorView): ActionResult {
  const { from, to, text } = selectedText(view);
  if (from === to) {
    insertAtSelection(view, "[](url)", { anchor: from + 1 });
  } else {
    insertAtSelection(view, `[${text}](url)`, { anchor: from + text.length + 3, head: from + text.length + 6 });
  }
  return true;
}

function insertAtRange(view: EditorView, from: number, to: number, text: string): void {
  view.dispatch({ changes: { from, to, insert: text } });
}

function invokeUi(
  callback: (() => void | Promise<void>) | undefined,
  notify: (message: string) => void = () => undefined,
): ActionResult {
  if (!callback) return false;
  try {
    void Promise.resolve(callback()).catch((error: unknown) => notify(error instanceof Error ? error.message : String(error)));
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Creates the single action registry shared by menus, keymap adapters,
 * context menus, and save controls. It contains no browser globals.
 */
export function createActions(dependencies: ActionsDependencies = {}): AppActions {
  const state = dependencies.state ?? documentState;
  const getView = (): EditorView | null => dependencies.getEditorView?.() ?? null;
  const notify = dependencies.notify ?? (() => undefined);
  const getFormats = dependencies.getFormats ?? (() => []);
  const getSettings = dependencies.getSettings ?? (() => settingsState.settings);
  const dialogs = dependencies.dialogs ?? {};
  let lossyWarningAcknowledged = false;

  const unavailable = (message: string): false => {
    notify(message);
    return false;
  };

  const resolveFormatId = (formatId?: string): string => {
    if (formatId && formatId.trim().length > 0) return formatId;
    const configured = getSettings()?.files?.newDocumentFormat;
    if (configured && typeof configured === "string" && configured.trim().length > 0) {
      const formats = getFormats();
      const known = formats.find((f) => f.id === configured);
      if (known) {
        return known.creatable ? known.id : markdownFormat.id;
      }
      if (formats.length === 0) {
        return configured;
      }
    }
    return markdownFormat.id;
  };

  const canEdit = (): boolean => !state.readonly && state.format.editable;
  const canSaveAs = (): boolean => !state.readonly || state.path !== null;
  const hasTextOrPath = (): boolean => state.path !== null || state.text.length > 0;

  const shouldWarnLossySave = (format: FormatCapabilities): boolean =>
    format.lossy && !lossyWarningAcknowledged;

  const promptLossySave = async (): Promise<boolean> => {
    if (!dependencies.confirmLossySave) return true;
    const decision = await dependencies.confirmLossySave();
    if (decision === "save-lossy") {
      lossyWarningAcknowledged = true;
      return true;
    }
    if (decision === "save-markdown") {
      lossyWarningAcknowledged = true;
      return dependencies.saveAsMarkdown ? await dependencies.saveAsMarkdown() : false;
    }
    return false;
  };

  const prepareLossySave = async (): Promise<ActionResult> => {
    if (!shouldWarnLossySave(state.format)) return true;
    return await promptLossySave();
  };

  const resetLossyWarning = (): void => {
    lossyWarningAcknowledged = false;
  };

  const newDocument = async (formatId?: string, view?: EditorView | null): Promise<ActionResult> => {
    const targetFormatId = resolveFormatId(formatId);
    if (dependencies.openNewDocumentWindow) {
      try {
        await dependencies.openNewDocumentWindow(targetFormatId);
        return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    try {
      let created: NewDocument;
      try {
        created = await invoke<NewDocument>("new_document", { formatId: targetFormatId });
      } catch (error) {
        if (targetFormatId !== markdownFormat.id) {
          created = await invoke<NewDocument>("new_document", { formatId: markdownFormat.id });
        } else {
          throw error;
        }
      }
      resetDocument(created.format, created.text);
      resetLossyWarning();
      replaceEditorText(view ?? getView(), created.text);
      dependencies.onDocumentReplaced?.();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const newDocumentWithPicker = async (view?: EditorView | null): Promise<ActionResult> => {
    if (!dialogs.chooseFormat) return unavailable("Format picker is unavailable");
    try {
      const selected = await dialogs.chooseFormat(getFormats());
      return selected ? newDocument(selected, view) : false;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const pickFile = async (): Promise<string | null> => {
    try {
      return await invoke<string | null>("pick_file");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const openFile = async (path?: string, view?: EditorView | null): Promise<ActionResult> => {
    try {
      const picked = path ?? (await pickFile());
      if (!picked) return false;
      const opened = await invoke<OpenedFile>("open_file", { path: picked });
      replaceDocument(opened);
      resetLossyWarning();
      replaceEditorText(view ?? getView(), opened.text);
      dependencies.onDocumentReplaced?.();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const saveAs = async (_view?: EditorView | null): Promise<ActionResult> => {
    if (!canSaveAs() || !hasTextOrPath()) return unavailable("There is nothing to save");
    if (shouldWarnLossySave(state.format) && !(await prepareLossySave())) return false;
    const suggestedName = state.path?.split(/[\\/]/u).pop() ?? `Untitled.${state.format.defaultExtension}`;
    const beforeText = state.text;
    try {
      const result = await saveAsFile(state, suggestedName);
      if (!result) return false;
      markSaved(result, beforeText);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const save = async (view?: EditorView | null): Promise<ActionResult> => {
    if (!canEdit() || !hasTextOrPath()) return unavailable("This document cannot be saved");
    if (shouldWarnLossySave(state.format) && !(await prepareLossySave())) return false;
    if (state.path === null) return saveAs(view);
    const beforeText = state.text;
    try {
      const result = dependencies.autosave
        ? await dependencies.autosave.flush(true)
        : await invoke<SaveResult>("save_file", {
            path: state.path,
            text: beforeText,
            encoding: state.encoding,
            bom: state.bom,
            lineEnding: state.lineEnding,
          });
      if (!result) return false;
      markSaved(result, beforeText);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const newWindow = async (path = state.path ?? undefined): Promise<ActionResult> => {
    if (!path) return unavailable("An unsaved document has no path for a new window");
    try {
      await invoke("open_in_new_window", { path });
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const revealInExplorer = async (): Promise<ActionResult> => {
    if (!state.path) return unavailable("The unsaved document has no file to reveal");
    try {
      await invoke("reveal_in_explorer", { path: state.path });
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const copy = async (view = getView()): Promise<ActionResult> => {
    if (!view || !dependencies.clipboard) return false;
    const { from, to, text } = selectedText(view);
    if (from === to) return false;
    try {
      await dependencies.clipboard.writeText(text);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const cut = async (view = getView()): Promise<ActionResult> => {
    if (!canEdit() || !view || !dependencies.clipboard) return false;
    const { from, to, text } = selectedText(view);
    if (from === to) return false;
    try {
      await dependencies.clipboard.writeText(text);
      view.dispatch({ changes: { from, to, insert: "" } });
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const paste = async (view = getView()): Promise<ActionResult> => {
    if (!canEdit() || !view || !dependencies.clipboard) return false;
    try {
      insertAtSelection(view, await dependencies.clipboard.readText());
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const pastePlainText = paste;
  const editCommand = (run: Command) => (view = getView()): ActionResult => (canEdit() ? command(view, run) : false);

  const bold = editCommand((view) => toggleWrapper(view, "**", "**"));
  const italic = editCommand((view) => toggleWrapper(view, "*", "*"));
  const code = editCommand((view) => toggleWrapper(view, "`", "`"));
  const strikethrough = editCommand((view) => toggleWrapper(view, "~~", "~~"));
  const highlight = editCommand((view) => toggleWrapper(view, "==", "=="));
  const link = editCommand(formatLink);
  const heading = (level: number, view = getView()): ActionResult => (canEdit() && view ? formatHeading(view, level) : false);
  const list = editCommand(formatBulletList);
  const orderedList = editCommand(formatOrderedList);
  const taskList = editCommand(formatTaskList);
  const clearFormatting = editCommand(clearFormattingInView);
  const table = editCommand((view) => {
    insertAtSelection(view, "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n", { anchor: view.state.selection.main.from + 2 });
    return true;
  });
  const callout = editCommand((view) => {
    insertAtSelection(view, "> [!NOTE] Note\n> \n", { anchor: view.state.selection.main.from + 17 });
    return true;
  });
  const codeBlock = editCommand(toggleCodeBlock);
  const mathBlock = editCommand((view) => {
    insertAtSelection(view, "$$\n\n$$\n", { anchor: view.state.selection.main.from + 3 });
    return true;
  });
  const horizontalRule = editCommand((view) => {
    insertAtSelection(view, "\n---\n");
    return true;
  });

  const validateJson = async (): Promise<ActionResult> => {
    if (state.format.id !== "json") return false;
    try {
      const error = await invoke<{ line: number; column: number; message: string } | null>("validate_json", {
        text: state.text,
      });
      notify(
        error
          ? `JSON syntax error at line ${error.line}, column ${error.column}: ${error.message}`
          : "JSON is valid",
      );
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const formatJson = async (view = getView()): Promise<ActionResult> => {
    if (state.format.id !== "json" || !canEdit()) return false;
    try {
      const formatted = await invoke<string>("format_json", { text: state.text });
      setDocumentText(formatted);
      replaceEditorText(view, formatted);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const openSearch = (view = getView()): ActionResult => command(view, searchCommands.openSearch);
  const openReplace = (view = getView()): ActionResult => command(view, searchCommands.openReplace);
  const openLink = async (url: string): Promise<ActionResult> => {
    if (!url || !dialogs.openLink) return false;
    // Ссылка приходит из документа, а документ пользователь получил извне.
    // Схемы проверяются белым списком в одном месте на весь проект: data:,
    // file: и vbscript: открывать нельзя, а перечислить всё опасное чёрным
    // списком невозможно.
    const href = safeLinkHref(url);
    if (href === null) {
      notify(`Ссылка не открыта: небезопасный адрес ${url}`);
      return false;
    }
    try {
      await dialogs.openLink(href);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const copyLink = async (url: string): Promise<ActionResult> => {
    if (!url || !dependencies.clipboard) return false;
    try {
      await dependencies.clipboard.writeText(url);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const editLink = (url: string, view = getView()): ActionResult => {
    if (!canEdit() || !view) return false;
    const { from, to, text } = selectedText(view);
    const label = text || "link";
    insertAtRange(view, from, to, `[${label}](${url || "url"})`);
    return true;
  };
  const openImage = async (src: string): Promise<ActionResult> => {
    if (!src || !dialogs.openImage) return false;
    await dialogs.openImage(src);
    return true;
  };
  const copyImage = copyLink;

  const actionsById = new Map<string, () => Promise<ActionResult> | ActionResult>([
    ["file.new", () => newDocument()],
    ["file.newWindow", () => newDocument()],
    ["file.open", () => openFile()],
    ["file.save", () => save()],
    ["file.saveAs", () => saveAs()],
    ["file.close", () => invokeUi(dependencies.closeWindow)],
    ["file.settings", () => invokeUi(dependencies.openSettings, notify)],
    ["edit.undo", () => command(getView(), undo)],
    ["edit.redo", () => command(getView(), redo)],
    ["edit.cut", () => cut()],
    ["edit.copy", () => copy()],
    ["edit.paste", () => paste()],
    ["edit.pastePlainText", () => pastePlainText()],
    ["edit.selectAll", () => command(getView(), selectAll)],
    ["edit.find", () => openSearch()],
    ["edit.replace", () => openReplace()],
    ["edit.deleteLine", () => command(getView(), deleteLine)],
    ["edit.moveLineUp", () => command(getView(), moveLineUp)],
    ["edit.moveLineDown", () => command(getView(), moveLineDown)],
    ["format.bold", () => bold()],
    ["format.italic", () => italic()],
    ["format.strikethrough", () => strikethrough()],
    ["format.highlight", () => highlight()],
    ["format.code", () => code()],
    ["format.link", () => link()],
    ["format.clearFormatting", () => clearFormatting()],
    ["format.clearHeading", () => heading(0)],
    ["format.list", () => list()],
    ["format.orderedList", () => orderedList()],
    ["format.taskList", () => taskList()],
    ["format.table", () => table()],
    ["format.callout", () => callout()],
    ["format.codeBlock", () => codeBlock()],
    ["format.mathBlock", () => mathBlock()],
    ["format.horizontalRule", () => horizontalRule()],
    ["format.jsonValidate", () => validateJson()],
    ["format.jsonFormat", () => formatJson()],
    ["view.zoomIn", () => invokeUi(dependencies.zoomIn, notify)],
    ["view.zoomOut", () => invokeUi(dependencies.zoomOut, notify)],
    ["view.resetZoom", () => invokeUi(dependencies.resetZoom, notify)],
    ["help.shortcuts", () => invokeUi(() => dialogs.showHelp?.("shortcuts"), notify)],
    ["help.markdownReference", () => invokeUi(() => dialogs.showHelp?.("markdownReference"), notify)],
    ["help.about", () => invokeUi(() => dialogs.showHelp?.("about"), notify)],
  ]);

  const handlers: MarknoteKeymapHandlers = {
    newDocument: (view) => {
      void newDocument(undefined, view);
      return true;
    },
    newDocumentWithPicker: (view) => {
      void newDocumentWithPicker(view);
      return true;
    },
    openFile: (view) => {
      void openFile(undefined, view);
      return true;
    },
    save: (view) => {
      void save(view);
      return true;
    },
    saveAs: (view) => {
      void saveAs(view);
      return true;
    },
    closeWindow: () => invokeUi(dependencies.closeWindow, notify),
    openSearch: (view) => openSearch(view),
    openReplace: (view) => openReplace(view),
    goToLine: () => invokeUi(dependencies.goToLine, notify),
    zoomIn: () => invokeUi(dependencies.zoomIn, notify),
    zoomOut: () => invokeUi(dependencies.zoomOut, notify),
    resetZoom: () => invokeUi(dependencies.resetZoom, notify),
  };

  const hasAction = (id: string): boolean =>
    menuActionIds.has(id) || contextActionIds.has(id) || id.startsWith("file.new.") || id.startsWith("format.heading");

  const isAvailable = (id: string, payload?: string): boolean => {
    if (id.startsWith("file.new.")) {
      const formatId = id.slice("file.new.".length);
      return getFormats().some((format) => format.id === formatId && format.creatable && format.editable);
    }
    if (id === "file.new" || id === "file.open") return true;
    if (id === "file.newWindow") return true;
    if (id === "file.save") return canEdit() && hasTextOrPath();
    if (id === "file.saveAs") return canSaveAs() && hasTextOrPath();
    if (id === "reveal-in-explorer" || id === "file.revealInExplorer") return state.path !== null;
    if (id === "open-link" || id === "copy-link" || id === "edit-link") return Boolean(payload);
    if (id === "open-image" || id === "copy-image") return Boolean(payload);
    if (id === "file.close") return Boolean(dependencies.closeWindow);
    if (id === "file.settings") return Boolean(dependencies.openSettings);
    if (id === "format.jsonValidate") return state.format.id === "json";
    if (id === "format.jsonFormat") return state.format.id === "json" && canEdit();
    if (id === "help.shortcuts" || id === "help.markdownReference" || id === "help.about") return Boolean(dialogs.showHelp);
    if (id === "view.zoomIn") return Boolean(dependencies.zoomIn);
    if (id === "view.zoomOut") return Boolean(dependencies.zoomOut);
    if (id === "view.resetZoom") return Boolean(dependencies.resetZoom);
    if (["edit.copy", "copy"].includes(id)) return Boolean(getView() && getView()?.state.selection.main.empty === false);
    if (["edit.paste", "edit.pastePlainText", "paste"].includes(id)) return canEdit() && Boolean(dependencies.clipboard);
    if (id === "edit.cut" || id === "cut" || id === "delete") return canEdit() && Boolean(getView() && !getView()?.state.selection.main.empty);
    if (id.startsWith("edit.") || id.startsWith("format.") || ["bold", "italic", "code", "strikethrough", "highlight", "link", "insert-table", "insert-callout", "insert-code-block", "insert-math-block", "insert-hr"].includes(id)) return canEdit();
    return hasAction(id);
  };

  const run = async (id: string, payload?: string): Promise<ActionResult> => {
    if (id.startsWith("file.new.")) return newDocument(id.slice("file.new.".length));
    if (id === "file.open") return openFile(payload);
    if (id === "file.newWindow") return newDocument();
    if (id === "reveal-in-explorer" || id === "file.revealInExplorer") return revealInExplorer();
    if (id === "open-link") return openLink(payload ?? "");
    if (id === "copy-link") return copyLink(payload ?? "");
    if (id === "edit-link") return editLink(payload ?? "");
    if (id === "open-image") return openImage(payload ?? "");
    if (id === "copy-image") return copyImage(payload ?? "");
    if (id === "delete") return canEdit() ? command(getView(), deleteLine) : false;
    if (id === "select-all") return command(getView(), selectAll);
    if (id === "bold") return bold();
    if (id === "italic") return italic();
    if (id === "code") return code();
    if (id === "strikethrough") return strikethrough();
    if (id === "highlight") return highlight();
    if (id === "link") return link();
    if (id === "insert-table") return table();
    if (id === "insert-callout") return callout();
    if (id === "insert-code-block") return codeBlock();
    if (id === "insert-math-block") return mathBlock();
    if (id === "insert-hr") return horizontalRule();
    if (id === "format.jsonValidate") return validateJson();
    if (id === "format.jsonFormat") return formatJson();
    if (id.startsWith("format.heading")) {
      const level = Number(id.slice("format.heading".length));
      return heading(level);
    }
    const action = actionsById.get(id);
    if (!action) return false;
    return await action();
  };

  return {
    handlers,
    run,
    isAvailable,
    hasAction,
    newDocument,
    newDocumentWithPicker,
    pickFile,
    openFile,
    save,
    saveAs,
    newWindow,
    openInNewWindow: newWindow,
    revealInExplorer,
    undo: (view = getView()) => command(view, undo),
    redo: (view = getView()) => command(view, redo),
    cut,
    copy,
    paste,
    pastePlainText,
    selectAll: (view = getView()) => command(view, selectAll),
    deleteLine: editCommand(deleteLine),
    moveLineUp: editCommand(moveLineUp),
    moveLineDown: editCommand(moveLineDown),
    bold,
    italic,
    code,
    link,
    strikethrough,
    highlight,
    heading,
    list,
    orderedList,
    taskList,
    clearFormatting,
    table,
    callout,
    codeBlock,
    mathBlock,
    horizontalRule,
    openSearch,
    openReplace,
    openLink,
    copyLink,
    editLink,
    openImage,
    copyImage,
    resetLossyWarning,
  };
}
