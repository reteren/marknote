<script lang="ts">
  import type { EditorStats } from "../editor/createEditor";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { formatLabel, translate as t } from "../i18n";

  type Props = { format: FormatCapabilities; stats: EditorStats };
  let { format, stats }: Props = $props();
</script>

<footer class="status-bar" aria-label={t("status.bar")}>
  <div class="format-info">
    <button type="button" title={t("status.changeFormat")}>{formatLabel(format.id, format.label)}</button>
    {#if !format.editable}<span class="restriction">{t("save.readOnly")}</span>{/if}
    {#if format.lossy}<span class="restriction">{t("status.lossy")}</span>{/if}
  </div>

  <div class="stats" aria-live="polite">
    {#if stats.selection}
      <span>{stats.selection.toLine !== stats.selection.fromLine
        ? t("status.selectionLines", { fromLine: stats.selection.fromLine, toLine: stats.selection.toLine })
        : t("status.selectionLine", { line: stats.selection.fromLine })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("status.words", { count: stats.selection.words })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("status.characters", { count: stats.selection.chars })}</span>
    {:else}
      <span>{t("status.position", { line: stats.line, column: stats.col })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("status.lines", { count: stats.lines })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("status.words", { count: stats.words })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("status.characters", { count: stats.chars })}</span>
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
