<script lang="ts">
  import type { SaveStatus } from "../state/document.svelte";

  type Props = {
    title: string;
    saveStatus: SaveStatus;
    lastSavedAt: Date | null;
    onSave?: () => void;
    onSaveAs?: () => void;
  };

  let { title, saveStatus, lastSavedAt, onSave, onSaveAs }: Props = $props();

  const statusLabel = $derived(
    saveStatus === "pending"
      ? "Saving…"
      : saveStatus === "saved"
        ? lastSavedAt
          ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "Saved"
        : saveStatus === "readonly"
          ? "Read-only"
          : "Unsaved",
  );
</script>

<header class="menu-bar" aria-label="Главное меню">
  <div class="menu-groups">
    <span class="window-title" title={title}>{title}</span>
    <button type="button">File</button>
    <button type="button">Edit</button>
    <button type="button">Format</button>
    <button type="button">View</button>
    <button type="button">Help</button>
  </div>

  <div class="save-controls" aria-label="Сохранение документа">
    <span class:status-pending={saveStatus === "pending"} class:status-saved={saveStatus === "saved"}>{statusLabel}</span>
    <button type="button" onclick={() => onSave?.()} disabled={saveStatus === "pending" || saveStatus === "readonly"}>Save</button>
    <button type="button" onclick={() => onSaveAs?.()}>Save as…</button>
  </div>
</header>

<style>
  .menu-bar {
    min-height: var(--menubar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--bg-modifier-border);
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
  }

  .menu-groups,
  .save-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .window-title {
    max-width: min(30vw, 320px);
    overflow: hidden;
    margin-right: 8px;
    color: var(--text-faint);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    border: 0;
    border-radius: var(--radius-s);
    padding: 4px 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:hover:not(:disabled) { background: var(--bg-modifier-hover); color: var(--text-normal); }
  button:active:not(:disabled) { background: var(--bg-modifier-active); }
  button:disabled { color: var(--text-faint); cursor: default; }
  .save-controls { gap: 6px; white-space: nowrap; }
  .save-controls > span { color: var(--text-muted); }
  .save-controls .status-pending { color: var(--text-accent); }
  .save-controls .status-saved { color: var(--text-success); }

  @media (max-width: 760px) {
    .window-title { display: none; }
    .menu-bar { gap: 6px; padding: 0 6px; }
  }
</style>
