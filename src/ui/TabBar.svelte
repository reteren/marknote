<script lang="ts">
  import {
    workspace,
    activateTab,
    closeTab,
    openTab,
    tabLabel,
    type TabId,
    type WorkspaceTab,
  } from "../state/workspace.svelte";
  import { formatLabel, translate as t } from "../i18n";

  type Props = {
    onNewTab?: () => void;
    onSelectTab?: (id: TabId) => void;
    onCloseTab?: (id: TabId) => void;
  };

  let { onNewTab, onSelectTab, onCloseTab }: Props = $props();

  let tabListElement: HTMLElement | undefined = $state();

  function handleSelect(id: TabId): void {
    if (onSelectTab) {
      onSelectTab(id);
    } else {
      activateTab(id);
    }
  }

  function handleClose(event: MouseEvent | KeyboardEvent, id: TabId): void {
    event.stopPropagation();
    if (onCloseTab) {
      onCloseTab(id);
    } else {
      closeTab(id);
    }
  }

  function handleNew(): void {
    if (onNewTab) {
      onNewTab();
    } else {
      openTab();
    }
  }

  function handleKeydown(event: KeyboardEvent, index: number, tabId: TabId): void {
    const tabs = workspace.tabs;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (index + 1) % tabs.length;
      handleSelect(tabs[nextIndex].id);
      focusTab(nextIndex);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = (index - 1 + tabs.length) % tabs.length;
      handleSelect(tabs[prevIndex].id);
      focusTab(prevIndex);
    } else if (event.key === "Home") {
      event.preventDefault();
      handleSelect(tabs[0].id);
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      handleSelect(tabs[tabs.length - 1].id);
      focusTab(tabs.length - 1);
    } else if (event.key === "Delete" || (event.key === "w" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      handleClose(event, tabId);
    }
  }

  function focusTab(index: number): void {
    queueMicrotask(() => {
      const buttons = tabListElement?.querySelectorAll<HTMLElement>('[role="tab"]');
      buttons?.[index]?.focus();
    });
  }

  function getTabInfo(tab: WorkspaceTab): { name: string; format: string } {
    const label = tabLabel(tab);
    const name = label.name === "Untitled" ? t("tabs.untitled") : label.name;
    const format = formatLabel(tab.document.format.id, label.format);
    return { name, format };
  }
</script>

{#if workspace.tabs.length >= 2}
  <div
    class="tab-bar-strip"
    role="tablist"
    aria-label={t("tabs.bar")}
    bind:this={tabListElement}
  >
    <div class="tabs-container">
      {#each workspace.tabs as tab, index (tab.id)}
        {@const info = getTabInfo(tab)}
        {@const isActive = tab.id === workspace.activeId}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div
          class="tab"
          class:active={isActive}
          role="tab"
          id={`workspace-tab-${tab.id}`}
          aria-selected={isActive}
          aria-controls="editor-stage"
          tabindex={isActive ? 0 : -1}
          onclick={() => handleSelect(tab.id)}
          onkeydown={(e) => handleKeydown(e, index, tab.id)}
        >
          <span class="tab-title" title={info.name}>{info.name}</span>
          <span class="tab-format" title={info.format}>{info.format}</span>
          <button
            type="button"
            class="tab-close-btn"
            title={t("tabs.closeTab", { name: info.name })}
            aria-label={t("tabs.closeTab", { name: info.name })}
            onclick={(e) => handleClose(e, tab.id)}
          >
            ×
          </button>
        </div>
      {/each}

      <button
        type="button"
        class="tab-new-btn"
        title={t("tabs.newTab") + " (Ctrl+T)"}
        aria-label={t("tabs.newTab")}
        onclick={handleNew}
      >
        +
      </button>
    </div>
  </div>
{/if}

<style>
  .tab-bar-strip {
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--bg-modifier-border);
    display: flex;
    align-items: flex-end;
    min-width: 0;
    user-select: none;
    font-family: var(--font-ui);
  }

  .tabs-container {
    display: flex;
    align-items: flex-end;
    width: 100%;
    height: 100%;
    padding: 0 6px;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs-container::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    height: 27px;
    max-width: 200px;
    min-width: 80px;
    flex: 0 1 180px;
    padding: 0 8px;
    margin-bottom: -1px;
    border-radius: var(--radius-s) var(--radius-s) 0 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-size-ui);
    border: 1px solid transparent;
    border-bottom: 1px solid var(--bg-modifier-border);
    outline: none;
    transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
    box-sizing: border-box;
  }

  .tab:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .tab.active {
    background: var(--bg-primary);
    color: var(--text-normal);
    font-weight: 500;
    border-color: var(--bg-modifier-border);
    border-bottom-color: var(--bg-primary);
    box-shadow: 0 -2px 0 0 var(--accent);
    z-index: 2;
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tab-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-format {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-modifier-active);
    color: var(--text-faint);
    margin-inline-start: 6px;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .tab.active .tab-format {
    color: var(--text-muted);
  }

  .tab-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--text-faint);
    border-radius: var(--radius-s);
    margin-inline-start: 4px;
    padding: 0;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    font-family: inherit;
  }

  .tab-close-btn:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-error);
  }

  .tab-new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-bottom: 3px;
    border: 1px dashed var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    margin-inline-start: 4px;
    font-size: 15px;
    line-height: 1;
    font-family: inherit;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .tab-new-btn:hover {
    background: var(--bg-modifier-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  .tab-new-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
