import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  findNext as cmFindNext,
  findPrevious as cmFindPrevious,
  replaceNext as cmReplaceNext,
  replaceAll as cmReplaceAll,
} from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";

export type SearchQueryConfig = {
  search: string;
  replace?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
};

export type SearchMatch = {
  from: number;
  to: number;
};

export type SearchStats = {
  total: number;
  current: number; // 1-based, 0 if none
};

export const SEARCH_OPEN_EVENT = "marknote:search-open";
export const SEARCH_CLOSE_EVENT = "marknote:search-close";

export type SearchOpenEventDetail = {
  replaceMode: boolean;
  query?: string;
};

/**
 * Проверяет синтаксическую корректность регулярного выражения, не бросая исключений.
 */
export function isValidRegExp(source: string): boolean {
  if (!source) return true;
  try {
    new RegExp(source, "u");
    return true;
  } catch {
    return false;
  }
}

/**
 * Возвращает текст ошибки регулярного выражения или null, если выражение корректно.
 */
export function getRegExpError(source: string): string | null {
  if (!source) return null;
  try {
    new RegExp(source, "u");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Создаёт SearchQuery для CodeMirror, гарантируя отсутствие необработанных исключений при невалидном regex.
 */
export function createSearchQuery(config: SearchQueryConfig): SearchQuery {
  return new SearchQuery({
    search: config.search,
    replace: config.replace ?? "",
    caseSensitive: !!config.caseSensitive,
    wholeWord: !!config.wholeWord,
    regexp: !!config.regexp,
  });
}

/**
 * Возвращает текст выделения, если оно не пустое и помещается в одну строку.
 */
export function getInitialSearchText(state: EditorState): string | null {
  const sel = state.selection.main;
  if (sel.empty) return null;
  const text = state.sliceDoc(sel.from, sel.to);
  if (text.includes("\n") || text.includes("\r")) return null;
  return text;
}

/**
 * Ищет все непересекающиеся совпадения в документе с защитой от сбоев.
 */
export function findMatches(
  state: EditorState,
  queryConfig: SearchQueryConfig | SearchQuery,
  maxMatches = 100_000,
): SearchMatch[] {
  const query = queryConfig instanceof SearchQuery ? queryConfig : createSearchQuery(queryConfig);
  if (!query.search || !query.valid) return [];
  if (query.regexp && !isValidRegExp(query.search)) return [];

  const matches: SearchMatch[] = [];
  try {
    const cursor = query.getCursor(state) as unknown as {
      next(): { done: boolean; value: { from: number; to: number } };
      value: { from: number; to: number };
      done: boolean;
    };
    while (!cursor.next().done) {
      matches.push({ from: cursor.value.from, to: cursor.value.to });
      if (matches.length >= maxMatches) break;
    }
  } catch {
    return [];
  }
  return matches;
}

/**
 * Вычисляет счётчик совпадений: сколько всего и какое выбрано в данный момент.
 */
export function getSearchStats(
  state: EditorState,
  queryConfig: SearchQueryConfig | SearchQuery,
  selection?: { from: number; to: number },
): SearchStats {
  const matches = findMatches(state, queryConfig);
  const total = matches.length;
  if (total === 0) return { total: 0, current: 0 };

  const sel = selection ?? state.selection.main;

  // 1. Точное совпадение выделения с границами найденного участка
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (sel.from === m.from && sel.to === m.to) {
      return { total, current: i + 1 };
    }
  }

  // 2. Курсор или часть выделения находится внутри найденного участка
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (sel.from >= m.from && sel.to <= m.to) {
      return { total, current: i + 1 };
    }
  }

  return { total, current: 0 };
}

/**
 * Ищет следующее совпадение с переходом по кругу (от конца к началу).
 */
export function findNextMatch(
  state: EditorState,
  queryConfig: SearchQueryConfig | SearchQuery,
  fromPos?: number,
): SearchMatch | null {
  const matches = findMatches(state, queryConfig);
  if (matches.length === 0) return null;

  const currentSel = state.selection.main;
  const pos = fromPos ?? currentSel.to;

  for (const m of matches) {
    if (m.from >= pos) {
      if (m.from === currentSel.from && m.to === currentSel.to) {
        continue;
      }
      return m;
    }
  }

  // Переход по кругу
  return matches[0];
}

/**
 * Ищет предыдущее совпадение с переходом по кругу (от начала к концу).
 */
export function findPreviousMatch(
  state: EditorState,
  queryConfig: SearchQueryConfig | SearchQuery,
  fromPos?: number,
): SearchMatch | null {
  const matches = findMatches(state, queryConfig);
  if (matches.length === 0) return null;

  const currentSel = state.selection.main;
  const pos = fromPos ?? currentSel.from;

  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.to <= pos) {
      if (m.from === currentSel.from && m.to === currentSel.to) {
        continue;
      }
      return m;
    }
  }

  // Переход по кругу
  return matches[matches.length - 1];
}

/**
 * Вычисляет «заменить всё» на документе с корректной обработкой пересекающихся кандидатов.
 */
export function replaceAllMatches(
  state: EditorState,
  queryConfig: SearchQueryConfig | SearchQuery,
  replacement?: string,
): { changes: Array<{ from: number; to: number; insert: string }>; newDoc: string; count: number } {
  const query = queryConfig instanceof SearchQuery ? queryConfig : createSearchQuery(queryConfig);
  if (!query.search || !query.valid) {
    return { changes: [], newDoc: state.doc.toString(), count: 0 };
  }
  if (query.regexp && !isValidRegExp(query.search)) {
    return { changes: [], newDoc: state.doc.toString(), count: 0 };
  }

  const replaceStr = replacement ?? query.replace ?? "";
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  try {
    const cursor = query.getCursor(state) as unknown as {
      next(): { done: boolean; value: { from: number; to: number } };
      value: { from: number; to: number };
      done: boolean;
    };
    let lastEnd = 0;
    while (!cursor.next().done) {
      const { from, to } = cursor.value;
      if (from < lastEnd) continue; // исключаем пересечение с предыдущей заменой

      let insert = replaceStr;
      if (query.regexp) {
        const matchedText = state.sliceDoc(from, to);
        try {
          const re = new RegExp(query.search, query.caseSensitive ? "u" : "iu");
          insert = matchedText.replace(re, replaceStr);
        } catch {
          insert = replaceStr;
        }
      }

      changes.push({ from, to, insert });
      lastEnd = to;
    }
  } catch {
    return { changes: [], newDoc: state.doc.toString(), count: 0 };
  }

  if (changes.length === 0) {
    return { changes: [], newDoc: state.doc.toString(), count: 0 };
  }

  const tr = state.update({ changes });
  return {
    changes,
    newDoc: tr.state.doc.toString(),
    count: changes.length,
  };
}

export function dispatchSearchOpen(view: EditorView, replaceMode = false): void {
  const initialText = getInitialSearchText(view.state);
  const detail: SearchOpenEventDetail = {
    replaceMode,
    query: initialText ?? undefined,
  };

  if (typeof window !== "undefined") {
    view.dom?.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT, { detail, bubbles: true }));
    window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT, { detail }));
  }
}

export function dispatchSearchClose(view: EditorView): void {
  if (typeof window !== "undefined") {
    view.dom?.dispatchEvent(new CustomEvent(SEARCH_CLOSE_EVENT, { bubbles: true }));
    window.dispatchEvent(new CustomEvent(SEARCH_CLOSE_EVENT));
  }
}

/**
 * Набор команд управления поиском и заменой для CodeMirror и пользовательской панели.
 */
export const searchCommands = {
  openSearch: ((view: EditorView) => {
    dispatchSearchOpen(view, false);
    return true;
  }) as Command,

  openReplace: ((view: EditorView) => {
    dispatchSearchOpen(view, true);
    return true;
  }) as Command,

  findNext: ((view: EditorView) => {
    if (cmFindNext(view)) return true;

    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) return false;
    const next = findNextMatch(view.state, query);
    if (!next) return false;

    view.dispatch({
      selection: EditorSelection.single(next.from, next.to),
      scrollIntoView: true,
      userEvent: "select.search",
    });
    return true;
  }) as Command,

  findPrevious: ((view: EditorView) => {
    if (cmFindPrevious(view)) return true;

    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) return false;
    const prev = findPreviousMatch(view.state, query);
    if (!prev) return false;

    view.dispatch({
      selection: EditorSelection.single(prev.from, prev.to),
      scrollIntoView: true,
      userEvent: "select.search",
    });
    return true;
  }) as Command,

  replaceNext: ((view: EditorView) => {
    if (view.state.readOnly) return false;
    if (cmReplaceNext(view)) return true;

    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) return false;

    const sel = view.state.selection.main;
    const matches = findMatches(view.state, query);
    const isCurrentMatch = matches.some((m) => m.from === sel.from && m.to === sel.to);

    if (isCurrentMatch) {
      let insert = query.replace ?? "";
      if (query.regexp) {
        try {
          const matchedText = view.state.sliceDoc(sel.from, sel.to);
          const re = new RegExp(query.search, query.caseSensitive ? "u" : "iu");
          insert = matchedText.replace(re, query.replace ?? "");
        } catch {
          insert = query.replace ?? "";
        }
      }

      const next = findNextMatch(view.state, query, sel.to);
      const changes = [{ from: sel.from, to: sel.to, insert }];
      const changeSet = view.state.changes(changes);
      const newSelection = next
        ? EditorSelection.single(next.from, next.to).map(changeSet)
        : EditorSelection.single(sel.from + insert.length);

      view.dispatch({
        changes,
        selection: newSelection,
        scrollIntoView: true,
        userEvent: "input.replace",
      });
      return true;
    } else {
      return searchCommands.findNext(view);
    }
  }) as Command,

  replaceAll: ((view: EditorView) => {
    if (view.state.readOnly) return false;
    if (cmReplaceAll(view)) return true;

    const query = getSearchQuery(view.state);
    const result = replaceAllMatches(view.state, query);
    if (result.count === 0) return false;

    view.dispatch({
      changes: result.changes,
      userEvent: "input.replace.all",
    });
    return true;
  }) as Command,

  close: ((view: EditorView) => {
    dispatchSearchClose(view);
    closeSearchPanel(view);
    view.focus();
    return true;
  }) as Command,
};

/**
 * Расширение поиска MarkNote: настраивает подсветку @codemirror/search,
 * отключает встроенную DOM-панель в пользу Svelte-компонента и переопределяет цвета темы.
 */
export function marknoteSearch(): Extension {
  return [
    search({
      top: true,
      createPanel: () => ({
        dom: typeof document !== "undefined" ? document.createElement("span") : ({} as HTMLElement),
      }),
    }),
    keymap.of([
      { key: "Mod-f", run: searchCommands.openSearch },
      { key: "Mod-h", run: searchCommands.openReplace },
      { key: "F3", run: searchCommands.findNext },
      { key: "Shift-F3", run: searchCommands.findPrevious },
    ]),
    EditorView.theme({
      ".cm-searchMatch": {
        backgroundColor: "var(--search-match-bg)",
      },
      ".cm-searchMatch-selected": {
        backgroundColor: "var(--search-match-current-bg)",
        outline: "1px solid rgba(255, 177, 80, 0.4)",
      },
      ".cm-panels": {
        display: "none !important",
      },
    }),
  ];
}
