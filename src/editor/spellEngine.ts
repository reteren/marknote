import { invoke } from "@tauri-apps/api/core";

export type SpellLanguage = { tag: string; name: string };
export type SpellRange = { from: number; to: number };

const suggestionCache = new Map<string, Promise<string[]>>();

/** The single IPC seam for the native Windows spell checker. */
export function loadSpellcheckLanguages(): Promise<SpellLanguage[]> {
  return invoke<SpellLanguage[]>("spellcheck_languages")
    .then((languages) => (Array.isArray(languages) ? languages : []))
    .catch(() => []);
}

export async function checkSpelling(text: string, languages: readonly string[]): Promise<SpellRange[]> {
  if (!text || languages.length === 0) return [];
  try {
    const ranges = await invoke<SpellRange[]>("spellcheck_check", {
      text,
      languages: [...languages],
    });
    return Array.isArray(ranges)
      ? ranges.filter((range) => Number.isInteger(range?.from) && Number.isInteger(range?.to) && range.to > range.from)
      : [];
  } catch {
    return [];
  }
}

export async function suggestSpelling(word: string, languages: readonly string[]): Promise<string[]> {
  if (!word || languages.length === 0) return [];
  const key = JSON.stringify([word, [...languages].sort()]);
  const existing = suggestionCache.get(key);
  if (existing) return existing;
  const request = invoke<string[]>("spellcheck_suggest", {
    word,
    languages: [...languages],
    limit: 3,
  }).then((suggestions) => (
    Array.isArray(suggestions)
      ? suggestions.filter((item): item is string => typeof item === "string").slice(0, 3)
      : []
  )).catch(() => []);
  suggestionCache.set(key, request);
  if (suggestionCache.size > 1024) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  try {
    return await request;
  } catch {
    return [];
  }
}

export async function addSpellingWord(word: string, languages: readonly string[]): Promise<void> {
  if (!word || languages.length === 0) return;
  try {
    await invoke("spellcheck_add_word", { word, languages: [...languages] });
  } catch {
    // Spellcheck is advisory; a failed dictionary update must not interrupt editing.
  }
}

export function clearSpellcheckSuggestionCache(): void {
  suggestionCache.clear();
}
