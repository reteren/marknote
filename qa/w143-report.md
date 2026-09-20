# W143 — отвязывать ли HTML-разбор от Markdown

## Решение

Рекомендация: **менять в production**, но только вместе с заменой
`insertNewlineContinueMarkup`, а не оставляя импорт `@codemirror/lang-markdown`
в `keymap.ts`. Эксперимент пересёк установленный порог по размеру: основной
JS-чанк уменьшился на 148142 B (>100 KB), а обычный Markdown, таблицы, fenced
code и формулы сохранились. Цена — ожидаемая и зафиксированная на снимках:
HTML внутри Markdown больше не получает подсветку тегов/атрибутов и не имеет
HTML completion.

Production-код не менялся. Вариант для измерения находится в
`qa/w143-nohtml-markdown.ts`; он строит CodeMirror LanguageSupport напрямую из
`@lezer/markdown` и `@codemirror/language`, передаёт `marknoteMarkdown`, но не
передаёт `htmlParser` в `parseCode`. Для `keymap.ts` в эксперименте добавлена
компактная замена Enter-команды; проверка через настоящий CDP-ввод дала
одинаковое продолжение `1. first` → `2. second` в baseline и эксперименте.

## Парные измерения

Инструменты запускаются воспроизводимо из корня репозитория. Baseline использует
текущую production-сборку MarkNote (чанк из `qa/w143-baseline-build-report.json`),
эксперимент — `node qa/w143-build-experiment.mjs` и
`qa/w143-vite.config.ts`.

| Метрика | Baseline | Direct Lezer, без HTML | Разница | Доказательство |
|---|---:|---:|---:|---|
| Основной JS-чaнк | 538570 B | 390428 B | −148142 B (−27.5%) | `w143-baseline-build-report.json`, `w143-nohtml-build-report.json` |
| Первая отрисовка, документ 200 KB, медиана 3 прогонов | 111.070 ms | 107.406 ms | −3.664 ms | `w143-baseline.json`, `w143-nohtml-benchmark.json` |
| Первая отрисовка, документ 1 MB, медиана 3 прогонов | 151.954 ms | 162.825 ms | +10.871 ms | те же benchmark JSON |
| Startup browser heap после GC | 11212056 B | 10096788 B | −1115268 B (~1.06 MiB) | `w143-startup-heap-baseline.json`, `w143-startup-heap-nohtml.json` |

Все прогоны benchmark используют `qa/w140-benchmark.mjs`, одинаковые 3 запуска
и CDP Input; у baseline и experiment разные Vite/CDP порты только для
изоляции процессов (1420/9555 и 1423/9557).

## Что осталось от основного чанка

В экспериментальном основном чанке исчезли `@lezer/javascript` (81155 B),
`@codemirror/lang-html` (22334 B) и связанная HTML/CSS ветка. Крупнейшие модули
экспериментального чанка: `@lezer/markdown` 59246 B, `@codemirror/commands`
46356 B, `src/App.svelte` 40122 B, `src/editor/livePreview/tables.ts` 38185 B,
`@codemirror/language-data` 31619 B, `src/state/actions.ts` 30254 B и
`@codemirror/search` 27755 B.

## Проверка потерь

Один и тот же fixture проверен настоящим вводом через CDP:

```html
<div><span style="color:red">text</span></div>

<script>
const value = 42;
console.log(value);
</script>
```

| Наблюдение | Baseline | Без HTML |
|---|---:|---:|
| Токенизированные span в HTML fixture | 37 | 0 |
| HTML token-классы | 6 видов | 0 |
| Снимок | `qa/shots/w143-html-baseline.png` | `qa/shots/w143-html-nohtml.png` |

В baseline тег/атрибуты/строки и JavaScript визуально окрашены; в эксперименте
текст тот же, но весь fixture обычного цвета. Это сознательная потеря,
не дефект измерительного harness.

Обычный Markdown не пострадал — оба CDP-прогона дали одинаковые значения:

| Проверка | Baseline | Без HTML |
|---|---:|---:|
| Заголовок | 1 | 1 |
| Маркер списка виден | да | да |
| Ячейки таблицы | 4 | 4 |
| Fenced-code блок | 1 | 1 |
| Токены fenced-code | 5 | 5 |
| KaTeX widget | 1 | 1 |
| Enter после `1. first` | `1. first` → `2. second` | то же |

Доказательства: `w143-integrity-baseline.json`, `w143-integrity-nohtml.json`,
`w143-enter-baseline.json`, `w143-enter-nohtml.json` и
`w143-html-baseline.json`/`w143-html-nohtml.json`.

## Проверки репозитория

- `npx tsc --noEmit` — чисто.
- `npx vitest run --poolOptions.threads.maxThreads=3` — 50 файлов, 429 тестов,
  все зелёные.
- Production-код и `src-tauri/**` не изменялись, установщик не собирался.

