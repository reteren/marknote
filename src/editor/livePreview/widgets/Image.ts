import { WidgetType, type EditorView } from "@codemirror/view";
import { translate as t } from "../../../i18n";
import { resizeImageAtDOM, selectImage } from "../../imageResize";
import type { ImageSize } from "../../imageSize";

export type ImageResolver = (src: string) => Promise<string>;

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

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
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

    const handle = document.createElement("span");
    handle.className = "cm-marknote-image-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    wrapper.appendChild(handle);

    const selectOnPress = (event: Event) => {
      if (event.target === handle) return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.selected) selectImage(view, this.from, this.to);
    };
    // CodeMirror treats an atomic widget's mousedown as a text selection. Stop
    // both mouse event families so clicking the frame never fights the widget.
    wrapper.addEventListener("pointerdown", selectOnPress);
    wrapper.addEventListener("mousedown", selectOnPress);

    const startResize = (event: Event) => {
      if (!("pointerId" in event)) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerEvent = event as PointerEvent;

      const naturalWidth = image.naturalWidth > 0 ? image.naturalWidth : Number.POSITIVE_INFINITY;
      const measuredWidth = image.getBoundingClientRect().width || image.clientWidth || this.size?.width || image.naturalWidth;
      if (!measuredWidth || !Number.isFinite(measuredWidth)) return;

      const startX = pointerEvent.clientX;
      const startWidth = measuredWidth;
      const minimumWidth = 24;
      const maximumWidth = Math.max(minimumWidth, naturalWidth);
      let currentWidth = startWidth;
      const pointerId = pointerEvent.pointerId;
      wrapper.classList.add("is-resizing");

      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        currentWidth = Math.min(maximumWidth, Math.max(minimumWidth, startWidth + moveEvent.clientX - startX));
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
    handle.addEventListener("pointerdown", startResize);
    handle.addEventListener("mousedown", (event) => {
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
