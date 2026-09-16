// Проверка полноты словарей.
//
// Тип Dictionary объявлен как Readonly<Record<string, TranslationEntry>>, то
// есть обычный словарь без перечня обязательных ключей. Проверка типов
// проходит при любом числе пропусков, и опереться на неё нельзя: ровно так
// три словаря уехали без ста шестнадцати подписей, а автор был уверен, что
// закончил.
//
// Механизм переводов при отсутствии ключа показывает сам ключ. Это честно и
// видно сразу — но только тому, кто откроет программу на этом языке. Тест
// делает пропуск видимым всем и сразу.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { supportedLocales } from "../src/i18n/types";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

/** Ключи верхнего уровня словаря, прочитанные из исходника файла.
 *  Читаем текстом, а не импортом: словари грузятся динамически, а тесту нужен
 *  полный список без загрузки всех десяти в память. */
function keysOf(locale: string): Set<string> {
  const source = readFileSync(join(localesDir, `${locale}.ts`), "utf8");
  return new Set([...source.matchAll(/^\s{2}"([a-zA-Z0-9._]+)"\s*:/gm)].map((m) => m[1]));
}

describe("полнота словарей", () => {
  const reference = keysOf("en");

  it("английский словарь непустой и служит эталоном", () => {
    expect(reference.size).toBeGreaterThan(200);
  });

  for (const locale of supportedLocales.filter((code) => code !== "en")) {
    it(`${locale}: нет пропущенных ключей`, () => {
      const missing = [...reference].filter((key) => !keysOf(locale).has(key)).sort();
      expect(
        missing,
        missing.length === 0
          ? ""
          : `в ${locale}.ts не хватает ${missing.length} ключей, первые: ${missing.slice(0, 8).join(", ")}`,
      ).toEqual([]);
    });

    it(`${locale}: нет лишних ключей`, () => {
      // Лишний ключ означает, что строку убрали из интерфейса, а из словаря
      // забыли: мёртвый перевод, который будут поддерживать без нужды.
      const extra = [...keysOf(locale)].filter((key) => !reference.has(key)).sort();
      expect(
        extra,
        extra.length === 0 ? "" : `в ${locale}.ts лишние ключи: ${extra.slice(0, 8).join(", ")}`,
      ).toEqual([]);
    });
  }
});
