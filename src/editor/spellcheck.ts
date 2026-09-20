// Поддержка проверки орфографии и исключения разметки кода/формул/ссылок.
//
// Проверка орфографии выполняется браузерным движком (WebView2 / Chromium)
// по атрибуту spellcheck на contentDOM редактора. Язык словаря выбирает
// WebView2 из языка интерфейса Windows; страница не может его переопределить.
// Разметка (код, формулы, ссылки) помечается spellcheck="false", чтобы
// словари не подчёркивали синтаксис и идентификаторы.

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { profileMeasure } from "./profile";

const CODE_FORMULA_LINK_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "CodeText",
  "CodeInfo",
  "CodeMark",
  "MathBlock",
  "InlineMath",
  "MathMark",
  "Link",
  "Image",
  "URL",
  "Autolink",
  "LinkLabel",
  "LinkMark",
  "LinkTitle",
]);

const TOP_LEVEL_SKIP_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "MathBlock",
  "InlineMath",
  "Link",
  "Image",
  "URL",
  "Autolink",
]);

/**
 * Проверяет, находится ли позиция pos внутри блока кода, инлайн-кода, формулы или ссылки.
 * Используется автозаменой, чтобы не менять кавычки, тире и многоточия в разметке.
 */
export function isInsideCodeFormulaOrLink(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);

  let n: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (n) {
    if (CODE_FORMULA_LINK_NODES.has(n.name)) {
      if (pos > n.from && (pos < n.to || n.to === state.doc.length)) {
        return true;
      }
    }
    n = n.parent;
  }

  n = tree.resolveInner(pos, 1);
  while (n) {
    if (CODE_FORMULA_LINK_NODES.has(n.name)) {
      if (pos > n.from && (pos < n.to || n.to === state.doc.length)) {
        return true;
      }
    }
    n = n.parent;
  }

  return false;
}

const skipSpellcheckMark = Decoration.mark({ attributes: { spellcheck: "false" } });

function buildSkipDecorations(state: EditorState): DecorationSet {
  const tree = profileMeasure("spellcheck.parse", () => syntaxTree(state));
  const ranges: Range<Decoration>[] = [];

  profileMeasure("spellcheck.decorate", () => tree.iterate({
    enter(node) {
      if (TOP_LEVEL_SKIP_NODES.has(node.name)) {
        if (node.to > node.from) {
          ranges.push({ from: node.from, to: node.to, value: skipSpellcheckMark });
        }
        return false;
      }
    },
  }));

  return Decoration.set(ranges, true);
}

const skipCodeFormulaPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildSkipDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = buildSkipDecorations(update.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export type SpellcheckOptions = {
  enabled: boolean;
  skipCodeFormulaLinks: boolean;
};

export function spellcheckExtension(options: SpellcheckOptions): Extension[] {
  const extensions: Extension[] = [];

  const attrs: Record<string, string> = {
    spellcheck: options.enabled ? "true" : "false",
  };
  extensions.push(EditorView.contentAttributes.of(attrs));

  if (options.enabled && options.skipCodeFormulaLinks) {
    extensions.push(skipCodeFormulaPlugin);
  }

  return extensions;
}
