import { syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { translate } from "../i18n";
import {
  addSpellingWord,
  checkSpelling,
  clearSpellcheckSuggestionCache,
  suggestSpelling,
} from "./spellEngine";

export type SpellcheckOptions = {
  enabled: boolean;
  skipCodeFormulaLinks: boolean;
  dictionaries: string[];
  inlineSuggestions: boolean;
};

export type SpellcheckContext = {
  from: number;
  to: number;
  word: string;
  languages: string[];
};

export type SpellcheckActionPayload = SpellcheckContext & { suggestion?: string };
export type SpellcheckMenuEntry = {
  id: "spellcheck.replace" | "spellcheck.addToDictionary" | "spellcheck.noSuggestions";
  label: string;
  payload?: string;
  disabled?: boolean;
  spellSuggestion?: boolean;
};

type TextRange = { from: number; to: number };
type InlineSuggestionData = SpellcheckContext & { suggestions: string[] };

const CODE_FORMULA_LINK_NODES = new Set([
  "fencedcode", "codeblock", "inlinecode", "codetext", "codeinfo", "codemark",
  "mathblock", "inlinemath", "mathmark", "link", "linklabel", "linkmark",
  "linktitle", "autolink", "image", "url",
]);
const ALWAYS_SKIP_NODES = new Set(["image", "url", "htmltag", "htmlblock"]);
const spellcheckRefresh = StateEffect.define<null>();
const inlineTooltipEffect = StateEffect.define<InlineSuggestionData | null>();

const spellMark = Decoration.mark({ class: "cm-misspelled" });
const spellcheckCache = new Map<string, Promise<TextRange[]>>();

function nodeIsSkipped(name: string, skipCodeFormulaLinks: boolean): boolean {
  const normalized = name.toLowerCase();
  return ALWAYS_SKIP_NODES.has(normalized)
    || (skipCodeFormulaLinks && CODE_FORMULA_LINK_NODES.has(normalized));
}

function frontMatterRange(state: EditorState): TextRange | null {
  if (state.doc.lines < 2) return null;
  const first = state.doc.line(1);
  if (!/^\uFEFF?---\s*$/u.test(first.text)) return null;
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (/^(?:---|\.\.\.)\s*$/u.test(line.text)) return { from: first.from, to: line.to };
  }
  return { from: first.from, to: state.doc.length };
}

function addRegexRanges(text: string, base: number, pattern: RegExp, ranges: TextRange[]): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const value = match[0];
    if (value.length > 0) ranges.push({ from: base + index, to: base + index + value.length });
  }
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length < 2) return ranges.filter((range) => range.to > range.from);
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: TextRange[] = [];
  for (const range of ranges) {
    if (range.to <= range.from) continue;
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** Excluded absolute ranges for one line, including syntax and always-skipped text. */
export function spellcheckExcludedRanges(
  state: EditorState,
  line: { from: number; to: number; text: string },
  skipCodeFormulaLinks: boolean,
): TextRange[] {
  const ranges: TextRange[] = [];
  const frontMatter = frontMatterRange(state);
  if (frontMatter && frontMatter.from < line.to + 1 && frontMatter.to > line.from) {
    ranges.push({ from: Math.max(line.from, frontMatter.from), to: Math.min(line.to, frontMatter.to) });
  }

  const tree = syntaxTree(state);
  tree.iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (nodeIsSkipped(node.name, skipCodeFormulaLinks)) {
        const from = Math.max(line.from, node.from);
        const to = Math.min(line.to, node.to);
        if (to > from) ranges.push({ from, to });
        return false;
      }
    },
  });

  addRegexRanges(line.text, line.from, /!\[[^\]\n]*\](?:\([^\n)]*\)|\[[^\]\n]*\])?/gu, ranges);
  if (skipCodeFormulaLinks) {
    addRegexRanges(line.text, line.from, /\${1,2}[^$\n]+\${1,2}|\\\([^)\n]+\\\)|\\\[[^\]\n]+\\\]/gu, ranges);
  }
  addRegexRanges(line.text, line.from, /<[^>\n]*>/gu, ranges);
  addRegexRanges(line.text, line.from, /(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>()]+/giu, ranges);
  addRegexRanges(line.text, line.from, /\b(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/giu, ranges);

  return mergeRanges(ranges).map((range) => ({
    from: Math.max(line.from, range.from),
    to: Math.min(line.to, range.to),
  })).filter((range) => range.to > range.from);
}

/** Return eligible text spans for a line; excluded text is never sent to Windows. */
export function spellcheckLineSegments(
  state: EditorState,
  line: { from: number; to: number; text: string },
  skipCodeFormulaLinks: boolean,
): TextRange[] {
  const excluded = spellcheckExcludedRanges(state, line, skipCodeFormulaLinks);
  const segments: TextRange[] = [];
  let cursor = line.from;
  for (const range of excluded) {
    if (range.from > cursor) segments.push({ from: cursor, to: range.from });
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < line.to) segments.push({ from: cursor, to: line.to });
  return segments.filter((range) => range.to > range.from);
}

function cacheKey(
  line: { text: string; from: number; to: number },
  languages: readonly string[],
  exclusions: readonly TextRange[],
): string {
  return JSON.stringify([line.text, [...languages].sort(), exclusions.map((range) => [range.from - line.from, range.to - line.from])]);
}

/** Checks and caches a line by its text, language set, and syntax exclusion mask. */
export function checkSpellcheckLine(
  state: EditorState,
  line: { from: number; to: number; text: string },
  languages: readonly string[],
  skipCodeFormulaLinks: boolean,
): Promise<TextRange[]> {
  if (languages.length === 0 || line.text.length === 0) return Promise.resolve([]);
  const exclusions = spellcheckExcludedRanges(state, line, skipCodeFormulaLinks);
  const key = cacheKey(line, languages, exclusions);
  const cached = spellcheckCache.get(key);
  if (cached) return cached;

  const segments = spellcheckLineSegments(state, line, skipCodeFormulaLinks);
  const request = Promise.all(segments.map(async (segment) => {
    const segmentText = state.sliceDoc(segment.from, segment.to);
    const ranges = await checkSpelling(segmentText, languages);
    return ranges
      .filter((range) => range.from >= 0 && range.to <= segmentText.length)
      .map((range) => ({ from: segment.from + range.from - line.from, to: segment.from + range.to - line.from }));
  })).then((parts) => parts.flat());

  spellcheckCache.set(key, request);
  if (spellcheckCache.size > 4096) {
    const oldest = spellcheckCache.keys().next().value;
    if (oldest !== undefined) spellcheckCache.delete(oldest);
  }
  return request;
}

export function clearSpellcheckCache(): void {
  spellcheckCache.clear();
  clearSpellcheckSuggestionCache();
}

/** Used by autocorrect to avoid changing markup at the cursor. */
export function isInsideCodeFormulaOrLink(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node) {
    if (CODE_FORMULA_LINK_NODES.has(node.name.toLowerCase()) && pos > node.from && (pos < node.to || node.to === state.doc.length)) return true;
    node = node.parent;
  }
  node = tree.resolveInner(pos, 1);
  while (node) {
    if (CODE_FORMULA_LINK_NODES.has(node.name.toLowerCase()) && pos > node.from && (pos < node.to || node.to === state.doc.length)) return true;
    node = node.parent;
  }
  return false;
}

function wordAt(lineText: string, lineFrom: number, pos: number): TextRange | null {
  const pattern = /[\p{L}\p{M}\p{N}_'’\-]+/gu;
  for (const match of lineText.matchAll(pattern)) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to };
  }
  return null;
}

function activeTypingRange(state: EditorState): TextRange | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const range = wordAt(line.text, line.from, selection.head);
  return range && range.to === selection.head ? range : null;
}

function inlineTarget(
  state: EditorState,
  ranges: readonly TextRange[],
  skipCodeFormulaLinks: boolean,
): TextRange | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const pos = selection.head;
  const line = state.doc.lineAt(pos);
  for (const range of ranges) {
    if (range.from < line.from || range.to > line.to) continue;
    const afterWord = line.text.slice(range.to - line.from, Math.min(line.text.length, range.to - line.from + 1));
    if (pos >= range.from && pos <= range.to) return range;
    if (pos === range.to + 1 && /^\s$/u.test(afterWord)) return range;
  }
  const word = wordAt(line.text, line.from, pos);
  if (!word) return null;
  const excluded = spellcheckExcludedRanges(state, line, skipCodeFormulaLinks);
  if (excluded.some((range) => range.from < word!.to && range.to > word!.from)) return null;
  return ranges.find((range) => range.from === word!.from && range.to === word!.to) ?? null;
}

function inlineTooltip(data: InlineSuggestionData): Tooltip {
  return {
    pos: data.from,
    end: data.to,
    above: true,
    strictSide: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-spellcheck-suggestions";
      dom.setAttribute("role", "group");
      dom.setAttribute("aria-label", translate("spellcheck.suggestions"));
      for (const suggestion of data.suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cm-spellcheck-suggestion";
        button.textContent = suggestion;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          replaceSpellcheckWord(view, { ...data, suggestion });
          view.focus();
        });
        dom.append(button);
      }
      return { dom };
    },
  };
}

const inlineTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(inlineTooltipEffect)) return effect.value ? inlineTooltip(effect.value) : null;
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

function lineFromRange(state: EditorState, range: TextRange): string {
  return state.sliceDoc(range.from, range.to);
}

export function buildSpellcheckMenuEntries(
  context: SpellcheckContext,
  suggestions: readonly string[],
  labels: { noSuggestions: string; addToDictionary: string },
): SpellcheckMenuEntry[] {
  const entries: SpellcheckMenuEntry[] = suggestions.length > 0
    ? suggestions.slice(0, 3).map((suggestion) => ({
        id: "spellcheck.replace",
        label: suggestion,
        payload: JSON.stringify({ ...context, suggestion }),
        spellSuggestion: true,
      }))
    : [{ id: "spellcheck.noSuggestions", label: labels.noSuggestions, disabled: true }];
  entries.push({
    id: "spellcheck.addToDictionary",
    label: labels.addToDictionary,
    payload: JSON.stringify(context),
  });
  return entries;
}

/** Replace exactly one checked word and isolate it as a single undo step. */
export function replaceSpellcheckWord(view: EditorView, payload: SpellcheckActionPayload): boolean {
  const { from, to, word, suggestion } = payload;
  if (!suggestion || from < 0 || to <= from || to > view.state.doc.length) return false;
  if (view.state.sliceDoc(from, to) !== word || suggestion.includes("\n")) return false;
  view.dispatch({
    changes: { from, to, insert: suggestion },
    selection: { anchor: from + suggestion.length },
    annotations: [
      Transaction.userEvent.of("input.spellcheck"),
      isolateHistory.of("full"),
    ],
  });
  return true;
}

function fromPayload(payload?: string): SpellcheckActionPayload | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<SpellcheckActionPayload>;
    if (
      Number.isInteger(parsed.from) && Number.isInteger(parsed.to) && typeof parsed.word === "string"
      && Array.isArray(parsed.languages) && parsed.languages.every((tag) => typeof tag === "string")
    ) return parsed as SpellcheckActionPayload;
  } catch {
    return null;
  }
  return null;
}

class SpellcheckPlugin {
  decorations: DecorationSet = Decoration.none;
  private ranges: TextRange[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private checkRevision = 0;
  private typingRange: TextRange | null = null;
  private tooltipKey: string | null = null;
  private tooltipRevision = 0;

  constructor(private readonly view: EditorView, private readonly options: SpellcheckOptions) {
    this.dispatchTooltip(null);
    if (options.enabled) this.schedule(0);
  }

  update(update: ViewUpdate): void {
    if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(spellcheckRefresh)))) return;
    if (!this.options.enabled) return;

    if (update.docChanged) {
      this.ranges = [];
      this.typingRange = activeTypingRange(update.state);
      this.schedule(300);
    } else if (update.selectionSet && this.typingRange) {
      const selection = update.state.selection.main;
      if (!selection.empty || selection.head < this.typingRange.from || selection.head > this.typingRange.to) {
        this.typingRange = null;
      }
    }
    if (update.viewportChanged) this.schedule(300);
    if (update.selectionSet || update.docChanged) {
      this.rebuildDecorations(update.state);
      this.updateInlineTooltip(update.state);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.tooltipRevision += 1;
  }

  contextAt(pos: number): SpellcheckContext | null {
    const range = this.ranges.find((item) =>
      pos >= item.from && pos <= item.to
      && (!this.typingRange || item.from !== this.typingRange.from || item.to !== this.typingRange.to),
    );
    if (!range) return null;
    return {
      from: range.from,
      to: range.to,
      word: lineFromRange(this.view.state, range),
      languages: [...this.options.dictionaries],
    };
  }

  refreshNow(): void {
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.options.enabled || this.options.dictionaries.length === 0) {
      this.ranges = [];
      this.rebuildDecorations(this.view.state);
      this.updateInlineTooltip(this.view.state);
      this.dispatchRefresh();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkVisibleLines();
    }, delay);
  }

  private async checkVisibleLines(): Promise<void> {
    const state = this.view.state;
    const doc = state.doc;
    const revision = ++this.checkRevision;
    const lineNumbers = new Set<number>();
    for (const visible of this.view.visibleRanges) {
      const first = state.doc.lineAt(visible.from).number;
      const last = state.doc.lineAt(visible.to).number;
      for (let number = Math.max(1, first - 3); number <= Math.min(state.doc.lines, last + 3); number += 1) {
        lineNumbers.add(number);
      }
    }
    const checked = await Promise.all([...lineNumbers].map(async (number) => {
      const line = state.doc.line(number);
      const ranges = await checkSpellcheckLine(state, line, this.options.dictionaries, this.options.skipCodeFormulaLinks);
      return ranges.map((range) => ({ from: line.from + range.from, to: line.from + range.to }));
    }));
    if (this.destroyed || revision !== this.checkRevision || this.view.state.doc !== doc) return;
    this.ranges = checked.flat().filter((range) => range.to > range.from && range.to <= doc.length);
    this.rebuildDecorations(this.view.state);
    this.updateInlineTooltip(this.view.state);
    this.dispatchRefresh();
  }

  private rebuildDecorations(state: EditorState): void {
    const ranges: Range<Decoration>[] = [];
    for (const range of this.ranges) {
      const line = state.doc.lineAt(range.from);
      if (line.to < range.to) continue;
      if (this.typingRange && range.from === this.typingRange.from && range.to === this.typingRange.to) continue;
      ranges.push({ from: range.from, to: range.to, value: spellMark });
    }
    this.decorations = ranges.length ? Decoration.set(ranges, true) : Decoration.none;
  }

  private updateInlineTooltip(state: EditorState): void {
    const target = this.options.inlineSuggestions
      ? inlineTarget(state, this.ranges, this.options.skipCodeFormulaLinks)
      : null;
    if (!target || (this.typingRange && target.from === this.typingRange.from && target.to === this.typingRange.to)) {
      this.tooltipKey = null;
      this.tooltipRevision += 1;
      this.dispatchTooltip(null);
      return;
    }

    const word = lineFromRange(state, target);
    const key = JSON.stringify([target.from, target.to, word, this.options.dictionaries]);
    if (key === this.tooltipKey) return;
    this.tooltipKey = key;
    const request = ++this.tooltipRevision;
    this.dispatchTooltip(null);
    void suggestSpelling(word, this.options.dictionaries).then((suggestions) => {
      if (this.destroyed || request !== this.tooltipRevision || key !== this.tooltipKey || suggestions.length === 0) return;
      this.dispatchTooltip({
        ...target,
        word,
        languages: [...this.options.dictionaries],
        suggestions,
      });
    });
  }

  private dispatchTooltip(data: InlineSuggestionData | null): void {
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: inlineTooltipEffect.of(data) });
    });
  }

  private dispatchRefresh(): void {
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: spellcheckRefresh.of(null) });
    });
  }
}

const spellcheckPlugin = ViewPlugin.define<SpellcheckPlugin, SpellcheckOptions>(
  (view, options) => new SpellcheckPlugin(view, options),
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function getSpellcheckContextAt(view: EditorView, pos: number): SpellcheckContext | null {
  return view.plugin(spellcheckPlugin)?.contextAt(pos) ?? null;
}

export function refreshSpellcheck(view: EditorView): void {
  view.plugin(spellcheckPlugin)?.refreshNow();
}

export async function addWordToSpellcheckDictionary(context: SpellcheckContext): Promise<void> {
  await addSpellingWord(context.word, context.languages);
  clearSpellcheckCache();
}

export function handleSpellcheckMenuAction(view: EditorView, action: string, payload?: string): boolean {
  if (action === "spellcheck.replace") {
    const parsed = fromPayload(payload);
    if (!parsed?.suggestion) return false;
    const replaced = replaceSpellcheckWord(view, parsed);
    if (replaced) view.focus();
    return replaced;
  }
  if (action === "spellcheck.addToDictionary") {
    const parsed = fromPayload(payload);
    if (!parsed) return false;
    void addWordToSpellcheckDictionary(parsed).then(() => refreshSpellcheck(view));
    view.focus();
    return true;
  }
  return false;
}

export function spellcheckExtension(options: SpellcheckOptions): Extension[] {
  const normalizedOptions: SpellcheckOptions = {
    ...options,
    dictionaries: [...options.dictionaries],
  };
  return [
    EditorView.contentAttributes.of({ spellcheck: "false" }),
    inlineTooltipField,
    EditorView.baseTheme({
      ".cm-misspelled": {
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "var(--text-error)",
        textUnderlineOffset: "0.16em",
      },
      ".cm-spellcheck-suggestions": {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "3px",
        border: "1px solid var(--bg-modifier-border)",
        borderRadius: "var(--radius-m)",
        backgroundColor: "var(--bg-secondary)",
        boxShadow: "0 3px 12px rgba(0, 0, 0, 0.22)",
      },
      ".cm-spellcheck-suggestion": {
        padding: "3px 7px",
        border: "0",
        borderRadius: "var(--radius-s)",
        backgroundColor: "transparent",
        color: "var(--text-normal)",
        font: "inherit",
        fontWeight: "600",
        cursor: "pointer",
      },
      ".cm-spellcheck-suggestion:hover, .cm-spellcheck-suggestion:focus-visible": {
        backgroundColor: "var(--bg-modifier-hover)",
        outline: "none",
      },
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== "Escape") return false;
        const tooltip = view.state.field(inlineTooltipField, false);
        if (!tooltip) return false;
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ effects: inlineTooltipEffect.of(null) });
        return true;
      },
    }),
    spellcheckPlugin.of(normalizedOptions),
  ];
}
