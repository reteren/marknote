<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { formatLabel, translate as t } from "../i18n";

  export type FormatPickerMode = "grid" | "list" | "menu" | "dropdown";

  type Props = {
    mode?: FormatPickerMode;
    formats?: FormatCapabilities[];
    selectedId?: string | null;
    showMoreThreshold?: number;
    onSelect?: (format: FormatCapabilities) => void;
    onClose?: () => void;
  };

  const defaultMarkdown: FormatCapabilities = {
    id: "markdown",
    label: "Markdown",
    defaultExtension: "md",
    extensions: ["md", "markdown", "mdown", "mkd"],
    editable: true,
    creatable: true,
    livePreview: true,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
  };

  const defaultPlain: FormatCapabilities = {
    id: "plain",
    label: "Plain Text",
    defaultExtension: "txt",
    extensions: ["txt", "text"],
    editable: true,
    creatable: true,
    livePreview: false,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
  };

  let {
    mode = "grid",
    formats: propFormats,
    selectedId = null,
    showMoreThreshold = 8,
    onSelect,
    onClose,
  }: Props = $props();

  let loadedFormats = $state<FormatCapabilities[]>([]);
  let showMore = $state(false);

  const availableFormats = $derived.by<FormatCapabilities[]>(() => {
    const list = propFormats && propFormats.length > 0 ? propFormats : loadedFormats;
    if (list.length === 0) return [defaultMarkdown, defaultPlain];
    return list.filter((format) => format.creatable !== false);
  });

  const shouldCollapse = $derived(availableFormats.length > showMoreThreshold);

  const primaryFormats = $derived(
    shouldCollapse && !showMore
      ? availableFormats.slice(0, showMoreThreshold)
      : availableFormats,
  );

  onMount(() => {
    if (!propFormats || propFormats.length === 0) {
      void invoke<FormatCapabilities[]>("list_creatable_formats")
        .then((items) => {
          if (Array.isArray(items) && items.length > 0) {
            loadedFormats = items;
          } else {
            loadedFormats = [defaultMarkdown, defaultPlain];
          }
        })
        .catch(() => {
          loadedFormats = [defaultMarkdown, defaultPlain];
        });
    }
  });

  function handleSelect(format: FormatCapabilities): void {
    onSelect?.(format);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="format-picker"
  class:mode-grid={mode === "grid"}
  class:mode-list={mode === "list" || mode === "menu"}
  class:mode-dropdown={mode === "dropdown"}
  role="region"
  aria-label={t("formatPicker.choose")}
  onkeydown={handleKeyDown}
>
  {#if mode === "grid"}
    <div class="grid-container" role="grid" aria-label={t("formatPicker.grid")}>
      {#each primaryFormats as format (format.id)}
        <button
          type="button"
          role="gridcell"
          class="tile"
          class:selected={selectedId === format.id}
          onclick={() => handleSelect(format)}
        >
          <span class="tile-label">{formatLabel(format.id, format.label)}</span>
          <span class="tile-ext">.{format.defaultExtension}</span>
        </button>
      {/each}

      {#if shouldCollapse}
        <button
          type="button"
          role="gridcell"
          class="tile tile-more"
          onclick={() => { showMore = !showMore; }}
          aria-expanded={showMore}
        >
          <span class="tile-label">{showMore ? t("formatPicker.less") : t("formatPicker.more")}</span>
          <span class="tile-arrow">{showMore ? "▴" : "▾"}</span>
        </button>
      {/if}
    </div>
  {:else}
    <div
      class="list-container"
      role="menu"
      aria-label={t("formatPicker.list")}
    >
      {#each primaryFormats as format (format.id)}
        <button
          type="button"
          role="menuitem"
          class="list-item"
          class:selected={selectedId === format.id}
          onclick={() => handleSelect(format)}
        >
          <span class="item-label">
            {#if selectedId === format.id}
              <span class="checkmark" aria-hidden="true">✓ </span>
            {/if}
            {formatLabel(format.id, format.label)}
          </span>
          <span class="item-ext">.{format.defaultExtension}</span>
        </button>
      {/each}

      {#if shouldCollapse}
        <button
          type="button"
          role="menuitem"
          class="list-item list-more"
          onclick={() => { showMore = !showMore; }}
          aria-expanded={showMore}
        >
          <span class="item-label">{showMore ? t("formatPicker.less") : t("formatPicker.more")}</span>
          <span class="item-arrow">{showMore ? "▴" : "▾"}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .format-picker {
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    color: var(--text-normal);
  }

  /* Grid mode (стартовый экран) */
  .grid-container {
    display: grid;
    grid-template-columns: repeat(3, minmax(100px, 140px));
    gap: 8px;
    justify-content: center;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 76px;
    padding: 12px 8px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    background: var(--bg-secondary);
    color: var(--text-normal);
    font: inherit;
    cursor: pointer;
    outline: none;
    transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
  }

  .tile:hover {
    background: var(--bg-modifier-hover);
    border-color: var(--bg-modifier-border-hover);
    transform: translateY(-1px);
  }

  .tile:active {
    background: var(--bg-modifier-active);
    transform: translateY(0);
  }

  .tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .tile.selected {
    border-color: var(--accent);
    background: var(--bg-modifier-active);
  }

  .tile-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-normal);
  }

  .tile-ext {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-faint);
  }

  .tile-more {
    border-style: dashed;
    color: var(--text-muted);
  }

  .tile-arrow {
    font-size: 12px;
    color: var(--text-faint);
  }

  /* List / Menu / Dropdown modes */
  .list-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 180px;
    max-height: 360px;
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    font-size: var(--font-size-ui);
    text-align: start;
    cursor: pointer;
    outline: none;
    transition: background 0.08s ease;
  }

  .list-item:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .list-item:active {
    background: var(--bg-modifier-active);
  }

  .list-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .list-item.selected {
    color: var(--text-accent);
    font-weight: 500;
  }

  .item-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .checkmark {
    color: var(--accent);
    margin-inline-end: 4px;
  }

  .item-ext {
    margin-inline-start: 12px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }

  .list-more {
    border-top: 1px solid var(--bg-modifier-border);
    margin-top: 2px;
    color: var(--text-muted);
  }

  .item-arrow {
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
