// Разделы settings.spellcheck и settings.autoCorrect.
//
// Проверка орфографии идёт средствами WebView2: словари берутся из системы,
// язык без установленного в Windows пакета проверяться не будет.
//
// Владелец файла — W87. Сборка расширений в ../settings.ts, туда не пишем.

import type { Extension } from "@codemirror/state";
import type { Settings } from "../../state/settings.svelte";

export function spellcheckSettingsExtensions(settings: Settings | null): Extension[] {
  // Пока раздел не перенесён: правка ведётся без автозамены, а проверка
  // орфографии остаётся такой, какой её делает webview по умолчанию.
  void settings;
  return [];
}
