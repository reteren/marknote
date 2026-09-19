<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, tick } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { getZoom, installZoom, resetZoom, setZoomPercent, zoomIn, zoomOut } from "../editor/zoom";
  import { formatLabel, translate as t } from "../i18n";
  import {
    defaultSettings,
    flushSettings,
    loadSettings,
    settingsState,
    updateSettings,
    type Settings,
    type SettingsPatch,
  } from "../state/settings.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { recentFilesState } from "../state/recentFiles.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import packageInfo from "../../package.json";

  type SectionId = "language" | "editor" | "preview" | "spelling" | "files" | "windows" | "other";
  type Option = { value: string; labelKey: string };
  type Descriptor = {
    path: string;
    type: "toggle" | "number" | "select" | "fixed";
    titleKey: string;
    descriptionKey?: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    options?: Option[];
    display?: string;
  };
  type Section = { id: SectionId; labelKey: string; rowPaths: string[] };

  const languageOptions: Option[] = [
    { value: "system", labelKey: "settings.language.system" },
    { value: "en", labelKey: "settings.language.name.en" },
    { value: "ru", labelKey: "settings.language.name.ru" },
    { value: "de", labelKey: "settings.language.name.de" },
    { value: "es", labelKey: "settings.language.name.es" },
    { value: "pt", labelKey: "settings.language.name.pt" },
    { value: "it", labelKey: "settings.language.name.it" },
    { value: "fr", labelKey: "settings.language.name.fr" },
    { value: "zh", labelKey: "settings.language.name.zh" },
    { value: "ja", labelKey: "settings.language.name.ja" },
    { value: "ar", labelKey: "settings.language.name.ar" },
  ];

  const descriptors: Descriptor[] = [
    { path: "language", type: "select", titleKey: "settings.language.interface", descriptionKey: "settings.language.interfaceDescription", options: languageOptions },
    { path: "editor.fontFamily", type: "select", titleKey: "settings.editor.fontFamily", descriptionKey: "settings.editor.fontFamilyDescription", options: [
      { value: "system-serif", labelKey: "settings.editor.font.systemSerif" },
      { value: "system-sans", labelKey: "settings.editor.font.systemSans" },
      { value: "monospace", labelKey: "settings.editor.font.monospace" },
    ] },
    { path: "editor.fontSize", type: "number", titleKey: "settings.editor.fontSize", min: 8, max: 48, step: 1, unit: "settings.unit.px" },
    { path: "editor.zoomPercent", type: "number", titleKey: "settings.editor.zoom", descriptionKey: "settings.editor.zoomDescription", min: 50, max: 200, step: 10, unit: "settings.unit.percent" },
    { path: "editor.columnWidth", type: "select", titleKey: "settings.editor.columnWidth", descriptionKey: "settings.editor.columnWidthDescription", options: [
      { value: "narrow", labelKey: "settings.editor.column.narrow" },
      { value: "normal", labelKey: "settings.editor.column.normal" },
      { value: "wide", labelKey: "settings.editor.column.wide" },
      { value: "fullWidth", labelKey: "settings.editor.column.fullWidth" },
    ] },
    { path: "editor.tabWidth", type: "number", titleKey: "settings.editor.tabWidth", descriptionKey: "settings.editor.tabWidthDescription", min: 1, max: 16, step: 1 },
    { path: "editor.insertSpaces", type: "toggle", titleKey: "settings.editor.insertSpaces", descriptionKey: "settings.editor.insertSpacesDescription" },
    { path: "editor.softWrap", type: "toggle", titleKey: "settings.editor.softWrap" },
    { path: "editor.showInvisibles", type: "toggle", titleKey: "settings.editor.showInvisibles", descriptionKey: "settings.editor.showInvisiblesDescription" },
    { path: "editor.lineNumbers", type: "toggle", titleKey: "settings.editor.lineNumbers" },
    { path: "livePreview.enabled", type: "toggle", titleKey: "settings.preview.enabled" },
    { path: "livePreview.revealMarkup", type: "select", titleKey: "settings.preview.revealMarkup", descriptionKey: "settings.preview.revealMarkupDescription", options: [
      { value: "cursor", labelKey: "settings.preview.reveal.cursor" },
      { value: "line", labelKey: "settings.preview.reveal.line" },
      { value: "never", labelKey: "settings.preview.reveal.never" },
    ] },
    { path: "livePreview.renderFormulas", type: "toggle", titleKey: "settings.preview.renderFormulas" },
    { path: "livePreview.renderImages", type: "toggle", titleKey: "settings.preview.renderImages" },
    { path: "livePreview.maxImageWidth", type: "fixed", titleKey: "settings.preview.maxImageWidth", display: "settings.preview.maxImageWidthColumn" },
    { path: "livePreview.disableAboveBytes", type: "number", titleKey: "settings.preview.disableAbove", descriptionKey: "settings.preview.disableAboveDescription", min: 1, max: 100, step: 1, unit: "settings.unit.megabytes" },
    { path: "spellcheck.enabled", type: "toggle", titleKey: "settings.spelling.enabled", descriptionKey: "settings.spelling.enabledDescription" },
    { path: "spellcheck.skipCodeFormulaLinks", type: "toggle", titleKey: "settings.spelling.skipCodeFormulaLinks", descriptionKey: "settings.spelling.skipCodeFormulaLinksDescription" },
    { path: "autoCorrect.smartQuotes", type: "toggle", titleKey: "settings.spelling.smartQuotes" },
    { path: "autoCorrect.doubleHyphenToEmDash", type: "toggle", titleKey: "settings.spelling.doubleHyphenToEmDash" },
    { path: "autoCorrect.capitalizeAfterPeriod", type: "toggle", titleKey: "settings.spelling.capitalizeAfterPeriod" },
    { path: "autoCorrect.threeDotsToEllipsis", type: "toggle", titleKey: "settings.spelling.threeDotsToEllipsis" },
    { path: "files.autosave", type: "toggle", titleKey: "settings.files.autosave" },
    { path: "files.autosaveDelayMs", type: "number", titleKey: "settings.files.autosaveDelay", min: 0.25, max: 60, step: 0.25, unit: "settings.unit.seconds" },
    { path: "files.saveOnWindowBlur", type: "toggle", titleKey: "settings.files.saveOnWindowBlur" },
    { path: "files.newDocumentFormat", type: "select", titleKey: "settings.files.newDocumentFormat", descriptionKey: "settings.files.newDocumentFormatDescription", options: [] },
    { path: "files.newDocumentEncoding", type: "fixed", titleKey: "settings.files.newDocumentEncoding", display: "settings.files.utf8NoBom" },
    { path: "files.newDocumentLineEnding", type: "select", titleKey: "settings.files.newDocumentLineEnding", options: [
      { value: "system", labelKey: "settings.files.lineEnding.system" },
      { value: "lf", labelKey: "settings.files.lineEnding.lf" },
      { value: "crlf", labelKey: "settings.files.lineEnding.crlf" },
    ] },
    { path: "files.trimTrailingSpaces", type: "toggle", titleKey: "settings.files.trimTrailingSpaces" },
    { path: "files.finalNewline", type: "toggle", titleKey: "settings.files.finalNewline" },
    { path: "windows.rememberSizeAndPosition", type: "toggle", titleKey: "settings.windows.rememberSizeAndPosition" },
    { path: "windows.startupAction", type: "select", titleKey: "settings.windows.startupAction", options: [
      { value: "startScreen", labelKey: "settings.windows.startup.startScreen" },
      { value: "recentFiles", labelKey: "settings.windows.startup.recentFiles" },
    ] },
    { path: "windows.raiseExistingWindow", type: "toggle", titleKey: "settings.windows.raiseExistingWindow" },
  ];

  const sections: Section[] = [
    { id: "language", labelKey: "settings.section.language", rowPaths: ["language"] },
    { id: "editor", labelKey: "settings.section.editor", rowPaths: descriptors.filter((item) => item.path.startsWith("editor.")).map((item) => item.path) },
    { id: "preview", labelKey: "settings.section.preview", rowPaths: descriptors.filter((item) => item.path.startsWith("livePreview.")).map((item) => item.path) },
    { id: "spelling", labelKey: "settings.section.spelling", rowPaths: descriptors.filter((item) => item.path.startsWith("spellcheck.") || item.path.startsWith("autoCorrect.")).map((item) => item.path) },
    { id: "files", labelKey: "settings.section.files", rowPaths: descriptors.filter((item) => item.path.startsWith("files.")).map((item) => item.path) },
    { id: "windows", labelKey: "settings.section.windows", rowPaths: descriptors.filter((item) => item.path.startsWith("windows.")).map((item) => item.path) },
    { id: "other", labelKey: "settings.section.other", rowPaths: [] },
  ];

  const version = packageInfo.version;

  type Props = {
    onClose: () => void;
    onFocusEditor?: () => void;
    editorView?: EditorView | null;
  };
  let { onClose, onFocusEditor, editorView = null }: Props = $props();

  let dialogElement: HTMLDivElement | undefined = $state();
  let activeSection = $state<SectionId>("language");
  let searchQuery = $state("");
  let creatableFormats = $state<FormatCapabilities[]>([]);
  let resetConfirmationOpen = $state(false);
  let resetError = $state(false);
  let copiedVersion = $state(false);
  let settingsFileError = $state(false);
  let recentFilesCleared = $state(false);
  let zoomView = $derived(editorView);
  let matchingSections = $state<Section[]>(sections);

  async function handleClearRecentFiles(): Promise<void> {
    await recentFilesState.clear();
    recentFilesCleared = true;
    setTimeout(() => {
      recentFilesCleared = false;
    }, 2000);
  }

  function settingValue(path: string): unknown {
    return path.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], settingsState.settings as unknown);
  }

  function defaultValue(path: string): unknown {
    return path.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], defaultSettings as unknown);
  }

  function isModified(path: string): boolean {
    return JSON.stringify(settingValue(path)) !== JSON.stringify(defaultValue(path));
  }

  function updatePath(path: string, value: unknown, persist = true): void {
    const parts = path.split(".");
    if (parts.length === 1) {
      updateSettings({ [parts[0]]: value } as SettingsPatch, { persist });
      return;
    }
    const [group, field] = parts;
    updateSettings({ [group]: { [field]: value } } as SettingsPatch, { persist });
  }

  function resetPath(path: string): void {
    const value = defaultValue(path);
    if (path === "editor.zoomPercent" && editorView) applyZoomValue(Number(value));
    else updatePath(path, value);
  }

  function updateDescriptor(descriptor: Descriptor, rawValue: string | boolean): void {
    let value: unknown = rawValue;
    if (descriptor.type === "number") {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      const bounded = Math.min(descriptor.max ?? Number.MAX_SAFE_INTEGER, Math.max(descriptor.min ?? 0, numeric));
      value = descriptor.path === "files.autosaveDelayMs" ? Math.round(bounded * 1000) : bounded;
    }
    if (descriptor.path === "livePreview.disableAboveBytes") value = Number(value) * 1024 * 1024;
    if (descriptor.path === "editor.zoomPercent") {
      value = Math.min(200, Math.max(50, Math.round(Number(value) / 10) * 10));
      if (editorView) {
        applyZoomValue(Number(value));
        return;
      }
    }
    updatePath(descriptor.path, value);
  }

  function displayedValue(descriptor: Descriptor): string | number | boolean {
    const value = settingValue(descriptor.path);
    if (descriptor.path === "files.autosaveDelayMs") return Number(value) / 1000;
    if (descriptor.path === "livePreview.disableAboveBytes") return Number(value) / (1024 * 1024);
    if (descriptor.path === "editor.zoomPercent") return settingsState.settings.editor.zoomPercent;
    return value as string | number | boolean;
  }

  function applyZoomValue(target: number): void {
    if (!editorView) return;
    setZoomPercent(editorView, target);
  }

  function matches(path: string, query = searchQuery): boolean {
    const descriptor = descriptors.find((item) => item.path === path);
    if (!descriptor) return false;
    const text = `${t(descriptor.titleKey)} ${descriptor.descriptionKey ? t(descriptor.descriptionKey) : ""}`.toLocaleLowerCase();
    return !query.trim() || text.includes(query.trim().toLocaleLowerCase());
  }

  function sectionHasMatch(id: SectionId, query = searchQuery): boolean {
    if (!query.trim()) return true;
    const section = sections.find((item) => item.id === id);
    if (!section) return false;
    return section.rowPaths.some((path) => matches(path, query));
  }

  function setSearchQuery(value: string): void {
    searchQuery = value;
    matchingSections = sections.filter((section) => sectionHasMatch(section.id, value));
    if (value.trim() && !matchingSections.some((section) => section.id === activeSection)) {
      activeSection = matchingSections[0]?.id ?? "language";
    }
  }

  function visibleRows(id: SectionId): Descriptor[] {
    const section = sections.find((item) => item.id === id);
    if (!section) return [];
    return section.rowPaths
      .map((path) => descriptors.find((item) => item.path === path))
      .filter((item): item is Descriptor => item !== undefined && matches(item.path));
  }

  function changeSectionByKey(event: KeyboardEvent, section: SectionId): void {
    const visible = matchingSections;
    const current = Math.max(0, visible.findIndex((item) => item.id === section));
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (current + 1) % visible.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (current - 1 + visible.length) % visible.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visible.length - 1;
    else return;
    event.preventDefault();
    activeSection = visible[next]?.id ?? section;
    void tick().then(() => document.querySelector<HTMLButtonElement>(`[data-settings-tab="${activeSection}"]`)?.focus());
  }

  function trapTab(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (resetConfirmationOpen) {
        resetConfirmationOpen = false;
        void tick().then(() => dialogElement?.querySelector<HTMLButtonElement>("[data-reset-trigger]")?.focus());
      }
      else closeWindow();
      return;
    }
    if (event.key !== "Tab" || !dialogElement) return;
    const focusRoot = resetConfirmationOpen
      ? dialogElement.querySelector<HTMLElement>(".confirm-dialog") ?? dialogElement
      : dialogElement;
    const focusables = [...focusRoot.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeWindow(): void {
    void flushSettings();
    onClose();
    onFocusEditor?.();
  }

  async function showSettingsFile(): Promise<void> {
    settingsFileError = false;
    try {
      await invoke("reveal_settings_file");
    } catch {
      settingsFileError = true;
    }
  }

  async function copyAppVersion(): Promise<void> {
    try {
      await navigator.clipboard.writeText(version);
      copiedVersion = true;
      setTimeout(() => copiedVersion = false, 1600);
    } catch {
      copiedVersion = false;
    }
  }

  async function confirmResetAll(): Promise<void> {
    resetError = false;
    try {
      const settings = await invoke<Settings>("reset_settings");
      updateSettings(settings, { persist: false, applyLanguage: true });
      if (editorView) resetZoom(editorView);
      resetConfirmationOpen = false;
    } catch {
      resetError = true;
    }
  }

  function openResetConfirmation(): void {
    resetError = false;
    resetConfirmationOpen = true;
    void tick().then(() => dialogElement?.querySelector<HTMLButtonElement>(".confirm-dialog button")?.focus());
  }

  function cancelResetConfirmation(): void {
    resetConfirmationOpen = false;
    resetError = false;
    void tick().then(() => dialogElement?.querySelector<HTMLButtonElement>("[data-reset-trigger]")?.focus());
  }

  onMount(() => {
    void loadSettings();
    void invoke<FormatCapabilities[]>("list_creatable_formats")
      .then((formats) => { creatableFormats = Array.isArray(formats) ? formats.filter((item) => item.creatable) : []; })
      .catch(() => { creatableFormats = []; });
    void tick().then(() => dialogElement?.focus());
  });
</script>

<div class="settings-backdrop" onclick={(event) => { if (event.target === event.currentTarget) closeWindow(); }} role="presentation">
  <div
    class="settings-window"
    bind:this={dialogElement}
    role="dialog"
    aria-modal="true"
    aria-label={t("settings.title")}
    tabindex="-1"
    onkeydown={trapTab}
  >
    <header class="settings-header">
      <h1>{t("settings.title")}</h1>
      <label class="search-wrap">
        <span class="sr-only">{t("settings.search")}</span>
        <input
          type="search"
          value={searchQuery}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.search")}
          oninput={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </label>
      <button type="button" class="icon-button" aria-label={t("settings.close")} title={t("settings.close")} onclick={closeWindow}>×</button>
    </header>

    <div class="settings-body">
      <div class="section-nav" role="tablist" aria-label={t("settings.sections")} aria-orientation="vertical">
        {#each matchingSections as section (section.id)}
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            aria-controls={`settings-panel-${section.id}`}
            tabindex={activeSection === section.id ? 0 : -1}
            data-settings-tab={section.id}
            class:active={activeSection === section.id}
            onclick={() => activeSection = section.id}
            onkeydown={(event) => changeSectionByKey(event, section.id)}
          >{t(section.labelKey)}</button>
        {/each}
      </div>

      <div class="settings-content" id={`settings-panel-${activeSection}`} role="tabpanel" aria-label={t(sections.find((item) => item.id === activeSection)?.labelKey ?? "settings.title")}>
        {#if activeSection === "other"}
          <div class="other-actions">
            <div class="action-copy">
              <h2>{t("settings.other.settingsFile")}</h2>
              <p>{t("settings.other.settingsFileDescription")}</p>
              {#if settingsFileError}<span class="error-message" role="status">{t("settings.other.settingsFileError")}</span>{/if}
            </div>
            <button type="button" onclick={showSettingsFile}>{t("settings.other.revealSettingsFile")}</button>
          </div>
          <div class="other-actions">
            <div class="action-copy">
              <h2>{t("settings.other.version")}</h2>
              <p>{t("settings.other.versionDescription")}</p>
              <span class="version-number">{version}</span>
            </div>
            <button type="button" onclick={copyAppVersion} aria-live="polite">{copiedVersion ? t("settings.other.copied") : t("settings.other.copyVersion")}</button>
          </div>
          <div class="other-actions reset-action">
            <div class="action-copy">
              <h2>{t("settings.other.resetAll")}</h2>
              <p>{t("settings.other.resetAllDescription")}</p>
            </div>
            <button type="button" class="danger-button" data-reset-trigger onclick={openResetConfirmation}>{t("settings.other.resetAll")}</button>
          </div>
          {#if resetConfirmationOpen}
            <div class="confirm-layer">
              <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-reset-title" aria-describedby="settings-reset-description">
                <h2 id="settings-reset-title">{t("settings.other.resetAllConfirmation")}</h2>
                <p id="settings-reset-description">{t("settings.other.resetAllWarning")}</p>
                {#if resetError}<p class="error-message" role="alert">{t("settings.other.resetFailed")}</p>{/if}
                <div class="confirm-actions">
                  <button type="button" onclick={cancelResetConfirmation}>{t("settings.cancel")}</button>
                  <button type="button" class="danger-button" onclick={confirmResetAll}>{t("settings.other.resetAll")}</button>
                </div>
              </div>
            </div>
          {/if}
        {:else}
          {@const rows = visibleRows(activeSection)}
          {#each rows as descriptor (descriptor.path)}
            <SettingRow
              id={`settings-${descriptor.path}`}
              title={t(descriptor.titleKey)}
              description={descriptor.descriptionKey ? t(descriptor.descriptionKey) : undefined}
              changed={isModified(descriptor.path)}
              modifiedLabel={t("settings.modified")}
              resetLabel={t("settings.resetValue")}
              onReset={() => resetPath(descriptor.path)}
            >
              {#if descriptor.type === "toggle"}
                <input
                  type="checkbox"
                  class="toggle-input"
                  checked={Boolean(settingValue(descriptor.path))}
                  aria-label={t(descriptor.titleKey)}
                  onchange={(event) => updateDescriptor(descriptor, event.currentTarget.checked)}
                />
              {:else if descriptor.type === "number"}
                <label class="numeric-control">
                  <span class="sr-only">{t(descriptor.titleKey)}</span>
                  <input
                    type="number"
                    min={descriptor.min}
                    max={descriptor.max}
                    step={descriptor.step}
                    value={displayedValue(descriptor)}
                    aria-label={t(descriptor.titleKey)}
                    onchange={(event) => updateDescriptor(descriptor, event.currentTarget.value)}
                  />
                  {#if descriptor.unit}<span>{t(descriptor.unit)}</span>{/if}
                </label>
              {:else if descriptor.type === "select"}
                {#if descriptor.path === "windows.startupAction"}
                  <div class="startup-action-control">
                    <select
                      value={String(settingValue(descriptor.path))}
                      aria-label={t(descriptor.titleKey)}
                      onchange={(event) => updateDescriptor(descriptor, event.currentTarget.value)}
                    >
                      {#each descriptor.options ?? [] as option (option.value)}
                        <option value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      {/each}
                    </select>
                    <button
                      type="button"
                      class="clear-recent-button"
                      onclick={handleClearRecentFiles}
                      title={t("settings.windows.clearRecentFiles")}
                    >
                      {recentFilesCleared ? t("settings.windows.recentFilesCleared") : t("settings.windows.clearRecentFiles")}
                    </button>
                  </div>
                {:else}
                  <select
                    value={String(settingValue(descriptor.path))}
                    aria-label={t(descriptor.titleKey)}
                    onchange={(event) => updateDescriptor(descriptor, event.currentTarget.value)}
                  >
                    {#if descriptor.path === "files.newDocumentFormat"}
                      {#each creatableFormats as format (format.id)}
                        <option value={format.id}>{formatLabel(format.id, format.label)}</option>
                      {/each}
                      {#if creatableFormats.length === 0}<option value="markdown">{formatLabel("markdown", "Markdown")}</option>{/if}
                    {:else}
                      {#each descriptor.options ?? [] as option (option.value)}
                        <option value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      {/each}
                    {/if}
                  </select>
                {/if}
              {:else}
                <span class="fixed-value">{t(descriptor.display ?? "settings.value.fixed")}</span>
              {/if}
            </SettingRow>
          {/each}

          {#if rows.length === 0}
            <p class="empty-search">{t("settings.noResults")}</p>
          {/if}
        {/if}
      </div>
    </div>

    <footer class="settings-footer">
      <span class="save-state" role="status">{settingsState.saving ? t("settings.saving") : settingsState.dirty ? t("settings.pendingSave") : t("settings.saved")}</span>
      <span class="footer-spacer"></span>
      <button type="button" onclick={closeWindow}>{t("settings.close")}</button>
    </footer>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg-secondary-alt);
  }

  .settings-window {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(900px, 100%);
    height: min(700px, 100%);
    min-height: 420px;
    overflow: hidden;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    background: var(--bg-primary);
    color: var(--text-normal);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    box-shadow: 0 12px 42px var(--bg-secondary-alt);
    outline: none;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 58px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--bg-modifier-border);
  }

  .settings-header h1 {
    flex: none;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .search-wrap { flex: 1; min-width: 80px; }

  input, select, button {
    color: var(--text-normal);
    font: inherit;
  }

  .search-wrap input, select, input[type="number"] {
    min-height: 32px;
    padding: 6px 9px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: var(--bg-secondary);
  }

  .search-wrap input { width: 100%; }
  input::placeholder { color: var(--text-faint); }

  button {
    min-height: 32px;
    padding: 6px 10px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: var(--bg-secondary);
    cursor: pointer;
  }

  button:hover { border-color: var(--bg-modifier-border-hover); background: var(--bg-modifier-hover); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .icon-button { width: 32px; padding: 0; font-size: 20px; line-height: 1; }

  .settings-body {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  .section-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    padding: 14px 10px;
    border-inline-end: 1px solid var(--bg-modifier-border);
    background: var(--bg-secondary);
  }

  .section-nav button { border-color: transparent; background: transparent; text-align: start; }
  .section-nav button.active { border-color: var(--bg-modifier-border); background: var(--bg-modifier-hover); color: var(--text-accent); }

  .settings-content { position: relative; min-width: 0; overflow: auto; padding: 8px 24px 24px; }
  .toggle-input { cursor: pointer; }
  .numeric-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .numeric-control input { width: 90px; }
  .numeric-control span, .fixed-value { color: var(--text-muted); white-space: nowrap; }
  .settings-content select { width: 100%; max-width: 260px; }
  .startup-action-control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .startup-action-control select { flex: 1 1 140px; min-width: 120px; }
  .clear-recent-button { flex: 0 0 auto; font-size: 12px; white-space: nowrap; }

  .settings-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 8px 18px;
    border-top: 1px solid var(--bg-modifier-border);
    background: var(--bg-secondary);
  }

  .save-state { color: var(--text-muted); }
  .footer-spacer { flex: 1; }
  .empty-search { padding: 16px 0; color: var(--text-muted); }
  .other-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--bg-modifier-border); }
  .action-copy { min-width: 0; }
  .action-copy h2 { margin: 0; font-size: 14px; font-weight: 600; }
  .action-copy p { margin: 5px 0 0; color: var(--text-muted); }
  .version-number { display: inline-block; margin-top: 6px; color: var(--text-muted); font-family: var(--font-mono); }
  .error-message { display: block; margin-top: 5px; color: var(--text-error); }
  .danger-button { color: var(--text-error); }
  .confirm-layer { position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; padding: 20px; background: var(--bg-secondary-alt); }
  .confirm-dialog { width: min(400px, 100%); padding: 20px; border: 1px solid var(--bg-modifier-border); border-radius: var(--radius-m); background: var(--bg-primary); box-shadow: 0 8px 30px var(--bg-secondary-alt); }
  .confirm-dialog h2 { margin: 0; font-size: 16px; }
  .confirm-dialog p { color: var(--text-muted); line-height: 1.5; }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

  @media (max-width: 680px) {
    .settings-backdrop { padding: 8px; }
    .settings-window { height: 100%; min-height: 0; }
    .settings-header { gap: 8px; padding-inline: 10px; }
    .settings-body { grid-template-columns: 132px minmax(0, 1fr); }
    .settings-content { padding-inline: 14px; }
  }

  @media (max-width: 470px) {
    .settings-header { flex-wrap: wrap; }
    .settings-header h1 { flex: 1; }
    .search-wrap { order: 3; flex-basis: 100%; }
    .settings-body { grid-template-columns: 112px minmax(0, 1fr); }
    .other-actions { align-items: flex-start; flex-direction: column; }
  }
</style>
