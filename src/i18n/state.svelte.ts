import en from "./locales/en";
import type { Dictionary, Locale } from "./types";

export const interfaceLanguage = $state<{ locale: Locale; dictionary: Dictionary }>({
  locale: "en",
  dictionary: en,
});
