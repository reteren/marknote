// Live-preview settings represented as a CodeMirror extension.
//
// The six settings.livePreview fields from settings.json converge here. Values
// enter the facet read by the plugin and decoration builders.

import { Facet, type Extension } from "@codemirror/state";
import type { MarkupRevealMode, MaxImageWidth, Settings } from "../../state/settings.svelte";

export type LivePreviewSettings = Settings["livePreview"];

export interface LivePreviewConfig {
  enabled: boolean;
  revealMarkup: MarkupRevealMode;
  renderFormulas: boolean;
  renderImages: boolean;
  maxImageWidth: MaxImageWidth;
  disableAboveBytes: number;
}

export const defaultLivePreviewConfig: LivePreviewConfig = {
  enabled: true,
  revealMarkup: "cursor",
  renderFormulas: true,
  renderImages: true,
  maxImageWidth: "column",
  disableAboveBytes: 5 * 1024 * 1024,
};

export const livePreviewConfigFacet = Facet.define<
  Partial<LivePreviewConfig> | undefined,
  LivePreviewConfig
>({
  combine(values) {
    const combined = { ...defaultLivePreviewConfig };
    for (const val of values) {
      if (!val) continue;
      if (val.enabled !== undefined) combined.enabled = val.enabled;
      if (val.revealMarkup !== undefined) combined.revealMarkup = val.revealMarkup;
      if (val.renderFormulas !== undefined) combined.renderFormulas = val.renderFormulas;
      if (val.renderImages !== undefined) combined.renderImages = val.renderImages;
      if (val.maxImageWidth !== undefined) combined.maxImageWidth = val.maxImageWidth;
      if (val.disableAboveBytes !== undefined) combined.disableAboveBytes = val.disableAboveBytes;
    }
    return combined;
  },
});

/** Live-preview settings extension for settingsCompartment. */
export function livePreviewSettings(settings?: Partial<LivePreviewConfig> | null): Extension {
  return livePreviewConfigFacet.of(settings ?? undefined);
}
