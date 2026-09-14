<script lang="ts">
  import { onMount, tick } from "svelte";

  export type ContextMenuTarget = "selection" | "empty" | "link" | "image";

  export type ContextMenuAction =
    | "cut"
    | "copy"
    | "paste"
    | "delete"
    | "select-all"
    | "bold"
    | "italic"
    | "code"
    | "strikethrough"
    | "highlight"
    | "link"
    | "open-link"
    | "copy-link"
    | "edit-link"
    | "open-image"
    | "copy-image"
    | "insert-table"
    | "insert-callout"
    | "insert-code-block"
    | "insert-math-block"
    | "insert-hr";

  export type MenuItem = {
    id: ContextMenuAction;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    payload?: string;
  };

  export type MenuEntry = MenuItem | { separator: true };

  type Props = {
    open?: boolean;
    x?: number;
    y?: number;
    targetType?: ContextMenuTarget;
    linkUrl?: string | null;
    imageSrc?: string | null;
    hasSelection?: boolean;
    canPaste?: boolean;
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
    targetElement = null,
    autoAttach = true,
    onSelect,
    onClose,
  }: Props = $props();

  let menuRef: HTMLDivElement | undefined = $state();
  let focusedIndex = $state(-1);
  let adjustedX = $state(0);
  let adjustedY = $state(0);

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

    if (targetType === "selection" || hasSelection) {
      return [
        { id: "cut", label: "Cut", shortcut: "Ctrl+X" },
        { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
        { id: "paste", label: "Paste", shortcut: "Ctrl+V", disabled: !canPaste },
        { id: "delete", label: "Delete" },
        { separator: true },
        { id: "bold", label: "Bold", shortcut: "Ctrl+B" },
        { id: "italic", label: "Italic", shortcut: "Ctrl+I" },
        { id: "code", label: "Code", shortcut: "Ctrl+E" },
        { id: "strikethrough", label: "Strikethrough" },
        { id: "highlight", label: "Highlight" },
        { id: "link", label: "Link", shortcut: "Ctrl+K" },
      ];
    }

    // Над пустым местом (без выделения)
    return [
      { id: "paste", label: "Paste", shortcut: "Ctrl+V", disabled: !canPaste },
      { id: "select-all", label: "Select All", shortcut: "Ctrl+A" },
      { separator: true },
      { id: "insert-table", label: "Table" },
      { id: "insert-callout", label: "Callout" },
      { id: "insert-code-block", label: "Code Block", shortcut: "Ctrl+Shift+K" },
      { id: "insert-math-block", label: "Formula Block" },
      { id: "insert-hr", label: "Horizontal Line" },
    ];
  });

  const interactiveItems = $derived.by<MenuItem[]>(() => {
    return entries.filter((item): item is MenuItem => !("separator" in item) && !item.disabled);
  });

  function adjustPosition(targetX: number, targetY: number): void {
    if (typeof window === "undefined") {
      adjustedX = targetX;
      adjustedY = targetY;
      return;
    }

    const margin = 8;
    const menuWidth = menuRef?.offsetWidth || 210;
    const menuHeight = menuRef?.offsetHeight || 260;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let posX = targetX;
    let posY = targetY;

    // Переворот влево, если меню вылезает за правый край
    if (posX + menuWidth > viewportWidth - margin) {
      posX = Math.max(margin, posX - menuWidth);
    }

    // Переворот вверх, если меню вылезает за нижний край
    if (posY + menuHeight > viewportHeight - margin) {
      posY = Math.max(margin, posY - menuHeight);
    }

    adjustedX = Math.max(margin, posX);
    adjustedY = Math.max(margin, posY);
  }

  $effect(() => {
    if (open) {
      adjustPosition(x, y);
      focusedIndex = -1;
      void tick().then(() => {
        adjustPosition(x, y);
        menuRef?.focus();
      });
    }
  });

  function closeMenu(): void {
    if (!open) return;
    open = false;
    focusedIndex = -1;
    onClose?.();
  }

  function handleSelect(item: MenuItem): void {
    if (item.disabled) return;
    closeMenu();
    onSelect?.(item.id, item.payload);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!open) return;

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        break;

      case "ArrowDown": {
        event.preventDefault();
        event.stopPropagation();
        if (interactiveItems.length === 0) break;
        focusedIndex = (focusedIndex + 1) % interactiveItems.length;
        focusCurrentItem();
        break;
      }

      case "ArrowUp": {
        event.preventDefault();
        event.stopPropagation();
        if (interactiveItems.length === 0) break;
        focusedIndex = focusedIndex <= 0 ? interactiveItems.length - 1 : focusedIndex - 1;
        focusCurrentItem();
        break;
      }

      case "Home": {
        event.preventDefault();
        if (interactiveItems.length > 0) {
          focusedIndex = 0;
          focusCurrentItem();
        }
        break;
      }

      case "End": {
        event.preventDefault();
        if (interactiveItems.length > 0) {
          focusedIndex = interactiveItems.length - 1;
          focusCurrentItem();
        }
        break;
      }

      case "Enter":
      case " ": {
        event.preventDefault();
        event.stopPropagation();
        if (focusedIndex >= 0 && focusedIndex < interactiveItems.length) {
          const item = interactiveItems[focusedIndex];
          if (item) handleSelect(item);
        }
        break;
      }
    }
  }

  function focusCurrentItem(): void {
    void tick().then(() => {
      const activeElement = menuRef?.querySelector<HTMLButtonElement>(`[data-index="${focusedIndex}"]`);
      activeElement?.focus();
    });
  }

  onMount(() => {
    // Отключение штатного контекстного меню WebView2
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();

      if (!autoAttach) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      const img = target?.closest<HTMLImageElement>("img");
      const selection = window.getSelection();
      const hasTextSelection = selection ? !selection.isCollapsed && selection.toString().length > 0 : false;

      x = event.clientX;
      y = event.clientY;

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
      if (!open) return;
      if (menuRef && !menuRef.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const attachTarget = targetElement ?? window;
    attachTarget.addEventListener("contextmenu", handleContextMenu as EventListener);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", closeMenu);

    return () => {
      attachTarget.removeEventListener("contextmenu", handleContextMenu as EventListener);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", closeMenu);
    };
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={menuRef}
    class="context-menu"
    style:left="{adjustedX}px"
    style:top="{adjustedY}px"
    role="menu"
    tabindex="0"
    aria-label="Контекстное меню"
    onkeydown={handleKeyDown}
  >
    {#each entries as entry}
      {#if "separator" in entry}
        <div class="separator" role="separator"></div>
      {:else}
        {@const itemIndex = interactiveItems.indexOf(entry)}
        <button
          type="button"
          role="menuitem"
          class="menu-item"
          class:focused={itemIndex === focusedIndex}
          disabled={entry.disabled}
          data-index={itemIndex}
          tabindex={itemIndex === focusedIndex ? 0 : -1}
          onclick={() => handleSelect(entry)}
          onmouseenter={() => { focusedIndex = itemIndex; }}
        >
          <span class="label">{entry.label}</span>
          {#if entry.shortcut}
            <span class="shortcut">{entry.shortcut}</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 190px;
    max-width: 280px;
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
  }

  .separator {
    height: 1px;
    margin: 4px 2px;
    background: var(--bg-modifier-border);
  }

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

  .menu-item:hover:not(:disabled),
  .menu-item.focused:not(:disabled) {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .menu-item:active:not(:disabled) {
    background: var(--bg-modifier-active);
  }

  .menu-item:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  .label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut {
    margin-left: 14px;
    color: var(--text-faint);
    font-size: 11px;
    white-space: nowrap;
  }
</style>
