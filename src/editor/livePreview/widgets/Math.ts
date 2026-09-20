import { WidgetType, type EditorView } from "@codemirror/view";

type KatexApi = typeof import("katex").default;

const renderedMath = new Map<string, string>();
let katexLoader: Promise<KatexApi> | null = null;
const MAX_RENDERED_MATH = 256;

// Formulas in notes are usually much shorter than these values. They leave room
// for long expressions without letting a document expand WebView into a giant
// element or loop through macro expansion.
const KATEX_MAX_SIZE_EM = 100;
const KATEX_MAX_EXPAND = 1_000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function loadKatex(): Promise<KatexApi> {
  if (!katexLoader) {
    // The engine and its styled fonts are kept in a separate chunk and loaded
    // only when a formula actually appears in the preview.
    katexLoader = Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => module.default);
  }
  return katexLoader;
}

function renderMath(source: string, displayMode: boolean, katex: KatexApi): string {
  const key = `${displayMode ? "display" : "inline"}:${source}`;
  const cached = renderedMath.get(key);
  if (cached !== undefined) {
    // Keep frequently reused formulas warm while allowing old documents to
    // release their HTML instead of growing this process-wide cache forever.
    renderedMath.delete(key);
    renderedMath.set(key, cached);
    return cached;
  }

  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
      trust: false,
      maxSize: KATEX_MAX_SIZE_EM,
      maxExpand: KATEX_MAX_EXPAND,
    });
  } catch {
    html = `<code class="cm-marknote-math-error">${escapeHtml(source)}</code>`;
  }
  renderedMath.set(key, html);
  while (renderedMath.size > MAX_RENDERED_MATH) {
    const oldest = renderedMath.keys().next().value;
    if (oldest === undefined) break;
    renderedMath.delete(oldest);
  }
  return html;
}

/** Formula widget with lazy KaTeX loading and a cache keyed by source text. */
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

  /**
   * Clicking a rendered formula must place the cursor in it; otherwise it can
   * only be deleted as a whole, not edited. A cursor inside the block reveals
   * its `$$ … $$` markup.
   */
  ignoreEvent(): boolean {
    return false;
  }

  toDOM(_view: EditorView): HTMLElement {
    const element = document.createElement(this.displayMode ? "div" : "span");
    element.className = `cm-marknote-math${this.displayMode ? " cm-marknote-math-display" : ""}`;
    // Keep the editable source in place while KaTeX and its CSS load.
    element.textContent = this.source;

    void loadKatex().then(
      (katex) => {
        element.innerHTML = renderMath(this.source, this.displayMode, katex);
      },
      () => {
        // If the dynamic import fails, the source text remains visible.
      },
    );
    return element;
  }
}

export function clearMathCache() {
  renderedMath.clear();
}
