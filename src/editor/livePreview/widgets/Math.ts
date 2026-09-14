import { WidgetType, type EditorView } from "@codemirror/view";

type KatexApi = typeof import("katex").default;

const renderedMath = new Map<string, string>();
let katexLoader: Promise<KatexApi> | null = null;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function loadKatex(): Promise<KatexApi> {
  if (!katexLoader) {
    // Движок и его шрифты со стилями попадают в отдельный чанк и грузятся
    // только при фактическом появлении формулы в предпросмотре.
    katexLoader = Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => module.default);
  }
  return katexLoader;
}

function renderMath(source: string, displayMode: boolean, katex: KatexApi): string {
  const key = `${displayMode ? "display" : "inline"}:${source}`;
  const cached = renderedMath.get(key);
  if (cached !== undefined) return cached;

  let html: string;
  try {
    html = katex.renderToString(source, { displayMode, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    html = `<code class="cm-marknote-math-error">${escapeHtml(source)}</code>`;
  }
  renderedMath.set(key, html);
  return html;
}

/** Виджет формулы с ленивой загрузкой KaTeX и кэшем по исходному тексту. */
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
    // Пока KaTeX и его CSS грузятся, оставляем редактируемый исходник на месте.
    element.textContent = this.source;

    void loadKatex().then(
      (katex) => {
        element.innerHTML = renderMath(this.source, this.displayMode, katex);
      },
      () => {
        // При сбое динамического импорта исходный текст остаётся видимым.
      },
    );
    return element;
  }
}

export function clearMathCache() {
  renderedMath.clear();
}

