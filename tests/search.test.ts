import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  createSearchQuery,
  findMatches,
  findNextMatch,
  findPreviousMatch,
  getInitialSearchText,
  getRegExpError,
  getSearchStats,
  isValidRegExp,
  replaceAllMatches,
} from "../src/editor/search";

function createState(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.anchor, selection.head ?? selection.anchor)
      : EditorSelection.single(0),
  });
}

describe("MarkNote Search logic (search.ts)", () => {
  describe("1. Поиск с учётом и без учёта регистра", () => {
    const doc = "Alpha alpha ALPHA beta";

    it("без учёта регистра находит все варианты", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "alpha", caseSensitive: false });
      expect(matches).toHaveLength(3);
      expect(matches).toEqual([
        { from: 0, to: 5 },
        { from: 6, to: 11 },
        { from: 12, to: 17 },
      ]);
    });

    it("с учётом регистра находит только точные совпадения", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "alpha", caseSensitive: true });
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ from: 6, to: 11 });

      const matchesUpper = findMatches(state, { search: "ALPHA", caseSensitive: true });
      expect(matchesUpper).toHaveLength(1);
      expect(matchesUpper[0]).toEqual({ from: 12, to: 17 });
    });
  });

  describe("2. «Слово целиком» (wholeWord)", () => {
    const doc = "cat catalog concatenate cat";

    it("без флага «слово целиком» находит подстроку внутри других слов", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "cat", wholeWord: false });
      expect(matches).toHaveLength(4);
      expect(matches.map((m) => doc.slice(m.from, m.to))).toEqual(["cat", "cat", "cat", "cat"]);
    });

    it("с флагом «слово целиком» находит только изолированные слова", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "cat", wholeWord: true });
      expect(matches).toHaveLength(2);
      expect(matches).toEqual([
        { from: 0, to: 3 },
        { from: 24, to: 27 },
      ]);
    });
  });

  describe("3. Регулярные выражения (regexp)", () => {
    const doc = "item-12 and item-456 plus item-7890";

    it("находит совпадения по шаблону регулярного выражения", () => {
      const state = createState(doc);
      const matches = findMatches(state, { search: "item-\\d+", regexp: true });
      expect(matches).toHaveLength(3);
      expect(matches.map((m) => doc.slice(m.from, m.to))).toEqual([
        "item-12",
        "item-456",
        "item-7890",
      ]);
    });

    it("поддерживает флаг регистра вместе с регулярным выражением", () => {
      const state = createState("ITEM-1 item-2");
      const sensitive = findMatches(state, {
        search: "item-\\d+",
        regexp: true,
        caseSensitive: true,
      });
      expect(sensitive).toHaveLength(1);
      expect(sensitive[0]).toEqual({ from: 7, to: 13 });

      const insensitive = findMatches(state, {
        search: "item-\\d+",
        regexp: true,
        caseSensitive: false,
      });
      expect(insensitive).toHaveLength(2);
    });
  });

  describe("4. Счётчик совпадений (getSearchStats)", () => {
    const doc = "apple banana apple orange apple";
    // apple: [0..5], [13..18], [26..31]

    it("показывает общее количество и текущее совпадение по выделению", () => {
      // Курсор в самом начале (выделен 1-й apple: [0, 5])
      const state1 = createState(doc, { anchor: 0, head: 5 });
      const stats1 = getSearchStats(state1, { search: "apple" });
      expect(stats1).toEqual({ total: 3, current: 1 });

      // Выделен 2-й apple: [13, 18]
      const state2 = createState(doc, { anchor: 13, head: 18 });
      const stats2 = getSearchStats(state2, { search: "apple" });
      expect(stats2).toEqual({ total: 3, current: 2 });

      // Курсор внутри 3-го apple (например pos 28)
      const state3 = createState(doc, { anchor: 28 });
      const stats3 = getSearchStats(state3, { search: "apple" });
      expect(stats3).toEqual({ total: 3, current: 3 });

      // Курсор на слове banana (не на apple)
      const state4 = createState(doc, { anchor: 8 });
      const stats4 = getSearchStats(state4, { search: "apple" });
      expect(stats4).toEqual({ total: 3, current: 0 });
    });

    it("возвращает 0 при отсутствии совпадений или пустом запросе", () => {
      const state = createState(doc);
      expect(getSearchStats(state, { search: "pear" })).toEqual({ total: 0, current: 0 });
      expect(getSearchStats(state, { search: "" })).toEqual({ total: 0, current: 0 });
    });
  });

  describe("5. Переход по кругу от последнего к первому (wrap-around)", () => {
    const doc = "one two one three one";
    // "one" совпадения: [0..3], [8..11], [18..21]

    it("findNextMatch циклически переходит от последнего совпадения к первому", () => {
      const query = { search: "one" };

      // Позиция 0 -> первый матч [0, 3]
      const state0 = createState(doc, { anchor: 0 });
      expect(findNextMatch(state0, query)).toEqual({ from: 0, to: 3 });

      // Выделен первый матч [0, 3] -> следующий [8, 11]
      const state1 = createState(doc, { anchor: 0, head: 3 });
      expect(findNextMatch(state1, query)).toEqual({ from: 8, to: 11 });

      // Выделен второй матч [8, 11] -> следующий [18, 21]
      const state2 = createState(doc, { anchor: 8, head: 11 });
      expect(findNextMatch(state2, query)).toEqual({ from: 18, to: 21 });

      // Выделен последний матч [18, 21] -> переход по кругу к первому [0, 3]!
      const stateLast = createState(doc, { anchor: 18, head: 21 });
      expect(findNextMatch(stateLast, query)).toEqual({ from: 0, to: 3 });
    });

    it("findPreviousMatch циклически переходит от первого совпадения к последнему", () => {
      const query = { search: "one" };

      // Выделен второй матч [8, 11] -> предыдущий [0, 3]
      const state2 = createState(doc, { anchor: 8, head: 11 });
      expect(findPreviousMatch(state2, query)).toEqual({ from: 0, to: 3 });

      // Выделен первый матч [0, 3] -> переход по кругу к последнему [18, 21]!
      const stateFirst = createState(doc, { anchor: 0, head: 3 });
      expect(findPreviousMatch(stateFirst, query)).toEqual({ from: 18, to: 21 });
    });
  });

  describe("6. «Заменить всё» на документе с пересекающимися кандидатами", () => {
    it("корректно заменяет непересекающиеся пары в 'aaaa'", () => {
      const state = createState("aaaa");
      const result = replaceAllMatches(state, { search: "aa" }, "b");
      expect(result.count).toBe(2);
      expect(result.newDoc).toBe("bb");
      expect(result.changes).toEqual([
        { from: 0, to: 2, insert: "b" },
        { from: 2, to: 4, insert: "b" },
      ]);
    });

    it("заменяет вхождении в 'banana' без повреждения смежных символов", () => {
      const state = createState("banana");
      const result = replaceAllMatches(state, { search: "ana" }, "X");
      // "ana" встречается на [1..4] и [3..6], но второй пересекается с [1..4], поэтому заменяется только 1
      expect(result.count).toBe(1);
      expect(result.newDoc).toBe("bXna");
    });

    it("поддерживает замены по регулярному выражению с группами захвата", () => {
      const state = createState("cat=1 dog=2");
      const result = replaceAllMatches(
        state,
        { search: "(\\w+)=(\\d+)", regexp: true },
        "$2:$1",
      );
      expect(result.count).toBe(2);
      expect(result.newDoc).toBe("1:cat 2:dog");
    });
  });

  describe("7. Некорректное регулярное выражение не бросает исключение наружу", () => {
    const invalidPatterns = ["(", "[", "*", "\\", "(?="];

    for (const pattern of invalidPatterns) {
      it(`безопасно обрабатывает невалидный паттерн: ${pattern}`, () => {
        expect(isValidRegExp(pattern)).toBe(false);
        expect(getRegExpError(pattern)).toBeTruthy();

        const query = createSearchQuery({ search: pattern, regexp: true });
        expect(query.valid).toBe(false);

        const state = createState("test document (with brackets) and * stars");
        expect(() => findMatches(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findMatches(state, { search: pattern, regexp: true })).toEqual([]);

        expect(() => getSearchStats(state, { search: pattern, regexp: true })).not.toThrow();
        expect(getSearchStats(state, { search: pattern, regexp: true })).toEqual({
          total: 0,
          current: 0,
        });

        expect(() => findNextMatch(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findNextMatch(state, { search: pattern, regexp: true })).toBeNull();

        expect(() => findPreviousMatch(state, { search: pattern, regexp: true })).not.toThrow();
        expect(findPreviousMatch(state, { search: pattern, regexp: true })).toBeNull();

        expect(() =>
          replaceAllMatches(state, { search: pattern, regexp: true }, "replacement"),
        ).not.toThrow();
        const rep = replaceAllMatches(state, { search: pattern, regexp: true }, "replacement");
        expect(rep.count).toBe(0);
        expect(rep.newDoc).toBe(state.doc.toString());
      });
    }
  });

  describe("8. getInitialSearchText", () => {
    it("извлекает однострочное непустое выделение", () => {
      const doc = "first line\nsecond line";
      const state = createState(doc, { anchor: 6, head: 10 }); // "line"
      expect(getInitialSearchText(state)).toBe("line");
    });

    it("игнорирует пустое выделение", () => {
      const state = createState("some text", { anchor: 2 });
      expect(getInitialSearchText(state)).toBeNull();
    });

    it("игнорирует многострочное выделение", () => {
      const doc = "first line\nsecond line";
      const state = createState(doc, { anchor: 0, head: 15 });
      expect(getInitialSearchText(state)).toBeNull();
    });
  });

  describe("9. Тест на большом файле (fixtures/big-10k.md, 1 МБ)", () => {
    const fixturePath = resolve(__dirname, "../fixtures/big-10k.md");
    const content = readFileSync(fixturePath, "utf-8");
    const state = createState(content);

    // Меряем не секунды, а рост. Прежняя проверка требовала уложиться в 200 мс
    // по стенным часам и падала, когда машина занята чем-то ещё, — она мерила
    // загрузку компьютера, а не наш код. Ложная тревога дороже пропущенной
    // медленности: на неё каждый раз тратится внимание.
    //
    // Здесь тот же поиск прогоняется на маленьком куске и на всём файле. Оба
    // замера страдают от загрузки одинаково, поэтому их отношение устойчиво.
    // Линейный поиск даёт отношение около размерного, квадратичный — кратно
    // больше, и вот это проверка и ловит.
    it("ищет за время, растущее линейно, а не квадратично", () => {
      const smallDoc = content.slice(0, Math.floor(content.length / 10));
      const smallState = createState(smallDoc);
      const query = { search: "Строка", caseSensitive: true };

      const measure = (target: EditorState): number => {
        const started = performance.now();
        getSearchStats(target, query);
        return Math.max(performance.now() - started, 0.05);
      };

      // Прогрев: первый вызов платит за компиляцию и прогрев кэшей.
      measure(smallState);
      measure(state);

      const small = Math.min(measure(smallState), measure(smallState));
      const full = Math.min(measure(state), measure(state));

      expect(getSearchStats(state, query).total).toBeGreaterThan(0);
      // Документ в десять раз больше. Запас взят щедрый: проверка должна
      // ловить смену порядка сложности, а не колебания в разы.
      expect(full / small).toBeLessThan(40);
    });
  });
});
