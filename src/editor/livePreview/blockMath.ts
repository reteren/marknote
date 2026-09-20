// A multiline `$$ … $$` block is rendered by one widget, and such a replacement
// covers a line break. CodeMirror forbids returning these replacements from view
// plugins: it throws “Decorations that replace line breaks may not be specified
// via plugins”, then stops updating — the editor freezes and raw text remains on
// screen. Therefore the formula block lives in a state field, and the preview
// plugin leaves it alone (see blocks.ts, MathBlock).

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { isNodeActive } from "./isNodeActive";
import { livePreviewConfigFacet } from "./settings";
import { mathBlockSource, spansSeveralLines } from "./mathBlockSource";
import { MathWidget } from "./widgets/Math";

function byteLength(state: EditorState, maxBytes = Number.POSITIVE_INFINITY): number {
  if (state.doc.length > maxBytes) return maxBytes + 1;
  const text = state.doc.toString();
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).byteLength;
}

export function blockMathDecorations(state: EditorState): DecorationSet {
  const config = state.facet(livePreviewConfigFacet);
  if (!config.enabled || !config.renderFormulas) return Decoration.none;
  if (byteLength(state, config.disableAboveBytes) > config.disableAboveBytes) return Decoration.none;

  const ranges: Array<Range<Decoration>> = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "MathBlock") return;
      const node = ref.node;
      if (!spansSeveralLines(state, node)) return;
      if (isNodeActive(node, state.selection, state.doc, config.revealMarkup)) return;
      ranges.push({
        from: node.from,
        to: node.to,
        value: Decoration.replace({ widget: new MathWidget(mathBlockSource(state, node), true), block: true }),
      });
    },
  });
  return Decoration.set(ranges, true);
}

export const blockMathField = StateField.define<DecorationSet>({
  create: (state) => blockMathDecorations(state),
  update(value, transaction) {
    const configChanged =
      transaction.state.facet(livePreviewConfigFacet) !== transaction.startState.facet(livePreviewConfigFacet);
    if (!transaction.docChanged && !transaction.selection && !configChanged) return value;
    return blockMathDecorations(transaction.state);
  },
  // The block is intentionally NOT marked atomic: otherwise the cursor cannot
  // enter it by click or arrow keys, and a typed formula can only be deleted in
  // its entirety. A cursor inside activates the block and shows markup in place.
  provide: (field): Extension => EditorView.decorations.from(field),
});
