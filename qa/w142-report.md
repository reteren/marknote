# W142 — размер приложения и память

## Изменения

- `src/editor/livePreview/widgets/Math.ts`: `renderedMath` стал LRU-кэшем с
  лимитом 256 формул. Ранее карта жила до конца процесса без ограничения.
- `src/App.svelte`: `SettingsWindow.svelte` загружается динамически только при
  открытии настроек. `Ctrl+,` и пункт File → Settings проверены в браузере.
- `tests/wiring/wiring.test.ts` учитывает динамические Svelte-импорты как рёбра
  графа монтирования; `closeProtocol.test.ts` дожидается lazy-import.

## Измерения

Все замеры браузера воспроизводятся командой `node qa/measure-memory.mjs` при
запущенных Vite/Edge из `qa/browser/README.md`; результаты лежат в
`w142-memory-before.json` и `w142-memory-after.json`. Heap измеряется через
CDP после `HeapProfiler.collectGarbage`, поэтому для сравнения использован
именно browser heap, а не изменчивый working set процессов.

| Что измерялось | Инструмент | До | После | Доказательство |
|---|---|---:|---:|---|
| Основной JS-чанк | `node qa/measure-build.mjs` | 558352 B | 538570 B | `w142-build-report-before.json`, `w142-build-report-after.json` |
| Изолированный эффект lazy SettingsWindow | тот же Rollup-отчёт | 558465 B | 538570 B | `w142-build-report-before-settings.json`, `w142-build-report-after-settings.json` |
| Стартовый browser heap | CDP | 9.96 MB | 9.88 MB | `w142-memory-*.json` |
| Документ 1 MiB | CDP | 37.44 MB | 30.69 MB | `w142-memory-*.json` |
| 10 вкладок | CDP | 38.18 MB | 31.42 MB | `w142-memory-*.json` |
| После закрытия 9 вкладок | CDP | 37.87 MB | 31.11 MB | `w142-memory-*.json` |
| 500 правок / 500 уникальных формул | CDP | 37.81 MB | 31.05 MB | `w142-memory-*.json` |
| 200 циклов открыть/закрыть вкладку | CDP | 39.22 MB | 32.45 MB | `w142-memory-*.json` |

До/после для heap — это один и тот же сценарий из скрипта. Снижение примерно
на 6.76 MiB после документа и после 200 циклов подтверждает эффект ограничения
кэша формул; динамическая загрузка настроек дополнительно уменьшает стартовый
чанк, но в сценарии памяти настройки не открываются.

В финальном основном чанке десять самых тяжёлых модулей:

| Модуль | Размер |
|---|---:|
| `@lezer/javascript` | 81155 B |
| `@lezer/markdown` | 59346 B |
| `@codemirror/commands` | 46356 B |
| `src/App.svelte` | 40122 B |
| `src/editor/livePreview/tables.ts` | 38185 B |
| `@codemirror/language-data` | 31614 B |
| `src/state/actions.ts` | 30254 B |
| `@codemirror/search` | 27755 B |
| `src/editor/keymap.ts` | 23298 B |
| `@codemirror/lang-html` | 22334 B |

`SettingsWindow` теперь отдельный чанк 20631 B JS и 6.90 KB CSS. KaTeX остаётся
отдельным чанком 260.83 KB. Rollup предупреждает, что часть language-data
динамических импортов не может быть вынесена: языки также статически попадают
через `createEditor.ts` и другие адаптеры; эти файлы были вне границ задачи,
поэтому рискованное изменение не делал.

## Нативные процессы

`measure-memory.mjs` записывает все совпадающие процессы `marknote.exe` и
`msedgewebview2` и никого не останавливает. Надёжный нативный A/B-замер не
принят: до/во время проверки уже были чужие процессы WebView2, а на финальном
цикле появился `marknote.exe`; например, на старте было 29 WebView2 (~717 MiB
working set), а на 200-м цикле — 1 MarkNote (~26.8 MiB) и 37 WebView2 (~1.15
GiB). Смешивание этих процессов делает вывод о росте нативной памяти
недостоверным, поэтому процесс владельца не закрывался; для чистого прогона
нужно повторить тот же скрипт после остановки только сторонних экземпляров.

## Проверки

- `npx tsc --noEmit` — чисто.
- `npx vitest run --poolOptions.threads.maxThreads=3` — 50 файлов, 429 тестов,
  все прошли.
- `npm run build` — успешно; предупреждения Rollup только о неэффективных
  динамических language-data импортах и размере основного чанка.
- Живая браузерная проверка Ctrl+, открыла Settings после lazy-import; снимок:
  `qa/shots/w142-settings.png`.

## Проверил, но сознательно не менял

- `tabEditorStates` уже удаляет состояние при закрытии вкладки; лишняя правка
  не дала бы измеримого основания.
- `imageResolver` очищает документный кэш при смене пути, а удалённые data URL
  не складываются в дополнительный глобальный кэш.
- Подписки App/MenuBar/FindPanel/ContextMenu имеют cleanup-функции; изменение
  без воспроизводимого leak-сигнала было бы лишним.
- KaTeX и языки уже разбиты на чанки; KaTeX не дублировал основной чанк.

