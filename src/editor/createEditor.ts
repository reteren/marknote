import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  LanguageDescription,
  type LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter } from "@lezer/highlight";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { marknoteMarkdown } from "./markdownExtensions";
import { livePreview } from "./livePreview";
import { createMarknoteKeymap, type MarknoteKeymapHandlers } from "./keymap";
import { marknoteSearch } from "./search";
import { tableKeymap } from "./livePreview/tables";
import { keymap } from "@codemirror/view";
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

const setEditorDocumentFormatEffect = StateEffect.define<FormatCapabilities>();

/**
 * Полное сопоставление syntaxMode из src-tauri/src/formats/code.rs (и частых алиасов)
 * с языками в @codemirror/language-data.
 */
export const SYNTAX_MODE_MAP: Readonly<Record<string, string>> = {
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  htm: "html",
  xml: "xml",
  css: "css",
  javascript: "javascript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  python: "python",
  py: "python",
  pyw: "python",
  rust: "rust",
  rs: "rust",
  go: "go",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "c",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  ksh: "shell",
  zsh: "shell",
  json: "json",
  jsonc: "json",
};

/**
 * Находит LanguageDescription в @codemirror/language-data по syntaxMode или имени/расширению.
 */
export function findLanguageDescription(modeOrName: string | null | undefined): LanguageDescription | null {
  if (!modeOrName) return null;
  const trimmed = modeOrName.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();

  // Исключаем плейнтекст (в language-data "text" может резолвиться в LaTeX)
  if (normalized === "plain" || normalized === "text" || normalized === "txt") {
    return null;
  }

  const mapped = SYNTAX_MODE_MAP[normalized] ?? normalized;
  return (
    LanguageDescription.matchLanguageName(languages, mapped, true) ??
    LanguageDescription.matchFilename(languages, `file.${normalized}`) ??
    null
  );
}

const loadedSyntaxModes = new Map<string, LanguageSupport>();
const pendingSyntaxModes = new Map<string, Promise<LanguageSupport | null>>();

const syntaxTokenTheme = EditorView.theme({
  ".tok-keyword, .tok-operator": { color: "var(--text-accent)" },
  ".tok-string, .tok-number, .tok-bool": { color: "var(--text-normal)" },
  ".tok-comment": { color: "var(--text-muted)" },
  ".tok-typeName, .tok-className, .tok-propertyName": { color: "var(--text-accent)" },
  ".tok-invalid": { color: "var(--text-error)" },
});

export function loadSyntaxMode(mode: string): Promise<LanguageSupport | null> {
  const desc = findLanguageDescription(mode);
  if (!desc) return Promise.resolve(null);

  if (desc.support) return Promise.resolve(desc.support);

  const cached = loadedSyntaxModes.get(desc.name);
  if (cached) return Promise.resolve(cached);

  const pending = pendingSyntaxModes.get(desc.name);
  if (pending) return pending;

  const request = desc
    .load()
    .then((support) => {
      loadedSyntaxModes.set(desc.name, support);
      pendingSyntaxModes.delete(desc.name);
      return support;
    })
    .catch(() => {
      // Подсветка необязательна: неизвестный или недоступный режим не должен
      // мешать открыть текст и не должен шуметь в консоли.
      pendingSyntaxModes.delete(desc.name);
      return null;
    });
  pendingSyntaxModes.set(desc.name, request);
  return request;
}

type EditorRuntime = {
  formatCompartment: Compartment;
  formatField: StateField<FormatCapabilities>;
  imageResolver: ReturnType<typeof createImageResolver>;
};

const editorRuntimes = new WeakMap<EditorView, EditorRuntime>();

function sameFormat(left: FormatCapabilities, right: FormatCapabilities): boolean {
  return left.id === right.id &&
    left.livePreview === right.livePreview &&
    left.syntaxMode === right.syntaxMode;
}

function formatExtensions(
  format: FormatCapabilities,
  imageResolver: ReturnType<typeof createImageResolver>,
): Extension {
  if (format.livePreview) {
    return [
      markdown({ extensions: marknoteMarkdown, addKeymap: false }),
      livePreview({ resolveImage: imageResolver }),
    ];
  }
  if (format.syntaxMode) {
    const desc = findLanguageDescription(format.syntaxMode);
    if (desc?.support) {
      return desc.support.extension;
    }
  }
  return [];
}

function activateSyntaxMode(
  view: EditorView,
  runtime: EditorRuntime,
  format: FormatCapabilities,
): Promise<void> {
  if (format.livePreview || !format.syntaxMode) {
    return Promise.resolve();
  }

  const desc = findLanguageDescription(format.syntaxMode);
  if (!desc) return Promise.resolve();

  return loadSyntaxMode(format.syntaxMode).then((support) => {
    if (!support) return;
    const current = view.state.field(runtime.formatField, false);
    if (!current || !sameFormat(current, format)) return;
    try {
      view.dispatch({
        effects: runtime.formatCompartment.reconfigure(support.extension),
        selection: view.state.selection,
      });
    } catch {
      // EditorView мог быть уничтожен, пока разрешался динамический импорт.
    }
  });
}

/** Обновляет путь документа без пересоздания редактора и его расширений. */
export function setEditorDocumentPath(view: EditorView, path: string | null): void {
  // selection в спецификации транзакции заставляет ViewPlugin пересобрать
  // декорации сразу после обновления StateField.
  view.dispatch({
    effects: setEditorDocumentPathEffect.of(path),
    selection: view.state.selection,
  });
}

/**
 * Меняет тип документа без пересоздания редактора. Перенастройка compartment
 * сохраняет текст, выделение и историю undo; асинхронный язык применяется
 * только если документ всё ещё имеет тот же формат.
 */
export function setEditorFormat(view: EditorView, format: FormatCapabilities): Promise<void> | void {
  const runtime = editorRuntimes.get(view);
  if (!runtime) return;

  view.dispatch({
    effects: [
      setEditorDocumentFormatEffect.of(format),
      runtime.formatCompartment.reconfigure(formatExtensions(format, runtime.imageResolver)),
    ],
    selection: view.state.selection,
  });
  return activateSyntaxMode(view, runtime, format);
}

/** Алиас для обратной совместимости */
export const setEditorDocumentFormat = setEditorFormat;

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  path?: string | null;
  format: FormatCapabilities;
  /** Команды оболочки: сохранение, открытие, окна, масштаб. Приходят из
   *  src/state/actions.ts — редактор их не реализует, только вызывает. */
  handlers?: MarknoteKeymapHandlers;
  onChange: (doc: string) => void;
  onStats: (stats: EditorStats) => void;
}): EditorView {
  const imageResolver = createImageResolver(opts.path ?? null);
  const formatCompartment = new Compartment();
  const formatField = StateField.define<FormatCapabilities>({
    create: () => opts.format,
    update(format, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setEditorDocumentFormatEffect)) return effect.value;
      }
      return format;
    },
  });
  const runtime: EditorRuntime = { formatCompartment, formatField, imageResolver };
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
    formatField,
    // Таблица обрабатывает Tab раньше общего keymap, иначе сработает
    // отступ списка вместо перехода к следующей ячейке.
    keymap.of(tableKeymap),
    createMarknoteKeymap({ handlers: opts.handlers }),
    marknoteSearch(),
    EditorView.lineWrapping,
    highlightActiveLine(),
    syntaxHighlighting(classHighlighter),
    syntaxTokenTheme,
    marknoteTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) opts.onStats(getEditorStats(update.state));
    }),
  ];
  extensions.splice(extensions.indexOf(marknoteTheme), 0, formatCompartment.of(formatExtensions(opts.format, imageResolver)));

  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc, extensions }),
    parent: opts.parent,
  });
  editorRuntimes.set(view, runtime);
  activateSyntaxMode(view, runtime, opts.format);
  opts.onStats(getEditorStats(view.state));
  return view;
}
