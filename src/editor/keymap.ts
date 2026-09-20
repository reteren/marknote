import {
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  moveLineDown,
  moveLineUp,
  redo,
  undo,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { ChangeSet, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { keymap, EditorView, type Command, type KeyBinding } from "@codemirror/view";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { editorMarkdownCommandsStateField } from "./settings";
import { profileMeasure } from "./profile";

type Pair = { open: string; close: string };

const autoPairs: Record<string, Pair> = {
  "*": { open: "*", close: "*" },
  "`": { open: "`", close: "`" },
  "=": { open: "==", close: "==" },
  "~": { open: "~~", close: "~~" },
  "[": { open: "[", close: "]" },
  "(": { open: "(", close: ")" },
};

/** Commands that need the application shell (IPC, dialogs, or global UI). */
export interface MarknoteKeymapHandlers {
  newDocument?: Command;
  newDocumentWithPicker?: Command;
  openFile?: Command;
  save?: Command;
  saveAs?: Command;
  closeWindow?: Command;
  openSearch?: Command;
  openReplace?: Command;
  goToLine?: Command;
  zoomIn?: Command;
  zoomOut?: Command;
  resetZoom?: Command;
}

export interface MarknoteKeymapOptions {
  /** Optional command handlers supplied by App.svelte or the application shell. */
  handlers?: MarknoteKeymapHandlers;
  /** Lets the table extension own Tab/Shift-Tab while the cursor is in a table. */
  isInTable?: (state: EditorState, position: number) => boolean;
  /** Whether Markdown-only commands should handle a key in this editor state. */
  isMarkdownCommands?: (state: EditorState) => boolean;
}

function currentLine(state: EditorState, position: number): string {
  return state.doc.lineAt(position).text;
}

const orderedListLine = /^(?<indent>[ \t]*)(?<number>\d+)(?<delimiter>[.)])(?<spacing>[ \t]+)(?<content>.*)$/u;
const bulletListLine = /^(?<indent>[ \t]*)(?<marker>[-+*])(?<spacing>[ \t]+)(?<content>.*)$/u;
const headingLine = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/u;
const fenceLine = /^[ \t]{0,3}(?<marker>`{3,}|~{3,})/u;

type ListContext = {
  indent: number;
  type: "ordered" | "bullet";
  nextNumber: number;
};

type MarkerChange = { from: number; to: number; insert: string };

function indentationWidth(indent: string): number {
  let width = 0;
  for (const character of indent) {
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
  }
  return width;
}

function indentationPrefixLength(text: string, maximumWidth = 4): number {
  const indent = text.match(/^[ \t]*/u)?.[0] ?? "";
  let width = 0;
  for (let index = 0; index < indent.length; index += 1) {
    const character = indent[index];
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
    if (width >= maximumWidth) return index + 1;
  }
  return indent.length;
}

function isFenceClose(text: string, fence: string): boolean {
  const marker = fence[0];
  const minimum = fence.length;
  return new RegExp(`^[ \\t]{0,3}${marker}{${minimum},}[ \\t]*$`, "u").test(text);
}

function isHorizontalRule(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/u.test(trimmed);
}

/**
 * Finds the marker edits needed to make each contiguous ordered list count
 * from one. The returned positions refer to `text`, so callers can compose
 * these edits with the user's transaction without disturbing the selection.
 */
function orderedListMarkerChanges(text: string): MarkerChange[] {
  const changes: MarkerChange[] = [];
  const contexts: ListContext[] = [];
  let fence: string | null = null;
  let offset = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineOffset = offset;
    offset += rawLine.length + 1;

    if (fence) {
      if (isFenceClose(line, fence)) fence = null;
      continue;
    }
    const possibleFence = fenceLine.exec(line)?.groups?.marker;
    if (possibleFence) {
      fence = possibleFence;
      contexts.length = 0;
      continue;
    }
    if (/^[ \t]*$/u.test(line) || headingLine.test(line) || isHorizontalRule(line)) {
      contexts.length = 0;
      continue;
    }

    const ordered = orderedListLine.exec(line);
    if (ordered?.groups && ordered.groups.spacing) {
      const indent = indentationWidth(ordered.groups.indent ?? "");
      while (contexts.length && contexts[contexts.length - 1].indent > indent) contexts.pop();

      let context = contexts.find((candidate) => candidate.indent === indent);
      if (!context || context.type !== "ordered") {
        const index = contexts.findIndex((candidate) => candidate.indent === indent);
        if (index >= 0) contexts.splice(index, contexts.length - index);
        context = { indent, type: "ordered", nextNumber: 1 };
        contexts.push(context);
      }

      const expected = context.nextNumber;
      context.nextNumber += 1;
      const number = ordered.groups.number ?? "";
      if (number !== String(expected)) {
        const numberFrom = lineOffset + (ordered.groups.indent?.length ?? 0);
        changes.push({ from: numberFrom, to: numberFrom + number.length, insert: String(expected) });
      }
      continue;
    }

    const bullet = bulletListLine.exec(line);
    if (bullet?.groups) {
      const indent = indentationWidth(bullet.groups.indent ?? "");
      while (contexts.length && contexts[contexts.length - 1].indent > indent) contexts.pop();
      const index = contexts.findIndex((candidate) => candidate.indent === indent);
      if (index >= 0) contexts.splice(index, contexts.length - index);
      contexts.push({ indent, type: "bullet", nextNumber: 1 });
      continue;
    }

    // A non-empty, non-heading line is a lazy continuation of the current
    // list item in Markdown. Keep the open contexts so the next marker still
    // continues its sequence. Blank lines and headings above explicitly close it.
  }

  return changes;
}

/** Renumber all ordered-list markers in a Markdown document. */
export function normalizeOrderedLists(text: string): string {
  const changes = orderedListMarkerChanges(text);
  if (!changes.length) return text;
  let result = text;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

function normalizeViewOrderedLists(view: EditorView): void {
  const text = view.state.doc.toString();
  if (normalizeOrderedLists(text) === text) return;
  const changes = orderedListMarkerChanges(text);
  if (changes.length) {
    const norm = ChangeSet.of(changes, text.length);
    view.dispatch({
      changes,
      selection: view.state.selection.map(norm),
      userEvent: "input",
    });
  }
}

const listPrefixRegex = /^[ \t]*(?:\d+[.)]|[-+*])[ \t]+/u;

function getListPrefix(lineText: string): string | null {
  const match = listPrefixRegex.exec(lineText);
  return match ? match[0] : null;
}

function isListBlockBoundary(text: string): boolean {
  return /^[ \t]*$/u.test(text) || headingLine.test(text) || isHorizontalRule(text) || fenceLine.test(text);
}

function getMarkerChangesForTransaction(transaction: Transaction): MarkerChange[] {
  let couldAffect = false;
  let minFromB = transaction.newDoc.length;
  let maxToB = 0;

  transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (fromB < minFromB) minFromB = fromB;
    if (toB > maxToB) maxToB = toB;
    if (couldAffect) return;

    if (inserted.lines > 1 || transaction.startState.doc.lineAt(fromA).number !== transaction.startState.doc.lineAt(toA).number) {
      couldAffect = true;
      return;
    }
    const startLineText = transaction.startState.doc.lineAt(fromA).text;
    const newLineText = transaction.newDoc.lineAt(fromB).text;
    if (getListPrefix(startLineText) !== getListPrefix(newLineText)) {
      couldAffect = true;
      return;
    }
    const wasBlank = /^[ \t]*$/u.test(startLineText);
    const isBlank = /^[ \t]*$/u.test(newLineText);
    if (wasBlank !== isBlank) {
      couldAffect = true;
      return;
    }
    const wasBoundary = headingLine.test(startLineText) || isHorizontalRule(startLineText) || fenceLine.test(startLineText);
    const isBoundaryLine = headingLine.test(newLineText) || isHorizontalRule(newLineText) || fenceLine.test(newLineText);
    if (wasBoundary !== isBoundaryLine) {
      couldAffect = true;
      return;
    }
  });

  if (!couldAffect) return [];

  if (minFromB > maxToB) {
    minFromB = 0;
    maxToB = transaction.newDoc.length;
  }

  let startLine = transaction.newDoc.lineAt(Math.min(minFromB, transaction.newDoc.length)).number;
  let endLine = transaction.newDoc.lineAt(Math.min(maxToB, transaction.newDoc.length)).number;

  while (startLine > 1) {
    const text = transaction.newDoc.line(startLine - 1).text;
    if (isListBlockBoundary(text)) break;
    startLine -= 1;
  }

  while (endLine < transaction.newDoc.lines) {
    const text = transaction.newDoc.line(endLine + 1).text;
    if (isListBlockBoundary(text)) break;
    endLine += 1;
  }

  const fromPos = transaction.newDoc.line(startLine).from;
  const toPos = transaction.newDoc.line(endLine).to;
  const blockText = transaction.newDoc.sliceString(fromPos, toPos);
  const blockChanges = orderedListMarkerChanges(blockText);
  if (!blockChanges.length) return [];

  return blockChanges.map((change) => ({
    from: change.from + fromPos,
    to: change.to + fromPos,
    insert: change.insert,
  }));
}

/**
 * Keeps the persisted Markdown in sync with the displayed numbering after
 * arbitrary edits, paste, line moves, and deletes. The filter composes the
 * marker-only edits with the user's transaction, preserving cursor mapping.
 */
export const orderedListNormalization: Extension = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction;
  const changes = profileMeasure("lists.filter", () => getMarkerChangesForTransaction(transaction));
  if (!changes.length) return transaction;
  // Return the original transaction unchanged and add renumbering as a separate
  // follow-up change. CodeMirror then carries over the cursor, effects, and all
  // annotations — including undo-history annotations — without manual copying.
  // The old version built a new transaction field by field and lost anything it
  // forgot to list; it also accessed the private annotations field through a
  // type cast, which could silently break on a library update.
  return [transaction, { changes, sequential: true }];
});

function isListLine(text: string): boolean {
  return orderedListLine.test(text) || bulletListLine.test(text);
}

function isTableRow(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("``")) return false;
  return trimmed.split("|").length >= 3;
}

function isTableDelimiter(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

/**
 * Conservative Markdown table detection used as a fallback when tableKeymap is
 * installed after this keymap. It requires a delimiter row in the contiguous
 * table region, so prose containing a single pipe keeps normal Tab behaviour.
 */
export function isTableContext(state: EditorState, position: number): boolean {
  const lineNumber = state.doc.lineAt(position).number;
  const lineCount = state.doc.lines;
  const isTableRegionLine = (number: number): boolean => {
    const text = state.doc.line(number).text;
    return isTableRow(text) || isTableDelimiter(text);
  };

  if (!isTableRegionLine(lineNumber)) return false;

  for (let number = lineNumber; number >= 1 && isTableRegionLine(number); number -= 1) {
    if (isTableDelimiter(state.doc.line(number).text)) return true;
  }
  for (let number = lineNumber + 1; number <= lineCount && isTableRegionLine(number); number += 1) {
    if (isTableDelimiter(state.doc.line(number).text)) return true;
  }
  return false;
}

function changeSelectedLines(view: EditorView, remove: boolean): boolean {
  const { state } = view;
  const ranges = state.selection.ranges;
  const changes: { from: number; to: number; insert?: string }[] = [];
  const seen = new Set<number>();

  for (const range of ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      if (remove) {
        const amount = indentationPrefixLength(line.text);
        if (amount > 0) changes.push({ from: line.from, to: line.from + amount });
      } else if (isListLine(line.text)) {
        changes.push({ from: line.from, to: line.from, insert: "    " });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes, userEvent: remove ? "delete.dedent" : "input.indent", scrollIntoView: true });
    return true;
  }
  return false;
}

function indent(view: EditorView, isInTable: (state: EditorState, position: number) => boolean = isTableContext): boolean {
  const range = view.state.selection.main;
  if (isInTable(view.state, range.head)) return false;
  if (!range.empty) {
    const changed = changeSelectedLines(view, false);
    if (changed) normalizeViewOrderedLists(view);
    return changed;
  }

  const line = view.state.doc.lineAt(range.head);
  if (isListLine(line.text)) {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: "    " },
      selection: { anchor: range.anchor + 4, head: range.head + 4 },
      userEvent: "input.indent",
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from: range.head, to: range.head, insert: "    " },
      selection: { anchor: range.head + 4 },
      userEvent: "input.indent",
      scrollIntoView: true,
    });
  }
  normalizeViewOrderedLists(view);
  return true;
}

function outdent(view: EditorView, isInTable: (state: EditorState, position: number) => boolean = isTableContext): boolean {
  const range = view.state.selection.main;
  if (isInTable(view.state, range.head)) return false;
  if (!range.empty) {
    const changed = changeSelectedLines(view, true);
    if (changed) normalizeViewOrderedLists(view);
    return changed;
  }

  const line = view.state.doc.lineAt(range.head);
  const amount = indentationPrefixLength(line.text);
  if (amount === 0) return true;
  const newAnchor = Math.max(line.from, range.anchor - amount);
  const newHead = Math.max(line.from, range.head - amount);
  view.dispatch({
    changes: { from: line.from, to: line.from + amount },
    selection: { anchor: newAnchor, head: newHead },
    userEvent: "delete.dedent",
    scrollIntoView: true,
  });
  normalizeViewOrderedLists(view);
  return true;
}

function continueMarkdownList(view: EditorView): boolean {
  const range = view.state.selection.main;
  const line = view.state.doc.lineAt(range.head);
  const isUnspacedList = /^[ \t]*(?:\d+[.)]|[-+*])(?![ \t])/u.test(line.text);
  const handled = (!isUnspacedList && insertNewlineContinueMarkup(view)) || insertNewlineAndIndent(view);
  if (handled) normalizeViewOrderedLists(view);
  return handled;
}

/** Shift+Enter inserts a line break and preserves current line indentation without list markup. */
function softBreak(view: EditorView): boolean {
  const tr = view.state.changeByRange((range) => {
    const line = view.state.doc.lineAt(range.from);
    const indent = line.text.slice(0, range.from - line.from).match(/^[ \t]*/u)?.[0] ?? "";
    const insert = "\n" + indent;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  view.dispatch(tr, { userEvent: "input", scrollIntoView: true });
  return true;
}

function pairInputHandler(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  _insert: (from: number, to: number, text: string) => void,
): boolean {
  const openingPair = autoPairs[text];
  const pair = openingPair ?? Object.values(autoPairs).find((candidate) => candidate.close === text);
  if (!pair || text.length !== 1) return false;

  const state = view.state;
  const selected = state.sliceDoc(from, to);
  if (from !== to) {
    if (!openingPair) return false;
    view.dispatch({
      changes: { from, to, insert: `${pair.open}${selected}${pair.close}` },
      selection: { anchor: from + pair.open.length + selected.length },
    });
    return true;
  }

  const next = state.sliceDoc(from, from + pair.close.length);
  const previous = state.sliceDoc(Math.max(0, from - pair.open.length), from);

  // For an asterisk, the second press expands the pair just created to **...**.
  const canExpandAsterisk =
    text === "*" && previous === "*" && next === "*" && state.sliceDoc(Math.max(0, from - 2), Math.max(0, from - 1)) !== "*";
  if (canExpandAsterisk) {
    view.dispatch({
      changes: [
        { from, to: from, insert: "*" },
        { from: from + 1, to: from + 1, insert: "*" },
      ],
      selection: { anchor: from + 1 },
    });
    return true;
  }

  // Double markers (==, ~~) are never inserted while typing: “=” and “~” are
  // common in ordinary text, and someone typing “==” expects exactly two marks,
  // not four with the cursor in the middle. Selected text is still wrapped by
  // these marks (the branch above).
  if (pair.open.length === 2) return false;

  if (next === pair.close && text === pair.close[0]) {
    view.dispatch({ selection: { anchor: from + pair.close.length } });
    return true;
  }

  if (!openingPair) return false;

  view.dispatch({
    changes: { from, to, insert: pair.open + pair.close },
    selection: { anchor: from + pair.open.length },
  });
  return true;
}

function isWordCharacter(character: string): boolean {
  return /[^\s*_`~\[\]()]/u.test(character);
}

function wordOrSelection(state: EditorState): { from: number; to: number } {
  const range = state.selection.main;
  let from = range.from;
  let to = range.to;
  if (!range.empty) return { from, to };

  const text = state.doc.toString();
  while (from > 0 && isWordCharacter(text[from - 1] ?? "")) from -= 1;
  while (to < text.length && isWordCharacter(text[to] ?? "")) to += 1;
  return { from, to };
}

function wrappedContentBeforeCursor(state: EditorState, open: string, close: string): { from: number; to: number } | null {
  const cursor = state.selection.main.from;
  if (cursor < open.length + close.length || state.sliceDoc(cursor - close.length, cursor) !== close) return null;

  const contentTo = cursor - close.length;
  const openFrom = state.sliceDoc(0, contentTo).lastIndexOf(open);
  if (openFrom < 0) return null;
  const contentFrom = openFrom + open.length;
  const content = state.sliceDoc(contentFrom, contentTo);
  if (!content || content.includes("\n")) return null;
  return { from: contentFrom, to: contentTo };
}

/** Remove wrappers around either the selected content or a selection containing the markers. */
function unwrapWrapper(
  view: EditorView,
  open: string,
  close: string,
  from: number,
  to: number,
  collapseSelection: boolean,
): boolean {
  const state = view.state;
  const selected = state.sliceDoc(from, to);
  let wrapperFrom = -1;
  let wrapperTo = -1;
  let selectionFrom = from;
  let selectionTo = to;

  // Selection may include both markers, e.g. selecting **word**.
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    wrapperFrom = from;
    wrapperTo = to;
    selectionFrom = from;
    selectionTo = to - open.length - close.length;
  } else if (state.sliceDoc(from - open.length, from) === open && state.sliceDoc(to, to + close.length) === close) {
    // Or the usual selection of just the wrapped text.
    wrapperFrom = from - open.length;
    wrapperTo = to + close.length;
    selectionFrom = from - open.length;
    selectionTo = to - open.length;
  } else {
    // Also support a selection containing one marker and ending immediately next to the other.
    const includesLeft = selected.startsWith(open);
    const includesRight = selected.endsWith(close);
    const rightOutside = state.sliceDoc(to, to + close.length) === close;
    const leftOutside = state.sliceDoc(from - open.length, from) === open;
    if (includesLeft && rightOutside) {
      wrapperFrom = from;
      wrapperTo = to + close.length;
      selectionFrom = from;
      selectionTo = to - open.length;
    } else if (leftOutside && includesRight) {
      wrapperFrom = from - open.length;
      wrapperTo = to;
      selectionFrom = from - open.length;
      selectionTo = to - open.length - close.length;
    }
  }

  if (wrapperFrom < 0 || wrapperTo < 0) return false;
  const contentEnd = wrapperTo - open.length - close.length;
  view.dispatch({
    changes: [
      { from: wrapperFrom, to: wrapperFrom + open.length },
      { from: wrapperTo - close.length, to: wrapperTo },
    ],
    selection: collapseSelection
      ? { anchor: contentEnd }
      : { anchor: selectionFrom, head: selectionTo },
  });
  return true;
}

function toggleWrapper(view: EditorView, open: string, close: string): boolean {
  const state = view.state;
  const hadSelection = !state.selection.main.empty;
  const wrappedAtCursor = hadSelection ? null : wrappedContentBeforeCursor(state, open, close);
  const range = wrappedAtCursor ?? wordOrSelection(state);
  const { from, to } = range;

  if (from === to) {
    const cursor = state.selection.main.from;
    view.dispatch({ changes: { from: cursor, to: cursor, insert: open + close }, selection: { anchor: cursor + open.length } });
    return true;
  }

  if (unwrapWrapper(view, open, close, from, to, hadSelection || wrappedAtCursor !== null)) return true;
  view.dispatch({
    changes: { from, to, insert: open + state.sliceDoc(from, to) + close },
    selection: hadSelection
      ? { anchor: to + open.length + close.length }
      : { anchor: from + open.length, head: to + open.length },
  });
  return true;
}

function applyToSelectedLines(view: EditorView, change: (text: string) => string): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      const next = change(line.text);
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (!changes.length) return true;
  view.dispatch({ changes });
  return true;
}

/**
 * Replacing a whole line keeps the caret where it was: on an empty line that
 * is before the inserted `## `, and typing then went in front of the marker.
 * The caret belongs where the heading text is written.
 */
function caretAfterHeadingMarker(view: EditorView): void {
  const main = view.state.selection.main;
  if (!main.empty) return;
  const line = view.state.doc.lineAt(main.head);
  const marker = /^\s*#{1,6}(?:\s|$)/u.exec(line.text);
  if (!marker) return;
  const bodyStart = line.from + marker[0].length;
  if (main.head < bodyStart) view.dispatch({ selection: { anchor: bodyStart } });
}

function headingCommand(level: number): Command {
  return (view) => {
    let changed = false;
    const handled = applyToSelectedLines(view, (text) => {
      const indent = text.match(/^\s*/)?.[0] ?? "";
      const body = text.slice(indent.length).replace(/^#{1,6}(?:\s+|$)/, "").replace(/^\s+/, "");
      const next = level === 0 ? indent + body : `${indent}${"#".repeat(level)} ${body}`;
      if (next !== text) changed = true;
      return next;
    });
    if (changed && level > 0) caretAfterHeadingMarker(view);
    // This lets an injected Reset Zoom handler receive Ctrl+0 outside a
    // heading, while removing a heading retains priority on heading lines.
    return level === 0 ? changed : handled;
  };
}

function toggleLink(view: EditorView): boolean {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    view.dispatch({ changes: { from: range.from, to: range.to, insert: "[](url)" }, selection: { anchor: range.from + 1 } });
  } else {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
      selection: { anchor: range.from + text.length + 3, head: range.from + text.length + 6 },
    });
  }
  return true;
}

function toggleCodeBlock(view: EditorView): boolean {
  const range = view.state.selection.main;
  const firstLine = view.state.doc.lineAt(range.from);
  const lastLine = view.state.doc.lineAt(range.to);
  const from = firstLine.from;
  const to = lastLine.to;
  const text = view.state.sliceDoc(from, to);
  const trimmed = text.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const lines = text.split("\n");
    const unwrapped = lines.slice(1, -1).join("\n");
    view.dispatch({ changes: { from, to, insert: unwrapped } });
  } else {
    const wrapped = `\`\`\`\n${text}\n\`\`\``;
    view.dispatch({ changes: { from, to, insert: wrapped }, selection: { anchor: range.from + 4, head: range.to + 4 } });
  }
  return true;
}

function pastePlainText(view: EditorView): boolean {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return false;
  void navigator.clipboard.readText().then((text) => {
    view.dispatch(view.state.replaceSelection(text));
  });
  return true;
}

function commandBinding(key: string, run: Command): KeyBinding {
  return { key, run, preventDefault: true };
}

function externalBindings(handlers: MarknoteKeymapHandlers): KeyBinding[] {
  const pairs: [string, Command | undefined][] = [
    ["Mod-n", handlers.newDocument],
    ["Mod-Shift-n", handlers.newDocumentWithPicker],
    ["Mod-o", handlers.openFile],
    ["Mod-s", handlers.save],
    ["Mod-Shift-s", handlers.saveAs],
    ["Mod-w", handlers.closeWindow],
    ["Mod-f", handlers.openSearch],
    ["Mod-h", handlers.openReplace],
    ["Mod-g", handlers.goToLine],
    ["Mod-+", handlers.zoomIn],
    ["Mod-=", handlers.zoomIn],
    ["Mod--", handlers.zoomOut],
    ["Mod-0", handlers.resetZoom],
  ];
  return pairs.flatMap(([key, run]) => (run ? [commandBinding(key, run)] : []));
}

const physicalCodeNames: Record<string, string> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyK: "k",
  KeyN: "n",
  KeyO: "o",
  KeyS: "s",
  KeyV: "v",
  KeyW: "w",
  KeyY: "y",
  KeyZ: "z",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Equal: "=",
  Minus: "-",
  Home: "Home",
  End: "End",
};

export function physicalShortcutName(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey">): string | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const name = physicalCodeNames[event.code];
  if (!name) return null;
  // CodeMirror names the shifted equals key `+`, matching the View menu label.
  if (event.code === "Equal" && event.shiftKey) return "Mod-+";
  return `Mod-${event.shiftKey ? "Shift-" : ""}${name}`;
}

function codeAwareKeyHandler(bindings: KeyBinding[], view: EditorView, event: KeyboardEvent): boolean {
  const key = physicalShortcutName(event);
  if (!key) return false;
  const binding = bindings.find((candidate) => candidate.key === key);
  if (!binding?.run) return false;
  const handled = binding.run(view);
  if (handled) event.preventDefault();
  return handled;
}

function createBindings(options: MarknoteKeymapOptions): KeyBinding[] {
  const isInTable = options.isInTable ?? isTableContext;
  const isMarkdownCommands = options.isMarkdownCommands ?? ((state: EditorState) =>
    state.field(editorMarkdownCommandsStateField, false) ?? true);
  const markdownCommand = (run: Command): Command => (view) =>
    isMarkdownCommands(view.state) ? run(view) : false;
  const local: KeyBinding[] = [
    commandBinding("Mod-z", undo),
    commandBinding("Mod-Shift-z", redo),
    commandBinding("Mod-y", redo),
    commandBinding("Tab", (view) => indent(view, isInTable)),
    commandBinding("Shift-Tab", (view) => outdent(view, isInTable)),
    commandBinding("Shift-Enter", markdownCommand(softBreak)),
    commandBinding("Enter", markdownCommand(continueMarkdownList)),
    commandBinding("Mod-b", markdownCommand((view) => toggleWrapper(view, "**", "**"))),
    commandBinding("Mod-i", markdownCommand((view) => toggleWrapper(view, "*", "*"))),
    commandBinding("Mod-e", markdownCommand((view) => toggleWrapper(view, "`", "`"))),
    commandBinding("Mod-d", deleteLine),
    commandBinding("Alt-ArrowUp", moveLineUp),
    commandBinding("Alt-ArrowDown", moveLineDown),
    commandBinding("Mod-k", markdownCommand(toggleLink)),
    commandBinding("Mod-Shift-k", markdownCommand(toggleCodeBlock)),
    commandBinding("Mod-Shift-v", pastePlainText),
  ];
  for (let level = 1; level <= 6; level += 1) local.push(commandBinding(`Mod-${level}`, markdownCommand(headingCommand(level))));
  local.push(commandBinding("Mod-0", markdownCommand(headingCommand(0))));

  const external = externalBindings(options.handlers ?? {});
  const all = [...local, ...external];
  // `any` is deliberately last: CodeMirror first applies its normal key and
  // keyCode fallback, then this physical-code fallback handles Cyrillic layouts.
  all.push({ any: (view, event) => codeAwareKeyHandler(all, view, event), preventDefault: false });
  return all;
}

const marknoteDefaultKeymap = defaultKeymap.filter((binding) => binding.key !== "Mod-Enter");

/** Build the editor keymap, optionally supplying shell-owned command handlers. */
export function createMarknoteKeymap(options: MarknoteKeymapOptions = {}): Extension {
  const bindings = createBindings(options);
  return [
    history({ minDepth: Infinity }),
    keymap.of([...bindings, ...historyKeymap, ...marknoteDefaultKeymap]),
    EditorView.inputHandler.of(pairInputHandler),
  ];
}

/** Exported for tests and integration code that needs to inspect the real bindings. */
export const marknoteKeyBindings: readonly KeyBinding[] = createBindings({});
export const getMarknoteKeyBindings = (options: MarknoteKeymapOptions = {}): readonly KeyBinding[] => createBindings(options);

export { isListLine, toggleWrapper, toggleCodeBlock, indent, outdent, continueMarkdownList, softBreak };
