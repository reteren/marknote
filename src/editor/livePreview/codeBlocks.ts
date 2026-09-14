import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { BlockBuilder, BuilderContext } from "./types";

const loadedLanguages = new Map<string, LanguageSupport>();
const pendingLanguages = new Map<string, Promise<LanguageSupport | null>>();

function codeLanguage(ctx: BuilderContext): string | null {
  const info = ctx.node.getChild("CodeInfo");
  if (!info) return null;

  const value = ctx.view.state.doc.sliceString(info.from, info.to).trim();
  return value.split(/\s+/, 1)[0] || null;
}

function loadLanguage(name: string, view: EditorView): void {
  const key = name.toLowerCase();
  if (loadedLanguages.has(key) || pendingLanguages.has(key)) return;

  const description = LanguageDescription.matchLanguageName(languages, name, true);
  if (!description) return;

  const pending = description
    .load()
    .then((support) => {
      loadedLanguages.set(key, support);
      pendingLanguages.delete(key);

      // Re-run the decoration builder after the asynchronous parser arrives.
      // A closed view can race the language import, so this is intentionally
      // best effort and must never turn an unknown language into an error.
      try {
        view.dispatch({ selection: view.state.selection });
      } catch {
        // The editor may have been destroyed while the language was loading.
      }
      return support;
    })
    .catch(() => {
      pendingLanguages.delete(key);
      return null;
    });
  pendingLanguages.set(key, pending);
}

function highlightCode(ctx: BuilderContext, code: SyntaxNode, support: LanguageSupport): void {
  const source = ctx.view.state.doc.sliceString(code.from, code.to);
  try {
    const tree = support.language.parser.parse(source);
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (to <= from || !classes) return;
      ctx.add({
        from: code.from + from,
        to: code.from + to,
        value: Decoration.mark({ class: `cm-marknote-code-token ${classes}` }),
      });
    });
  } catch {
    // A language parser is optional decoration. Keep the code block usable
    // when a dynamically loaded parser cannot parse an incomplete document.
  }
}

function hideRange(ctx: BuilderContext, from: number, to: number): void {
  if (to <= from) return;
  const hidden = Decoration.replace({});
  ctx.add({ from, to, value: hidden });
  ctx.atomic({ from, to, value: hidden });
}

/** Построитель визуального вида fenced code blocks. */
export const codeBlockBuilder: BlockBuilder = (ctx) => {
  if (ctx.node.name !== "FencedCode") return false;
  if (ctx.active) return true;

  const opening = ctx.node.getChild("CodeMark");
  const code = ctx.node.getChild("CodeText");
  const marks = ctx.node.getChildren("CodeMark").sort((a, b) => a.from - b.from);
  const info = ctx.node.getChild("CodeInfo");

  if (opening) hideRange(ctx, opening.from, info?.to ?? opening.to);
  if (marks.length > 1) {
    const closing = marks[marks.length - 1];
    if (closing) hideRange(ctx, closing.from, closing.to);
  }

  if (code && code.to > code.from) {
    ctx.add({
      from: code.from,
      to: code.to,
      value: Decoration.mark({ class: "cm-marknote-code-block" }),
    });

    const name = codeLanguage(ctx);
    if (name) {
      const key = name.toLowerCase();
      const support = loadedLanguages.get(key);
      if (support) highlightCode(ctx, code, support);
      else loadLanguage(name, ctx.view);
    }
  }

  return true;
};

/** Тема fenced code blocks и классов, которые выдаёт classHighlighter. */
export const codeBlockTheme = EditorView.theme({
  ".cm-marknote-code-block": {
    display: "inline-block",
    width: "100%",
    backgroundColor: "var(--code-block-bg)",
    color: "var(--code-text)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-mono)",
    lineHeight: "var(--line-height-text)",
    whiteSpace: "pre",
  },
  ".cm-marknote-code-token": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-marknote-code-token.tok-keyword, .cm-marknote-code-token.tok-operator": {
    color: "var(--text-accent)",
  },
  ".cm-marknote-code-token.tok-string, .cm-marknote-code-token.tok-number, .cm-marknote-code-token.tok-bool": {
    color: "var(--text-normal)",
  },
  ".cm-marknote-code-token.tok-comment": {
    color: "var(--text-muted)",
  },
  ".cm-marknote-code-token.tok-typeName, .cm-marknote-code-token.tok-className, .cm-marknote-code-token.tok-propertyName": {
    color: "var(--text-accent)",
  },
  ".cm-marknote-code-token.tok-invalid": {
    color: "var(--text-error)",
  },
});
