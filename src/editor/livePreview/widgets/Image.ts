import { WidgetType, type EditorView } from "@codemirror/view";
import { translate as t } from "../../../i18n";
import { resizeImageAtDOM, selectImage } from "../../imageResize";
import type { ImageSize } from "../../imageSize";

export type ImageResolver = (src: string) => Promise<string>;

export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

/**
 * The width an image takes when `edge` is dragged by (dx, dy). Height follows
 * the proportions, so the top and bottom edges resize too: a vertical drag is
 * turned into the width that gives that height. A corner follows whichever
 * direction moved further.
 */
export function resizedWidth(
  edge: ResizeEdge,
  startWidth: number,
  startHeight: number,
  dx: number,
  dy: number,
  limits: { minimum: number; maximum: number },
): number {
  const ratio = startHeight > 0 ? startWidth / startHeight : 1;
  const fromX = edge.includes("e") ? dx : edge.includes("w") ? -dx : 0;
  const fromY = (edge.includes("s") ? dy : edge.includes("n") ? -dy : 0) * ratio;
  const change = Math.abs(fromX) >= Math.abs(fromY) ? fromX : fromY;
  return Math.min(limits.maximum, Math.max(limits.minimum, startWidth + change));
}

/** The widget currently shown by an image element; updateDOM swaps it in place. */
const currentWidget = new WeakMap<HTMLElement, ImageWidget>();

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolveImage?: ImageResolver,
    readonly size?: ImageSize,
    readonly selected = false,
    readonly from = 0,
    readonly to = 0,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof ImageWidget && widget.src === this.src && widget.alt === this.alt && widget.resolveImage === this.resolveImage &&
      widget.size?.width === this.size?.width && widget.size?.height === this.size?.height && widget.selected === this.selected &&
      widget.from === this.from && widget.to === this.to;
  }

  /** Same picture: only its place in the text or its selection differs. */
  private samePicture(widget: ImageWidget): boolean {
    return widget.src === this.src && widget.alt === this.alt && widget.resolveImage === this.resolveImage &&
      widget.size?.width === this.size?.width && widget.size?.height === this.size?.height;
  }

  /**
   * Typing before an image moves it, which makes a new widget on every key.
   * Rebuilding its element reloaded the picture each time and made it blink,
   * so the element is kept and only told where it is now.
   */
  updateDOM(dom: HTMLElement, _view: EditorView, from?: WidgetType): boolean {
    const previous = from instanceof ImageWidget ? from : currentWidget.get(dom);
    if (!previous || !this.samePicture(previous)) return false;
    currentWidget.set(dom, this);
    dom.classList.toggle("is-selected", this.selected);
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    currentWidget.set(wrapper, this);
    // Handlers read the widget through the element, so a reused element acts
    // on the image's current place in the text, not the one it was built at.
    const current = (): ImageWidget => currentWidget.get(wrapper) ?? this;
    wrapper.className = `cm-marknote-image is-loading${this.selected ? " is-selected" : ""}`;
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", this.alt || this.src);

    const fallback = (err?: unknown) => {
      wrapper.classList.remove("is-loading");
      wrapper.classList.add("is-broken");
      wrapper.replaceChildren();

      const errorBadge = document.createElement("span");
      errorBadge.className = "cm-marknote-image-error";

      const errStr = err instanceof Error ? err.message : String(err ?? "");
      let reason = t("image.insertFailed");
      if (/too large|ImageTooLarge|larger than/iu.test(errStr)) {
        wrapper.classList.add("is-too-large");
        reason = t("image.tooLarge");
      } else if (/missing|not found|No such file/iu.test(errStr)) {
        wrapper.classList.add("is-missing");
        reason = t("image.notFound");
      } else if (/saved document path/iu.test(errStr)) {
        wrapper.classList.add("is-unsaved");
        reason = t("image.needsDocument");
      }

      errorBadge.textContent = this.src ? `${reason}: ${this.src}` : reason;
      errorBadge.title = errStr || reason;
      wrapper.appendChild(errorBadge);
    };

    const image = document.createElement("img");
    image.alt = this.alt;
    image.loading = "lazy";

    const applyImageSize = () => {
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      const requestedWidth = this.size?.width ?? (naturalWidth > 0 ? naturalWidth / 2 : undefined);
      if (requestedWidth !== undefined) {
        const width = naturalWidth > 0 ? Math.min(requestedWidth, naturalWidth) : requestedWidth;
        image.style.width = `${width}px`;
      }
      if (this.size?.height !== undefined) {
        const height = naturalHeight > 0 ? Math.min(this.size.height, naturalHeight) : this.size.height;
        image.style.height = `${height}px`;
      } else {
        image.style.height = "auto";
      }
    };

    image.addEventListener("load", () => {
      // Set dimensions while the image is still transparent, so an unsized
      // photo never flashes at its natural full width before being halved.
      applyImageSize();
      wrapper.classList.remove("is-loading");
      wrapper.classList.add("is-loaded");
    }, { once: true });

    image.addEventListener("error", () => {
      fallback();
    }, { once: true });

    wrapper.appendChild(image);

    // A selected image shows an accent frame; every edge and corner of it
    // resizes the picture, keeping its proportions.
    const frame = document.createElement("span");
    frame.className = "cm-marknote-image-frame";
    frame.setAttribute("aria-hidden", "true");
    const edges: ResizeEdge[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
    for (const edge of edges) {
      const grip = document.createElement("span");
      grip.className = `cm-marknote-image-resize-handle is-${edge}`;
      grip.dataset.edge = edge;
      frame.appendChild(grip);
    }
    wrapper.appendChild(frame);

    const selectOnPress = (event: Event) => {
      if ((event.target as Element | null)?.closest?.(".cm-marknote-image-resize-handle")) return;
      event.preventDefault();
      event.stopPropagation();
      const widget = current();
      if (!widget.selected) selectImage(view, widget.from, widget.to);
    };
    // CodeMirror treats an atomic widget's mousedown as a text selection. Stop
    // both mouse event families so clicking the frame never fights the widget.
    wrapper.addEventListener("pointerdown", selectOnPress);
    wrapper.addEventListener("mousedown", selectOnPress);

    const startResize = (event: Event) => {
      if (!("pointerId" in event)) return;
      const grip = (event.target as Element | null)?.closest?.(".cm-marknote-image-resize-handle") as HTMLElement | null;
      const edge = grip?.dataset.edge as ResizeEdge | undefined;
      if (!edge) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerEvent = event as PointerEvent;

      const naturalWidth = image.naturalWidth > 0 ? image.naturalWidth : Number.POSITIVE_INFINITY;
      const rect = image.getBoundingClientRect();
      const startWidth = rect.width || image.clientWidth || this.size?.width || image.naturalWidth;
      const startHeight = rect.height || image.clientHeight;
      if (!startWidth || !Number.isFinite(startWidth)) return;

      const startX = pointerEvent.clientX;
      const startY = pointerEvent.clientY;
      const limits = { minimum: 24, maximum: Math.max(24, naturalWidth) };
      let currentWidth = startWidth;
      const pointerId = pointerEvent.pointerId;
      wrapper.classList.add("is-resizing");

      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        currentWidth = resizedWidth(edge, startWidth, startHeight, moveEvent.clientX - startX, moveEvent.clientY - startY, limits);
        image.style.width = `${currentWidth}px`;
        image.style.height = "auto";
      };
      const finish = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        wrapper.classList.remove("is-resizing");
        if (Math.abs(currentWidth - startWidth) > 0.5) resizeImageAtDOM(view, wrapper, currentWidth);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
    };
    frame.addEventListener("pointerdown", startResize);
    frame.addEventListener("mousedown", (event) => {
      if (!(event.target as Element | null)?.closest?.(".cm-marknote-image-resize-handle")) return;
      event.preventDefault();
      event.stopPropagation();
    });

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
