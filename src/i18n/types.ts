export type Locale = "en" | "ru" | "de" | "es" | "pt" | "it" | "fr" | "zh" | "ja" | "ar";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type TranslationEntry = string | Partial<Record<PluralCategory, string>>;
export type Dictionary = Readonly<Record<string, TranslationEntry>>;
export type TranslationValue = string | number | Date;
export type TranslationParams = Readonly<Record<string, TranslationValue>>;

export const supportedLocales: readonly Locale[] = ["en", "ru", "de", "es", "pt", "it", "fr", "zh", "ja", "ar"];

export function normalizeLocale(value: string): Locale {
  const language = value.trim().toLowerCase().split(/[-_]/u)[0];
  return supportedLocales.includes(language as Locale) ? language as Locale : "en";
}
