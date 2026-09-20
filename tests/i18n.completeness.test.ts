// Are the dictionaries complete?
//
// The Dictionary type is declared as Readonly<Record<string, TranslationEntry>>,
// an ordinary map with no list of required keys. Type checking passes with any
// number of them missing, so it cannot be relied on: that is exactly how three
// dictionaries shipped without a hundred and sixteen labels while their author
// was sure he was done.
//
// When a key is missing, the translation mechanism shows the key itself. That
// is honest and immediately visible — but only to someone who opens the program
// in that language. This test makes the gap visible to everyone at once.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { supportedLocales } from "../src/i18n/types";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

/** The top-level keys of a dictionary, read from the source of the file.
 *  We read text instead of importing: the dictionaries are loaded dynamically,
 *  and the test needs the full list without pulling all ten into memory. */
function keysOf(locale: string): Set<string> {
  const source = readFileSync(join(localesDir, `${locale}.ts`), "utf8");
  return new Set([...source.matchAll(/^\s{2}"([a-zA-Z0-9._]+)"\s*:/gm)].map((m) => m[1]));
}

describe("dictionary completeness", () => {
  const reference = keysOf("en");

  it("the English dictionary is not empty and serves as the reference", () => {
    expect(reference.size).toBeGreaterThan(200);
  });

  for (const locale of supportedLocales.filter((code) => code !== "en")) {
    it(`${locale}: no missing keys`, () => {
      const missing = [...reference].filter((key) => !keysOf(locale).has(key)).sort();
      expect(
        missing,
        missing.length === 0
          ? ""
          : `${locale}.ts is missing ${missing.length} keys, the first of them: ${missing.slice(0, 8).join(", ")}`,
      ).toEqual([]);
    });

    it(`${locale}: no extra keys`, () => {
      // An extra key means the string was removed from the interface but left
      // in the dictionary: a dead translation that will be maintained for
      // nothing.
      const extra = [...keysOf(locale)].filter((key) => !reference.has(key)).sort();
      expect(
        extra,
        extra.length === 0 ? "" : `${locale}.ts has extra keys: ${extra.slice(0, 8).join(", ")}`,
      ).toEqual([]);
    });
  }
});
