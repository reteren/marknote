// Многострочный блок `$$ … $$` рисуется одним виджетом, а такая замена
// перекрывает перевод строки. CodeMirror запрещает отдавать подобные замены из
// плагина вида: он бросает «Decorations that replace line breaks may not be
// specified via plugins», после чего перестаёт обновляться — редактор застывает
// и на экране остаётся сырой текст. Поэтому блок формулы живёт в поле
// состояния, а плагин предпросмотра его не трогает (см. blocks.ts, MathBlock).

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { isNodeActive } from "./isNodeActive";
import { livePreviewConfigFacet } from "./settings";
import { mathBlockSource, spansSeveralLines } from "./mathBlockSource";
import { MathWidget } from "./widgets/Math";

function byteLength(state: EditorState): number {
  const text = state.doc.toString();
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).byteLength;
}

export function blockMathDecorations(state: EditorState): DecorationSet {
  const config = state.facet(livePreviewConfigFacet);
  if (!config.enabled || !config.renderFormulas) return Decoration.none;
  if (byteLength(state) > config.disableAboveBytes) return Decoration.none;

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
  // Блок намеренно НЕ объявлен неделимым: иначе курсор не попадает внутрь ни
  // щелчком, ни стрелками, и набранную формулу можно только удалить целиком.
  // Курсор внутри делает блок активным, и на его месте показывается разметка.
  provide: (field): Extension => EditorView.decorations.from(field),
});
