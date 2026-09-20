import { Text, type EditorState, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isNodeActive } from "./isNodeActive";
import { decorationsForBlockNode, indentationGuideForLine } from "./blocks";
import { codeBlockBuilder } from "./codeBlocks";
import { tableBuilder } from "./tables";
import { calloutBuilder } from "./callouts";
import { footnoteBuilder } from "./footnotes";
import { decorationsForInlineNode, safeLinkHref, type DecorationSpec } from "./inline";
import { livePreviewConfigFacet, type LivePreviewConfig } from "./settings";
import type { BlockBuilder, BuilderContext } from "./types";
import type { ImageResolver } from "./widgets/Image";
import { profileMeasure } from "../profile";

export interface LivePreviewOptions {
  maxBytes?: number;
  resolveImage?: ImageResolver;
  config?: Partial<LivePreviewConfig>;
}

export interface PreviewBuildResult {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
  disabled: boolean;
}

const documentByteLengths = new WeakMap<Text, number>();
const utf8Encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();

/**
 * Returns the UTF-8 size for a document, reusing the result for selection and
 * viewport updates that keep the same immutable CodeMirror Text instance.
 */
export function documentByteLength(doc: Text): number {
  const cached = documentByteLengths.get(doc);
  if (cached !== undefined) return cached;
  const text = doc.toString();
  const bytes = utf8Encoder ? utf8Encoder.encode(text).byteLength : text.length;
  documentByteLengths.set(doc, bytes);
  return bytes;
}

function byteLength(state: EditorState, maxBytes = Number.POSITIVE_INFINITY) {
  // UTF-8 never uses fewer bytes than JavaScript UTF-16 code units. Once the
  // lower bound is already over the configured limit, avoid flattening a
  // multi-megabyte Text just to discover that it is too large.
  if (state.doc.length > maxBytes) return maxBytes + 1;
  return documentByteLength(state.doc);
}

function isBlockNode(node: SyntaxNode) {
  return node.name === "MathBlock" ||
    node.name === "HorizontalRule" ||
    node.name === "Callout" ||
    node.name === "CalloutMark" ||
    node.name === "CalloutTitle" ||
    node.name === "FootnoteDefinition" ||
    node.name === "FootnoteDefinitionMark" ||
    node.name === "FootnoteDefinitionText" ||
    /^ATXHeading[1-6]$/.test(node.name) ||
    /^SetextHeading[12]$/.test(node.name) ||
    node.name === "OrderedList" ||
    node.name === "BulletList" ||
    node.name === "ListMark" ||
    node.name === "Task" ||
    node.name === "TaskMarker" ||
    node.name === "Blockquote" ||
    node.name === "QuoteMark";
}

function asRanges(specs: DecorationSpec[]) {
  const valid = specs
    .filter((spec) => spec.to > spec.from || spec.line || Boolean(spec.decoration.spec.widget))
    .map((spec) => ({ from: spec.from, to: spec.to, value: spec.decoration }));
  valid.sort((a, b) => a.from - b.from);
  return Decoration.set(valid, true);
}

function asDecorationRanges(ranges: readonly Range<Decoration>[]) {
  const valid = ranges.filter((range) => range.to > range.from);
  return Decoration.set(valid, true);
}

/**
 * Block builders are intentionally registered in one place. A builder is
 * allowed to own a node completely, in which case traversal of its children
 * is skipped. The order mirrors the M4 contract: table and code builders are
 * followed by callouts and footnotes, before the legacy block fallback.
 */
export const livePreviewBlockBuilders: readonly BlockBuilder[] = [
  tableBuilder,
  codeBlockBuilder,
  calloutBuilder,
  footnoteBuilder,
];

function runBlockBuilders(
  view: EditorView,
  node: SyntaxNode,
  active: boolean,
  specs: DecorationSpec[],
  atomicRanges: Array<Range<Decoration>>,
): boolean {
  const context: BuilderContext = {
    view,
    node,
    active,
    add: (range) =>
      specs.push({
        from: range.from,
        to: range.to,
        decoration: range.value,
        line:
          range.from === range.to &&
          Boolean((range.value as unknown as { point?: boolean }).point) &&
          !Boolean((range.value.spec as { widget?: unknown }).widget),
      }),
    atomic: (range) => atomicRanges.push(range),
  };
  for (const builder of livePreviewBlockBuilders) {
    if (builder(context)) return true;
  }
  return false;
}

function uniqueSpecs(specs: readonly DecorationSpec[]) {
  const unique = new Map<string, DecorationSpec>();
  for (const spec of specs) {
    const key = `${spec.from}:${spec.to}:${spec.decoration.spec.class ?? spec.decoration.spec.widget?.constructor?.name ?? "replace"}`;
    if (!unique.has(key)) unique.set(key, spec);
  }
  return [...unique.values()];
}

function buildDecorationSetsInternal(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  options: LivePreviewOptions,
  view?: EditorView,
): PreviewBuildResult {
  const stateConfig = state.facet(livePreviewConfigFacet);
  const config = options.config ? { ...stateConfig, ...options.config } : stateConfig;

  const maxBytes = options.maxBytes ?? config.disableAboveBytes;
  if (!config.enabled || byteLength(state, maxBytes) > maxBytes) return { decorations: Decoration.none, atomicRanges: Decoration.none, disabled: true };

  const specs: DecorationSpec[] = [];
  const builderAtomicRanges: Array<Range<Decoration>> = [];
  const seen = new Set<string>();
  const tree = profileMeasure("preview.parse", () => syntaxTree(state));
  profileMeasure("preview.decorate", () => {
    for (const visible of visibleRanges) {
      const startLine = state.doc.lineAt(visible.from).number;
      const endLine = state.doc.lineAt(visible.to).number;
      for (let number = startLine; number <= endLine; number += 1) {
        const spec = indentationGuideForLine(state.doc.line(number));
        if (spec) specs.push(spec);
      }

      tree.iterate({
        from: visible.from,
        to: visible.to,
        enter: (ref) => {
          const node = ref.node;
          if (node.name === "Document" || node.name === "Paragraph") return;
          const key = `${node.name}:${node.from}:${node.to}`;
          if (seen.has(key)) return;
          seen.add(key);

          const active = isNodeActive(node, state.selection, state.doc, config.revealMarkup);
          if (view && runBlockBuilders(view, node, active, specs, builderAtomicRanges)) return false;

          const nodeSpecs = isBlockNode(node)
            ? decorationsForBlockNode(node, active, state, config, visibleRanges)
            : decorationsForInlineNode(node, active, state, options.resolveImage, config);
          specs.push(...nodeSpecs);
        },
      });
    }
  });

  const { decorationRanges, atomicSpecs, builderAtomic } = profileMeasure("preview.finalize", () => {
    const all = uniqueSpecs(specs);
    return {
      decorationRanges: asRanges(all),
      atomicSpecs: asRanges(all.filter((spec) => spec.atomic)),
      builderAtomic: asDecorationRanges(builderAtomicRanges),
    };
  });
  return {
    decorations: decorationRanges,
    atomicRanges: builderAtomic.size ? Decoration.set([...decorationRangesToArray(builderAtomic), ...decorationRangesToArray(atomicSpecs)], true) : atomicSpecs,
    disabled: false,
  };
}

function decorationRangesToArray(set: DecorationSet): Array<Range<Decoration>> {
  const ranges: Array<Range<Decoration>> = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    ranges.push({ from, to, value });
  });
  return ranges;
}

/**
 * Чистая часть построения предпросмотра. Она принимает только состояние и
 * видимые диапазоны, поэтому легко проверяется в Node/Vitest без браузера.
 */
export function buildDecorationSets(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  options: LivePreviewOptions = {},
): PreviewBuildResult {
  return buildDecorationSetsInternal(state, visibleRanges, options);
}

export class LivePreviewValue {
  decorations: DecorationSet = Decoration.none;
  atomicRanges: DecorationSet = Decoration.none;
  disabled = false;
  readonly options: LivePreviewOptions;

  constructor(view: EditorView, options: LivePreviewOptions = {}) {
    this.options = options;
    this.rebuild(view);
  }

  get maxBytes(): number {
    return this.options.maxBytes ?? 5 * 1024 * 1024;
  }

  get resolveImage(): ImageResolver | undefined {
    return this.options.resolveImage;
  }

  update(update: ViewUpdate) {
    const configChanged = update.state.facet(livePreviewConfigFacet) !== update.startState.facet(livePreviewConfigFacet);
    if (update.docChanged || update.selectionSet || update.viewportChanged || configChanged) {
      this.rebuild(update.view);
    }
  }

  private rebuild(view: EditorView) {
    const result = profileMeasure("preview.rebuild", () =>
      buildDecorationSetsInternal(view.state, view.visibleRanges, this.options, view));
    this.disabled = result.disabled;
    this.decorations = result.decorations;
    this.atomicRanges = result.atomicRanges;
  }
}

function enclosingLink(view: EditorView, event: MouseEvent): SyntaxNode | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return null;
  let node: SyntaxNode | null = syntaxTree(view.state).resolve(pos, 1);
  while (node && node.name !== "Link") node = node.parent;
  return node;
}

function openLinkOnCtrlClick(event: MouseEvent, view: EditorView) {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return false;
  const link = enclosingLink(view, event);
  const url = link?.getChild("URL");
  if (!url) return false;
  const href = view.state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, "");
  const safeHref = safeLinkHref(href);
  if (!safeHref) return false;
  event.preventDefault();
  if (typeof window !== "undefined") window.open(safeHref, "_blank", "noopener,noreferrer");
  return true;
}

export const livePreviewPlugin = ViewPlugin.define<LivePreviewValue, LivePreviewOptions>(
  (view, options) => new LivePreviewValue(view, options),
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      mousedown(event, view) {
        return openLinkOnCtrlClick(event, view);
      },
    },
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
  },
);

/** Фасад для тестов и интеграций, которым нужен текущий набор декораций. */
export function previewDecorations(view: EditorView): DecorationSet {
  return view.plugin(livePreviewPlugin)?.decorations ?? Decoration.none;
}

/** Утилита для тестов: извлекает ranges без зависимости от DOM. */
export function decorationRanges(set: DecorationSet) {
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    ranges.push({ from, to, decoration: value });
  });
  return ranges;
}
