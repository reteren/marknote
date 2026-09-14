<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { openSearchPanel, setSearchQuery } from "@codemirror/search";
  import {
    createSearchQuery,
    getInitialSearchText,
    getRegExpError,
    getSearchStats,
    isValidRegExp,
    searchCommands,
    SEARCH_CLOSE_EVENT,
    SEARCH_OPEN_EVENT,
    type SearchOpenEventDetail,
    type SearchStats,
  } from "../editor/search";

  type Props = {
    view?: EditorView | null;
    isOpen?: boolean;
    replaceMode?: boolean;
    onClose?: () => void;
    onOpen?: () => void;
  };

  let {
    view = null,
    isOpen = $bindable(false),
    replaceMode = $bindable(false),
    onClose,
    onOpen,
  }: Props = $props();

  let search = $state("");
  let replace = $state("");
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let regexp = $state(false);
  let stats = $state<SearchStats>({ total: 0, current: 0 });

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let replaceInputEl = $state<HTMLInputElement | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const regexError = $derived(regexp ? getRegExpError(search) : null);
  const isRegexInvalid = $derived(regexp && regexError !== null);

  const counterText = $derived.by(() => {
    if (!search) return "";
    if (isRegexInvalid) return "Ошибка regex";
    if (stats.total === 0) return "нет совпадений";
    if (stats.current > 0) return `${stats.current} из ${stats.total}`;
    return `${stats.total} совпадений`;
  });

  function syncSearchQuery(): void {
    if (!view) return;
    const query = createSearchQuery({
      search,
      replace,
      caseSensitive,
      wholeWord,
      regexp,
    });

    view.dispatch({
      effects: setSearchQuery.of(query),
    });

    if (isOpen && query.valid && search) {
      openSearchPanel(view);
    }

    stats = getSearchStats(view.state, query);
  }

  function scheduleSync(immediate = false): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (immediate) {
      syncSearchQuery();
    } else {
      debounceTimer = setTimeout(() => {
        syncSearchQuery();
      }, 60);
    }
  }

  export function open(withReplace = false, initialText?: string): void {
    isOpen = true;
    replaceMode = withReplace;

    if (initialText !== undefined) {
      search = initialText;
    } else if (view) {
      const selected = getInitialSearchText(view.state);
      if (selected) {
        search = selected;
      }
    }

    scheduleSync(true);
    onOpen?.();

    setTimeout(() => {
      if (withReplace && replaceInputEl && search) {
        replaceInputEl.focus();
        replaceInputEl.select();
      } else if (searchInputEl) {
        searchInputEl.focus();
        searchInputEl.select();
      }
    }, 0);
  }

  export function close(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    isOpen = false;
    if (view) {
      searchCommands.close(view);
    }
    onClose?.();
  }

  function handleNext(): void {
    scheduleSync(true);
    if (view) {
      searchCommands.findNext(view);
      const query = createSearchQuery({ search, replace, caseSensitive, wholeWord, regexp });
      stats = getSearchStats(view.state, query);
    }
  }

  function handlePrevious(): void {
    scheduleSync(true);
    if (view) {
      searchCommands.findPrevious(view);
      const query = createSearchQuery({ search, replace, caseSensitive, wholeWord, regexp });
      stats = getSearchStats(view.state, query);
    }
  }

  function handleReplaceOne(): void {
    scheduleSync(true);
    if (view) {
      searchCommands.replaceNext(view);
      const query = createSearchQuery({ search, replace, caseSensitive, wholeWord, regexp });
      stats = getSearchStats(view.state, query);
    }
  }

  function handleReplaceAll(): void {
    scheduleSync(true);
    if (view) {
      searchCommands.replaceAll(view);
      const query = createSearchQuery({ search, replace, caseSensitive, wholeWord, regexp });
      stats = getSearchStats(view.state, query);
    }
  }

  function toggleCase(): void {
    caseSensitive = !caseSensitive;
    scheduleSync(true);
  }

  function toggleWholeWord(): void {
    wholeWord = !wholeWord;
    scheduleSync(true);
  }

  function toggleRegexp(): void {
    regexp = !regexp;
    scheduleSync(true);
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function onReplaceKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      handleReplaceOne();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function onPanelKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      replaceMode = false;
      searchInputEl?.focus();
      searchInputEl?.select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
      e.preventDefault();
      replaceMode = true;
      replaceInputEl?.focus();
      replaceInputEl?.select();
    }
  }

  onMount(() => {
    const handleGlobalKeydown = (e: KeyboardEvent): void => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === "f" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        open(false);
      } else if (isMod && e.key.toLowerCase() === "h" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        open(true);
      }
    };

    const handleOpenEvent = (e: Event): void => {
      const detail = (e as CustomEvent<SearchOpenEventDetail>).detail;
      open(detail?.replaceMode ?? false, detail?.query);
    };

    const handleCloseEvent = (): void => {
      close();
    };

    const handleSelectionUpdate = (): void => {
      if (isOpen && view && search) {
        const query = createSearchQuery({ search, replace, caseSensitive, wholeWord, regexp });
        stats = getSearchStats(view.state, query);
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener(SEARCH_OPEN_EVENT, handleOpenEvent);
    window.addEventListener(SEARCH_CLOSE_EVENT, handleCloseEvent);
    window.addEventListener("mouseup", handleSelectionUpdate);
    window.addEventListener("keyup", handleSelectionUpdate);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      window.removeEventListener(SEARCH_OPEN_EVENT, handleOpenEvent);
      window.removeEventListener(SEARCH_CLOSE_EVENT, handleCloseEvent);
      window.removeEventListener("mouseup", handleSelectionUpdate);
      window.removeEventListener("keyup", handleSelectionUpdate);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="find-panel"
    role="dialog"
    tabindex="-1"
    aria-label="Поиск и замена"
    onkeydown={onPanelKeydown}
  >
    <!-- Строка 1: Поиск -->
    <div class="panel-row">
      <button
        type="button"
        class="btn-icon toggle-replace"
        class:expanded={replaceMode}
        title={replaceMode ? "Скрыть замену" : "Показать замену (Ctrl+H)"}
        onclick={() => (replaceMode = !replaceMode)}
        aria-label="Переключить панель замены"
      >
        <span class="chevron">{replaceMode ? "▼" : "▶"}</span>
      </button>

      <div class="input-wrapper" class:has-error={isRegexInvalid}>
        <input
          type="text"
          bind:this={searchInputEl}
          bind:value={search}
          placeholder="Найти…"
          aria-label="Строка поиска"
          aria-invalid={isRegexInvalid}
          title={isRegexInvalid ? (regexError ?? "Некорректное регулярное выражение") : ""}
          oninput={() => scheduleSync(false)}
          onkeydown={onSearchKeydown}
        />

        <div class="input-toggles">
          <button
            type="button"
            class="toggle-btn"
            class:active={caseSensitive}
            title="Учитывать регистр (Alt+C)"
            aria-pressed={caseSensitive}
            onclick={toggleCase}
          >
            Aa
          </button>
          <button
            type="button"
            class="toggle-btn"
            class:active={wholeWord}
            title="Слово целиком (Alt+W)"
            aria-pressed={wholeWord}
            onclick={toggleWholeWord}
          >
            \b
          </button>
          <button
            type="button"
            class="toggle-btn"
            class:active={regexp}
            title="Регулярное выражение (Alt+R)"
            aria-pressed={regexp}
            onclick={toggleRegexp}
          >
            .*
          </button>
        </div>
      </div>

      <div class="status-group">
        <span class="counter" class:error={isRegexInvalid}>
          {counterText}
        </span>
      </div>

      <div class="nav-group">
        <button
          type="button"
          class="btn-icon"
          title="Предыдущее совпадение (Shift+Enter)"
          aria-label="Предыдущее совпадение"
          disabled={stats.total === 0}
          onclick={handlePrevious}
        >
          ↑
        </button>
        <button
          type="button"
          class="btn-icon"
          title="Следующее совпадение (Enter)"
          aria-label="Следующее совпадение"
          disabled={stats.total === 0}
          onclick={handleNext}
        >
          ↓
        </button>
        <button
          type="button"
          class="btn-icon close-btn"
          title="Закрыть (Esc)"
          aria-label="Закрыть панель поиска"
          onclick={close}
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Строка 2: Замена (при replaceMode) -->
    {#if replaceMode}
      <div class="panel-row replace-row">
        <div class="row-spacer"></div>

        <div class="input-wrapper">
          <input
            type="text"
            bind:this={replaceInputEl}
            bind:value={replace}
            placeholder="Заменить на…"
            aria-label="Строка замены"
            oninput={() => scheduleSync(false)}
            onkeydown={onReplaceKeydown}
          />
        </div>

        <div class="replace-actions">
          <button
            type="button"
            class="btn-action"
            title="Заменить текущее (Enter)"
            disabled={stats.total === 0}
            onclick={handleReplaceOne}
          >
            Заменить
          </button>
          <button
            type="button"
            class="btn-action"
            title="Заменить все совпадения"
            disabled={stats.total === 0}
            onclick={handleReplaceAll}
          >
            Заменить всё
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-panel {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    color: var(--text-normal);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    min-width: 320px;
    max-width: min(540px, calc(100vw - 32px));
  }

  .panel-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .row-spacer {
    width: 24px;
    flex-shrink: 0;
  }

  .toggle-replace {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chevron {
    font-size: 10px;
    line-height: 1;
    color: var(--text-muted);
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 160px;
    background: var(--bg-primary);
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
  }

  .input-wrapper:focus-within {
    border-color: var(--accent);
  }

  .input-wrapper.has-error {
    border-color: var(--text-error) !important;
  }

  input[type="text"] {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--text-normal);
    font-family: inherit;
    font-size: var(--font-size-ui);
    outline: none;
  }

  input[type="text"]::placeholder {
    color: var(--text-faint);
  }

  .input-toggles {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
  }

  .toggle-btn {
    padding: 2px 5px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    line-height: 1.2;
  }

  .toggle-btn:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .toggle-btn.active {
    background: var(--bg-modifier-active);
    color: var(--text-accent);
    outline: 1px solid var(--accent);
  }

  .status-group {
    min-width: 70px;
    text-align: right;
    white-space: nowrap;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .counter {
    color: var(--text-muted);
    font-size: 12px;
  }

  .counter.error {
    color: var(--text-error);
  }

  .nav-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .btn-icon:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  .close-btn:hover {
    color: var(--text-error);
  }

  .replace-row {
    padding-top: 2px;
  }

  .replace-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .btn-action {
    padding: 3px 8px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: var(--bg-primary);
    color: var(--text-normal);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-action:hover:not(:disabled) {
    background: var(--bg-modifier-hover);
    border-color: var(--bg-modifier-border-hover);
  }

  .btn-action:active:not(:disabled) {
    background: var(--bg-modifier-active);
  }

  .btn-action:disabled {
    color: var(--text-faint);
    cursor: default;
    border-color: transparent;
    background: transparent;
  }
</style>
