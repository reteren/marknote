import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { DecorationSpec } from "./inline";
import type { LivePreviewConfig } from "./settings";
import { CheckboxWidget } from "./widgets/Checkbox";
import { HrWidget } from "./widgets/Hr";
import { MathWidget } from "./widgets/Math";

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

const line = (position: number, className: string): DecorationSpec => ({
  from: position,
  to: position,
  decoration: Decoration.line({ class: className }),
  line: true,
});

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof TextWidget && widget.text === this.text && widget.className === this.className;
  }

  toDOM(_view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    return element;
  }
}

function children(node: SyntaxNode, name: string) {
  return node.getChildren(name).sort((a, b) => a.from - b.from);
}

function isShortSetextUnderline(node: SyntaxNode, state: EditorState): boolean {
  if (node.name !== "SetextHeading2") return false;
  const marker = children(node, "HeaderMark")[0];
  return Boolean(marker && /^-{1,2}$/u.test(state.doc.sliceString(marker.from, marker.to).trim()));
}

function isTaskChecked(node: SyntaxNode, state: EditorState) {
  const marker = node.getChild("TaskMarker");
  return Boolean(marker && /^\[[xX]\]$/.test(state.doc.sliceString(marker.from, marker.to)));
}

function indentationWidth(text: string): number {
  const indent = text.match(/^[ \t]*/u)?.[0] ?? "";
  let width = 0;
  for (const character of indent) {
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
  }
  return width;
}

export function indentationGuideForLine(target: { from: number; text: string }): DecorationSpec | null {
  const width = indentationWidth(target.text);
  if (width < 4) return null;
  const indent = Math.max(1, Math.min(64, width));
  return line(target.from, `cm-marknote-nested-list-line cm-marknote-nested-list-indent-${indent}`);
}

function nestedListGuide(node: SyntaxNode, state: EditorState): DecorationSpec[] {
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  const specs: DecorationSpec[] = [];
  for (let number = first; number <= last; number += 1) {
    const spec = indentationGuideForLine(state.doc.line(number));
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Построение заголовков, списков, цитат и блочных виджетов. */
export function decorationsForBlockNode(
  node: SyntaxNode,
  active: boolean,
  state: EditorState,
  config?: LivePreviewConfig,
): DecorationSpec[] {
  if (/^ATXHeading[1-6]$/.test(node.name)) {
    const level = Number(node.name.slice(-1));
    const specs: DecorationSpec[] = [mark(node.from, node.to, `cm-marknote-heading cm-marknote-heading-${level}`)];
    if (!active) specs.push(...children(node, "HeaderMark").map((child) => hide(child.from, child.to)));
    return specs;
  }

  if (node.name === "SetextHeading1" || node.name === "SetextHeading2") {
    if (isShortSetextUnderline(node, state)) return [];
    const level = node.name.endsWith("1") ? 1 : 2;
    const specs: DecorationSpec[] = [mark(node.from, node.to, `cm-marknote-heading cm-marknote-heading-${level}`)];
    if (!active) specs.push(...children(node, "HeaderMark").map((child) => hide(child.from, child.to)));
    return specs;
  }

  if (node.name === "OrderedList" || node.name === "BulletList") {
    return nestedListGuide(node, state);
  }

  if (node.name === "ListMark") {
    const parent = node.parent;
    const list = parent?.parent;
    if (list?.name === "BulletList") {
      return [{
        from: node.from,
        to: node.to,
        decoration: Decoration.replace({ widget: new TextWidget("•", "cm-marknote-bullet") }),
        atomic: true,
      }];
    }
    if (active) return [];
    if (list?.name === "OrderedList") return [mark(node.from, node.to, "cm-marknote-ordered-marker")];
    return [];
  }

  if (node.name === "TaskMarker") {
    if (active) return [];
    const source = state.doc.sliceString(node.from, node.to);
    return [{
      from: node.from,
      to: node.to,
      decoration: Decoration.replace({ widget: new CheckboxWidget(/^\[[xX]\]$/.test(source), node.from) }),
      atomic: true,
    }];
  }

  if (node.name === "Task") {
    const marker = node.getChild("TaskMarker");
    if (!marker || marker.to >= node.to || !isTaskChecked(node, state)) return [];
    return [mark(marker.to, node.to, "cm-marknote-task-done")];
  }

  if (node.name === "Blockquote") {
    if (node.firstChild?.nextSibling?.name === "Callout") return [];
    return [mark(node.from, node.to, "cm-marknote-blockquote")];
  }

  if (node.name === "QuoteMark") {
    if (active) return [];
    return [{
      from: node.from,
      to: node.to,
      decoration: Decoration.replace({ widget: new TextWidget("│", "cm-marknote-quote-mark") }),
      atomic: true,
    }];
  }

  if (node.name === "MathBlock") {
    if (config?.renderFormulas === false) {
      return [mark(node.from, node.to, "cm-marknote-math-source")];
    }
    const marks = children(node, "MathMark");
    const sourceFrom = marks[0]?.to ?? node.from + 2;
    const sourceTo = marks.length > 1 ? marks[marks.length - 1].from : node.to;
    const source = state.doc.sliceString(sourceFrom, sourceTo).replace(/^\r?\n|\r?\n$/g, "");
    if (active) return [mark(node.from, node.to, "cm-marknote-math-source")];
    return [{
      from: node.from,
      to: node.to,
      decoration: Decoration.replace({ widget: new MathWidget(source, true) }),
      atomic: true,
    }];
  }

  if (node.name === "HorizontalRule") {
    if (active) return [];
    return [{
      from: node.from,
      to: node.to,
      decoration: Decoration.replace({ widget: new HrWidget() }),
      atomic: true,
    }];
  }

  if (node.name === "Callout") {
    return [mark(node.from, node.to, "cm-marknote-callout")];
  }

  if (node.name === "CalloutMark") {
    return active ? [] : [hide(node.from, node.to)];
  }

  if (node.name === "CalloutTitle") {
    return [mark(node.from, node.to, "cm-marknote-callout-title")];
  }

  if (node.name === "FootnoteDefinitionMark") {
    return active ? [] : [hide(node.from, node.to)];
  }

  if (node.name === "FootnoteDefinitionText") {
    return [mark(node.from, node.to, "cm-marknote-footnote-definition")];
  }

  return [];
}

export const livePreviewTheme = EditorView.theme({
  ".cm-marknote-bold": { fontWeight: "var(--h1-weight)" },
  ".cm-marknote-italic": { fontStyle: "italic" },
  ".cm-marknote-strikethrough": { textDecoration: "line-through" },
  ".cm-marknote-highlight": { backgroundColor: "var(--text-highlight-bg)" },
  ".cm-marknote-comment": { color: "var(--text-faint)", fontStyle: "italic" },
  ".cm-marknote-inline-code": {
    backgroundColor: "var(--code-bg)",
    color: "var(--code-text)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-mono)",
    borderRadius: "var(--radius-s)",
  },
  ".cm-marknote-math-source": { color: "var(--text-accent)", fontFamily: "var(--font-mono)" },
  ".cm-marknote-link": { color: "var(--text-accent)", textDecoration: "underline", cursor: "pointer" },
  ".cm-marknote-image-source": { color: "var(--text-accent)" },
  ".cm-marknote-footnote": { color: "var(--text-accent)", verticalAlign: "super", fontSize: "0.8em" },
  ".cm-marknote-heading": { display: "inline-block", width: "100%" },
  ".cm-marknote-heading-1": { fontSize: "var(--h1-size)", fontWeight: "var(--h1-weight)", color: "var(--h1-color)" },
  ".cm-marknote-heading-2": { fontSize: "var(--h2-size)", fontWeight: "var(--h2-weight)", color: "var(--h2-color)" },
  ".cm-marknote-heading-3": { fontSize: "var(--h3-size)", fontWeight: "var(--h3-weight)", color: "var(--h3-color)" },
  ".cm-marknote-heading-4": { fontSize: "var(--h4-size)", fontWeight: "var(--h4-weight)", color: "var(--h4-color)" },
  ".cm-marknote-heading-5": { fontSize: "var(--h5-size)", fontWeight: "var(--h5-weight)", color: "var(--h5-color)" },
  ".cm-marknote-heading-6": { fontSize: "var(--h6-size)", fontWeight: "var(--h6-weight)", color: "var(--h6-color)" },
  ".cm-marknote-bullet": { display: "inline-block", width: "1.25em", textAlign: "center", color: "var(--text-muted)" },
  ".cm-marknote-ordered-marker": { color: "var(--text-muted)" },
  ".cm-line.cm-marknote-nested-list-line": { backgroundRepeat: "no-repeat" },
  ...Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => {
      const indent = index + 1;
      const levels = Math.floor(indent / 4);
      if (levels <= 0) return [`.cm-line.cm-marknote-nested-list-indent-${indent}`, {}];
      const stops: string[] = [];
      for (let k = 0; k < levels; k += 1) {
        const pos = `${0.625 + k * 1.25}em`;
        stops.push(
          `transparent calc(${pos} - 1px), var(--bg-modifier-border-hover) calc(${pos} - 1px), var(--bg-modifier-border-hover) ${pos}, transparent ${pos}`,
        );
      }
      return [
        `.cm-line.cm-marknote-nested-list-indent-${indent}`,
        {
          backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
        },
      ];
    }),
  ),
  ".cm-marknote-task-done": { color: "var(--text-muted)", textDecoration: "line-through" },
  ".cm-marknote-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "0.95em",
    height: "0.95em",
    marginRight: "0.45em",
    border: "1.5px solid var(--text-muted)",
    borderRadius: "var(--radius-s)",
    verticalAlign: "-0.18em",
    cursor: "pointer",
    boxSizing: "border-box",
    lineHeight: "1",
    userSelect: "none",
  },
  ".cm-marknote-checkbox.is-checked": {
    backgroundColor: "var(--accent)",
    borderColor: "var(--accent)",
  },
  ".cm-marknote-checkbox.is-checked::after": {
    content: "'✓'",
    color: "var(--text-on-accent)",
    fontSize: "0.75em",
    fontWeight: "bold",
    lineHeight: "1",
  },
  ".cm-marknote-blockquote": { borderLeft: "2px solid var(--bg-modifier-border)", paddingLeft: "0.8em" },
  ".cm-marknote-quote-mark": { color: "var(--text-muted)", marginRight: "0.4em" },
  ".cm-marknote-callout": { borderLeft: "3px solid var(--accent)", paddingLeft: "0.8em" },
  ".cm-marknote-callout-title": { fontWeight: "var(--h2-weight)", color: "var(--text-accent)" },
  ".cm-marknote-footnote-definition": { color: "var(--text-muted)" },
  ".cm-marknote-math": { color: "var(--text-normal)" },
  ".cm-marknote-math-display": { display: "block", textAlign: "center", padding: "0.4em 0" },
  ".cm-marknote-math-error": { color: "var(--text-error)" },
  ".cm-marknote-image": { display: "inline-block", maxWidth: "100%", verticalAlign: "middle" },
  ".cm-marknote-image img": { display: "block", maxWidth: "100%", height: "auto" },
  ".cm-marknote-image.is-broken": { border: "1px solid var(--text-error)", color: "var(--text-error)", padding: "0.25em 0.5em" },
  ".cm-marknote-hr": { display: "block", width: "100%", borderTop: "1px solid var(--bg-modifier-border)", margin: "0.75em 0" },
});
