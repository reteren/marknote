<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    id: string;
    title: string;
    description?: string;
    changed?: boolean;
    modifiedLabel?: string;
    resetLabel?: string;
    onReset?: () => void;
    children: Snippet;
  };

  let {
    id,
    title,
    description,
    changed = false,
    modifiedLabel = "",
    resetLabel = "",
    onReset,
    children,
  }: Props = $props();
</script>

<div class="setting-row" data-setting-row={id}>
  <div class="setting-copy">
    <div class="setting-heading">
      <h3 id={`${id}-title`}>{title}</h3>
      {#if changed}<span class="modified-indicator">{modifiedLabel}</span>{/if}
    </div>
    {#if description}<p id={`${id}-description`}>{description}</p>{/if}
  </div>

  <div class="setting-control" aria-labelledby={`${id}-title`}>
    {@render children()}
  </div>

  {#if changed && onReset}
    <button type="button" class="setting-reset" aria-label={resetLabel} title={resetLabel} onclick={onReset}>
      {resetLabel}
    </button>
  {/if}
</div>

<style>
  .setting-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 250px) auto;
    align-items: center;
    gap: 12px 18px;
    padding: 15px 0;
    border-bottom: 1px solid var(--bg-modifier-border);
  }

  .setting-copy {
    min-width: 0;
  }

  .setting-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  h3 {
    margin: 0;
    color: var(--text-normal);
    font: inherit;
    font-weight: 600;
  }

  .setting-copy p {
    margin: 4px 0 0;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .modified-indicator {
    padding: 2px 7px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: 999px;
    color: var(--text-accent);
    font-size: 11px;
    white-space: nowrap;
  }

  .setting-control {
    min-width: 0;
  }

  .setting-reset {
    max-width: 110px;
    padding: 5px 8px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .setting-reset:hover {
    border-color: var(--bg-modifier-border-hover);
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  @media (max-width: 720px) {
    .setting-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }

    .setting-control {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .setting-reset {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
