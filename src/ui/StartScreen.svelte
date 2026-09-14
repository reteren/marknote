<script lang="ts">
  import type { FormatCapabilities } from "../state/formats.svelte";

  type Props = { formats: FormatCapabilities[] };
  let { formats }: Props = $props();
</script>

<section class="start-screen" aria-label="Новый документ">
  <div class="mark">MN</div>
  <h1>MarkNote</h1>
  <p class="lead">Начните печатать, чтобы создать заметку.</p>
  <p class="hint">Markdown используется по умолчанию. Выбор формата появится в M3.</p>
  {#if formats.length > 0}
    <div class="format-hint" aria-label="Доступные форматы">
      {#each formats as format}
        <span>{format.label}</span>
      {/each}
    </div>
  {/if}
</section>

<style>
  .start-screen {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 8px;
    padding: 48px;
    pointer-events: none;
    color: var(--text-muted);
    text-align: center;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    margin-bottom: 8px;
    border: 1px solid var(--bg-modifier-border-hover);
    border-radius: var(--radius-m);
    color: var(--text-accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-mono);
    letter-spacing: 0.08em;
  }

  h1 { margin: 0; color: var(--text-normal); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  p { margin: 0; }
  .lead { color: var(--text-normal); font-size: var(--font-size-text); }
  .hint { color: var(--text-faint); }
  .format-hint { display: flex; gap: 6px; margin-top: 10px; color: var(--text-faint); }
  .format-hint span { padding: 3px 7px; border: 1px solid var(--bg-modifier-border); border-radius: 99px; }
</style>
