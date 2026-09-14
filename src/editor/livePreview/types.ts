// Общий контракт построителей декораций живого предпросмотра.
//
// Файл принадлежит координатору: на него опираются модули, которые пишутся
// параллельно (таблицы, блоки кода, callout, сноски), и плагин, который их
// вызывает. Менять сигнатуры нельзя — сломается сборка сразу у нескольких
// авторов.

import type { Range } from "@codemirror/state";
import type { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Куда построитель складывает готовую декорацию. */
export type DecoSink = (deco: Range<Decoration>) => void;

export type BuilderContext = {
  view: EditorView;
  /** Узел дерева, до которого дошёл обход. */
  node: SyntaxNode;
  /**
   * Раскрыт ли узел — результат isNodeActive для него.
   * Своё правило раскрытия вводить нельзя, только это поле.
   */
  active: boolean;
  /** Обычные декорации: replace, mark, widget. */
  add: DecoSink;
  /**
   * Диапазоны, которые курсор перепрыгивает целиком.
   * Попадают в EditorView.atomicRanges.
   */
  atomic: DecoSink;
};

/**
 * Построитель декораций для одного вида узлов.
 * Возвращает true, если узел обработан полностью и обходить его потомков
 * не нужно; false — если узел не его и разбор продолжается.
 */
export type BlockBuilder = (ctx: BuilderContext) => boolean;
