// Shared contract for live-preview decoration builders.
//
// This file belongs to the coordinator: parallel modules (tables, code blocks,
// callouts, footnotes) and the plugin that calls them depend on it. Do not
// change the signatures; several authors' builds would break at once.

import type { Range } from "@codemirror/state";
import type { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Destination where the builder puts the completed decoration. */
export type DecoSink = (deco: Range<Decoration>) => void;

export type BuilderContext = {
  view: EditorView;
  /** Tree node reached by the traversal. */
  node: SyntaxNode;
  /**
   * Whether the node is active — the result of isNodeActive for it.
   * Do not introduce another activation rule; use only this field.
   */
  active: boolean;
  /** Ordinary decorations: replace, mark, widget. */
  add: DecoSink;
  /**
   * Ranges that the cursor jumps over as a whole.
   * They become EditorView.atomicRanges.
   */
  atomic: DecoSink;
};

/**
 * Decoration builder for one node type.
 * Returns true when the node was handled completely and its descendants need
 * not be traversed; false when the node is not handled and traversal continues.
 */
export type BlockBuilder = (ctx: BuilderContext) => boolean;
