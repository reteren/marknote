<script lang="ts">
  import FormatPicker from "./FormatPicker.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";

  type Props = {
    formats?: FormatCapabilities[];
    onSelect?: (format: FormatCapabilities) => void;
    onOpenFile?: () => void;
    onDrop?: (event: DragEvent) => void;
  };

  let { formats = [], onSelect, onOpenFile, onDrop }: Props = $props();

  function preventDrag(event: DragEvent): void {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    onDrop?.(event);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="start-screen"
  aria-label="New document"
  ondragover={preventDrag}
  ondrop={handleDrop}
>
  <div class="start-content">
    <div class="mark" aria-hidden="true">MN</div>
    <h1>MarkNote</h1>
    <p class="lead">New file</p>

    <div class="format-picker-wrap">
      <FormatPicker mode="grid" {formats} onSelect={onSelect} />
    </div>

    <div class="open-row">
      <button type="button" class="open-button" onclick={() => onOpenFile?.()}>Open file…</button>
      <span>or drop a file here</span>
    </div>
    <p class="hint">Start typing to create a Markdown note.</p>
  </div>
</section>

<style>
  .start-screen {
    position: absolute;
    inset: 0;
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
  .format-picker-wrap, .open-button { pointer-events: auto; }

  .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 4px;
    border: 1px solid var(--bg-modifier-border-hover);
    border-radius: var(--radius-m);
    color: var(--text-accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-mono);
    letter-spacing: 0.08em;
  }
  h1 { margin: 0; color: var(--text-normal); font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
  p { margin: 0; }
  .lead { color: var(--text-normal); font-size: var(--font-size-text); }
  .hint { color: var(--text-faint); }
  .open-row { display: flex; align-items: center; gap: 9px; margin-top: 4px; }
  .open-row > span { color: var(--text-faint); }
  .open-button {
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    padding: 6px 10px;
    background: var(--bg-secondary);
    color: var(--text-normal);
    font: inherit;
    cursor: pointer;
  }
  .open-button:hover { border-color: var(--bg-modifier-border-hover); background: var(--bg-modifier-hover); }
  .open-button:active { background: var(--bg-modifier-active); }
  .open-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  @media (max-width: 560px) {
    .start-screen { padding: 24px 12px; }
    .open-row { flex-direction: column; gap: 4px; }
  }
</style>
