import { invoke } from "@tauri-apps/api/core";
import { normalizeLocale, setInterfaceLanguage } from "../i18n";

export type ColumnWidth = "narrow" | "normal" | "wide" | "fullWidth";
export type MarkupRevealMode = "cursor" | "line" | "never";
export type MaxImageWidth = "column";
export type NewDocumentEncoding = "utf8";
export type NewDocumentLineEnding = "system" | "lf" | "crlf";
export type StartupAction = "startScreen" | "recentFiles";

export type Settings = {
  language: string;
  spellcheck: {
    enabled: boolean;
    skipCodeFormulaLinks: boolean;
    dictionaries: string[];
    inlineSuggestions: boolean;
  };
  autoCorrect: {
    smartQuotes: boolean;
    doubleHyphenToEmDash: boolean;
    capitalizeAfterPeriod: boolean;
    threeDotsToEllipsis: boolean;
  };
  editor: {
    fontFamily: string;
    fontSize: number;
    zoomPercent: number;
    columnWidth: ColumnWidth;
    tabWidth: number;
    insertSpaces: boolean;
    softWrap: boolean;
    showInvisibles: boolean;
    lineNumbers: boolean;
  };
  livePreview: {
    enabled: boolean;
    revealMarkup: MarkupRevealMode;
    renderFormulas: boolean;
    renderImages: boolean;
    maxImageWidth: MaxImageWidth;
    disableAboveBytes: number;
  };
  files: {
    autosave: boolean;
    autosaveDelayMs: number;
    saveOnWindowBlur: boolean;
    newDocumentFormat: string;
    newDocumentEncoding: NewDocumentEncoding;
    newDocumentLineEnding: NewDocumentLineEnding;
    trimTrailingSpaces: boolean;
    finalNewline: boolean;
  };
  windows: {
    rememberSizeAndPosition: boolean;
    startupAction: StartupAction;
    raiseExistingWindow: boolean;
    openFilesInTabs: boolean;
  };
};

export type SettingsPatch = {
  language?: string;
  spellcheck?: Partial<Settings["spellcheck"]>;
  autoCorrect?: Partial<Settings["autoCorrect"]>;
  editor?: Partial<Settings["editor"]>;
  livePreview?: Partial<Settings["livePreview"]>;
  files?: Partial<Settings["files"]>;
  windows?: Partial<Settings["windows"]>;
};
type UpdateOptions = { persist?: boolean; applyLanguage?: boolean };

export type SettingsState = {
  settings: Settings;
  ready: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  resolvedLanguage: string;
  error: string | null;
};

export const defaultSettings: Settings = {
  language: "en",
  spellcheck: {
    enabled: true,
    skipCodeFormulaLinks: true,
    dictionaries: ["en"],
    inlineSuggestions: false,
  },
  autoCorrect: {
    smartQuotes: false,
    doubleHyphenToEmDash: false,
    capitalizeAfterPeriod: false,
    threeDotsToEllipsis: false,
  },
  editor: {
    // Defaults match the current appearance: --font-text is Inter in
    // src/styles/theme.css and --font-size-text is 16px. Otherwise an update
    // would silently recolor the font and change its size for anyone who had
    // never touched a setting.
    fontFamily: "system-sans",
    fontSize: 16,
    zoomPercent: 100,
    columnWidth: "normal",
    tabWidth: 4,
    insertSpaces: true,
    softWrap: true,
    showInvisibles: false,
    lineNumbers: false,
  },
  livePreview: {
    enabled: true,
    revealMarkup: "cursor",
    renderFormulas: true,
    renderImages: true,
    maxImageWidth: "column",
    disableAboveBytes: 5 * 1024 * 1024,
  },
  files: {
    autosave: true,
    autosaveDelayMs: 2_000,
    saveOnWindowBlur: true,
    newDocumentFormat: "markdown",
    newDocumentEncoding: "utf8",
    newDocumentLineEnding: "system",
    trimTrailingSpaces: false,
    finalNewline: false,
  },
  windows: {
    rememberSizeAndPosition: true,
    startupAction: "startScreen",
    raiseExistingWindow: true,
    openFilesInTabs: false,
  },
};

export const settingsState = $state<SettingsState>({
  settings: structuredClone(defaultSettings),
  ready: false,
  loading: false,
  saving: false,
  dirty: false,
  resolvedLanguage: "en",
  error: null,
});

const SAVE_DEBOUNCE_MS = 400;
let initialized = false;
let loadPromise: Promise<Settings> | null = null;
let savePromise: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let revision = 0;
let persistedRevision = 0;
let languagePreferenceRevision = 0;

const SPELLCHECK_DICTIONARY_TAGS = new Set(["en", "ru", "de", "es", "fr", "it", "pt", "ar"]);

export function normalizeSpellcheckDictionaries(values: readonly unknown[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().split("-")[0]?.toLowerCase();
    if (tag && SPELLCHECK_DICTIONARY_TAGS.has(tag)) normalized.add(tag);
  }
  return [...normalized];
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    spellcheck: {
      enabled: settings.spellcheck.enabled,
      skipCodeFormulaLinks: settings.spellcheck.skipCodeFormulaLinks,
      dictionaries: normalizeSpellcheckDictionaries(settings.spellcheck.dictionaries),
      inlineSuggestions: settings.spellcheck.inlineSuggestions,
    },
    autoCorrect: { ...settings.autoCorrect },
    editor: { ...settings.editor },
    livePreview: { ...settings.livePreview },
    files: { ...settings.files },
    windows: { ...settings.windows },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function applyLanguagePreference(language: string): Promise<void> {
  const request = ++languagePreferenceRevision;
  let resolved = language;
  if (language === "system") {
    try {
      resolved = await invoke<string>("get_resolved_language");
    } catch {
      resolved = "en";
    }
  }
  if (request !== languagePreferenceRevision) return;
  const locale = normalizeLocale(resolved);
  settingsState.resolvedLanguage = locale;
  await setInterfaceLanguage(locale);
}

/** Read settings once from Rust and apply the resolved UI language. */
export function loadSettings(): Promise<Settings> {
  if (initialized) return Promise.resolve(settingsState.settings);
  if (loadPromise) return loadPromise;

  settingsState.loading = true;
  loadPromise = (async () => {
    try {
      const settings = await invoke<Settings>("get_settings");
      updateSettings(settings, { persist: false, applyLanguage: false });
      await applyLanguagePreference(settingsState.settings.language);
      settingsState.error = null;
    } catch (error) {
      settingsState.settings = cloneSettings(defaultSettings);
      settingsState.resolvedLanguage = "en";
      await setInterfaceLanguage("en");
      settingsState.error = errorText(error);
    } finally {
      initialized = true;
      settingsState.ready = true;
      settingsState.loading = false;
      loadPromise = null;
    }
    return settingsState.settings;
  })();
  return loadPromise;
}

function scheduleSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushSettings();
  }, SAVE_DEBOUNCE_MS);
}

/** Apply a settings patch immediately; persistence is debounced to coalesce rapid edits. */
export function updateSettings(patch: SettingsPatch, options: UpdateOptions = {}): Settings {
  const previousLanguage = settingsState.settings.language;
  const previous = settingsState.settings;
  const spellcheckPatch = patch.spellcheck ?? {};
  const mergedSpellcheck = {
    enabled: typeof spellcheckPatch.enabled === "boolean" ? spellcheckPatch.enabled : previous.spellcheck.enabled,
    skipCodeFormulaLinks: typeof spellcheckPatch.skipCodeFormulaLinks === "boolean"
      ? spellcheckPatch.skipCodeFormulaLinks
      : previous.spellcheck.skipCodeFormulaLinks,
    dictionaries: normalizeSpellcheckDictionaries(
      Array.isArray(spellcheckPatch.dictionaries) ? spellcheckPatch.dictionaries : previous.spellcheck.dictionaries,
    ),
    inlineSuggestions: typeof spellcheckPatch.inlineSuggestions === "boolean"
      ? spellcheckPatch.inlineSuggestions
      : previous.spellcheck.inlineSuggestions,
  };
  settingsState.settings = {
    ...previous,
    ...patch,
    spellcheck: mergedSpellcheck,
    autoCorrect: { ...previous.autoCorrect, ...patch.autoCorrect },
    editor: { ...previous.editor, ...patch.editor },
    livePreview: { ...previous.livePreview, ...patch.livePreview },
    files: { ...previous.files, ...patch.files },
    windows: { ...previous.windows, ...patch.windows },
  };
  if (options.persist !== false) {
    revision += 1;
    settingsState.dirty = true;
  }
  settingsState.error = null;
  if (options.applyLanguage !== false && settingsState.settings.language !== previousLanguage) {
    void applyLanguagePreference(settingsState.settings.language).catch((error: unknown) => {
      settingsState.error = errorText(error);
    });
  }
  if (options.persist !== false) scheduleSave();
  return settingsState.settings;
}

/** Flush queued changes; writes are serialized and the latest revision is never overwritten. */
export async function flushSettings(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!settingsState.ready) await loadSettings();
  if (savePromise) await savePromise;
  if (persistedRevision >= revision) return;

  const targetRevision = revision;
  const snapshot = cloneSettings(settingsState.settings);
  settingsState.saving = true;
  settingsState.dirty = true;
  savePromise = invoke<Settings>("save_settings", { settings: snapshot })
    .then((saved) => {
      persistedRevision = targetRevision;
      if (revision === targetRevision) {
        settingsState.settings = saved;
        settingsState.dirty = false;
      }
      settingsState.error = null;
    })
    .catch((error: unknown) => {
      settingsState.error = errorText(error);
      // Keep dirty set so a later retry cannot silently lose the pending change.
    })
    .finally(() => {
      settingsState.saving = false;
      savePromise = null;
    });
  await savePromise;

  if (persistedRevision < revision && settingsState.error === null) {
    await flushSettings();
  }
}

// Importing the settings state from the application starts its single IPC read.
void loadSettings();
