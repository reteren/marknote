import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { LivePreviewConfig } from "./settings";
import { ImageWidget, type ImageResolver } from "./widgets/Image";
import { MathWidget } from "./widgets/Math";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns a normalized URL only for schemes that make sense for a note.
 *
 * Deliberately use the platform URL parser rather than a string blacklist:
 * it canonicalizes the scheme (including case and C0 whitespace handling),
 * rejects malformed/relative destinations, and does not treat percent- or
 * Unicode-encoded text as a protocol. Relative links are left to a future
 * file-link action instead of being opened in the WebView's URL context.
 */
export function safeLinkHref(raw: string): string | null {
  if (!raw) return null;

  let parsed: URL;
  try {
    // No base URL is supplied on purpose: relative and protocol-relative
    // links must not become an https URL merely because the editor has a
    // synthetic origin.
    parsed = new URL(raw);
  } catch {
    return null;
  }

  return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
}

export interface DecorationSpec {
  from: number;
  to: number;
  decoration: Decoration;
  atomic?: boolean;
}

const hide = (from: number, to: number): DecorationSpec => ({
  from,
  to,
  decoration: Decoration.replace({}),
  atomic: true,
});

const mark = (from: number, to: number, className: string): DecorationSpec => ({
  from,
  to,
  decoration: Decoration.mark({ class: className }),
});

function children(node: SyntaxNode, name: string) {
  return node.getChildren(name).sort((a, b) => a.from - b.from);
}

function innerRange(node: SyntaxNode, markerName: string) {
  const markers = children(node, markerName);
  if (!markers.length) return { from: node.from, to: node.to };
  return { from: markers[0].to, to: markers[markers.length - 1].from };
}

function hideChildren(node: SyntaxNode, markerName: string) {
  return children(node, markerName).filter((child) => child.to > child.from).map((child) => hide(child.from, child.to));
}

function sourceBetween(node: SyntaxNode, markerName: string, state: EditorState) {
  const range = innerRange(node, markerName);
  return state.doc.sliceString(range.from, range.to);
}

function linkTextRange(node: SyntaxNode, marks: SyntaxNode[], url: SyntaxNode | null) {
  if (!marks.length) return { from: node.from, to: node.to };
  const from = marks[0].to;
  if (!url) return { from, to: marks[marks.length - 1].from };
  // У ссылки после текста идут `]`, `(`, URL и `)`. Нужна именно `]`, а
  // не последний LinkMark перед закрывающей скобкой.
  const closingBracket = marks.filter((marker) => marker.to <= url.from && marker.from >= from).at(-1);
  return { from, to: closingBracket?.from ?? from };
}

/** Построение строчных декораций. Все решения об active принимает plugin. */
export function decorationsForInlineNode(
  node: SyntaxNode,
  active: boolean,
  state: EditorState,
  resolveImage?: ImageResolver,
  config?: LivePreviewConfig,
): DecorationSpec[] {
  switch (node.name) {
    case "StrongEmphasis": {
      const range = innerRange(node, "EmphasisMark");
      return [mark(range.from, range.to, "cm-marknote-bold"), ...(active ? [] : hideChildren(node, "EmphasisMark"))];
    }
    case "Emphasis": {
      const range = innerRange(node, "EmphasisMark");
      return [mark(range.from, range.to, "cm-marknote-italic"), ...(active ? [] : hideChildren(node, "EmphasisMark"))];
    }
    case "Strikethrough": {
      const range = innerRange(node, "StrikethroughMark");
      return [mark(range.from, range.to, "cm-marknote-strikethrough"), ...(active ? [] : hideChildren(node, "StrikethroughMark"))];
    }
    case "Highlight": {
      const range = innerRange(node, "HighlightMark");
      return [mark(range.from, range.to, "cm-marknote-highlight"), ...(active ? [] : hideChildren(node, "HighlightMark"))];
    }
    case "Comment": {
      const range = innerRange(node, "CommentMark");
      if (!active) return [{ from: node.from, to: node.to, decoration: Decoration.replace({}), atomic: true }];
      return [mark(range.from, range.to, "cm-marknote-comment")];
    }
    case "InlineCode": {
      const range = innerRange(node, "CodeMark");
      return [mark(range.from, range.to, "cm-marknote-inline-code"), ...(active ? [] : hideChildren(node, "CodeMark"))];
    }
    case "InlineMath": {
      if (config?.renderFormulas === false) {
        return [mark(node.from, node.to, "cm-marknote-math-source")];
      }
      const source = sourceBetween(node, "MathMark", state);
      if (!active) {
        return [{
          from: node.from,
          to: node.to,
          decoration: Decoration.replace({ widget: new MathWidget(source, false) }),
          atomic: true,
        }];
      }
      return [mark(node.from, node.to, "cm-marknote-math-source")];
    }
    case "Link": {
      const marks = children(node, "LinkMark");
      const url = node.getChild("URL");
      const range = linkTextRange(node, marks, url);
      const specs = [mark(range.from, range.to, "cm-marknote-link")];
      if (!active) {
        specs.push(...marks.map((child) => hide(child.from, child.to)));
        if (url) specs.push(hide(url.from, url.to));
      }
      return specs;
    }
    case "Image": {
      if (config?.renderImages === false) {
        return [mark(node.from, node.to, "cm-marknote-image-source")];
      }
      const marks = children(node, "LinkMark");
      const url = node.getChild("URL");
      const altRange = linkTextRange(node, marks, url);
      const alt = state.doc.sliceString(altRange.from, altRange.to).replace(/^\[/, "").replace(/\]$/, "");
      const src = url ? state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, "") : "";
      if (!active) {
        return [{
          from: node.from,
          to: node.to,
          decoration: Decoration.replace({ widget: new ImageWidget(src, alt, resolveImage) }),
          atomic: true,
        }];
      }
      return [mark(node.from, node.to, "cm-marknote-image-source")];
    }
    case "FootnoteReference":
      return [mark(node.from, node.to, "cm-marknote-footnote")];
    default:
      return [];
  }
}
