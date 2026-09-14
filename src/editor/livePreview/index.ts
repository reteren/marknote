import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";
import { livePreviewTheme } from "./blocks";
import { codeBlockTheme } from "./codeBlocks";
import { tableTheme } from "./tables";
import { calloutTheme } from "./callouts";
import { footnoteTheme, footnoteTooltip } from "./footnotes";

export function livePreview(opts?: {
  /** Выше этого размера документа предпросмотр выключается. По умолчанию 5 МБ. */
  maxBytes?: number;
  /** Отдаёт data-URL для картинки, относительной к документу. */
  resolveImage?: (src: string) => Promise<string>;
}): Extension {
  return [
    livePreviewPlugin.of(opts ?? {}),
    livePreviewTheme,
    codeBlockTheme,
    tableTheme,
    calloutTheme,
    footnoteTheme,
    footnoteTooltip,
  ];
}

export { livePreviewPlugin } from "./plugin";
export { isNodeActive } from "./isNodeActive";
