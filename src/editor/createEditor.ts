import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, StateEffect, StateField, Text, type ChangeDesc, type Extension } from "@codemirror/state";
import {
  LanguageDescription,
  type LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import { marknoteMarkdown } from "./markdownExtensions";
import { livePreview } from "./livePreview";
import { createMarknoteKeymap, type MarknoteKeymapHandlers } from "./keymap";
import { marknoteSearch } from "./search";
import { tableKeymap } from "./livePreview/tables";
import { keymap } from "@codemirror/view";
import { marknoteTheme } from "./theme";
import { createImageResolver } from "./imageResolver";
import { supportsMarkdownCommands, type FormatCapabilities } from "../state/formats.svelte";
import type { Settings } from "../state/settings.svelte";
import {
  editorSettingsExtensions,
  editorFormatSyntaxStateField,
  editorMarkdownCommandsStateField,
  editorSettingsStateField,
  setEditorFormatSyntaxEffect,
  setEditorMarkdownCommandsEffect,
  setEditorSettingsEffect,
  settingsCompartment,
} from "./settings";
import {
  createZoomRuntime,
  reconfigureZoom,
  registerZoomRuntime,
  zoomRuntimeExtension,
  type ZoomRuntime,
} from "./zoom";

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

const wordCounts = new WeakMap<Text, number>();

function countWordsInDocument(doc: Text): number {
  const cached = wordCounts.get(doc);
  if (cached !== undefined) return cached;
  const count = countWords(doc.toString());
  wordCounts.set(doc, count);
  return count;
}

function countWholeWords(doc: Text, from: number, to: number): number {
  const text = doc.sliceString(from, to);
  let count = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    const start = from + (match.index ?? 0);
    const end = start + match[0].length;
    const startsAtBoundary = start === 0 || /\s/u.test(doc.sliceString(start - 1, start));
    const endsAtBoundary = end === doc.length || /\s/u.test(doc.sliceString(end, end + 1));
    if (startsAtBoundary && endsAtBoundary) count += 1;
  }
  return count;
}

type ChangedWordRange = { oldFrom: number; oldTo: number; newFrom: number; newTo: number };

function countWordsAfterChanges(previous: EditorState, state: EditorState, changes: ChangeDesc): number {
  const ranges: ChangedWordRange[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    ranges.push({
      oldFrom: Math.max(0, fromA - 1),
      oldTo: Math.min(previous.doc.length, toA + 1),
      newFrom: Math.max(0, fromB - 1),
      newTo: Math.min(state.doc.length, toB + 1),
    });
  });
  if (!ranges.length) return countWordsInDocument(state.doc);

  const merged: ChangedWordRange[] = [];
  for (const range of ranges) {
    const previousRange = merged.at(-1);
    if (previousRange && (range.oldFrom <= previousRange.oldTo || range.newFrom <= previousRange.newTo)) {
      previousRange.oldTo = Math.max(previousRange.oldTo, range.oldTo);
      previousRange.newTo = Math.max(previousRange.newTo, range.newTo);
      continue;
    }
    merged.push({ ...range });
  }

  let count = countWordsInDocument(previous.doc);
  for (const range of merged) {
    count -= countWords(previous.doc.sliceString(range.oldFrom, range.oldTo));
    count += countWords(state.doc.sliceString(range.newFrom, range.newTo));
  }
  wordCounts.set(state.doc, count);
  return count;
}

export function getEditorStats(state: EditorState, previous?: EditorState, changes?: ChangeDesc): EditorStats {
  const words = previous && changes ? countWordsAfterChanges(previous, state, changes) : countWordsInDocument(state.doc);
  const cursor = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursor);
  const range = state.selection.main;

  if (range.empty) {
    return {
      line: cursorLine.number,
      col: cursor - cursorLine.from + 1,
      lines: state.doc.lines,
      words,
      chars: state.doc.length,
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
    words,
    chars: state.doc.length,
    selection: {
      fromLine,
      toLine,
      words: countWholeWords(state.doc, range.from, range.to),
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

export type EditorStateOptions = {
  doc: string;
  path?: string | null;
  format: FormatCapabilities;
  settings?: Settings | null;
};

export type EditorScrollPosition = {
  top: number;
  left: number;
};

type EditorRuntime = {
  formatCompartment: Compartment;
  formatField: StateField<FormatCapabilities>;
  documentPathField: StateField<string | null>;
  zoom: ZoomRuntime;
  imageResolver: ReturnType<typeof createImageResolver>;
  createState: (opts: EditorStateOptions) => EditorState;
  handlers?: MarknoteKeymapHandlers;
  onChange: (doc: string) => void;
  onStats: (stats: EditorStats) => void;
  scrollPositions: WeakMap<EditorState, EditorScrollPosition>;
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
      setEditorFormatSyntaxEffect.of(Boolean(format.syntaxMode)),
      setEditorMarkdownCommandsEffect.of(supportsMarkdownCommands(format)),
      runtime.formatCompartment.reconfigure(formatExtensions(format, runtime.imageResolver)),
      settingsCompartment.reconfigure(editorSettingsExtensions(
        view.state.field(editorSettingsStateField, false) ?? null,
        Boolean(format.syntaxMode),
      )),
    ],
    selection: view.state.selection,
  });
  return activateSyntaxMode(view, runtime, format);
}

/** Алиас для обратной совместимости */
export const setEditorDocumentFormat = setEditorFormat;

function buildEditorState(runtime: EditorRuntime, opts: EditorStateOptions): EditorState {
  const extensions: Extension[] = [
    runtime.documentPathField,
    runtime.formatField,
    editorMarkdownCommandsStateField,
    // Таблица обрабатывает Tab раньше общего keymap, иначе сработает
    // отступ списка вместо перехода к следующей ячейке.
    keymap.of(tableKeymap),
    createMarknoteKeymap({ handlers: runtime.handlers }),
    marknoteSearch(),
    // Всё, что зависит от настроек, — в одном отсеке: смена настройки
    // перенастраивает его, а не пересоздаёт редактор.
    settingsCompartment.of(editorSettingsExtensions(opts.settings ?? null, Boolean(opts.format.syntaxMode))),
    editorFormatSyntaxStateField,
    editorSettingsStateField,
    syntaxHighlighting(classHighlighter),
    syntaxTokenTheme,
    marknoteTheme,
    // Один и тот же отсек присутствует в каждом состоянии вкладки. Сам
    // процент масштаба хранится в runtime view и синхронизируется при
    // переключении состояния.
    zoomRuntimeExtension(runtime.zoom),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) runtime.onChange(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) runtime.onStats(getEditorStats(update.state, update.startState, update.changes));
    }),
  ];
  extensions.splice(
    extensions.indexOf(marknoteTheme),
    0,
    runtime.formatCompartment.of(formatExtensions(opts.format, runtime.imageResolver)),
  );

  const state = EditorState.create({ doc: opts.doc, extensions });
  // StateField хранит последний применённый снимок настроек, чтобы после
  // setState восстановить тот же отсек и не откатить настройки вкладки.
  return state.update({
    effects: [
      setEditorSettingsEffect.of(opts.settings ?? null),
      setEditorFormatSyntaxEffect.of(Boolean(opts.format.syntaxMode)),
      setEditorMarkdownCommandsEffect.of(supportsMarkdownCommands(opts.format)),
    ],
  }).state;
}

/**
 * Создаёт состояние вкладки с тем же набором расширений, что и у view.
 * Состояние не подключается к DOM до вызова setEditorState; оболочка может
 * хранить его рядом с WorkspaceTab и передавать обратно при активации.
 */
export function createEditorState(view: EditorView, opts: EditorStateOptions): EditorState {
  const runtime = editorRuntimes.get(view);
  if (!runtime) throw new Error("EditorView is not managed by createEditor");

  // Настройки общие для окна. Если они не переданы, копируем снимок активного
  // состояния, включая null до ответа Rust.
  const activeSettings = view.state.field(editorSettingsStateField, false);
  return runtime.createState({
    ...opts,
    settings: opts.settings === undefined ? activeSettings : opts.settings,
  });
}

/** Возвращает текущий viewport редактора в пикселях. */
export function getEditorScrollPosition(view: EditorView): EditorScrollPosition {
  return { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft };
}

/** Восстанавливает viewport после переключения состояния вкладки. */
export function setEditorScrollPosition(view: EditorView, position: EditorScrollPosition): void {
  view.scrollDOM.scrollTop = Math.max(0, position.top);
  view.scrollDOM.scrollLeft = Math.max(0, position.left);
}

/**
 * Переключает один EditorView на состояние другой вкладки.
 * Возвращает прежнее состояние, уже содержащее последнюю историю и курсор,
 * чтобы оболочка заменила свой снимок активной вкладки. Положение прокрутки
 * сохраняется отдельно: CodeMirror не включает его в EditorState.
 */
export function setEditorState(view: EditorView, nextState: EditorState): EditorState {
  const runtime = editorRuntimes.get(view);
  if (!runtime) throw new Error("EditorView is not managed by createEditor");

  const previousState = view.state;
  runtime.scrollPositions.set(previousState, getEditorScrollPosition(view));
  const nextPath = nextState.field(runtime.documentPathField, false);
  if (nextPath !== undefined) runtime.imageResolver.setDocumentPath(nextPath);
  const nextFormat = nextState.field(runtime.formatField, false);
  const settings = previousState.field(editorSettingsStateField, false) ?? null;
  const nextScroll = runtime.scrollPositions.get(nextState) ?? { top: 0, left: 0 };
  view.setState(nextState);
  // Настройки и масштаб — свойства view, но их Compartment обязан быть в
  // каждом состоянии. Перенастраиваем оба отсека после подключения нового.
  view.dispatch({
    effects: [
      settingsCompartment.reconfigure(editorSettingsExtensions(settings, Boolean(nextFormat?.syntaxMode))),
      setEditorSettingsEffect.of(settings),
      setEditorFormatSyntaxEffect.of(Boolean(nextFormat?.syntaxMode)),
    ],
    selection: view.state.selection,
  });
  reconfigureZoom(view);
  // setState оставляет DOM viewport как есть, а requestMeasure самого view
  // выполняется позже. Применяем сохранённую позицию сейчас и после измерения;
  // callback проверяет, что вкладка всё ещё активна.
  setEditorScrollPosition(view, nextScroll);
  const stateAfterReconfigure = view.state;
  view.requestMeasure({
    read: () => null,
    write: (_measure, measuredView) => {
      if (measuredView.state === stateAfterReconfigure) setEditorScrollPosition(measuredView, nextScroll);
    },
  });
  if (nextFormat) void activateSyntaxMode(view, runtime, nextFormat);
  runtime.onStats(getEditorStats(view.state));
  return previousState;
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
  /** Настройки пользователя. Может не быть: редактор поднимается раньше,
   *  чем Rust успевает отдать settings.json. */
  settings?: Settings | null;
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
  const runtime: EditorRuntime = {
    formatCompartment,
    formatField,
    documentPathField,
    zoom: createZoomRuntime(opts.settings?.editor.zoomPercent),
    imageResolver,
    createState: () => {
      throw new Error("Editor state factory is not initialized");
    },
    handlers: opts.handlers,
    onChange: opts.onChange,
    onStats: opts.onStats,
    scrollPositions: new WeakMap<EditorState, EditorScrollPosition>(),
  };
  runtime.createState = (stateOpts) => buildEditorState(runtime, stateOpts);
  const view = new EditorView({
    state: runtime.createState(opts),
    parent: opts.parent,
  });
  // Замеры из qa/ работают с настоящим редактором и должны как-то до него
  // дотянуться. Ссылка выставляется только в режиме разработки (vite), в
  // собранной программе этого кода нет вовсе: отладочная лазейка в выпуске
  // никому не нужна.
  if (import.meta.env?.DEV) {
    (globalThis as typeof globalThis & { __marknoteEditorView__?: EditorView }).__marknoteEditorView__ = view;
  }
  editorRuntimes.set(view, runtime);
  registerZoomRuntime(view, runtime.zoom);
  activateSyntaxMode(view, runtime, opts.format);
  opts.onStats(getEditorStats(view.state));
  return view;
}
