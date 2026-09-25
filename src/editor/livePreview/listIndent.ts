import { StateEffect, StateField, type ChangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export type ListContinuationLine = {
  from: number;
  indentTo: number;
  indentColumns: number;
};

export type VisibleListItem = {
  itemFrom: number;
  itemTo: number;
  itemLineFrom: number;
  markerFrom: number;
  markerTo: number;
  contentFrom: number;
  contentColumn: number;
  listIndentColumns: number;
  nested: boolean;
  isBullet: boolean;
  taskMarkerFrom: number | null;
  taskMarkerTo: number | null;
  taskChecked: boolean;
  continuationLines: ListContinuationLine[];
};

export type MeasuredListItem = VisibleListItem & {
  paddingInlineStart: number;
  textIndent: number;
};

type ListIndentState = {
  layouts: MeasuredListItem[];
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
};

const emptySet = Decoration.none;
const listIndentMeasure = StateEffect.define<MeasuredListItem[]>();

function indentationWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
  }
  return width;
}

function visibleLineStarts(state: EditorState, visibleRanges: readonly { from: number; to: number }[]): number[] {
  const starts = new Set<number>();
  for (const range of visibleRanges) {
    const first = state.doc.lineAt(Math.min(range.from, state.doc.length)).number;
    const last = state.doc.lineAt(Math.min(range.to, state.doc.length)).number;
    for (let number = first; number <= last; number += 1) starts.add(state.doc.line(number).from);
  }
  return [...starts].sort((a, b) => a - b);
}

function taskMarkerFor(item: SyntaxNode): SyntaxNode | null {
  return item.getChild("Task")?.getChild("TaskMarker") ?? null;
}

/** Finds visible list items and continuation lines that have enough source indentation. */
export function visibleListItems(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
): VisibleListItem[] {
  if (visibleRanges.length === 0) return [];

  const items = new Map<number, { node: SyntaxNode; marker: SyntaxNode; taskMarker: SyntaxNode | null }>();
  const markerLines = new Set<number>();
  const tree = syntaxTree(state);
  for (const visible of visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        if (ref.name === "ListMark") markerLines.add(state.doc.lineAt(ref.from).from);
        if (ref.name !== "ListItem") return;
        const marker = ref.node.getChild("ListMark");
        if (!marker) return;
        const taskMarker = taskMarkerFor(ref.node);
        items.set(marker.from, { node: ref.node, marker, taskMarker });
      },
    });
  }

  const visibleStarts = visibleLineStarts(state, visibleRanges);
  const candidates = [...items.values()].map(({ node, marker, taskMarker }) => {
    const markerLine = state.doc.lineAt(marker.from);
    let contentFrom = taskMarker?.to ?? marker.to;
    while (contentFrom < markerLine.to && /[ \t]/u.test(state.doc.sliceString(contentFrom, contentFrom + 1))) {
      contentFrom += 1;
    }
    const sourceIndent = markerLine.text.slice(0, marker.from - markerLine.from);
    const contentPrefix = markerLine.text.slice(0, contentFrom - markerLine.from);
    const listIndentColumns = indentationWidth(sourceIndent);
    const list = node.parent;
    const taskText = taskMarker ? state.doc.sliceString(taskMarker.from, taskMarker.to) : "";
    return {
      node,
      marker,
      taskMarker,
      item: {
        itemFrom: node.from,
        itemTo: node.to,
        itemLineFrom: markerLine.from,
        markerFrom: marker.from,
        markerTo: marker.to,
        contentFrom,
        contentColumn: indentationWidth(contentPrefix),
        listIndentColumns,
        nested: listIndentColumns >= 4,
        isBullet: list?.name === "BulletList",
        taskMarkerFrom: taskMarker?.from ?? null,
        taskMarkerTo: taskMarker?.to ?? null,
        taskChecked: /^\[[xX]\]$/u.test(taskText),
        continuationLines: [] as ListContinuationLine[],
      } satisfies VisibleListItem,
    };
  });

  const results = new Map<number, VisibleListItem>();
  for (const candidate of candidates) results.set(candidate.item.markerFrom, candidate.item);

  for (const lineFrom of visibleStarts) {
    if (markerLines.has(lineFrom)) continue;
    const line = state.doc.lineAt(lineFrom);
    const leading = line.text.match(/^[ \t]*/u)?.[0] ?? "";
    if (leading.length >= line.text.length) continue;
    const indentColumns = indentationWidth(leading);
    const owners = candidates
      .filter(({ node, item }) => line.from > item.itemLineFrom && line.from < node.to && indentColumns >= item.contentColumn)
      .sort((a, b) => (a.node.to - a.node.from) - (b.node.to - b.node.from));
    const owner = owners[0];
    if (!owner) continue;
    owner.item.continuationLines.push({ from: line.from, indentTo: line.from + leading.length, indentColumns });
    results.set(owner.item.markerFrom, owner.item);
  }

  return [...results.values()]
    .filter((item) => visibleStarts.includes(item.itemLineFrom) || item.continuationLines.length > 0)
    .sort((a, b) => a.itemLineFrom - b.itemLineFrom || a.markerFrom - b.markerFrom);
}

function finitePx(value: number): string {
  return `${Math.max(0, value).toFixed(2).replace(/\.00$/u, "")}px`;
}

function validLinePosition(state: EditorState, position: number): boolean {
  return position >= 0 && position <= state.doc.length && state.doc.lineAt(position).from === position;
}

function nestedGuideClasses(indentColumns: number, nested: boolean): string[] {
  if (!nested || indentColumns < 4) return [];
  return [
    "cm-marknote-nested-list-line",
    `cm-marknote-nested-list-indent-${Math.max(1, Math.min(64, indentColumns))}`,
  ];
}

function buildListIndentState(state: EditorState, layouts: MeasuredListItem[]): ListIndentState {
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const replacements = new Map<string, Range<Decoration>>();

  for (const item of layouts) {
    if (
      !validLinePosition(state, item.itemLineFrom)
      || item.markerFrom < item.itemLineFrom
      || item.contentFrom < item.markerTo
      || state.doc.lineAt(item.contentFrom).from !== item.itemLineFrom
    ) continue;

    const itemLineDecoration = Decoration.line({
      class: ["cm-marknote-list-item-line", ...nestedGuideClasses(item.listIndentColumns, item.nested)].join(" "),
      attributes: {
        style: `padding-inline-start:${finitePx(item.paddingInlineStart)};text-indent:-${finitePx(item.textIndent)}`,
      },
    });
    decorations.push({ from: item.itemLineFrom, to: item.itemLineFrom, value: itemLineDecoration });

    for (const continuation of item.continuationLines) {
      if (
        !validLinePosition(state, continuation.from)
        || continuation.indentTo <= continuation.from
        || continuation.indentTo > state.doc.lineAt(continuation.from).to
      ) continue;
      const lineDecoration = Decoration.line({
        class: [
          "cm-marknote-list-continuation-line",
          ...nestedGuideClasses(continuation.indentColumns, item.nested),
        ].join(" "),
        attributes: { style: `padding-inline-start:${finitePx(item.paddingInlineStart)}` },
      });
      decorations.push({ from: continuation.from, to: continuation.from, value: lineDecoration });
      const replace = Decoration.replace({});
      const key = `${continuation.from}:${continuation.indentTo}`;
      replacements.set(key, { from: continuation.from, to: continuation.indentTo, value: replace });
    }
  }

  decorations.push(...replacements.values());
  atomicRanges.push(...replacements.values());
  return {
    layouts,
    decorations: decorations.length ? Decoration.set(decorations, true) : emptySet,
    atomicRanges: atomicRanges.length ? Decoration.set(atomicRanges, true) : emptySet,
  };
}

export function buildListIndentDecorations(state: EditorState, layouts: MeasuredListItem[]): DecorationSet {
  return buildListIndentState(state, layouts).decorations;
}

function mapPosition(changes: ChangeSet, position: number, association: number): number {
  return changes.mapPos(position, association);
}

function mapLayout(changes: ChangeSet, item: MeasuredListItem): MeasuredListItem {
  return {
    ...item,
    itemFrom: mapPosition(changes, item.itemFrom, 1),
    itemTo: mapPosition(changes, item.itemTo, -1),
    itemLineFrom: mapPosition(changes, item.itemLineFrom, 1),
    markerFrom: mapPosition(changes, item.markerFrom, 1),
    markerTo: mapPosition(changes, item.markerTo, -1),
    contentFrom: mapPosition(changes, item.contentFrom, 1),
    taskMarkerFrom: item.taskMarkerFrom === null ? null : mapPosition(changes, item.taskMarkerFrom, 1),
    taskMarkerTo: item.taskMarkerTo === null ? null : mapPosition(changes, item.taskMarkerTo, -1),
    continuationLines: item.continuationLines.map((line) => ({
      ...line,
      from: mapPosition(changes, line.from, 1),
      indentTo: mapPosition(changes, line.indentTo, -1),
    })),
  };
}

export const listIndentField = StateField.define<ListIndentState>({
  create: () => ({ layouts: [], decorations: emptySet, atomicRanges: emptySet }),
  update(value, transaction) {
    const effect = transaction.effects.find((candidate) => candidate.is(listIndentMeasure));
    if (effect) return buildListIndentState(transaction.state, effect.value);
    if (!transaction.docChanged) return value;
    return buildListIndentState(transaction.state, value.layouts.map((item) => mapLayout(transaction.changes, item)));
  },
  provide(field): Extension {
    return [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.from(field, (value) => value.atomicRanges),
    ];
  },
});

function lineElementAt(view: EditorView, pos: number): HTMLElement | null {
  const node = view.domAtPos(pos, 1).node;
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(".cm-line") ?? null;
}

function prefixSignature(view: EditorView, item: VisibleListItem): string {
  const line = view.state.doc.lineAt(item.itemLineFrom);
  const prefix = line.text.slice(0, item.contentFrom - line.from);
  const style = getComputedStyle(view.contentDOM);
  return JSON.stringify([prefix, style.font, style.direction]);
}

function probeItem(view: EditorView, item: VisibleListItem): HTMLElement {
  const line = view.state.doc.lineAt(item.itemLineFrom);
  const lineProbe = document.createElement("div");
  lineProbe.className = "cm-line";
  lineProbe.style.cssText = "position:relative;width:max-content;min-width:0;max-width:none;white-space:pre;padding-block:0;";

  const appendText = (text: string): void => {
    if (text) lineProbe.append(document.createTextNode(text));
  };
  appendText(line.text.slice(0, item.markerFrom - line.from));
  if (item.isBullet) {
    const bullet = document.createElement("span");
    bullet.className = "cm-marknote-bullet";
    bullet.textContent = "•";
    lineProbe.append(bullet);
  } else {
    const marker = document.createElement("span");
    marker.className = "cm-marknote-ordered-marker";
    marker.textContent = line.text.slice(item.markerFrom - line.from, item.markerTo - line.from);
    lineProbe.append(marker);
  }
  if (item.taskMarkerFrom !== null && item.taskMarkerTo !== null) {
    appendText(view.state.doc.sliceString(item.markerTo, item.taskMarkerFrom));
    const checkbox = document.createElement("span");
    checkbox.className = `cm-marknote-checkbox${item.taskChecked ? " is-checked" : ""}`;
    lineProbe.append(checkbox);
    appendText(view.state.doc.sliceString(item.taskMarkerTo, item.contentFrom));
  } else {
    appendText(view.state.doc.sliceString(item.markerTo, item.contentFrom));
  }
  const contentProbe = document.createElement("span");
  contentProbe.className = "cm-marknote-list-probe-content";
  contentProbe.textContent = "x";
  contentProbe.style.visibility = "hidden";
  lineProbe.append(contentProbe);
  lineProbe.dataset.listItemProbe = prefixSignature(view, item);
  return lineProbe;
}

type PendingRead = { item: VisibleListItem; signature: string };
type MeasurementResult = { layouts: MeasuredListItem[]; pending: PendingRead[] };

function layoutKey(item: MeasuredListItem): string {
  return JSON.stringify([
    item.itemFrom,
    item.itemTo,
    item.itemLineFrom,
    item.markerFrom,
    item.markerTo,
    item.contentFrom,
    item.contentColumn,
    item.nested,
    item.continuationLines.map((line) => [line.from, line.indentTo, line.indentColumns]),
  ]);
}

function layoutsEqual(left: readonly MeasuredListItem[], right: readonly MeasuredListItem[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      layoutKey(a) !== layoutKey(b)
      || Math.abs(a.paddingInlineStart - b.paddingInlineStart) > 0.5
      || Math.abs(a.textIndent - b.textIndent) > 0.5
    ) return false;
  }
  return true;
}

class ListIndentMeasurer {
  private readonly cache = new Map<string, { paddingInlineStart: number; textIndent: number }>();
  private readonly probes = new Map<string, HTMLElement>();
  private readonly host: HTMLDivElement;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.host = document.createElement("div");
    this.host.className = "cm-marknote-list-measure-host";
    this.host.style.cssText = "position:absolute;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;contain:layout style;";
    view.dom.append(this.host);
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return;
    const ownMeasureEffect = update.transactions.length > 0 && update.transactions.every((transaction) =>
      !transaction.docChanged
      && !transaction.selection
      && transaction.effects.length > 0
      && transaction.effects.every((effect) => effect.is(listIndentMeasure)),
    );
    if (ownMeasureEffect) return;
    if (update.geometryChanged) this.cache.clear();

    const configChanged = update.state.facet(livePreviewConfigFacet) !== update.startState.facet(livePreviewConfigFacet);
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || configChanged) this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.host.remove();
    this.cache.clear();
    this.probes.clear();
  }

  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => this.read(view),
      write: (result, view) => this.write(result, view),
    });
  }

  private read(view: EditorView): MeasurementResult {
    const preview = view.plugin(livePreviewPlugin);
    const config = view.state.facet(livePreviewConfigFacet);
    if (!config.enabled || preview?.disabled) return { layouts: [], pending: [] };

    const visibleItems = visibleListItems(view.state, view.visibleRanges);
    const layouts: MeasuredListItem[] = [];
    const pending: PendingRead[] = [];
    for (const item of visibleItems) {
      const signature = prefixSignature(view, item);
      const lineCoords = view.coordsAtPos(item.itemLineFrom, 1);
      const contentCoords = view.coordsAtPos(item.contentFrom, -1);
      const lineElement = lineElementAt(view, item.itemLineFrom);
      if (lineCoords && contentCoords && lineElement) {
        const lineRect = lineElement.getBoundingClientRect();
        const rtl = getComputedStyle(lineElement).direction === "rtl";
        const measured = {
          paddingInlineStart: rtl ? lineRect.right - contentCoords.left : contentCoords.left - lineRect.left,
          textIndent: rtl ? lineCoords.left - contentCoords.left : contentCoords.left - lineCoords.left,
        };
        this.cache.set(signature, measured);
        while (this.cache.size > 256) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
        layouts.push({ ...item, ...measured });
        continue;
      }

      const cached = this.cache.get(signature);
      if (cached) {
        this.cache.delete(signature);
        this.cache.set(signature, cached);
        layouts.push({ ...item, ...cached });
        continue;
      }

      const probe = this.probes.get(signature);
      if (probe) {
        const lineRect = probe.getBoundingClientRect();
        const contentRect = probe.querySelector<HTMLElement>(".cm-marknote-list-probe-content")?.getBoundingClientRect();
        if (contentRect) {
          const rtl = getComputedStyle(probe).direction === "rtl";
          const style = getComputedStyle(probe);
          const lineStart = rtl
            ? lineRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
            : lineRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          const measured = {
            paddingInlineStart: rtl ? lineRect.right - contentRect.left : contentRect.left - lineRect.left,
            textIndent: rtl ? lineStart - contentRect.left : contentRect.left - lineStart,
          };
          this.cache.set(signature, measured);
          layouts.push({ ...item, ...measured });
          continue;
        }
      }
      pending.push({ item, signature });
    }
    return { layouts, pending };
  }

  private write(result: MeasurementResult, view: EditorView): void {
    if (this.destroyed || view !== this.view) return;
    if (result.pending.length > 0) {
      this.host.replaceChildren();
      this.probes.clear();
      for (const pending of result.pending) {
        const probe = probeItem(view, pending.item);
        probe.style.direction = getComputedStyle(view.contentDOM).direction;
        this.host.append(probe);
        this.probes.set(pending.signature, probe);
      }
      this.schedule();
      return;
    }

    const current = view.state.field(listIndentField, false);
    if (!current || layoutsEqual(current.layouts, result.layouts)) return;
    view.dispatch({ effects: listIndentMeasure.of(result.layouts) });
  }
}

import { livePreviewConfigFacet } from "./settings";
import { livePreviewPlugin } from "./plugin";

export const listIndentMeasurePlugin = ViewPlugin.fromClass(ListIndentMeasurer);
