// Раздел settings.livePreview: включение предпросмотра, момент раскрытия
// разметки, отрисовка формул и изображений, порог отключения по размеру.
//
// Владелец файла — W86. Сборка расширений в ../settings.ts, туда не пишем.

import type { Extension } from "@codemirror/state";
import type { Settings } from "../../state/settings.svelte";
import { livePreviewSettings } from "../livePreview";

export function livePreviewSettingsExtensions(settings: Settings | null): Extension[] {
  return [livePreviewSettings(settings?.livePreview)];
}
