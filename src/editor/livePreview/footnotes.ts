import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, type Tooltip, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import type { BlockBuilder, BuilderContext } from "./types";

/** Extracts all footnote definitions from the document as a Map: label -> definition text. */
export function getFootnoteDefinitions(state: EditorState): Map<string, string> {
  const definitions = new Map<string, string>();
  const docText = state.doc.toString();
  const lines = docText.split(/\r?\n/);
  let currentLabel: string | null = null;
  let currentText: string[] = [];

  for (const line of lines) {
    const match = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(line);
    if (match) {
      if (currentLabel) {
        definitions.set(currentLabel, currentText.join(" ").trim());
      }
      currentLabel = match[1];
      currentText = [match[2]];
    } else if (currentLabel && /^(?: {4}|\t)(.*)$/.test(line)) {
      currentText.push(line.trim());
    } else if (currentLabel && line.trim() === "") {
      // A blank line may precede a continuation or terminate a definition.
    } else {
      if (currentLabel) {
        definitions.set(currentLabel, currentText.join(" ").trim());
        currentLabel = null;
        currentText = [];
      }
    }
  }

  if (currentLabel) {
    definitions.set(currentLabel, currentText.join(" ").trim());
  }

  return definitions;
}

/** Superscript footnote widget in the text. */
export class FootnoteRefWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof FootnoteRefWidget && other.label === this.label;
  }

  toDOM(): HTMLElement {
    if (typeof document === "undefined") return {} as HTMLElement;
    const sup = document.createElement("sup");
    sup.className = "cm-marknote-footnote-ref";
    sup.dataset.footnote = this.label;
    sup.textContent = this.label;
    return sup;
  }
}

/** Decoration builder for footnotes and their definitions (W6). */
export const footnoteBuilder: BlockBuilder = (ctx: BuilderContext): boolean => {
  // 1. Footnote definition: [^1]: text.
  if (ctx.node.name === "FootnoteDefinition") {
    // Cursor inside the definition: show the original text.
    if (ctx.active) return true;

    const source = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);
    const colonIdx = source.indexOf(":") + 1;
    const labelEnd = ctx.node.from + (colonIdx > 0 ? colonIdx : 0);

    // Entire definition text: muted style.
    ctx.add({
      from: ctx.node.from,
      to: ctx.node.to,
      value: Decoration.mark({ class: "cm-marknote-footnote-definition" }),
    });

    // Emphasize the label.
    if (labelEnd > ctx.node.from) {
      ctx.add({
        from: ctx.node.from,
        to: labelEnd,
        value: Decoration.mark({ class: "cm-marknote-footnote-def-label" }),
      });
    }

    return true;
  }

  // 2. Footnote reference in text: [^1].
  if (ctx.node.name === "FootnoteReference") {
    const text = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);
    const match = /^\[\^([^\]\s]+)\]$/.exec(text);
    if (!match) return false;

    const label = match[1];
    const defs = getFootnoteDefinitions(ctx.view.state);

    // A reference without a definition must not break rendering: leave it as ordinary text.
    if (!defs.has(label)) {
      return true;
    }

    // Show the original text when the cursor is inside.
    if (ctx.active) {
      return true;
    }

    // Display it as a superscript number or label.
    const widget = Decoration.replace({
      widget: new FootnoteRefWidget(label),
    });
    ctx.add({ from: ctx.node.from, to: ctx.node.to, value: widget });
    ctx.atomic({ from: ctx.node.from, to: ctx.node.to, value: widget });
    return true;
  }

  // 3. Fallback: if the tree has no footnote-specific nodes (W4 has not wired
  // them in yet), recognize the construct from paragraph/block text.
  if (ctx.node.name === "Paragraph") {
    if (ctx.node.getChild("FootnoteReference") || ctx.node.getChild("FootnoteDefinition")) {
      return false;
    }

    const text = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);

    // Check whether the whole paragraph is a footnote definition: [^1]: text.
    const defMatch = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(text);
    if (defMatch) {
      if (ctx.active) return true;

      const colonIdx = text.indexOf(":") + 1;
      ctx.add({
        from: ctx.node.from,
        to: ctx.node.to,
        value: Decoration.mark({ class: "cm-marknote-footnote-definition" }),
      });
      ctx.add({
        from: ctx.node.from,
        to: ctx.node.from + colonIdx,
        value: Decoration.mark({ class: "cm-marknote-footnote-def-label" }),
      });
      return true;
    }

    // Check for footnote references inside the paragraph: [^1].
    const refRE = /\[\^([^\]\s]+)\]/g;
    let m: RegExpExecArray | null;
    let handled = false;
    const defs = getFootnoteDefinitions(ctx.view.state);

    while ((m = refRE.exec(text)) !== null) {
      const label = m[1];
      // A reference without a definition remains ordinary text.
      if (!defs.has(label)) continue;

      const from = ctx.node.from + m.index;
      const to = from + m[0].length;
      const isActive = ctx.active || ctx.view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);

      if (!isActive) {
        const widget = Decoration.replace({
          widget: new FootnoteRefWidget(label),
        });
        ctx.add({ from, to, value: widget });
        ctx.atomic({ from, to, value: widget });
        handled = true;
      }
    }

    if (handled) return true;
  }

  return false;
};

/**
 * Tooltip showing definition text when the pointer hovers over a footnote.
 */
export const footnoteTooltip: Extension = hoverTooltip((view: EditorView, pos: number): Tooltip | null => {
  let label: string | null = null;
  let refFrom = 0;
  let refTo = 0;

  // 1. Find the FootnoteReference node in the syntax tree.
  let node: SyntaxNode | null = syntaxTree(view.state).resolve(pos, 1);
  while (node && node.name !== "FootnoteReference" && node.name !== "Paragraph" && node.name !== "Document") {
    node = node.parent;
  }

  if (node && node.name === "FootnoteReference") {
    refFrom = node.from;
    refTo = node.to;
    const text = view.state.doc.sliceString(refFrom, refTo);
    const m = /^\[\^([^\]\s]+)\]$/.exec(text);
    if (m) label = m[1];
  } else {
    // 2. Fallback: find the construct in the text around the cursor position.
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const refRE = /\[\^([^\]\s]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = refRE.exec(lineText)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (pos >= from && pos <= to) {
        label = m[1];
        refFrom = from;
        refTo = to;
        break;
      }
    }
  }

  if (!label) return null;

  const defs = getFootnoteDefinitions(view.state);
  const definitionText = defs.get(label);
  if (!definitionText) return null;

  return {
    pos: refFrom,
    end: refTo,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-marknote-footnote-tooltip";
      dom.textContent = definitionText;
      return { dom };
    },
  };
});

/** CSS theme for footnotes and the tooltip. Tokens must come from theme.css. */
export const footnoteTheme = EditorView.baseTheme({
  ".cm-marknote-footnote-ref": {
    color: "var(--text-accent)",
    verticalAlign: "super",
    fontSize: "0.8em",
    fontWeight: "600",
    cursor: "pointer",
    padding: "0 0.15em",
  },
  ".cm-marknote-footnote-definition": {
    color: "var(--text-muted)",
    fontSize: "0.95em",
  },
  ".cm-marknote-footnote-def-label": {
    color: "var(--text-accent)",
    fontWeight: "600",
    marginRight: "0.3em",
  },
  ".cm-marknote-footnote-tooltip": {
    padding: "6px 10px",
    maxWidth: "360px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--bg-modifier-border)",
    borderRadius: "var(--radius-s)",
    color: "var(--text-normal)",
    fontSize: "var(--font-size-ui)",
    lineHeight: "var(--line-height-ui)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
  },
});
