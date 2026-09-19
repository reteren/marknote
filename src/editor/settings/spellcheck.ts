// Разделы settings.spellcheck и settings.autoCorrect.
//
// Проверка орфографии идёт средствами WebView2: словари берутся из системы,
// язык без установленного в Windows пакета проверяться не будет.
//
// Владелец файла — W87. Сборка расширений в ../settings.ts, туда не пишем.

import type { Extension } from "@codemirror/state";
import type { Settings } from "../../state/settings.svelte";
import { spellcheckExtension } from "../spellcheck";
import { autoCorrectExtension } from "../autoCorrect";

export function spellcheckSettingsExtensions(settings: Settings | null): Extension[] {
  if (!settings) {
    return [];
  }

  return [
    ...spellcheckExtension({
      enabled: settings.spellcheck.enabled,
      skipCodeFormulaLinks: settings.spellcheck.skipCodeFormulaLinks,
    }),
    ...autoCorrectExtension(settings.autoCorrect),
  ];
}
