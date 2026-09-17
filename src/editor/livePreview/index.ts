import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";
import { livePreviewTheme } from "./blocks";
import { codeBlockTheme } from "./codeBlocks";
import { tableTheme } from "./tables";
import { calloutTheme } from "./callouts";
import { footnoteTheme, footnoteTooltip } from "./footnotes";
import { orderedListNormalization } from "../keymap";

export function livePreview(opts?: {
  /** Жёсткий порог размера документа, перекрывающий настройку
   *  livePreview.disableAboveBytes. Нужен тестам, чтобы не собирать
   *  пятимегабайтный документ; в приложении не задаётся — иначе настройка
   *  перестанет действовать, и человек не поймёт почему. */
  maxBytes?: number;
  /** Отдаёт data-URL для картинки, относительной к документу. */
  resolveImage?: (src: string) => Promise<string>;
}): Extension {
  return [
    orderedListNormalization,
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
export { livePreviewSettings } from "./settings";
