import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";
import { blockMathField } from "./blockMath";
import { livePreviewTheme } from "./blocks";
import { codeBlockTheme } from "./codeBlocks";
import { tableTheme } from "./tables";
import { calloutTheme } from "./callouts";
import { footnoteTheme, footnoteTooltip } from "./footnotes";
import { orderedListNormalization } from "../keymap";

export function livePreview(opts?: {
  /** Hard document-size limit overriding livePreview.disableAboveBytes.
   *  Tests use it to avoid building a five-megabyte document; the app does not
   *  set it, otherwise the setting would stop working and confuse users. */
  maxBytes?: number;
  /** Returns a data URL for an image relative to the document. */
  resolveImage?: (src: string) => Promise<string>;
}): Extension {
  return [
    orderedListNormalization,
    livePreviewPlugin.of(opts ?? {}),
    blockMathField,
    livePreviewTheme,
    codeBlockTheme,
    tableTheme,
    calloutTheme,
    footnoteTheme,
    footnoteTooltip,
  ];
}

export { livePreviewPlugin } from "./plugin";
export { blockMathField, blockMathDecorations } from "./blockMath";
export { isNodeActive } from "./isNodeActive";
export { livePreviewSettings } from "./settings";
