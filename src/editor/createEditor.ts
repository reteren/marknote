import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { marknoteMarkdown } from "./markdownExtensions";
import { livePreview } from "./livePreview";
import { marknoteKeymap } from "./keymap";
import { marknoteTheme } from "./theme";
import { createImageResolver } from "./imageResolver";
import type { FormatCapabilities } from "../state/formats.svelte";

export type EditorStats = {
  line: number;
  col: number;
  lines: number;
  words: number;
  chars: number;
  selection: null | {
    fromLine: number;
    toLine: number;
    words: number;
    chars: number;
  };
};

function countWords(text: string): number {
  let count = 0;
  for (const _match of text.matchAll(/\S+/gu)) count += 1;
  return count;
}

function countWholeWords(text: string, from: number, to: number): number {
  let count = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start >= from && end <= to) count += 1;
  }
  return count;
}

export function getEditorStats(state: EditorState): EditorStats {
  const text = state.doc.toString();
  const cursor = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursor);
  const range = state.selection.main;

  if (range.empty) {
    return {
      line: cursorLine.number,
      col: cursor - cursorLine.from + 1,
      lines: state.doc.lines,
      words: countWords(text),
      chars: text.length,
      selection: null,
    };
  }

  const fromLine = state.doc.lineAt(range.from).number;
  // Конец в начале строки относится к предыдущей строке — так читается Ln 11–16.
  const toLine = state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
  return {
    line: cursorLine.number,
    col: cursor - cursorLine.from + 1,
    lines: state.doc.lines,
    words: countWords(text),
    chars: text.length,
    selection: {
      fromLine,
      toLine,
      words: countWholeWords(text, range.from, range.to),
      chars: range.to - range.from,
    },
  };
}

const setEditorDocumentPathEffect = StateEffect.define<string | null>();

/** Обновляет путь документа без пересоздания редактора и его расширений. */
export function setEditorDocumentPath(view: EditorView, path: string | null): void {
  // selection в спецификации транзакции заставляет ViewPlugin пересобрать
  // декорации сразу после обновления StateField.
  view.dispatch({
    effects: setEditorDocumentPathEffect.of(path),
    selection: view.state.selection,
  });
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  path?: string | null;
  format: FormatCapabilities;
  onChange: (doc: string) => void;
  onStats: (stats: EditorStats) => void;
}): EditorView {
  const imageResolver = createImageResolver(opts.path ?? null);
  const documentPathField = StateField.define<string | null>({
    create: () => opts.path ?? null,
    update(path, transaction) {
      let nextPath = path;
      for (const effect of transaction.effects) {
        if (effect.is(setEditorDocumentPathEffect)) {
          imageResolver.setDocumentPath(effect.value);
          nextPath = effect.value;
        }
      }
      return nextPath;
    },
  });

  const extensions: Extension[] = [
    documentPathField,
    marknoteKeymap,
    EditorView.lineWrapping,
    highlightActiveLine(),
    markdown({ extensions: marknoteMarkdown, addKeymap: false }),
    marknoteTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) opts.onStats(getEditorStats(update.state));
    }),
  ];

  if (opts.format.livePreview) extensions.push(livePreview({ resolveImage: imageResolver }));

  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc, extensions }),
    parent: opts.parent,
  });
  opts.onStats(getEditorStats(view.state));
  return view;
}
