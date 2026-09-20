import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type LanguageSupport as LanguageSupportType,
  type StreamParser,
} from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { BlockBuilder, BuilderContext } from "./types";

const loadedLanguages = new Map<string, LanguageSupport>();
const pendingLanguages = new Map<string, Promise<LanguageSupportType | null>>();

function legacySupport(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

/**
 * Languages from the format registry plus common fenced-block languages.
 * Do not import the complete `languages` list from language-data: it contains
 * dozens of dynamic imports and makes Vite emit a chunk for each one.
 * Each loader remains dynamic, so a specific mode loads only after its block
 * appears in the visible area.
 */
const languages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "C",
    alias: ["c"],
    extensions: ["c", "h"],
    load: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c++", "cc", "cxx"],
    extensions: ["cpp", "c++", "cc", "cxx", "hpp", "hh", "hxx"],
    load: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((module) => module.css()),
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    extensions: ["dockerfile"],
    filename: /^Dockerfile$/i,
    load: () => import("@codemirror/legacy-modes/mode/dockerfile").then((module) => legacySupport(module.dockerFile)),
  }),
  LanguageDescription.of({
    name: "Go",
    extensions: ["go"],
    load: () => import("@codemirror/lang-go").then((module) => module.go()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm", "xhtml"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((module) => module.html()),
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load: () => import("@codemirror/lang-java").then((module) => module.java()),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js", "node", "ecmascript"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((module) => module.javascript()),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc", "json5"],
    extensions: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then((module) => module.json()),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["markdown", "md"],
    extensions: ["md", "markdown", "mdown", "mkd"],
    load: () => import("@codemirror/lang-markdown").then((module) => module.markdown()),
  }),
  LanguageDescription.of({
    name: "PHP",
    extensions: ["php", "php3", "php4", "php5", "php7", "phtml"],
    load: () => import("@codemirror/lang-php").then((module) => module.php()),
  }),
  LanguageDescription.of({
    name: "PowerShell",
    alias: ["powershell", "pwsh", "ps1"],
    extensions: ["ps1", "psd1", "psm1"],
    load: () => import("@codemirror/legacy-modes/mode/powershell").then((module) => legacySupport(module.powerShell)),
  }),
  LanguageDescription.of({
    name: "Python",
    extensions: ["py", "pyw"],
    load: () => import("@codemirror/lang-python").then((module) => module.python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then((module) => module.rust()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["shell", "bash", "sh", "zsh"],
    extensions: ["sh", "ksh", "bash"],
    load: () => import("@codemirror/legacy-modes/mode/shell").then((module) => legacySupport(module.shell)),
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then((module) => module.sql()),
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load: () => import("@codemirror/legacy-modes/mode/toml").then((module) => legacySupport(module.toml)),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["typescript", "ts"],
    extensions: ["ts", "mts", "cts"],
    load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["xml", "xsl", "xsd", "svg"],
    extensions: ["xml", "xsl", "xsd", "svg"],
    load: () => import("@codemirror/lang-xml").then((module) => module.xml()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((module) => module.yaml()),
  }),
];

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

/** Visual builder for fenced code blocks. */
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

/** Theme for fenced code blocks and classes emitted by classHighlighter. */
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
