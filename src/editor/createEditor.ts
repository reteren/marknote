import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
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

type SyntaxModeLoader = () => Promise<LanguageSupport>;

function legacySupport(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

/**
 * Явный список режимов из реестра форматов и того же набора, что использует
 * fenced-code preview. Общий реестр language-data сюда намеренно не тянем:
 * каждый режим подгружается только при выборе соответствующего формата.
 */
const syntaxModeAliases: Record<string, string> = {
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
  shell: "shell",
  sh: "shell",
  bash: "shell",
  ksh: "shell",
  zsh: "shell",
  json: "json",
  jsonc: "json",
};

const syntaxModeLoaders: Record<string, SyntaxModeLoader> = {
  yaml: () => import("@codemirror/lang-yaml").then((module) => module.yaml()),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then((module) => legacySupport(module.toml)),
  html: () => import("@codemirror/lang-html").then((module) => module.html()),
  xml: () => import("@codemirror/lang-xml").then((module) => module.xml()),
  css: () => import("@codemirror/lang-css").then((module) => module.css()),
  javascript: () => import("@codemirror/lang-javascript").then((module) => module.javascript()),
  typescript: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ typescript: true })),
  python: () => import("@codemirror/lang-python").then((module) => module.python()),
  rust: () => import("@codemirror/lang-rust").then((module) => module.rust()),
  go: () => import("@codemirror/lang-go").then((module) => module.go()),
  c: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
  shell: () => import("@codemirror/legacy-modes/mode/shell").then((module) => legacySupport(module.shell)),
  json: () => import("@codemirror/lang-json").then((module) => module.json()),
};

const loadedSyntaxModes = new Map<string, LanguageSupport>();
const pendingSyntaxModes = new Map<string, Promise<LanguageSupport | null>>();

const syntaxTokenTheme = EditorView.theme({
  ".tok-keyword, .tok-operator": { color: "var(--text-accent)" },
  ".tok-string, .tok-number, .tok-bool": { color: "var(--text-normal)" },
  ".tok-comment": { color: "var(--text-muted)" },
  ".tok-typeName, .tok-className, .tok-propertyName": { color: "var(--text-accent)" },
  ".tok-invalid": { color: "var(--text-error)" },
});

function normalizedSyntaxMode(mode: string | null): string | null {
  if (!mode) return null;
  const normalized = mode.trim().toLowerCase();
  return syntaxModeAliases[normalized] ?? null;
}

function loadSyntaxMode(mode: string): Promise<LanguageSupport | null> {
  const cached = loadedSyntaxModes.get(mode);
  if (cached) return Promise.resolve(cached);

  const pending = pendingSyntaxModes.get(mode);
  if (pending) return pending;

  const loader = syntaxModeLoaders[mode];
  if (!loader) return Promise.resolve(null);

  const request = loader()
    .then((support) => {
      loadedSyntaxModes.set(mode, support);
      pendingSyntaxModes.delete(mode);
      return support;
    })
    .catch(() => {
      // Подсветка необязательна: неизвестный или недоступный режим не должен
      // мешать открыть текст и не должен шуметь в консоли.
      pendingSyntaxModes.delete(mode);
      return null;
    });
  pendingSyntaxModes.set(mode, request);
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
  if (!format.livePreview) return [];
  return [
    markdown({ extensions: marknoteMarkdown, addKeymap: false }),
    livePreview({ resolveImage: imageResolver }),
  ];
}

function activateSyntaxMode(
  view: EditorView,
  runtime: EditorRuntime,
  format: FormatCapabilities,
): void {
  const mode = normalizedSyntaxMode(format.syntaxMode);
  if (!mode || format.livePreview) return;

  void loadSyntaxMode(mode).then((support) => {
    if (!support) return;
    const current = view.state.field(runtime.formatField, false);
    if (!current || !sameFormat(current, format)) return;
    try {
      view.dispatch({
        effects: runtime.formatCompartment.reconfigure(support.extension),
        selection: view.state.selection,
      });
    } catch {
      // EditorView may have been destroyed while the dynamic import resolved.
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
export function setEditorDocumentFormat(view: EditorView, format: FormatCapabilities): void {
  const runtime = editorRuntimes.get(view);
  if (!runtime) return;

  view.dispatch({
    effects: [
      setEditorDocumentFormatEffect.of(format),
      runtime.formatCompartment.reconfigure(formatExtensions(format, runtime.imageResolver)),
    ],
    selection: view.state.selection,
  });
  activateSyntaxMode(view, runtime, format);
}

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
