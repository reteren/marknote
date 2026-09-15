<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createContextFormatGroups, type MenuItem as ModelMenuItem } from "./menuModel";

  export type ContextMenuTarget = "selection" | "empty" | "link" | "image";

  export type ContextMenuAction =
    | "cut" | "copy" | "paste" | "delete" | "select-all"
    | "edit.pastePlainText"
    | "bold" | "italic" | "code" | "strikethrough" | "highlight" | "link"
    | "format.bold" | "format.italic" | "format.strikethrough" | "format.highlight"
    | "format.code" | "format.link"
    | "format.heading1" | "format.heading2" | "format.heading3" | "format.heading4" | "format.heading5" | "format.heading6"
    | "format.clearHeading" | "format.list" | "format.table" | "format.callout" | "format.codeBlock" | "format.mathBlock" | "format.horizontalRule"
    | "open-link" | "copy-link" | "edit-link" | "open-image" | "copy-image"
    | "insert-table" | "insert-callout" | "insert-code-block" | "insert-math-block" | "insert-hr";

  export type MenuItem = {
    id: ContextMenuAction;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    payload?: string;
  };

  type Separator = { separator: true };
  type MenuOption = MenuItem | Separator;
  type SubmenuEntry = { kind: "submenu"; label: string; items: MenuOption[] };
  type MenuEntry = MenuOption | SubmenuEntry;
  type FocusableRootEntry = MenuItem | SubmenuEntry;

  type Props = {
    open?: boolean;
    x?: number;
    y?: number;
    targetType?: ContextMenuTarget;
    linkUrl?: string | null;
    imageSrc?: string | null;
    hasSelection?: boolean;
    canPaste?: boolean;
    editable?: boolean;
    targetElement?: HTMLElement | null;
    autoAttach?: boolean;
    onSelect?: (action: ContextMenuAction, payload?: string) => void;
    onClose?: () => void;
  };

  let {
    open = $bindable(false),
    x = $bindable(0),
    y = $bindable(0),
    targetType = $bindable<ContextMenuTarget>("empty"),
    linkUrl = null,
    imageSrc = null,
    hasSelection = false,
    canPaste = true,
    editable = true,
    targetElement = null,
    autoAttach = true,
    onSelect,
    onClose,
  }: Props = $props();

  let layerRef: HTMLDivElement | undefined = $state();
  let menuRef: HTMLDivElement | undefined = $state();
  let submenuRef: HTMLDivElement | undefined = $state();
  let activeSubmenuLabel = $state<string | null>(null);
  let focusedRootIndex = $state(-1);
  let focusedSubmenuIndex = $state(-1);
  let adjustedX = $state(0);
  let adjustedY = $state(0);
  let submenuX = $state(0);
  let submenuY = $state(0);
  let returnFocusElement: HTMLElement | null = null;

  function toOption(item: ModelMenuItem): MenuOption {
    if (item.separator) return { separator: true };
    return {
      id: item.id as ContextMenuAction,
      label: item.label,
      ...(item.shortcut ? { shortcut: item.shortcut } : {}),
      disabled: item.disabled,
    };
  }

  const formatSubmenus = $derived.by<SubmenuEntry[]>(() =>
    createContextFormatGroups({ editable }).map((group) => ({
      kind: "submenu",
      label: group.label,
      items: group.items.map(toOption),
    })),
  );

  const entries = $derived.by<MenuEntry[]>(() => {
    if (targetType === "link" || linkUrl) {
      const url = linkUrl ?? "";
      return [
        { id: "open-link", label: "Open Link", payload: url },
        { id: "copy-link", label: "Copy Link Address", payload: url },
        { id: "edit-link", label: "Edit Link", payload: url },
        { separator: true },
        { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
      ];
    }

    if (targetType === "image" || imageSrc) {
      const src = imageSrc ?? "";
      return [
        { id: "open-image", label: "Open Image", payload: src },
        { id: "copy-image", label: "Copy Image Path", payload: src },
        { separator: true },
        { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
      ];
    }

    const selectionExists = targetType === "selection" || hasSelection;
    return [
      ...formatSubmenus,
      { separator: true },
      { id: "cut", label: "Cut", shortcut: "Ctrl+X", disabled: !selectionExists || !editable },
      { id: "copy", label: "Copy", shortcut: "Ctrl+C", disabled: !selectionExists },
      { id: "paste", label: "Paste", shortcut: "Ctrl+V", disabled: !canPaste || !editable },
      { id: "edit.pastePlainText", label: "Paste as Plain Text", shortcut: "Ctrl+Shift+V", disabled: !canPaste || !editable },
      { id: "delete", label: "Delete", disabled: !selectionExists || !editable },
      { id: "select-all", label: "Select All", shortcut: "Ctrl+A" },
    ];
  });

  const rootFocusable = $derived.by<FocusableRootEntry[]>(() =>
    entries.filter((entry): entry is FocusableRootEntry =>
      "kind" in entry || (!("separator" in entry) && !entry.disabled),
    ),
  );

  const activeSubmenu = $derived.by<SubmenuEntry | undefined>(() =>
    entries.find((entry): entry is SubmenuEntry => "kind" in entry && entry.label === activeSubmenuLabel),
  );

  const submenuFocusable = $derived.by<MenuItem[]>(() =>
    (activeSubmenu?.items ?? []).filter((entry): entry is MenuItem => !("separator" in entry) && !entry.disabled),
  );

  function adjustRootPosition(targetX: number, targetY: number): void {
    if (typeof window === "undefined") {
      adjustedX = targetX;
      adjustedY = targetY;
      return;
    }

    const margin = 8;
    const menuWidth = menuRef?.offsetWidth || 230;
    const menuHeight = menuRef?.offsetHeight || Math.min(360, Math.max(170, entries.length * 30));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let posX = targetX;
    let posY = targetY;

    if (posX + menuWidth > viewportWidth - margin) posX = Math.max(margin, posX - menuWidth);
    if (posY + menuHeight > viewportHeight - margin) posY = Math.max(margin, viewportHeight - menuHeight - margin);
    adjustedX = Math.max(margin, posX);
    adjustedY = Math.max(margin, posY);
  }

  function adjustSubmenuPosition(anchor: HTMLElement): void {
    if (typeof window === "undefined") return;
    const margin = 8;
    const rect = anchor.getBoundingClientRect();
    const width = submenuRef?.offsetWidth || 220;
    const height = submenuRef?.offsetHeight || Math.max(150, (activeSubmenu?.items.length ?? 5) * 29);
    const openLeft = rect.right + width > window.innerWidth - margin;
    submenuX = openLeft ? Math.max(margin, rect.left - width) : rect.right - 2;
    submenuY = rect.top + height > window.innerHeight - margin
      ? Math.max(margin, window.innerHeight - height - margin)
      : Math.max(margin, rect.top - 4);
  }

  function openSubmenu(group: SubmenuEntry, trigger?: HTMLElement): void {
    activeSubmenuLabel = group.label;
    focusedSubmenuIndex = -1;
    if (trigger) {
      void tick().then(() => adjustSubmenuPosition(trigger));
    }
  }

  function closeSubmenuAndFocusTrigger(): void {
    const groupLabel = activeSubmenuLabel;
    activeSubmenuLabel = null;
    focusedSubmenuIndex = -1;
    const index = rootFocusable.findIndex((entry) => "kind" in entry && entry.label === groupLabel);
    focusedRootIndex = index;
    void tick().then(() => focusRootItem(index));
  }

  function focusRootItem(index: number): void {
    void tick().then(() => menuRef?.querySelector<HTMLButtonElement>(`[data-menu-level="root"][data-index="${index}"]`)?.focus());
  }

  function focusSubmenuItem(index: number): void {
    void tick().then(() => submenuRef?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)?.focus());
  }

  $effect(() => {
    if (!open) return;
    adjustRootPosition(x, y);
    focusedRootIndex = -1;
    activeSubmenuLabel = null;
    void tick().then(() => {
      adjustRootPosition(x, y);
      menuRef?.focus();
    });
  });

  function closeMenu(restoreFocus = false): void {
    if (!open) return;
    open = false;
    activeSubmenuLabel = null;
    focusedRootIndex = -1;
    focusedSubmenuIndex = -1;
    onClose?.();
    if (restoreFocus) {
      const focusTarget = returnFocusElement ?? targetElement;
      void tick().then(() => focusTarget?.focus());
    }
  }

  function handleSelect(item: MenuItem): void {
    if (item.disabled) return;
    closeMenu(true);
    onSelect?.(item.id, item.payload);
  }

  function activateRoot(entry: FocusableRootEntry): void {
    if ("kind" in entry) {
      if (activeSubmenuLabel === entry.label) {
        activeSubmenuLabel = null;
        focusedSubmenuIndex = -1;
      } else {
        const trigger = menuRef?.querySelector<HTMLButtonElement>(`[data-submenu-label="${entry.label}"]`);
        openSubmenu(entry, trigger ?? undefined);
      }
    } else {
      handleSelect(entry);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!open) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const inSubmenu = target?.closest<HTMLElement>("[data-menu-level='submenu']") !== null;

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        event.stopPropagation();
        if (inSubmenu) {
          if (submenuFocusable.length === 0) break;
          focusedSubmenuIndex = event.key === "ArrowDown"
            ? (focusedSubmenuIndex + 1) % submenuFocusable.length
            : focusedSubmenuIndex <= 0 ? submenuFocusable.length - 1 : focusedSubmenuIndex - 1;
          focusSubmenuItem(focusedSubmenuIndex);
        } else {
          if (rootFocusable.length === 0) break;
          focusedRootIndex = event.key === "ArrowDown"
            ? (focusedRootIndex + 1) % rootFocusable.length
            : focusedRootIndex <= 0 ? rootFocusable.length - 1 : focusedRootIndex - 1;
          const current = rootFocusable[focusedRootIndex];
          if (current && !("kind" in current) && activeSubmenuLabel) activeSubmenuLabel = null;
          focusRootItem(focusedRootIndex);
        }
        break;
      }
      case "Home":
      case "End":
        event.preventDefault();
        if (inSubmenu && submenuFocusable.length) {
          focusedSubmenuIndex = event.key === "Home" ? 0 : submenuFocusable.length - 1;
          focusSubmenuItem(focusedSubmenuIndex);
        } else if (rootFocusable.length) {
          focusedRootIndex = event.key === "Home" ? 0 : rootFocusable.length - 1;
          focusRootItem(focusedRootIndex);
        }
        break;
      case "ArrowRight":
        event.preventDefault();
        if (!inSubmenu) {
          const current = rootFocusable[focusedRootIndex];
          if (current && "kind" in current) {
            const trigger = menuRef?.querySelector<HTMLButtonElement>(`[data-submenu-label="${current.label}"]`);
            openSubmenu(current, trigger ?? undefined);
            focusedSubmenuIndex = 0;
            focusSubmenuItem(0);
          }
        }
        break;
      case "ArrowLeft":
        if (inSubmenu) {
          event.preventDefault();
          closeSubmenuAndFocusTrigger();
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (inSubmenu) {
          const item = submenuFocusable[focusedSubmenuIndex];
          if (item) handleSelect(item);
        } else {
          const item = rootFocusable[focusedRootIndex];
          if (item) activateRoot(item);
        }
        break;
      default:
        break;
    }
  }

  function handleRootHover(entry: FocusableRootEntry, event: MouseEvent): void {
    focusedRootIndex = rootFocusable.indexOf(entry);
    if ("kind" in entry) {
      const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
      openSubmenu(entry, trigger);
    } else {
      activeSubmenuLabel = null;
      focusedSubmenuIndex = -1;
    }
  }

  function handleSubmenuHover(item: MenuItem): void {
    focusedSubmenuIndex = submenuFocusable.indexOf(item);
  }

  onMount(() => {
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      if (!autoAttach) return;

      returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      const img = target?.closest<HTMLImageElement>("img");
      const selection = window.getSelection();
      const hasTextSelection = selection ? !selection.isCollapsed && selection.toString().length > 0 : false;
      x = event.clientX;
      y = event.clientY;
      linkUrl = null;
      imageSrc = null;

      if (anchor?.href) {
        targetType = "link";
        linkUrl = anchor.href;
      } else if (img?.src) {
        targetType = "image";
        imageSrc = img.src;
      } else if (hasTextSelection) {
        targetType = "selection";
      } else {
        targetType = "empty";
      }
      open = true;
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (open && layerRef && !layerRef.contains(event.target as Node)) closeMenu();
    };

    const attachTarget = targetElement ?? window;
    attachTarget.addEventListener("contextmenu", handleContextMenu as EventListener);
    window.addEventListener("pointerdown", handlePointerDown);
    const handleResize = (): void => closeMenu();
    window.addEventListener("resize", handleResize);
    return () => {
      attachTarget.removeEventListener("contextmenu", handleContextMenu as EventListener);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
    };
  });
</script>

{#if open}
  <div bind:this={layerRef} class="context-menu-layer">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={menuRef}
      class="context-menu"
      style:left="{adjustedX}px"
      style:top="{adjustedY}px"
      role="menu"
      tabindex="0"
      aria-label="Context menu"
      data-menu-level="root"
      onkeydown={handleKeyDown}
    >
      {#each entries as entry}
        {#if "separator" in entry}
          <div class="separator" role="separator"></div>
        {:else if "kind" in entry}
          {@const itemIndex = rootFocusable.indexOf(entry)}
          <button
            type="button"
            role="menuitem"
            class="menu-item submenu-trigger"
            class:focused={itemIndex === focusedRootIndex}
            aria-haspopup="menu"
            aria-expanded={activeSubmenuLabel === entry.label}
            data-menu-level="root"
            data-index={itemIndex}
            data-submenu-label={entry.label}
            tabindex={itemIndex === focusedRootIndex ? 0 : -1}
            onclick={() => activateRoot(entry)}
            onmouseenter={(event) => handleRootHover(entry, event)}
          >
            <span class="label">{entry.label}</span>
            <span class="submenu-arrow" aria-hidden="true">›</span>
          </button>
        {:else}
          {@const itemIndex = rootFocusable.indexOf(entry)}
          <button
            type="button"
            role="menuitem"
            class="menu-item"
            class:focused={itemIndex === focusedRootIndex}
            disabled={entry.disabled}
            data-menu-level="root"
            data-menu-action={entry.id}
            data-index={itemIndex}
            tabindex={itemIndex === focusedRootIndex ? 0 : -1}
            onclick={() => handleSelect(entry)}
            onmouseenter={(event) => handleRootHover(entry, event)}
          >
            <span class="label">{entry.label}</span>
            {#if entry.shortcut}<span class="shortcut">{entry.shortcut}</span>{/if}
          </button>
        {/if}
      {/each}
    </div>

    {#if activeSubmenu}
      <div
        bind:this={submenuRef}
        class="context-submenu"
        style:left="{submenuX}px"
        style:top="{submenuY}px"
        role="menu"
        aria-label={activeSubmenu.label}
        tabindex="-1"
        data-menu-level="submenu"
        onkeydown={handleKeyDown}
      >
        {#each activeSubmenu.items as item}
          {#if "separator" in item}
            <div class="separator" role="separator"></div>
          {:else}
            {@const itemIndex = submenuFocusable.indexOf(item)}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              class:focused={itemIndex === focusedSubmenuIndex}
              disabled={item.disabled}
              data-menu-action={item.id}
              data-index={itemIndex}
              tabindex={itemIndex === focusedSubmenuIndex ? 0 : -1}
              onclick={() => handleSelect(item)}
              onmouseenter={() => handleSubmenuHover(item)}
            >
              <span class="label">{item.label}</span>
              {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .context-menu-layer { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }

  .context-menu,
  .context-submenu {
    position: fixed;
    min-width: 210px;
    max-width: min(280px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 4px;
    margin: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    line-height: var(--line-height-ui);
    color: var(--text-normal);
    user-select: none;
    outline: none;
    pointer-events: auto;
  }

  .separator { height: 1px; margin: 4px 2px; background: var(--bg-modifier-border); }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    text-align: left;
    cursor: pointer;
    outline: none;
    transition: background 0.08s ease;
  }

  .menu-item:hover:not(:disabled), .menu-item.focused:not(:disabled) {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }
  .menu-item:active:not(:disabled) { background: var(--bg-modifier-active); }
  .menu-item:disabled { color: var(--text-faint); cursor: default; }
  .label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .shortcut { margin-left: 14px; color: var(--text-faint); font-size: 11px; white-space: nowrap; }
  .submenu-arrow { margin-left: 18px; color: var(--text-muted); font-size: 18px; line-height: 0.7; }
</style>
