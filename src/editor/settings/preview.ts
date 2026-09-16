// Раздел settings.livePreview: включение предпросмотра, момент раскрытия
// разметки, отрисовка формул и изображений, порог отключения по размеру.
//
// Владелец файла — W86. Сборка расширений в ../settings.ts, туда не пишем.

import type { Extension } from "@codemirror/state";
import type { Settings } from "../../state/settings.svelte";

export function livePreviewSettingsExtensions(settings: Settings | null): Extension[] {
  // Пока раздел не перенесён: предпросмотр подключается в createEditor
  // безусловно, и отсутствие настроек обязано означать именно это.
  void settings;
  return [];
}
