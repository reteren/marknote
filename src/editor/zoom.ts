import { Compartment, StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { settingsState, updateSettings } from "../state/settings.svelte";

/** Размеры выбраны так, чтобы не ломать рабочую колонку и оставаться читаемыми. */
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_STORAGE_KEY = "marknote.editor.zoom";

/** Runtime масштаба принадлежит одному EditorView и переиспользуется его
 * состояниями вкладок. Сам отсек должен присутствовать в каждом состоянии,
 * иначе view.setState не сможет перенастроить масштаб после переключения. */
export type ZoomRuntime = {
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

function getInitialZoom(): number {
  // Единственное хранилище масштаба — settings.json. Раньше значение жило в
  // localStorage, а в настройках лежала копия, которая ни на что не влияла:
  // после перезапуска побеждал localStorage, и масштаб не переносился вместе
  // с файлом настроек на другую машину.
  if (settingsState.ready) return clampZoom(settingsState.settings.editor.zoomPercent);
  // Запасной путь для запуска вне Tauri — в тестах и в обычном браузере, где
  // настроек нет вовсе. Не мёртвый код: без него редактор там теряет масштаб.
  return readStoredZoom();
}

export function zoomTheme(percent: number): Extension {
  const factor = percent / ZOOM_DEFAULT;
  return EditorView.theme({
    // Меню и строка состояния не меняются: селектор ограничен этим редактором.
    // `marknoteTheme` is installed after the settings compartment.  Include
    // the editor class in the zoom selectors so these calculated values win
    // over the base variable declaration without using !important.
    "&.cm-editor": {
      fontSize: `calc(var(--font-size-text) * ${factor})`,
      maxWidth: "var(--line-width)",
    },
    "&.cm-editor .cm-content": {
      fontSize: `calc(var(--font-size-text) * ${factor})`,
    },
  });
}

/** Создаёт отсек масштаба до создания первого EditorState. */
export function createZoomRuntime(initialPercent?: number): ZoomRuntime {
  return {
    compartment: new Compartment(),
    percent: initialPercent === undefined ? getInitialZoom() : clampZoom(initialPercent),
  };
}

/** Добавляет отсек масштаба в список расширений состояния. */
export function zoomRuntimeExtension(runtime: ZoomRuntime): Extension {
  return runtime.compartment.of(zoomTheme(runtime.percent));
}

/** Регистрирует заранее созданный runtime за view. */
export function registerZoomRuntime(view: EditorView, runtime: ZoomRuntime): void {
  runtimes.set(view, runtime);
}

/** Синхронизирует отсек масштаба после setState. */
export function reconfigureZoom(view: EditorView): void {
  const runtime = ensureRuntime(view);
  view.dispatch({
    effects: runtime.compartment.reconfigure(zoomTheme(runtime.percent)),
    selection: view.state.selection,
  });
}

function ensureRuntime(view: EditorView): ZoomRuntime {
  const existing = runtimes.get(view);
  if (existing) return existing;

  const runtime = createZoomRuntime();
  runtimes.set(view, runtime);
  view.dispatch({
    effects: StateEffect.appendConfig.of(runtime.compartment.of(zoomTheme(runtime.percent))),
    selection: view.state.selection,
  });
  return runtime;
}

function applyZoom(view: EditorView, percent: number, syncSettings = true): void {
  const runtime = ensureRuntime(view);
  const next = clampZoom(percent);
  runtime.percent = next;
  // Запасной путь для запуска вне Tauri, см. getInitialZoom.
  storeZoom(next);
  // Запись в настройки уже с задержкой (scheduleSave), поэтому серия нажатий
  // Ctrl+= не превращается в серию записей на диск.
  if (syncSettings && settingsState.settings.editor.zoomPercent !== next) {
    updateSettings({ editor: { zoomPercent: next } });
  }
  view.dispatch({
    effects: runtime.compartment.reconfigure(zoomTheme(next)),
    selection: view.state.selection,
  });
}

/** Подключает масштаб и восстанавливает значение из настроек (с fallback на localStorage). */
export function installZoom(view: EditorView): number {
  ensureRuntime(view);
  return getZoom(view);
}

/** Устанавливает точное значение масштаба редактора. */
export function setZoomPercent(view: EditorView, percent: number, syncSettings = true): void {
  applyZoom(view, percent, syncSettings);
}

/** Увеличивает кегль текста редактора на один шаг. */
export function zoomIn(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent + ZOOM_STEP);
}

/** Уменьшает кегль текста редактора на один шаг. */
export function zoomOut(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent - ZOOM_STEP);
}

/** Возвращает масштаб к исходному значению и сохраняет это решение в настройках. */
export function resetZoom(view: EditorView): void {
  applyZoom(view, ZOOM_DEFAULT);
}

/** Возвращает текущий масштаб; полезно оболочке для состояния пункта меню. */
export function getZoom(view: EditorView): number {
  return ensureRuntime(view).percent;
}
