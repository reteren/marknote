<script lang="ts">
  import { onMount } from "svelte";
  import FormatPicker from "./FormatPicker.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { settingsState } from "../state/settings.svelte";
  import {
    recentFilesState,
    extractFileName,
    extractDirectory,
    formatOpenedAt,
  } from "../state/recentFiles.svelte";
  import { translate as t, interfaceLanguage } from "../i18n";

  type Props = {
    formats?: FormatCapabilities[];
    onSelect?: (format: FormatCapabilities) => void;
    onOpenFile?: () => void;
    onOpenPath?: (path: string) => void;
    onDrop?: (event: DragEvent) => void;
  };

  let { formats = [], onSelect, onOpenFile, onOpenPath, onDrop }: Props = $props();

  let showFormatPicker = $state(false);

  const isRecentFiles = $derived(settingsState.settings.windows.startupAction === "recentFiles");

  function getFileName(filePath: string): string {
    return extractFileName(filePath);
  }

  function getDirectory(filePath: string): string {
    return extractDirectory(filePath);
  }

  function getOpenedAt(timestamp: number): string {
    return formatOpenedAt(timestamp, interfaceLanguage.locale);
  }

  function preventDrag(event: DragEvent): void {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    onDrop?.(event);
  }

  onMount(() => {
    if (settingsState.settings.windows.startupAction === "recentFiles") {
      void recentFilesState.load();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="start-screen"
  aria-label={isRecentFiles ? t("start.recentFiles") : t("start.newDocument")}
  ondragover={preventDrag}
  ondrop={handleDrop}
>
  <div class="start-content">
    {#if isRecentFiles}
      <h1>{t("start.recentFiles")}</h1>

      {#if recentFilesState.items.length > 0}
        <div class="recent-files-list" role="list" aria-label={t("start.recentFiles")}>
          {#each recentFilesState.items as entry (entry.path)}
            <button
              type="button"
              class="recent-file-item"
              onclick={() => onOpenPath?.(entry.path)}
              title={entry.path}
            >
              <div class="recent-file-main">
                <span class="recent-file-name">{getFileName(entry.path)}</span>
                <span class="recent-file-date">{getOpenedAt(entry.openedAt)}</span>
              </div>
              <div class="recent-file-path">{getDirectory(entry.path)}</div>
            </button>
          {/each}
        </div>

        <div class="open-row">
          <button type="button" class="open-button" onclick={() => onOpenFile?.()}>{t("start.openFile")}</button>
          <button
            type="button"
            class="open-button secondary"
            onclick={() => (showFormatPicker = !showFormatPicker)}
          >
            {t("start.newDocument")}
          </button>
        </div>

        {#if showFormatPicker}
          <div class="format-picker-wrap">
            <FormatPicker mode="grid" {formats} onSelect={onSelect} />
          </div>
        {/if}
      {:else}
        <p class="empty-recent">{t("start.noRecentFiles")}</p>
        <div class="format-picker-wrap">
          <FormatPicker mode="grid" {formats} onSelect={onSelect} />
        </div>

        <div class="open-row">
          <button type="button" class="open-button" onclick={() => onOpenFile?.()}>{t("start.openFile")}</button>
          <span>{t("start.dropFile")}</span>
        </div>
      {/if}
    {:else}
      <h1>{t("app.name")}</h1>

      <div class="format-picker-wrap">
        <FormatPicker mode="grid" {formats} onSelect={onSelect} />
      </div>

      <div class="open-row">
        <button type="button" class="open-button" onclick={() => onOpenFile?.()}>{t("start.openFile")}</button>
        <span>{t("start.dropFile")}</span>
      </div>
    {/if}
  </div>
</section>

<style>
  .start-screen {
    position: absolute;
    inset: 0;
    /* Opaque: the screen lies over the empty editor, and without a background
       the active-line highlight would show through as a stripe across the screen. */
    background: var(--bg-primary);
    display: grid;
    place-items: center;
    overflow: auto;
    padding: 36px 24px;
    color: var(--text-muted);
    text-align: center;
  }

  .start-content {
    display: grid;
    justify-items: center;
    width: min(100%, 560px);
    gap: 10px;
    pointer-events: none;
  }
  .format-picker-wrap,
  .open-button,
  .recent-files-list {
    pointer-events: auto;
  }

  h1 {
    margin: 0;
    color: var(--text-normal);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .open-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .open-row > span {
    color: var(--text-faint);
  }
  .open-button {
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    padding: 6px 10px;
    background: var(--bg-secondary);
    color: var(--text-normal);
    font: inherit;
    cursor: pointer;
  }
  .open-button:hover {
    border-color: var(--bg-modifier-border-hover);
    background: var(--bg-modifier-hover);
  }
  .open-button:active {
    background: var(--bg-modifier-active);
  }
  .open-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .open-button.secondary {
    background: transparent;
    color: var(--text-muted);
  }
  .open-button.secondary:hover {
    color: var(--text-normal);
    background: var(--bg-modifier-hover);
  }

  .recent-files-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-height: 380px;
    overflow-y: auto;
    padding: 2px;
  }

  .recent-file-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    background: var(--bg-secondary);
    color: var(--text-normal);
    text-align: start;
    cursor: pointer;
    transition: background 0.1s ease, border-color 0.1s ease;
    font: inherit;
  }
  .recent-file-item:hover {
    background: var(--bg-modifier-hover);
    border-color: var(--bg-modifier-border-hover);
  }
  .recent-file-item:active {
    background: var(--bg-modifier-active);
  }
  .recent-file-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .recent-file-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .recent-file-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-file-date {
    font-size: 11px;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .recent-file-path {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: ltr;
  }

  .empty-recent {
    margin: 4px 0 12px;
    color: var(--text-muted);
  }

  @media (max-width: 560px) {
    .start-screen {
      padding: 24px 12px;
    }
  }
</style>
