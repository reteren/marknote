import { WidgetType, type EditorView } from "@codemirror/view";

export type ImageResolver = (src: string) => Promise<string>;

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolveImage?: ImageResolver,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof ImageWidget && widget.src === this.src && widget.alt === this.alt && widget.resolveImage === this.resolveImage;
  }

  toDOM(_view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-marknote-image";
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", this.alt || this.src);

    const fallback = () => {
      wrapper.classList.add("is-broken");
      wrapper.textContent = this.src || "Image";
    };
    const image = document.createElement("img");
    image.alt = this.alt;
    image.loading = "lazy";
    image.addEventListener("error", fallback, { once: true });
    wrapper.appendChild(image);

    const source = this.src.startsWith("data:") || /^(?:https?:|blob:)/i.test(this.src)
      ? Promise.resolve(this.src)
      : this.resolveImage?.(this.src) ?? Promise.resolve(this.src);
    source.then((resolved) => {
      if (!resolved) throw new Error("empty image URL");
      image.src = resolved;
    }).catch(fallback);
    return wrapper;
  }
}
