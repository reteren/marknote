<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { translate as t } from "../i18n";

  type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

  type Props = {
    title: string;
    onClose: () => void;
    onError?: (error: unknown) => void;
  };

  let { title, onClose, onError }: Props = $props();
  let maximized = $state(false);

  const resizeDirections: ResizeDirection[] = [
    "North", "South", "West", "East",
    "NorthWest", "NorthEast", "SouthWest", "SouthEast",
  ];

  function reportWindowError(error: unknown): void {
    if (onError) onError(error);
    else console.error("Window control failed", error);
  }

  async function refreshMaximizedState(): Promise<void> {
    try {
      maximized = await getCurrentWindow().isMaximized();
    } catch (error) {
      reportWindowError(error);
    }
  }

  async function toggleMaximize(): Promise<void> {
    try {
      const window = getCurrentWindow();
      await window.toggleMaximize();
      maximized = await window.isMaximized();
    } catch (error) {
      reportWindowError(error);
    }
  }

  async function minimize(): Promise<void> {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      reportWindowError(error);
    }
  }

  function startResize(event: MouseEvent, direction: ResizeDirection): void {
    if (event.button !== 0 || maximized) return;
    event.preventDefault();
    void getCurrentWindow().startResizeDragging(direction).catch(reportWindowError);
  }

  function handleDragRegionDoubleClick(event: MouseEvent): void {
    if ((event.target as Element | null)?.closest("button")) return;
    void toggleMaximize();
  }

  function activateButtonOnEnter(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    (event.currentTarget as HTMLButtonElement).click();
  }

  function activateButtonOnSpace(event: KeyboardEvent): void {
    if (event.key !== " ") return;
    event.preventDefault();
    (event.currentTarget as HTMLButtonElement).click();
  }

  onMount(() => {
    let disposed = false;
    let unlistenResize: UnlistenFn | undefined;
    void refreshMaximizedState();
    const window = getCurrentWindow();
    if (typeof window.onResized !== "function") return;
    void window.onResized(() => void refreshMaximizedState())
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenResize = unlisten;
      })
      .catch(reportWindowError);
    return () => {
      disposed = true;
      unlistenResize?.();
    };
  });
</script>

<header class="titlebar" aria-label={t("window.titleBar")}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="titlebar-drag-region" data-tauri-drag-region role="presentation" ondblclick={handleDragRegionDoubleClick}>
    <svg class="app-mark" viewBox="0 0 24 24" aria-hidden="true" data-tauri-drag-region>
      <rect x="5" y="3.75" width="14" height="16.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M8 8h8M8 11h5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      <path d="M12.1 16.9c.1-2.2 1.3-3.8 3.9-4.6-.1 2.5-1.4 4.1-3.9 4.6Zm0 0c-.1-1.5-.8-2.6-2.4-3.2.1 1.7.8 2.7 2.4 3.2Z" fill="var(--text-accent)" />
    </svg>
    <!-- The menu bar shows the document name after File/Edit/View/Help.
         It is intentionally absent here, otherwise it would appear twice. -->
  </div>

  <div class="window-controls" role="group" aria-label={t("window.controls")}>
    <button type="button" class="window-control" aria-label={t("window.minimize")} title={t("window.minimize")} onclick={minimize} onkeydown={activateButtonOnEnter} onkeyup={activateButtonOnSpace}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5h8" /></svg>
    </button>
    <button
      type="button"
      class="window-control"
      aria-label={maximized ? t("window.restore") : t("window.maximize")}
      title={maximized ? t("window.restore") : t("window.maximize")}
      onclick={toggleMaximize}
      onkeydown={activateButtonOnEnter}
      onkeyup={activateButtonOnSpace}
    >
      {#if maximized}
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.2h5.8V8M8 4H2.2v5.8H8V4Z" /></svg>
      {:else}
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx=".3" /></svg>
      {/if}
    </button>
    <button type="button" class="window-control close-control" aria-label={t("window.close")} title={t("window.close")} onclick={onClose} onkeydown={activateButtonOnEnter} onkeyup={activateButtonOnSpace}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" /></svg>
    </button>
  </div>
</header>

{#if !maximized}
  <div class="resize-hotspots" aria-hidden="true">
    {#each resizeDirections as direction (direction)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class={`resize-hotspot resize-${direction.toLowerCase()}`}
        data-resize-direction={direction}
        onmousedown={(event) => startResize(event, direction)}
      ></div>
    {/each}
  </div>
{/if}

<style>
  .titlebar {
    position: relative;
    z-index: 950;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: var(--menubar-height);
    overflow: hidden;
    background: var(--bg-secondary);
    color: var(--text-normal);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    user-select: none;
  }

  .titlebar-drag-region {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding-inline-start: 12px;
    cursor: default;
  }

  .app-mark {
    flex: none;
    width: 18px;
    height: 18px;
    color: var(--text-muted);
    pointer-events: none;
  }

  .document-title {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-controls {
    display: flex;
    flex: none;
    align-items: stretch;
    height: 100%;
    z-index: 960;
  }

  .window-control {
    display: grid;
    place-items: center;
    width: 46px;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: default;
  }

  .window-control:hover { background: var(--bg-modifier-hover); color: var(--text-normal); }
  .window-control:active { background: var(--bg-modifier-active); }
  .close-control:hover { background: var(--text-error); color: var(--text-on-danger); }
  .close-control:active { background: var(--text-error); }

  .window-control svg {
    width: 12px;
    height: 12px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linecap: square;
    stroke-linejoin: miter;
    pointer-events: none;
  }

  .resize-hotspots {
    position: fixed;
    z-index: 955;
    inset: 0;
    pointer-events: none;
  }

  .resize-hotspot {
    position: absolute;
    pointer-events: auto;
    touch-action: none;
  }

  .resize-north, .resize-south { inset-inline: 10px; height: 5px; }
  .resize-north { top: 0; cursor: ns-resize; }
  .resize-south { bottom: 0; cursor: ns-resize; }
  .resize-west, .resize-east { inset-block: 10px; width: 5px; }
  .resize-west { inset-inline-start: 0; cursor: ew-resize; }
  .resize-east { inset-inline-end: 0; cursor: ew-resize; }
  .resize-northwest, .resize-southeast { width: 10px; height: 10px; cursor: nwse-resize; }
  .resize-northeast, .resize-southwest { width: 10px; height: 10px; cursor: nesw-resize; }
  .resize-northwest { inset-block-start: 0; inset-inline-start: 0; }
  .resize-northeast { inset-block-start: 0; inset-inline-end: 0; }
  .resize-southwest { inset-block-end: 0; inset-inline-start: 0; }
  .resize-southeast { inset-block-end: 0; inset-inline-end: 0; }
</style>
