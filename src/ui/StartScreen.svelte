<script lang="ts">
  import FormatPicker from "./FormatPicker.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { translate as t } from "../i18n";

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
  aria-label={t("start.newDocument")}
  ondragover={preventDrag}
  ondrop={handleDrop}
>
  <div class="start-content">
    <h1>{t("app.name")}</h1>

    <div class="format-picker-wrap">
      <FormatPicker mode="grid" {formats} onSelect={onSelect} />
    </div>

    <div class="open-row">
      <button type="button" class="open-button" onclick={() => onOpenFile?.()}>{t("start.openFile")}</button>
      <span>{t("start.dropFile")}</span>
    </div>
  </div>
</section>

<style>
  .start-screen {
    position: absolute;
    inset: 0;
    /* Непрозрачный: экран лежит поверх пустого редактора, и без фона сквозь
       него видно подсветку активной строки — полосу поперёк экрана. */
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
  .format-picker-wrap, .open-button { pointer-events: auto; }

  h1 { margin: 0; color: var(--text-normal); font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
  .open-row { display: grid; justify-items: center; gap: 2px; margin-top: 4px; }
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
  }
</style>
