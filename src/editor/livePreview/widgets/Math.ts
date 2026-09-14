import katex from "katex";
import { WidgetType, type EditorView } from "@codemirror/view";

const renderedMath = new Map<string, string>();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** KaTeX вызывается только тогда, когда виджет реально попал в DOM. */
function renderMath(source: string, displayMode: boolean): string {
  const key = `${displayMode ? "display" : "inline"}:${source}`;
  const cached = renderedMath.get(key);
  if (cached) return cached;
  let html: string;
  try {
    html = katex.renderToString(source, { displayMode, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    html = `<code class="cm-marknote-math-error">${escapeHtml(source)}</code>`;
  }
  renderedMath.set(key, html);
  return html;
}

export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly displayMode: boolean,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof MathWidget && widget.source === this.source && widget.displayMode === this.displayMode;
  }

  toDOM(_view: EditorView): HTMLElement {
    const element = document.createElement(this.displayMode ? "div" : "span");
    element.className = `cm-marknote-math${this.displayMode ? " cm-marknote-math-display" : ""}`;
    element.innerHTML = renderMath(this.source, this.displayMode);
    return element;
  }
}

export function clearMathCache() {
  renderedMath.clear();
}
