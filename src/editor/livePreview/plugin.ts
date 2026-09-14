import { type EditorState } from "@codemirror/state";
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
import { decorationsForBlockNode } from "./blocks";
import { decorationsForInlineNode, type DecorationSpec } from "./inline";
import type { ImageResolver } from "./widgets/Image";

export interface LivePreviewOptions {
  maxBytes?: number;
  resolveImage?: ImageResolver;
}

export interface PreviewBuildResult {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
  disabled: boolean;
}

function byteLength(state: EditorState) {
  const text = state.doc.toString();
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).byteLength;
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
    node.name === "ListMark" ||
    node.name === "Task" ||
    node.name === "TaskMarker" ||
    node.name === "Blockquote" ||
    node.name === "QuoteMark";
}

function asRanges(specs: DecorationSpec[]) {
  const valid = specs
    .filter((spec) => spec.to > spec.from)
    .map((spec) => ({ from: spec.from, to: spec.to, value: spec.decoration }));
  return Decoration.set(valid, true);
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
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (byteLength(state) > maxBytes) return { decorations: Decoration.none, atomicRanges: Decoration.none, disabled: true };

  const specs: DecorationSpec[] = [];
  const seen = new Set<string>();
  const tree = syntaxTree(state);
  for (const visible of visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (ref) => {
        const node = ref.node;
        if (node.name === "Document" || node.name === "Paragraph") return;
        const key = `${node.name}:${node.from}:${node.to}`;
        if (seen.has(key)) return;
        seen.add(key);

        const active = isNodeActive(node, state.selection, state.doc);
        const nodeSpecs = isBlockNode(node)
          ? decorationsForBlockNode(node, active, state)
          : decorationsForInlineNode(node, active, state, options.resolveImage);
        specs.push(...nodeSpecs);
      },
    });
  }

  const unique = new Map<string, DecorationSpec>();
  for (const spec of specs) {
    const key = `${spec.from}:${spec.to}:${spec.decoration.spec.class ?? spec.decoration.spec.widget?.constructor?.name ?? "replace"}`;
    if (!unique.has(key)) unique.set(key, spec);
  }
  const all = [...unique.values()];
  return {
    decorations: asRanges(all),
    atomicRanges: asRanges(all.filter((spec) => spec.atomic)),
    disabled: false,
  };
}

export class LivePreviewValue {
  decorations: DecorationSet = Decoration.none;
  atomicRanges: DecorationSet = Decoration.none;
  disabled = false;
  readonly maxBytes: number;
  readonly resolveImage?: ImageResolver;

  constructor(view: EditorView, options: LivePreviewOptions = {}) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.resolveImage = options.resolveImage;
    this.rebuild(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.rebuild(update.view);
  }

  private rebuild(view: EditorView) {
    const result = buildDecorationSets(view.state, view.visibleRanges, {
      maxBytes: this.maxBytes,
      resolveImage: this.resolveImage,
    });
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
  if (!href || /^javascript:/i.test(href)) return false;
  event.preventDefault();
  if (typeof window !== "undefined") window.open(href, "_blank", "noopener,noreferrer");
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
