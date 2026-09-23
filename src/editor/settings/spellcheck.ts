// settings.spellcheck and settings.autoCorrect sections.
//
// Spellchecking uses the selected bundled dictionaries through spellEngine.
//
// File owner: W87. Extensions are assembled in ../settings.ts; do not edit there.

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
      dictionaries: settings.spellcheck.dictionaries ?? ["en"],
      inlineSuggestions: settings.spellcheck.inlineSuggestions ?? false,
    }),
    ...autoCorrectExtension(settings.autoCorrect),
  ];
}
