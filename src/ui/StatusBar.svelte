<script lang="ts">
  import type { EditorStats } from "../editor/createEditor";
  import type { FormatCapabilities } from "../state/formats.svelte";

  type Props = { format: FormatCapabilities; stats: EditorStats };
  let { format, stats }: Props = $props();
</script>

<footer class="status-bar" aria-label="Строка состояния">
  <div class="format-info">
    <button type="button" title="Смена формата будет доступна в M3">{format.label}</button>
    {#if !format.editable}<span class="restriction">Read-only</span>{/if}
    {#if format.lossy}<span class="restriction">Lossy</span>{/if}
  </div>

  <div class="stats" aria-live="polite">
    {#if stats.selection}
      <span>Ln {stats.selection.fromLine}{#if stats.selection.toLine !== stats.selection.fromLine}–{stats.selection.toLine}{/if} selected</span>
      <span aria-hidden="true">·</span>
      <span>{stats.selection.words} words</span>
      <span aria-hidden="true">·</span>
      <span>{stats.selection.chars} chars</span>
    {:else}
      <span>Ln {stats.line}, Col {stats.col}</span>
      <span aria-hidden="true">·</span>
      <span>{stats.lines} lines</span>
      <span aria-hidden="true">·</span>
      <span>{stats.words} words</span>
      <span aria-hidden="true">·</span>
      <span>{stats.chars} chars</span>
    {/if}
  </div>
</footer>

<style>
  .status-bar {
    min-height: var(--statusbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--bg-modifier-border);
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
  }

  .format-info,
  .stats { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .format-info button {
    border: 0;
    border-radius: var(--radius-s);
    padding: 2px 5px;
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    cursor: pointer;
  }
  .format-info button:hover { background: var(--bg-modifier-hover); }
  .restriction { color: var(--text-accent); }
  .stats { justify-content: flex-end; white-space: nowrap; }

  @media (max-width: 620px) {
    .status-bar { gap: 8px; padding: 0 7px; }
    .stats span:nth-of-type(n + 5) { display: none; }
  }
</style>
