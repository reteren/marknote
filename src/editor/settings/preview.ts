// settings.livePreview section: enabling preview, when to reveal markup,
// rendering formulas and images, and the size cutoff.
//
// File owner: W86. Extensions are assembled in ../settings.ts; do not edit there.

import type { Extension } from "@codemirror/state";
import type { Settings } from "../../state/settings.svelte";
import { livePreviewSettings } from "../livePreview";

export function livePreviewSettingsExtensions(settings: Settings | null): Extension[] {
  return [livePreviewSettings(settings?.livePreview)];
}
