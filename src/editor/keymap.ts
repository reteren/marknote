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
import { EditorState, type Extension } from "@codemirror/state";
import { keymap, EditorView, type Command, type KeyBinding } from "@codemirror/view";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";

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
}

function currentLine(state: EditorState, position: number): string {
  return state.doc.lineAt(position).text;
}

function isListLine(text: string): boolean {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(text);
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
        const amount = Math.min(4, line.text.match(/^ */)?.[0].length ?? 0);
        if (amount > 0) changes.push({ from: line.from, to: line.from + amount });
      } else if (isListLine(line.text)) {
        changes.push({ from: line.from, to: line.from, insert: "    " });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    return true;
  }
  return false;
}

function indent(view: EditorView, isInTable: (state: EditorState, position: number) => boolean = isTableContext): boolean {
  const range = view.state.selection.main;
  if (isInTable(view.state, range.head)) return false;
  if (!range.empty) return changeSelectedLines(view, false);

  const line = view.state.doc.lineAt(range.head);
  if (isListLine(line.text)) {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: "    " } });
  } else {
    view.dispatch({ changes: { from: range.head, to: range.head, insert: "    " } });
  }
  return true;
}

function outdent(view: EditorView, isInTable: (state: EditorState, position: number) => boolean = isTableContext): boolean {
  const range = view.state.selection.main;
  if (isInTable(view.state, range.head)) return false;
  if (!range.empty) return changeSelectedLines(view, true);

  const line = view.state.doc.lineAt(range.head);
  const amount = Math.min(4, line.text.match(/^ */)?.[0].length ?? 0);
  if (amount === 0) return true;
  view.dispatch({ changes: { from: line.from, to: line.from + amount } });
  return true;
}

function continueMarkdownList(view: EditorView): boolean {
  return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
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

  // Для звёздочки второе нажатие расширяет только что созданную пару до **...**.
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

/** Remove wrappers around either the selected content or a selection containing the markers. */
function unwrapWrapper(view: EditorView, open: string, close: string, from: number, to: number): boolean {
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
  view.dispatch({
    changes: [
      { from: wrapperFrom, to: wrapperFrom + open.length },
      { from: wrapperTo - close.length, to: wrapperTo },
    ],
    selection: { anchor: selectionFrom, head: selectionTo },
  });
  return true;
}

function toggleWrapper(view: EditorView, open: string, close: string): boolean {
  const state = view.state;
  const range = wordOrSelection(state);
  const { from, to } = range;

  if (from === to) {
    const cursor = state.selection.main.from;
    view.dispatch({ changes: { from: cursor, to: cursor, insert: open + close }, selection: { anchor: cursor + open.length } });
    return true;
  }

  if (unwrapWrapper(view, open, close, from, to)) return true;
  view.dispatch({
    changes: { from, to, insert: open + state.sliceDoc(from, to) + close },
    selection: { anchor: from + open.length, head: to + open.length },
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
  const local: KeyBinding[] = [
    commandBinding("Mod-z", undo),
    commandBinding("Mod-Shift-z", redo),
    commandBinding("Mod-y", redo),
    commandBinding("Tab", (view) => indent(view, isInTable)),
    commandBinding("Shift-Tab", (view) => outdent(view, isInTable)),
    commandBinding("Enter", continueMarkdownList),
    commandBinding("Mod-b", (view) => toggleWrapper(view, "**", "**")),
    commandBinding("Mod-i", (view) => toggleWrapper(view, "*", "*")),
    commandBinding("Mod-e", (view) => toggleWrapper(view, "`", "`")),
    commandBinding("Mod-d", deleteLine),
    commandBinding("Alt-ArrowUp", moveLineUp),
    commandBinding("Alt-ArrowDown", moveLineDown),
    commandBinding("Mod-k", toggleLink),
    commandBinding("Mod-Shift-k", toggleCodeBlock),
    commandBinding("Mod-Shift-v", pastePlainText),
  ];
  for (let level = 1; level <= 6; level += 1) local.push(commandBinding(`Mod-${level}`, headingCommand(level)));
  local.push(commandBinding("Mod-0", headingCommand(0)));

  const external = externalBindings(options.handlers ?? {});
  const all = [...local, ...external];
  // `any` is deliberately last: CodeMirror first applies its normal key and
  // keyCode fallback, then this physical-code fallback handles Cyrillic layouts.
  all.push({ any: (view, event) => codeAwareKeyHandler(all, view, event), preventDefault: false });
  return all;
}

/** Build the editor keymap, optionally supplying shell-owned command handlers. */
export function createMarknoteKeymap(options: MarknoteKeymapOptions = {}): Extension {
  const bindings = createBindings(options);
  return [
    history({ minDepth: Infinity }),
    keymap.of([...bindings, ...historyKeymap, ...defaultKeymap]),
    EditorView.inputHandler.of(pairInputHandler),
  ];
}

/** Exported for tests and integration code that needs to inspect the real bindings. */
export const marknoteKeyBindings: readonly KeyBinding[] = createBindings({});
export const getMarknoteKeyBindings = (options: MarknoteKeymapOptions = {}): readonly KeyBinding[] => createBindings(options);

export { isListLine, toggleWrapper, toggleCodeBlock, indent, outdent, continueMarkdownList };
