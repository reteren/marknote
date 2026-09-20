import { Compartment, StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { settingsState, updateSettings } from "../state/settings.svelte";

/** Values are chosen to keep the working column intact and remain readable. */
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_STORAGE_KEY = "marknote.editor.zoom";

/** The zoom runtime belongs to one EditorView and is reused by its tab states.
 * The compartment itself must be present in every state, otherwise view.setState
 * cannot reconfigure zoom after switching tabs. */
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
    // localStorage may be disabled by the WebView privacy policy.
    return ZOOM_DEFAULT;
  }
}

function storeZoom(percent: number): void {
  try {
    globalThis.localStorage?.setItem(ZOOM_STORAGE_KEY, String(percent));
  } catch {
    // Persistence is optional and must not interfere with editing.
  }
}

function getInitialZoom(): number {
  // settings.json is the single source of zoom. Previously the value lived in
  // localStorage while settings held an inert copy: after a restart localStorage
  // won, and zoom did not travel with the settings file to another machine.
  if (settingsState.ready) return clampZoom(settingsState.settings.editor.zoomPercent);
  // Fallback for running outside Tauri — in tests and an ordinary browser where
  // settings do not exist at all. This is live code: without it the editor loses zoom there.
  return readStoredZoom();
}

export function zoomTheme(percent: number): Extension {
  const factor = percent / ZOOM_DEFAULT;
  return EditorView.theme({
    // The menu and status bar do not change: the selector is scoped to this editor.
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

/** Creates the zoom compartment before the first EditorState. */
export function createZoomRuntime(initialPercent?: number): ZoomRuntime {
  return {
    compartment: new Compartment(),
    percent: initialPercent === undefined ? getInitialZoom() : clampZoom(initialPercent),
  };
}

/** Adds the zoom compartment to the state's extension list. */
export function zoomRuntimeExtension(runtime: ZoomRuntime): Extension {
  return runtime.compartment.of(zoomTheme(runtime.percent));
}

/** Registers a pre-created runtime for a view. */
export function registerZoomRuntime(view: EditorView, runtime: ZoomRuntime): void {
  runtimes.set(view, runtime);
}

/** Synchronizes the zoom compartment after setState. */
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
  // Fallback for running outside Tauri; see getInitialZoom.
  storeZoom(next);
  // Settings writes are already delayed (scheduleSave), so a series of Ctrl+=
  // presses does not become a series of disk writes.
  if (syncSettings && settingsState.settings.editor.zoomPercent !== next) {
    updateSettings({ editor: { zoomPercent: next } });
  }
  view.dispatch({
    effects: runtime.compartment.reconfigure(zoomTheme(next)),
    selection: view.state.selection,
  });
}

/** Installs zoom and restores its value from settings (falling back to localStorage). */
export function installZoom(view: EditorView): number {
  ensureRuntime(view);
  return getZoom(view);
}

/** Sets the editor's exact zoom value. */
export function setZoomPercent(view: EditorView, percent: number, syncSettings = true): void {
  applyZoom(view, percent, syncSettings);
}

/** Increases the editor text size by one step. */
export function zoomIn(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent + ZOOM_STEP);
}

/** Decreases the editor text size by one step. */
export function zoomOut(view: EditorView): void {
  applyZoom(view, ensureRuntime(view).percent - ZOOM_STEP);
}

/** Restores the default zoom and persists that choice in settings. */
export function resetZoom(view: EditorView): void {
  applyZoom(view, ZOOM_DEFAULT);
}

/** Returns the current zoom; the shell uses it for the menu-item state. */
export function getZoom(view: EditorView): number {
  return ensureRuntime(view).percent;
}
