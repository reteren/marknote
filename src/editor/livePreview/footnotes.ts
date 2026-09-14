import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, type Tooltip, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import type { BlockBuilder, BuilderContext } from "./types";

/** Извлекает все определения сносок из документа в виде Map: метка -> текст определения. */
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
      // Пустая строка может предшествовать продолжению или завершать определение
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

/** Виджет надстрочной сноски в тексте. */
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

/** Построитель декораций для сносок и их определений (W6). */
export const footnoteBuilder: BlockBuilder = (ctx: BuilderContext): boolean => {
  // 1. Определение сноски: [^1]: текст
  if (ctx.node.name === "FootnoteDefinition") {
    // Курсор внутри определения — показываем исходный текст
    if (ctx.active) return true;

    const source = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);
    const colonIdx = source.indexOf(":") + 1;
    const labelEnd = ctx.node.from + (colonIdx > 0 ? colonIdx : 0);

    // Весь текст определения — приглушённый стиль
    ctx.add({
      from: ctx.node.from,
      to: ctx.node.to,
      value: Decoration.mark({ class: "cm-marknote-footnote-definition" }),
    });

    // Метка выделена акцентом
    if (labelEnd > ctx.node.from) {
      ctx.add({
        from: ctx.node.from,
        to: labelEnd,
        value: Decoration.mark({ class: "cm-marknote-footnote-def-label" }),
      });
    }

    return true;
  }

  // 2. Ссылка на сноску в тексте: [^1]
  if (ctx.node.name === "FootnoteReference") {
    const text = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);
    const match = /^\[\^([^\]\s]+)\]$/.exec(text);
    if (!match) return false;

    const label = match[1];
    const defs = getFootnoteDefinitions(ctx.view.state);

    // Ссылка без определения не должна ломать отображение: остаётся обычным текстом
    if (!defs.has(label)) {
      return true;
    }

    // При курсоре внутри виден исходный текст
    if (ctx.active) {
      return true;
    }

    // Отображается как надстрочный номер или метка
    const widget = Decoration.replace({
      widget: new FootnoteRefWidget(label),
    });
    ctx.add({ from: ctx.node.from, to: ctx.node.to, value: widget });
    ctx.atomic({ from: ctx.node.from, to: ctx.node.to, value: widget });
    return true;
  }

  // 3. Fallback: если дерево не содержит специфических узлов сносок (W4 ещё не подключил их),
  // распознаём конструкцию по тексту абзаца/блока
  if (ctx.node.name === "Paragraph") {
    if (ctx.node.getChild("FootnoteReference") || ctx.node.getChild("FootnoteDefinition")) {
      return false;
    }

    const text = ctx.view.state.doc.sliceString(ctx.node.from, ctx.node.to);

    // Проверяем, не является ли весь абзац определением сноски: [^1]: текст
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

    // Проверяем ссылки на сноски внутри абзаца: [^1]
    const refRE = /\[\^([^\]\s]+)\]/g;
    let m: RegExpExecArray | null;
    let handled = false;
    const defs = getFootnoteDefinitions(ctx.view.state);

    while ((m = refRE.exec(text)) !== null) {
      const label = m[1];
      // Ссылка без определения остаётся обычным текстом
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
 * Всплывающая подсказка с текстом определения при наведении курсора мыши на сноску.
 */
export const footnoteTooltip: Extension = hoverTooltip((view: EditorView, pos: number): Tooltip | null => {
  let label: string | null = null;
  let refFrom = 0;
  let refTo = 0;

  // 1. Поиск узла FootnoteReference в синтаксическом дереве
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
    // 2. Fallback: поиск конструкции по строке вокруг позиции курсора
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

/** CSS-тема оформления сносок и тултипа. Токены строго из theme.css. */
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
