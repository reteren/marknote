import { WidgetType, type EditorView } from "@codemirror/view";

type KatexApi = typeof import("katex").default;

const renderedMath = new Map<string, string>();
let katexLoader: Promise<KatexApi> | null = null;
const MAX_RENDERED_MATH = 256;

// Формулы в заметках обычно намного меньше этих значений. Они оставляют
// запас для длинных выражений, но не дают документу развернуть WebView в
// гигантский элемент или зациклить макрорасширение.
const KATEX_MAX_SIZE_EM = 100;
const KATEX_MAX_EXPAND = 1_000;

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

  /**
   * Щелчок по отрисованной формуле должен ставить курсор в неё, иначе формулу
   * нельзя исправить — только удалить целиком. Курсор внутри блока раскрывает
   * его в разметку `$$ … $$`.
   */
  ignoreEvent(): boolean {
    return false;
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
