<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import type { LineEnding, SaveStatus, SaveResult } from "../state/document.svelte";

  type Props = {
    saveStatus?: SaveStatus;
    lastSavedAt?: Date | string | null;
    path?: string | null;
    text?: string;
    format?: FormatCapabilities;
    encoding?: string;
    bom?: boolean;
    lineEnding?: LineEnding;
    readonly?: boolean;
    dirty?: boolean;
    onSave?: () => void | Promise<void>;
    onSaveAs?: () => void | Promise<void>;
    onSaved?: (result: SaveResult) => void;
    onError?: (error: unknown) => void;
    onSaving?: () => void;
  };

  let {
    saveStatus = "unsaved",
    lastSavedAt = null,
    path = null,
    text = "",
    format = {
      id: "markdown",
      label: "Markdown",
      defaultExtension: "md",
      extensions: ["md", "markdown"],
      editable: true,
      creatable: true,
      livePreview: true,
      autosave: true,
      lossy: false,
      syntaxMode: null,
      template: "",
    },
    encoding = "utf-8",
    bom = false,
    lineEnding = "lf",
    readonly = false,
    dirty = false,
    onSave,
    onSaveAs,
    onSaved,
    onError,
    onSaving,
  }: Props = $props();

  let isSavingInternal = $state(false);

  const isReadOnly = $derived(readonly || saveStatus === "readonly" || !format.editable);
  const isPending = $derived(saveStatus === "pending" || isSavingInternal);
  const isSaved = $derived(saveStatus === "saved" && !dirty);
  const isEmptyUntitled = $derived(path === null && !dirty && text.length === 0);

  const statusLabel = $derived.by(() => {
    if (isReadOnly) return "Read-only";
    if (isPending) return "Saving…";
    if (format.lossy && dirty) return "● Unsaved changes";
    if (saveStatus === "saved") {
      if (!lastSavedAt) return "Saved";
      const parsed = typeof lastSavedAt === "string" ? new Date(lastSavedAt) : lastSavedAt;
      const time = parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `Saved ${time}`;
    }
    return "● Unsaved";
  });

  const saveDisabled = $derived(
    isReadOnly || isPending || isEmptyUntitled || (isSaved && path !== null),
  );

  const saveAsDisabled = $derived(isPending || (isEmptyUntitled && isReadOnly));

  async function handleSave(): Promise<void> {
    if (saveDisabled) return;

    // An untitled document always follows the Save As flow.  Check this
    // before the generic save callback so a parent exposing both callbacks
    // cannot accidentally invoke two different save paths.
    if (path === null) {
      await handleSaveAs();
      return;
    }

    if (onSave) {
      await onSave();
      return;
    }

    try {
      isSavingInternal = true;
      onSaving?.();
      const result = await invoke<SaveResult>("save_file", {
        path,
        text,
        encoding,
        bom,
        lineEnding,
      });
      onSaved?.(result);
    } catch (error) {
      onError?.(error);
    } finally {
      isSavingInternal = false;
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (isPending) return;

    if (onSaveAs) {
      await onSaveAs();
      return;
    }

    try {
      isSavingInternal = true;
      onSaving?.();
      const extension = format.defaultExtension || "md";
      const filename = path ? path.split(/[\\/]/u).pop() : undefined;
      const suggestedName = filename ?? `Untitled.${extension}`;

      const result = await invoke<SaveResult | null>("save_as", {
        text,
        formatId: format.id,
        suggestedName,
      });

      if (result) {
        onSaved?.(result);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      isSavingInternal = false;
    }
  }
</script>

<div class="save-controls" aria-label="Document save controls">
  <span
    class="status-indicator"
    class:status-pending={isPending}
    class:status-saved={isSaved}
    class:status-readonly={isReadOnly}
    class:status-faint={isEmptyUntitled}
    title={isReadOnly ? "Document is read-only" : statusLabel}
  >
    {statusLabel}
  </span>

  <button
    type="button"
    class="save-btn"
    disabled={saveDisabled}
    onclick={handleSave}
    title={isReadOnly ? "File is read-only (saving is disabled)" : "Save (Ctrl+S)"}
  >
    Save
  </button>

  <button
    type="button"
    class="save-as-btn"
    disabled={saveAsDisabled}
    onclick={handleSaveAs}
    title={isReadOnly ? "Save as a Markdown document" : "Save as… (Ctrl+Shift+S)"}
  >
    {isReadOnly && !format.editable ? "Save as Markdown…" : "Save as…"}
  </button>
</div>

<style>
  .save-controls {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    white-space: nowrap;
    user-select: none;
  }

  .status-indicator {
    color: var(--text-muted);
    font-size: var(--font-size-ui);
    padding: 0 4px;
    transition: color 0.15s ease;
  }

  .status-indicator.status-pending {
    color: var(--text-accent);
  }

  .status-indicator.status-saved {
    color: var(--text-success);
  }

  .status-indicator.status-readonly {
    color: var(--text-faint);
  }

  .status-indicator.status-faint {
    color: var(--text-faint);
    opacity: 0.6;
  }

  button {
    border: 0;
    border-radius: var(--radius-s);
    padding: 4px 8px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--font-size-ui);
    cursor: pointer;
    outline: none;
    transition: background 0.1s ease, color 0.1s ease;
  }

  button:hover:not(:disabled) {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  button:active:not(:disabled) {
    background: var(--bg-modifier-active);
  }

  button:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
