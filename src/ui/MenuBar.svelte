<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { SaveStatus } from "../state/document.svelte";
  import type { FormatCapabilities } from "../state/formats.svelte";
  import { formatTime, interfaceLanguage, translate as t } from "../i18n";
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
    title,
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
  let popupTop = $state(4);
  let submenuOpensOpposite = $state(false);

  const displayTitle = $derived(title ?? t("menu.windowTitle"));
  const rtl = $derived(interfaceLanguage.locale === "ar");
  const model = $derived(createMenuModel(formats, menuState));
  const statusLabel = $derived(
    saveStatus === "pending"
      ? t("save.saving")
      : saveStatus === "saved"
        ? lastSavedAt
          ? t("save.savedAt", { time: formatTime(lastSavedAt) })
          : t("save.saved")
        : saveStatus === "readonly"
          ? t("save.readOnly")
          : t("save.unsaved"),
  );

  function sectionById(id: string | null): MenuSection | undefined {
    return id ? model.find((section) => section.id === id) : undefined;
  }

  function selectableItems(items: MenuItem[]): MenuItem[] {
    // Labels (kind: "label") are not commands: they are not clickable and the
    // keyboard skips them. There is currently one — the current zoom above View items.
    return items.filter((item) => !item.separator && !item.disabled && item.kind !== "label");
  }

  function focusMenuItem(item: MenuItem | undefined): void {
    if (!item) return;
    queueMicrotask(() => {
      const node = menuRoot?.querySelector<HTMLElement>(`[data-menu-item-id="${item.id}"]`);
      node?.focus();
    });
  }

  function positionPopupForKeyboard(sectionId: string): void {
    const sectionIndex = model.findIndex((section) => section.id === sectionId);
    const button = menuRoot?.querySelectorAll<HTMLElement>('[role="menubar"] button')[sectionIndex];
    const rect = button?.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 8);
    const idealLeft = rect ? (rtl ? rect.right - width : rect.left) : 4;
    popupLeft = Math.max(4, Math.min(idealLeft, window.innerWidth - width - 4));
    popupTop = Math.max(4, Math.min((menuRoot?.getBoundingClientRect().bottom ?? 0) + 1, window.innerHeight - 8));
  }

  function positionPopupFromPointer(x: number, y: number): void {
    popupLeft = x - 2;
    popupTop = y - 2;
    void tick().then(() => {
      const popup = menuRoot?.querySelector<HTMLElement>(".menu-popup");
      if (!popup) return;

      const bounds = popup.getBoundingClientRect();
      const width = bounds.width || Math.min(280, window.innerWidth - 8);
      const height = bounds.height || Math.min(520, window.innerHeight - 8);
      const left = x - 2 + width <= window.innerWidth - 4 ? x - 2 : x + 2 - width;
      const top = y - 2 + height <= window.innerHeight - 4 ? y - 2 : y + 2 - height;
      popupLeft = Math.max(4, Math.min(left, window.innerWidth - width - 4));
      popupTop = Math.max(4, Math.min(top, window.innerHeight - height - 4));
    });
  }

  function openSection(id: string, pointer?: { x: number; y: number }): void {
    const section = sectionById(id);
    if (!section) return;
    const wasOpen = openSectionId !== null;
    openSectionId = id;
    activeSubmenuId = null;
    activeSubmenuIndex = 0;
    activeItemIndex = 0;
    if (pointer) positionPopupFromPointer(pointer.x, pointer.y);
    else if (!wasOpen) positionPopupForKeyboard(id);
    focusMenuItem(selectableItems(section.items)[0]);
  }

  function closeMenu(restoreFocus = false): void {
    openSectionId = null;
    activeSubmenuId = null;
    activeItemIndex = 0;
    activeSubmenuIndex = 0;
    if (restoreFocus) {
      // Only the editor's own focus(): a raw focus() on .cm-content would
      // move the caret to the start of the document.
      if (onFocusEditor) onFocusEditor();
      else queueMicrotask(() => menuRoot?.closest(".app-shell")?.querySelector<HTMLElement>(".cm-content")?.focus());
    }
  }

  function openSubmenu(item: MenuItem, node?: HTMLElement): void {
    if (!item.submenu || item.disabled) return;
    activeSubmenuId = item.id;
    activeSubmenuIndex = 0;
    const rect = node?.getBoundingClientRect();
    const preferredSpace = rect
      ? rtl ? rect.left : window.innerWidth - rect.right
      : rtl
        ? popupLeft
        : window.innerWidth - popupLeft - 280;
    submenuOpensOpposite = preferredSpace < 276;
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
        if (rtl) {
          if (activeSubmenuId) {
            activeSubmenuId = null;
            activeSubmenuIndex = 0;
            focusMenuItem(activeSectionItems()[activeItemIndex]);
          } else {
            const sectionIndex = (model.findIndex((section) => section.id === openSectionId) - 1 + model.length) % model.length;
            openSection(model[sectionIndex]?.id ?? "");
          }
        } else if (activeSubmenuId) {
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
        if (rtl) {
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
        } else if (activeSubmenuId) {
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
    if (openSectionId === id) closeMenu(false);
    else openSection(id, event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY });
  }

  function handleItemHover(event: MouseEvent, item: MenuItem): void {
    if (item.disabled) return;
    const node = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    const section = sectionById(openSectionId);
    activeItemIndex = selectableItems(section?.items ?? []).findIndex((candidate) => candidate.id === item.id);
    if (item.submenu) {
      openSubmenu(item, node);
    } else {
      // Leaving an item with a submenu closes that submenu. Without this, the
      // format list stayed open while the pointer moved across neighboring items,
      // making it look as if File had opened it by itself.
      activeSubmenuId = null;
      activeSubmenuIndex = 0;
    }
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

<header class="menu-bar" bind:this={menuRoot} aria-label={t("menu.mainMenu")}>
  <div class="menu-groups">
    <span class="window-title" title={displayTitle}>{displayTitle}</span>
    <div class="menu-tabs" aria-label={t("menu.sections")} role="menubar" tabindex="-1">
      {#each model as section}
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSectionId === section.id}
          class:menu-open={openSectionId === section.id}
          onclick={(event) => handleSectionClick(event, section.id)}
        >{section.label}</button>
      {/each}
    </div>
  </div>

  <div class="save-controls" aria-label={t("menu.documentSaveControls")}>
    <span class:status-pending={saveStatus === "pending"} class:status-saved={saveStatus === "saved"}>{statusLabel}</span>
    <button type="button" onclick={() => onSave?.()} disabled={saveStatus === "pending" || saveStatus === "readonly"}>{t("menu.save")}</button>
    <button type="button" onclick={() => onSaveAs?.()}>{t("menu.saveAs")}</button>
  </div>

  {#if openSectionId}
    {@const section = sectionById(openSectionId)}
    <div class="menu-popup" role="menu" aria-label={section?.label} style={`left: ${popupLeft}px; top: ${popupTop}px`}>
      {#each section?.items ?? [] as menuItem}
        {#if menuItem.separator}
          <div class="menu-separator" role="separator"></div>
        {:else if menuItem.kind === "label"}
          <div class="menu-caption" role="presentation">{menuItem.label}</div>
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
            <div class:submenu-opposite={submenuOpensOpposite} class="submenu-panel" role="menu">
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
    margin-inline-end: 8px;
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
    /* The 4px gap is not cosmetic: the menu opens with the pointer 2px inside
       the border, and this field is what keeps it there. If removed, the pointer
       lands directly on the first item, fires mouseenter, and the format submenu
       starts popping open by itself again. */
    position: fixed;
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
  .menu-popup > button, .submenu-panel button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 28px; padding: 5px 9px; text-align: start; }
  .item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-trailing { display: flex; align-items: center; gap: 14px; margin-inline-start: 18px; }
  .shortcut { color: var(--text-faint); font-family: var(--font-mono); font-size: var(--font-size-mono); white-space: nowrap; }
  .submenu-arrow { color: var(--text-muted); font-size: 18px; line-height: 0.7; }
  :global([dir="rtl"]) .submenu-arrow { transform: scaleX(-1); }
  /* A label, not an item: no hover, no focus, quieter than ordinary text. */
  .menu-caption {
    padding: 4px 9px 6px;
    color: var(--text-faint);
    font-size: 11px;
    text-align: start;
    cursor: default;
    user-select: none;
  }

  .menu-separator { height: 1px; margin: 4px 5px; background: var(--bg-modifier-border); }
  .submenu-panel {
    position: absolute;
    top: 4px;
    inset-inline-start: calc(100% - 4px);
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
  .submenu-panel.submenu-opposite { inset-inline-end: calc(100% - 4px); inset-inline-start: auto; }

  @media (max-width: 760px) {
    .window-title { display: none; }
    .menu-bar { gap: 6px; padding: 0 6px; }
  }
</style>
