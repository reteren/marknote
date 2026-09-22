import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parseImageAlt, serializeImageAlt } from "./imageSize";

export interface ImageSelection {
  from: number;
  to: number;
}

export const imageSelectionEffect = StateEffect.define<ImageSelection | null>();

export const imageSelectionField = StateField.define<ImageSelection | null>({
  create: () => null,
  update(value, transaction) {
    let next = value;
    if (next && transaction.docChanged) {
      // Any text edit is an intentional interaction change. A resize commit
      // restores the selection in the same transaction via its effect below.
      next = null;
    }

    for (const effect of transaction.effects) {
      if (effect.is(imageSelectionEffect)) next = effect.value;
    }
    return next;
  },
});

export interface ImageNodeParts {
  alt: string;
  altFrom: number;
  altTo: number;
}

function children(node: SyntaxNode, name: string) {
  return node.getChildren(name).sort((left, right) => left.from - right.from);
}

function linkTextRange(node: SyntaxNode, marks: SyntaxNode[], url: SyntaxNode | null, state: EditorState) {
  if (!marks.length) return { from: node.from, to: node.to };
  const from = marks[0].to;
  if (!url) return { from, to: marks[marks.length - 1].from };
  const beforeUrl = marks.filter((marker) => marker.to <= url.from && marker.from >= from);
  const opening = beforeUrl.at(-1);
  if (!opening) return { from, to: from };
  if (state.doc.sliceString(opening.from, opening.to) === "(") {
    const closing = beforeUrl.at(-2);
    if (closing && state.doc.sliceString(closing.from, closing.to).endsWith("]")) {
      return { from, to: closing.from };
    }
  }
  return { from, to: opening.from };
}

/** Extracts the same alt-text fields used by the live-preview image widget. */
export function imageNodeParts(node: SyntaxNode, state: EditorState): ImageNodeParts {
  const marks = children(node, "LinkMark");
  const url = node.getChild("URL");
  const altRange = linkTextRange(node, marks, url, state);
  const alt = state.doc.sliceString(altRange.from, altRange.to).replace(/^\[/, "").replace(/\]$/, "");
  return {
    alt,
    altFrom: altRange.from,
    altTo: altRange.to,
  };
}

function enclosingImage(view: EditorView, element: HTMLElement): SyntaxNode | null {
  let position: number;
  try {
    position = view.posAtDOM(element, 0);
  } catch {
    return null;
  }

  const tree = syntaxTree(view.state);
  for (const bias of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolve(position, bias);
    while (node && node.name !== "Image") node = node.parent;
    if (node) return node;
  }
  return null;
}

export function selectImage(view: EditorView, from: number, to: number): void {
  view.dispatch({ effects: imageSelectionEffect.of({ from, to }) });
}

export function clearImageSelection(view: EditorView): void {
  if (view.state.field(imageSelectionField, false)) {
    view.dispatch({ effects: imageSelectionEffect.of(null) });
  }
}

/**
 * Commits one resize transaction after pointer movement has only changed the
 * rendered DOM. The DOM node is mapped at commit time, so edits above an image
 * cannot redirect the write to a stale decoration position.
 */
export function resizeImageAtDOM(view: EditorView, element: HTMLElement, width: number): boolean {
  const node = enclosingImage(view, element);
  if (!node) return false;

  const parts = imageNodeParts(node, view.state);
  const parsed = parseImageAlt(parts.alt);
  const nextWidth = Math.max(1, Math.round(width));
  const nextAlt = serializeImageAlt(parsed.alt, { width: nextWidth });
  const lengthDelta = nextAlt.length - parts.alt.length;
  const selected = { from: node.from, to: node.to + lengthDelta };

  view.dispatch({
    changes: { from: parts.altFrom, to: parts.altTo, insert: nextAlt },
    effects: imageSelectionEffect.of(selected),
  });
  return true;
}
