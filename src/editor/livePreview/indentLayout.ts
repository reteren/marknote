// Indentation guides, the small gap before list markers, and hanging indent
// for wrapped list items in live preview.
//
// - Every whole indent unit at the start of a line draws one thin vertical
//   guide. The guides are a background on the line, so text, caret and
//   selection stay exactly where the characters are.
// - A list item line gets a small gap before its marker, with no guide.
// - The wrapped part of a long list item continues under the item's text:
//   the line gets padding equal to the measured width of everything before
//   the text, and the same negative text-indent for its first visual line.
//
// Widths are measured from the rendered editor (the space width of the
// current font, and where each item's text actually starts), never guessed.

import { getIndentUnit, syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { indentLevels, parseListLine } from "../listCommands";

const LIST_GAP = "0.3em";
const HANG_TOLERANCE_PX = 0.5;

const remeasured = StateEffect.define<null>();

/** Lines whose layout belongs to another block renderer. */
function excluded(state: EditorState, lineFrom: number, lineTo: number): boolean {
  if (lineFrom === lineTo) return false;
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "Table" || node.name === "FrontMatter") return true;
  }
  return false;
}

export type IndentLineLayout = {
  from: number;
  levels: number;
  /** Offset of the list marker in the line, or null when the line is not a list item. */
  markerFrom: number | null;
  markerTo: number | null;
  bullet: boolean;
  /** Offset of the item's text, for measuring the hanging indent. */
  contentFrom: number | null;
};

/** Describes every visible line that needs guides or list layout. */
export function indentLayouts(state: EditorState, visibleRanges: readonly { from: number; to: number }[]): IndentLineLayout[] {
  const layouts: IndentLineLayout[] = [];
  const seen = new Set<number>();
  for (const range of visibleRanges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      const line = state.doc.line(number);
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      if (excluded(state, line.from, line.to)) continue;
      const levels = indentLevels(line.text, state);
      const item = parseListLine(line.text);
      if (!levels && !item) continue;
      const markerFrom = item ? line.from + item.indent.length : null;
      layouts.push({
        from: line.from,
        levels,
        markerFrom,
        markerTo: item && markerFrom !== null ? markerFrom + item.markerLength : null,
        bullet: item ? item.number === null : false,
        contentFrom: item ? line.from + item.contentStart : null,
      });
    }
  }
  return layouts;
}

/** Builds the decorations for the layouts; `hangs` holds measured text offsets by line start. */
export function indentLayoutDecorations(layouts: readonly IndentLineLayout[], hangs: ReadonlyMap<number, number>): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  for (const layout of layouts) {
    const classes: string[] = [];
    const style: string[] = [];
    if (layout.levels > 0) {
      classes.push("cm-md-guides");
      style.push(`--md-levels: ${layout.levels}`);
    }
    if (layout.markerFrom !== null) {
      classes.push("cm-md-list-line");
      const hang = hangs.get(layout.from);
      if (hang !== undefined) style.push(`--md-hang: ${hang.toFixed(2)}px`);
    }
    ranges.push(Decoration.line({ attributes: { class: classes.join(" "), style: style.join("; ") } }).range(layout.from));
    // The gap before an ordered marker; a bullet widget carries its own gap in CSS.
    if (layout.markerFrom !== null && layout.markerTo !== null && !layout.bullet) {
      ranges.push(Decoration.mark({ class: "cm-md-list-gap" }).range(layout.markerFrom, layout.markerTo));
    }
  }
  return Decoration.set(ranges, true);
}

function sameHangs(left: ReadonlyMap<number, number>, right: ReadonlyMap<number, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const other = right.get(key);
    if (other === undefined || Math.abs(other - value) > HANG_TOLERANCE_PX) return false;
  }
  return true;
}

let measuringContext: CanvasRenderingContext2D | null | undefined;

function spaceWidth(view: EditorView): number | null {
  if (measuringContext === undefined) {
    measuringContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measuringContext) return null;
  const style = getComputedStyle(view.contentDOM);
  measuringContext.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  const width = measuringContext.measureText(" ").width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

class IndentLayoutView {
  decorations: DecorationSet;
  private layouts: IndentLineLayout[];
  private hangs = new Map<number, number>();
  private unitWidth = "";

  constructor(private readonly view: EditorView) {
    this.layouts = indentLayouts(view.state, view.visibleRanges);
    this.decorations = indentLayoutDecorations(this.layouts, this.hangs);
    this.scheduleMeasure();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const mapped = new Map<number, number>();
      for (const [from, hang] of this.hangs) mapped.set(update.changes.mapPos(from, 1), hang);
      this.hangs = mapped;
    }
    const remeasure = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(remeasured)));
    if (update.docChanged || update.viewportChanged || update.selectionSet || remeasure || update.geometryChanged) {
      this.layouts = indentLayouts(update.state, update.view.visibleRanges);
      this.decorations = indentLayoutDecorations(this.layouts, this.hangs);
    }
    if (!remeasure) this.scheduleMeasure();
  }

  private scheduleMeasure(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const width = spaceWidth(view);
        const unit = width === null ? "" : `${(width * Math.max(1, getIndentUnit(view.state))).toFixed(2)}px`;
        const hangs = new Map<number, number>();
        for (const layout of this.layouts) {
          if (layout.contentFrom === null) continue;
          const line = view.domAtPos(layout.from).node;
          const element = (line instanceof HTMLElement ? line : line.parentElement)?.closest(".cm-line");
          const coords = view.coordsAtPos(layout.contentFrom, 1);
          if (!element || !coords) continue;
          const offset = coords.left - element.getBoundingClientRect().left;
          if (Number.isFinite(offset) && offset >= 0) hangs.set(layout.from, offset);
        }
        return { unit, hangs };
      },
      write: ({ unit, hangs }, view) => {
        if (unit && unit !== this.unitWidth) {
          this.unitWidth = unit;
          view.dom.style.setProperty("--md-unit", unit);
        }
        if (sameHangs(this.hangs, hangs)) return;
        this.hangs = hangs;
        // Dispatching inside a measure cycle is not allowed; do it right after.
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: remeasured.of(null) });
        });
      },
    });
  }
}

export const indentLayoutPlugin = ViewPlugin.fromClass(IndentLayoutView, {
  decorations: (plugin) => plugin.decorations,
});

export const indentLayoutTheme = EditorView.baseTheme({
  ".cm-line.cm-md-guides": {
    backgroundImage:
      "repeating-linear-gradient(to right, var(--bg-modifier-border-hover) 0 1px, transparent 1px var(--md-unit, 2em))",
    backgroundSize: "calc(var(--md-levels) * var(--md-unit, 2em)) 100%",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0.35em 0",
  },
  ".cm-line.cm-md-list-line": {
    paddingInlineStart: "var(--md-hang, 0px)",
    textIndent: "calc(-1 * var(--md-hang, 0px))",
  },
  ".cm-md-list-gap": { marginInlineStart: LIST_GAP },
  ".cm-md-list-line .cm-marknote-bullet": { marginInlineStart: LIST_GAP },
  // text-indent is inherited: inline-block widgets on a hanging line would
  // push their own content out of their box without this reset.
  ".cm-md-list-line .cm-marknote-bullet, .cm-md-list-line .cm-marknote-checkbox, .cm-md-list-line .cm-marknote-image, .cm-md-list-line .cm-marknote-math": {
    textIndent: "0",
  },
});
