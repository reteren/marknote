# W144: ввод в очень больших документах

## Методика

Профиль снят живым Vite + Edge через CDP скриптом
[`qa/w144-profile.mjs`](w144-profile.mjs). Скрипт открывает реальный редактор,
загружает Markdown-файл ровно 5 MiB, вставляет символ через
`Input.insertText`, а затем ждёт два `requestAnimationFrame`. В каждом варианте
было три перезагрузки с прогревом 1 s; в таблице указана медиана трёх запусков.
Внутренние интервалы измеряются `performance.now()` вокруг реального
`EditorView.dispatch` и подозреваемых расширений. `W144_CPU=1` дополнительно
сохраняет CDP `Profiler` sampling profile.

## Разложение ввода 5 MiB

Все значения в миллисекундах; это один и тот же CDP-замер до и после правки.
`cdp dispatch` — возврат `Input.insertText`, `2 RAF` — завершение двух кадров,
а `post-dispatch frame` — разница между ними и не является чистым временем
paint: она также включает планирование браузерного кадра.

| Участок | До | После | Доказательство |
| --- | ---: | ---: | --- |
| `EditorView.dispatch` / применение транзакции | 87.7 | 7.2 | `qa/w144-profile-before-all-clean.json`, `qa/w144-profile-after-all-clean.json` |
| CDP `Input.insertText` до возврата | 99.8 | 15.3 | те же JSON |
| до двух `requestAnimationFrame` | 114.4 | 30.8 | те же JSON |
| post-dispatch до двух кадров (прокси DOM/frame) | 14.6 | 15.5 | те же JSON |
| пересборка live preview | 13.9 | 0 | фаза `preview.rebuild` в тех же JSON |
| фильтр перенумерации списков | 0.0 | 0.1 | фаза `lists.filter` в тех же JSON |
| пометка кода/формул spellcheck | 0.8 | 0.5 | фаза `spellcheck.decorate` в тех же JSON |
| получение уже разобранного дерева в preview/spellcheck | 0.0 | 0.0 | фазы `preview.parse` и `spellcheck.parse` |

Фазы вложены в `EditorView.dispatch`, поэтому их нельзя складывать с
`transaction.apply`. Разбор `@lezer/markdown` происходит внутри обновления
языкового состояния CodeMirror до вызова наших `syntaxTree`-функций и потому не
виден как отдельная фаза `preview.parse`. CPU-профиль
`qa/w144-cpu-normal.json` зафиксировал для 5 MiB до правки 36.0 ms в
`getEditorStats` и около 10.1 ms в `TextEncoder.encode`; там же видны
инкрементальный `reuseFragment` Lezer и обычные parser frames. Для независимой
оценки parser-части 5 MiB plain-text контроль дал 37.8 ms транзакции против
46.2 ms Markdown без preview, то есть разница около 8.4 ms — это оценка
Markdown/Lezer и связанных Markdown-расширений, а не сумма sampling frames.

## Проверка гипотез и варианты

| Вариант | 5 MiB transaction | 5 MiB CDP dispatch | Что доказано |
| --- | ---: | ---: | --- |
| До всех W144 правок, preview отключается порогом | 87.7 | 99.8 | `w144-profile-before-all-clean.json`; полный scan размера, статистики и update overhead оставались |
| После только нижней оценки размера preview, до stats/blockMath | 59.7 | 72.9 | `w144-profile-before-stats-after-limits.json`; preview уже 0 ms |
| После incremental stats, до blockMath shortcut | 23.2 | 34.6 | `w144-profile-before-block-math-stats.json` |
| После всех правок | 7.7 | 16.8 | `w144-profile-after-block-math-stats.json` |
| Окончательный чистый before/after | 87.7 → 7.2 | 99.8 → 15.3 | `w144-profile-before-all-clean.json`, `w144-profile-after-all-clean.json` |

Отдельный контроль `w144-profile-no-preview.json` показал верхнюю границу
выигрыша от полного отключения preview: около 46.2 ms transaction на 5 MiB.
`w144-profile-high-limit.json` при пороге 20 MiB заставил preview работать и
дал 66.6 ms transaction и 11.3 ms `preview.rebuild`; значит настройка
`disableAboveBytes` действительно отключает preview, а прежний расход в
обычном режиме был в основном не построением видимых decorations, а
проверкой размера документа.

## Что изменено

1. `src/editor/livePreview/plugin.ts` и `blockMath.ts` сначала сравнивают
   UTF-16 длину `Text` с лимитом. UTF-8 для этого текста не может быть короче,
   поэтому документ, уже превышающий лимит, больше не flatten-ится в строку и
   не кодируется `TextEncoder` перед отключением preview/formula. Для документов
   ниже лимита сохранён прежний точный UTF-8 расчёт и поведение порога.
2. `src/editor/createEditor.ts` кеширует статистику слов по неизменяемому
   CodeMirror `Text` и после изменения пересчитывает только расширенные на один
   символ изменённые диапазоны. Символы берутся из `doc.length`; подсчёт слов в
   выделении по-прежнему учитывает целые слова и границы whitespace.
3. `qa/w144-profile.mjs` оставлен воспроизводимым профилем CDP; добавлены
   `tests/editorStats.performance.test.ts` и регрессионные проверки shortcut в
   `tests/livePreview.performance.test.ts` и `tests/blockMath.test.ts`.

## Проверки

- `npx vitest run --poolOptions.threads.maxThreads=3` — 51 файл, 433 теста
  прошли.
- `npx tsc --noEmit` — прошёл.
- Rust не менялся, поэтому `cargo test` не запускался.
- Живой браузерный замер выполнен через CDP; нативное окно для W144 не
  требовалось и не запускалось.

## Проверено, но не изменено ради скорости

- `src/editor/keymap.ts`: измеренный фильтр списков занимает около 0.1 ms.
  Он уже работает по изменённому list-блоку, а переход к другой семантике
  нормализации мог бы менять поведение Enter/Tab и indent/outdent.
- `src/editor/spellcheck.ts`: обход дерева происходит на `docChanged` или
  смене дерева, а не на каждом движении курсора/viewport; measured cost менее
  1.3 ms. Инкрементальная разметка границ code/formula/link требует отдельной
  доказательной модели, поэтому её не вводил.
- Lezer parser и разбор за экраном: parser нужен для целостного
  инкрементального дерева; контроль plain-format дал около 8.4 ms разницы, но
  безопасного ограничения разбора viewport без изменения Markdown-семантики
  нет.
- Пересборка preview при `selectionSet`/`viewportChanged` и обработчики таблиц:
  они нужны для `revealMarkup`, видимых decorations и drag-подсветки; в путь
  ввода 5 MiB дополнительный существенный расход не попали.
- DOM: точного отдельного paint timestamp CDP не предоставляет в этом сценарии,
  поэтому зафиксирован честный proxy `post-dispatch frame`, а изменение DOM
  ради неподтверждённой гипотезы не делалось.
