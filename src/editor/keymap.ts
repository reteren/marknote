import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { keymap, EditorView, type KeyBinding } from "@codemirror/view";
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

function currentLine(state: EditorState, position: number): string {
  return state.doc.lineAt(position).text;
}

function isListLine(text: string): boolean {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(text);
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

function indent(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return changeSelectedLines(view, false);

  const line = view.state.doc.lineAt(range.head);
  if (isListLine(line.text)) {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: "    " } });
  } else {
    view.dispatch({ changes: { from: range.head, to: range.head, insert: "    " } });
  }
  return true;
}

function outdent(view: EditorView): boolean {
  const range = view.state.selection.main;
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

function toggleWrapper(view: EditorView, open: string, close: string): boolean {
  const state = view.state;
  const range = state.selection.main;
  let from = range.from;
  let to = range.to;

  if (range.empty) {
    const text = state.doc.toString();
    const isWord = (character: string): boolean => /[^\s*_`~\[\]()]/u.test(character);
    while (from > 0 && isWord(text[from - 1] ?? "")) from -= 1;
    while (to < text.length && isWord(text[to] ?? "")) to += 1;
    if (from === to) {
      view.dispatch({ changes: { from: range.from, to: range.to, insert: open + close }, selection: { anchor: range.from + open.length } });
      return true;
    }
  }

  const hasWrapper = state.sliceDoc(from - open.length, from) === open && state.sliceDoc(to, to + close.length) === close;
  if (hasWrapper) {
    view.dispatch({
      changes: [
        { from: from - open.length, to: from },
        { from: to, to: to + close.length },
      ],
      selection: { anchor: from - open.length, head: to - open.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: open + state.sliceDoc(from, to) + close },
      selection: { anchor: from + open.length, head: to + open.length },
    });
  }
  return true;
}

const bindings: KeyBinding[] = [
  { key: "Mod-z", run: undo },
  { key: "Mod-Shift-z", run: redo },
  { key: "Mod-y", run: redo },
  { key: "Tab", run: indent },
  { key: "Shift-Tab", run: outdent },
  { key: "Enter", run: continueMarkdownList },
  { key: "Mod-b", run: (view) => toggleWrapper(view, "**", "**") },
  { key: "Mod-i", run: (view) => toggleWrapper(view, "*", "*") },
  { key: "Mod-e", run: (view) => toggleWrapper(view, "`", "`") },
];

/** M1 keymap: история, списки, пары, обёртки и стандартная правка. */
export const marknoteKeymap: Extension = [
  history({ minDepth: Infinity }),
  keymap.of([...bindings, ...historyKeymap, ...defaultKeymap]),
  EditorView.inputHandler.of(pairInputHandler),
];

export { isListLine, currentLine };
