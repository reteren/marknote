import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";
import { livePreviewTheme } from "./blocks";

export function livePreview(opts?: {
  /** Выше этого размера документа предпросмотр выключается. По умолчанию 5 МБ. */
  maxBytes?: number;
  /** Отдаёт data-URL для картинки, относительной к документу. */
  resolveImage?: (src: string) => Promise<string>;
}): Extension {
  return [livePreviewPlugin.of(opts ?? {}), livePreviewTheme];
}

export { livePreviewPlugin } from "./plugin";
export { isNodeActive } from "./isNodeActive";
