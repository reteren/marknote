import en from "./locales/en";
import type { Dictionary, Locale, PluralCategory, TranslationEntry, TranslationParams } from "./types";
import { normalizeLocale } from "./types";
import { interfaceLanguage } from "./state.svelte";

export type { Dictionary, Locale, TranslationEntry, TranslationParams } from "./types";
export { supportedLocales, normalizeLocale } from "./types";
export { applyDocumentTextDirection } from "./direction";
export { interfaceLanguage };

export const englishDictionary: Dictionary = en;

const loadedDictionaries = new Map<Locale, Dictionary>([["en", en]]);
const loaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Dictionary }>> = {
  ru: () => import("./locales/ru"),
  de: () => import("./locales/de"),
  es: () => import("./locales/es"),
  pt: () => import("./locales/pt"),
  it: () => import("./locales/it"),
  fr: () => import("./locales/fr"),
  zh: () => import("./locales/zh"),
  ja: () => import("./locales/ja"),
  ar: () => import("./locales/ar"),
};

let languageRequest = 0;

async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = loadedDictionaries.get(locale);
  if (cached) return cached;
  const module = await loaders[locale as Exclude<Locale, "en">]();
  loadedDictionaries.set(locale, module.default);
  return module.default;
}

/** Load only the selected non-English dictionary and update the document root direction. */
export async function setInterfaceLanguage(language: string): Promise<Locale> {
  const locale = normalizeLocale(language);
  const request = ++languageRequest;
  let dictionary: Dictionary = en;
  if (locale !== "en") {
    try {
      dictionary = await loadDictionary(locale);
    } catch {
      // Missing translation chunks are a normal fallback to the bundled English dictionary.
      dictionary = en;
    }
  }
  if (request !== languageRequest) return interfaceLanguage.locale;
  interfaceLanguage.locale = dictionary === en && locale !== "en" ? "en" : locale;
  interfaceLanguage.dictionary = dictionary;
  if (typeof document !== "undefined") {
    document.documentElement.lang = interfaceLanguage.locale;
    document.documentElement.dir = interfaceLanguage.locale === "ar" ? "rtl" : "ltr";
  }
  return interfaceLanguage.locale;
}

function pluralCategory(locale: string, count: number): PluralCategory {
  return new Intl.PluralRules(normalizeLocale(locale)).select(count) as PluralCategory;
}

function resolveEntry(locale: string, key: string, entry: TranslationEntry, params: TranslationParams): string {
  if (typeof entry === "string") return interpolate(entry, locale, params);
  const count = typeof params.count === "number" ? params.count : 0;
  const category = pluralCategory(locale, count);
  const template = entry[category] ?? entry.other ?? entry.one ?? Object.values(entry)[0];
  return template === undefined ? key : interpolate(template, locale, params);
}

function interpolate(template: string, locale: string, params: TranslationParams): string {
  return template.replace(/\{([\w.]+)(?:\s*,\s*(number|date|time))?\}/gu, (placeholder, name: string, format?: string) => {
    const value = params[name];
    if (value === undefined || value === null) return placeholder;
    if (value instanceof Date) {
      return format === "time" ? formatTime(value, locale) : formatDate(value, locale);
    }
    if (typeof value === "number") return formatNumber(value, locale);
    return String(value);
  });
}

/** Translate with selected-language → English → key fallback. */
export function translate(key: string, params: TranslationParams = {}): string {
  return translateWith(interfaceLanguage.locale, interfaceLanguage.dictionary, key, params);
}

/** Translate format names received dynamically from the Rust format registry. */
export function formatLabel(formatId: string, rustLabel: string): string {
  const entry = interfaceLanguage.dictionary[`format.${formatId}`]
    ?? englishDictionary[`format.${formatId}`];
  return typeof entry === "string" ? entry : rustLabel;
}

/** Pure entry point used for fallback/plural tests and non-reactive consumers. */
export function translateWith(
  locale: string,
  dictionary: Dictionary,
  key: string,
  params: TranslationParams = {},
): string {
  const requested = dictionary[key];
  if (requested !== undefined) return resolveEntry(locale, key, requested, params);
  const fallback = englishDictionary[key];
  if (fallback !== undefined) return resolveEntry("en", key, fallback, params);
  return key;
}

export function formatNumber(value: number, locale: string = interfaceLanguage.locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(value: Date, locale: string = interfaceLanguage.locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}

export function formatTime(value: Date, locale: string = interfaceLanguage.locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(value);
}

export function formatDateTime(value: Date, locale: string = interfaceLanguage.locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value);
}
