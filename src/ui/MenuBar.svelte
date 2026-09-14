<script lang="ts">
  import { onMount } from "svelte";
  import type { SaveStatus } from "../state/document.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { createMenuModel, type MenuItem, type MenuSection, type MenuState } from "./menuModel";

  export type MenuAction = (id: string) => void;

  type Props = {
    title?: string;
    saveStatus?: SaveStatus;
    lastSavedAt?: Date | null;
    formats?: FormatCapabilities[];
    menuState?: MenuState;
    onAction?: MenuAction;
    onFocusEditor?: () => void;
    onSave?: () => void;
    onSaveAs?: () => void;
  };

  let {
    title = "Untitled.md — MarkNote",
    saveStatus = "unsaved",
    lastSavedAt = null,
    formats = [],
    menuState = {},
    onAction,
    onFocusEditor,
    onSave,
    onSaveAs,
  }: Props = $props();

  let menuRoot: HTMLElement | undefined = $state();
  let openSectionId = $state<string | null>(null);
  let activeItemIndex = $state(0);
  let activeSubmenuId = $state<string | null>(null);
  let activeSubmenuIndex = $state(0);
  let popupLeft = $state(4);
  let submenuOpensLeft = $state(false);

  const model = $derived(createMenuModel(formats, menuState));
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

  function sectionById(id: string | null): MenuSection | undefined {
    return id ? model.find((section) => section.id === id) : undefined;
  }

  function selectableItems(items: MenuItem[]): MenuItem[] {
    return items.filter((item) => !item.separator && !item.disabled);
  }

  function focusMenuItem(item: MenuItem | undefined): void {
    if (!item) return;
    queueMicrotask(() => {
      const node = menuRoot?.querySelector<HTMLElement>(`[data-menu-item-id="${item.id}"]`);
      node?.focus();
    });
  }

  function positionPopup(button?: HTMLElement): void {
    const width = 280;
    const rect = button?.getBoundingClientRect();
    const idealLeft = rect?.left ?? 4;
    popupLeft = Math.max(4, Math.min(idealLeft, window.innerWidth - width - 4));
  }

  function openSection(id: string, button?: HTMLElement): void {
    const section = sectionById(id);
    if (!section) return;
    openSectionId = id;
    activeSubmenuId = null;
    activeSubmenuIndex = 0;
    activeItemIndex = 0;
    positionPopup(button);
    focusMenuItem(selectableItems(section.items)[0]);
  }

  function closeMenu(restoreFocus = false): void {
    openSectionId = null;
    activeSubmenuId = null;
    activeItemIndex = 0;
    activeSubmenuIndex = 0;
    if (restoreFocus) {
      onFocusEditor?.();
      queueMicrotask(() => menuRoot?.closest(".app-shell")?.querySelector<HTMLElement>(".cm-content")?.focus());
    }
  }

  function openSubmenu(item: MenuItem, node?: HTMLElement): void {
    if (!item.submenu || item.disabled) return;
    activeSubmenuId = item.id;
    activeSubmenuIndex = 0;
    const rect = node?.getBoundingClientRect();
    submenuOpensLeft = Boolean(
      (rect && rect.right + 276 > window.innerWidth) || (!rect && popupLeft + 280 + 276 > window.innerWidth),
    );
    focusMenuItem(item.submenu.find((child) => !child.disabled && !child.separator));
  }

  function choose(item: MenuItem | undefined): void {
    if (!item || item.separator || item.disabled) return;
    if (item.submenu) {
      openSubmenu(item);
      return;
    }
    onAction?.(item.id);
    closeMenu(false);
  }

  function activeSectionItems(): MenuItem[] {
    return selectableItems(sectionById(openSectionId)?.items ?? []);
  }

  function activeSubmenuItems(): MenuItem[] {
    const parent = sectionById(openSectionId)?.items.find((item) => item.id === activeSubmenuId);
    return selectableItems(parent?.submenu ?? []);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Alt") {
      event.preventDefault();
      if (openSectionId) closeMenu(false);
      else openSection(model[0]?.id ?? "");
      return;
    }

    if (!openSectionId) return;
    const items = activeSubmenuId ? activeSubmenuItems() : activeSectionItems();
    if (items.length === 0 && event.key !== "Escape") return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (activeSubmenuId) activeSubmenuIndex = (activeSubmenuIndex + 1) % activeSubmenuItems().length;
        else activeItemIndex = (activeItemIndex + 1) % activeSectionItems().length;
        focusMenuItem(items[activeSubmenuId ? activeSubmenuIndex : activeItemIndex]);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (activeSubmenuId) activeSubmenuIndex = (activeSubmenuIndex - 1 + items.length) % items.length;
        else activeItemIndex = (activeItemIndex - 1 + items.length) % items.length;
        focusMenuItem(items[activeSubmenuId ? activeSubmenuIndex : activeItemIndex]);
        break;
      case "ArrowRight": {
        event.preventDefault();
        if (activeSubmenuId) {
          const sectionIndex = (model.findIndex((section) => section.id === openSectionId) + 1) % model.length;
          openSection(model[sectionIndex]?.id ?? "");
        } else {
          const item = activeSectionItems()[activeItemIndex];
          if (item?.submenu) openSubmenu(item);
          else {
            const sectionIndex = (model.findIndex((section) => section.id === openSectionId) + 1) % model.length;
            openSection(model[sectionIndex]?.id ?? "");
          }
        }
        break;
      }
      case "ArrowLeft":
        event.preventDefault();
        if (activeSubmenuId) {
          activeSubmenuId = null;
          activeSubmenuIndex = 0;
          focusMenuItem(activeSectionItems()[activeItemIndex]);
        } else {
          const sectionIndex = (model.findIndex((section) => section.id === openSectionId) - 1 + model.length) % model.length;
          openSection(model[sectionIndex]?.id ?? "");
        }
        break;
      case "Enter":
        event.preventDefault();
        choose(items[activeSubmenuId ? activeSubmenuIndex : activeItemIndex]);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      default:
        break;
    }
  }

  function handleSectionClick(event: MouseEvent, id: string): void {
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    if (openSectionId === id) closeMenu(false);
    else openSection(id, button);
  }

  function handleSectionHover(event: MouseEvent, id: string): void {
    if (!openSectionId || openSectionId === id) return;
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    openSection(id, button);
  }

  function handleItemHover(event: MouseEvent, item: MenuItem): void {
    if (item.disabled) return;
    const node = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    const section = sectionById(openSectionId);
    activeItemIndex = selectableItems(section?.items ?? []).findIndex((candidate) => candidate.id === item.id);
    if (item.submenu) openSubmenu(item, node);
  }

  function handleSubmenuHover(item: MenuItem): void {
    if (item.disabled) return;
    activeSubmenuIndex = activeSubmenuItems().findIndex((candidate) => candidate.id === item.id);
  }

  function handleOutsidePointer(event: PointerEvent): void {
    if (openSectionId && !menuRoot?.contains(event.target as Node)) closeMenu(false);
  }

  onMount(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => handleKeyDown(event);
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  });
</script>

<header class="menu-bar" bind:this={menuRoot} aria-label="Главное меню">
  <div class="menu-groups">
    <span class="window-title" title={title}>{title}</span>
    <div class="menu-tabs" aria-label="Разделы меню" role="menubar" tabindex="-1">
      {#each model as section}
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSectionId === section.id}
          class:menu-open={openSectionId === section.id}
          onclick={(event) => handleSectionClick(event, section.id)}
          onmouseenter={(event) => handleSectionHover(event, section.id)}
        >{section.label}</button>
      {/each}
    </div>
  </div>

  <div class="save-controls" aria-label="Сохранение документа">
    <span class:status-pending={saveStatus === "pending"} class:status-saved={saveStatus === "saved"}>{statusLabel}</span>
    <button type="button" onclick={() => onSave?.()} disabled={saveStatus === "pending" || saveStatus === "readonly"}>Save</button>
    <button type="button" onclick={() => onSaveAs?.()}>Save as…</button>
  </div>

  {#if openSectionId}
    {@const section = sectionById(openSectionId)}
    <div class="menu-popup" role="menu" aria-label={section?.label} style:left={`${popupLeft}px`}>
      {#each section?.items ?? [] as menuItem}
        {#if menuItem.separator}
          <div class="menu-separator" role="separator"></div>
        {:else}
          <button
            type="button"
            role="menuitem"
            data-menu-item-id={menuItem.id}
            class:active-item={activeSectionItems()[activeItemIndex]?.id === menuItem.id}
            aria-haspopup={menuItem.submenu ? "menu" : undefined}
            aria-disabled={menuItem.disabled}
            disabled={menuItem.disabled}
            onclick={() => choose(menuItem)}
            onmouseenter={(event) => handleItemHover(event, menuItem)}
          >
            <span class="item-label">{menuItem.label}</span>
            <span class="item-trailing">
              {#if menuItem.shortcut}<span class="shortcut">{menuItem.shortcut}</span>{/if}
              {#if menuItem.submenu}<span class="submenu-arrow" aria-hidden="true">›</span>{/if}
            </span>
          </button>
          {#if activeSubmenuId === menuItem.id && menuItem.submenu}
            <div class:submenu-left={submenuOpensLeft} class="submenu-panel" role="menu">
              {#each menuItem.submenu as submenuItem}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item-id={submenuItem.id}
                  class:active-item={activeSubmenuItems()[activeSubmenuIndex]?.id === submenuItem.id}
                  aria-disabled={submenuItem.disabled}
                  disabled={submenuItem.disabled}
                  onclick={() => choose(submenuItem)}
                  onmouseenter={() => handleSubmenuHover(submenuItem)}
                >
                  <span class="item-label">{submenuItem.label}</span>
                  {#if submenuItem.shortcut}<span class="shortcut">{submenuItem.shortcut}</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
</header>

<style>
  .menu-bar {
    position: relative;
    z-index: 20;
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

  .menu-groups, .menu-tabs, .save-controls { display: flex; align-items: center; gap: 2px; }
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
  button:hover:not(:disabled), button.active-item, button.menu-open { background: var(--bg-modifier-hover); color: var(--text-normal); }
  button:active:not(:disabled) { background: var(--bg-modifier-active); }
  button:disabled { color: var(--text-faint); cursor: default; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .save-controls { gap: 6px; white-space: nowrap; }
  .save-controls > span { color: var(--text-muted); }
  .save-controls .status-pending { color: var(--text-accent); }
  .save-controls .status-saved { color: var(--text-success); }

  .menu-popup {
    position: fixed;
    top: calc(var(--menubar-height) + 1px);
    z-index: 30;
    display: flex;
    flex-direction: column;
    width: min(280px, calc(100vw - 8px));
    max-height: min(520px, calc(100vh - var(--menubar-height) - 8px));
    overflow: visible;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: 0 10px 28px var(--bg-secondary-alt);
  }
  .menu-popup > button, .submenu-panel button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 28px; padding: 5px 9px; text-align: left; }
  .item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-trailing { display: flex; align-items: center; gap: 14px; margin-left: 18px; }
  .shortcut { color: var(--text-faint); font-family: var(--font-mono); font-size: var(--font-size-mono); white-space: nowrap; }
  .submenu-arrow { color: var(--text-muted); font-size: 18px; line-height: 0.7; }
  .menu-separator { height: 1px; margin: 4px 5px; background: var(--bg-modifier-border); }
  .submenu-panel {
    position: absolute;
    top: 4px;
    left: calc(100% - 4px);
    z-index: 31;
    width: min(260px, calc(100vw - 8px));
    max-height: min(520px, calc(100vh - var(--menubar-height) - 8px));
    overflow: auto;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: 0 10px 28px var(--bg-secondary-alt);
  }
  .submenu-panel.submenu-left { right: calc(100% - 4px); left: auto; }

  @media (max-width: 760px) {
    .window-title { display: none; }
    .menu-bar { gap: 6px; padding: 0 6px; }
  }
</style>
