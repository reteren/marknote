import { Compartment, StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Размеры выбраны так, чтобы не ломать рабочую колонку и оставаться читаемыми. */
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_STORAGE_KEY = "marknote.editor.zoom";

type ZoomRuntime = {
  compartment: Compartment;
  percent: number;
};

const runtimes = new WeakMap<EditorView, ZoomRuntime>();

function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent / ZOOM_STEP) * ZOOM_STEP));
}

function readStoredZoom(): number {
  try {
    const raw = globalThis.localStorage?.getItem(ZOOM_STORAGE_KEY);
    if (raw === null || raw === undefined) return ZOOM_DEFAULT;
    return clampZoom(Number(raw));
  } catch {
    // localStorage может быть отключён политикой приватности WebView.
    return ZOOM_DEFAULT;
  }
}

function storeZoom(percent: number): void {
  try {
    globalThis.localStorage?.setItem(ZOOM_STORAGE_KEY, String(percent));
  } catch {
    // Запоминание необязательно и не должно мешать редактированию.
  }
}

function zoomTheme(percent: number): Extension {
  const factor = percent / ZOOM_DEFAULT;
  return EditorView.theme({
    // Меню и строка состояния не меняются: селектор ограничен этим редактором.
    "&": {
      fontSize: `calc(var(--font-size-text) * ${factor})`,
      maxWidth: "var(--line-width)",
    },
    ".cm-content": {
      fontSize: `calc(var(--font-size-text) * ${factor})`,
    },
  });
}

function ensureRuntime(view: EditorView): ZoomRuntime {
  const existing = runtimes.get(view);
  if (existing) return existing;

  const runtime: ZoomRuntime = {
    compartment: new Compartment(),
    percent: readStoredZoom(),
  };
  runtimes.set(view, runtime);
  view.dispatch({
    effects: StateEffect.appendConfig.of(runtime.compartment.of(zoomTheme(runtime.percent))),
    selection: view.state.selection,
  });
  return runtime;
}

function applyZoom(view: EditorView, percent: number): void {
  const runtime = ensureRuntime(view);
  const next = clampZoom(percent);
  runtime.percent = next;
  storeZoom(next);
  view.dispatch({
    effects: runtime.compartment.reconfigure(zoomTheme(next)),
    selection: view.state.selection,
  });
}

/** Подключает масштаб и восстанавливает последнее значение из localStorage. */
export function installZoom(view: EditorView): number {
  ensureRuntime(view);
  return getZoom(view);
}

/** Увеличивает кегль текста редактора на один шаг. */
export function zoomIn(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent + ZOOM_STEP);
}

/** Уменьшает кегль текста редактора на один шаг. */
export function zoomOut(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent - ZOOM_STEP);
}

/** Возвращает масштаб к исходному значению и сохраняет это решение. */
export function resetZoom(view: EditorView): void {
  applyZoom(view, ZOOM_DEFAULT);
}

/** Возвращает текущий масштаб; полезно оболочке для состояния пункта меню. */
export function getZoom(view: EditorView): number {
  return ensureRuntime(view).percent;
}
