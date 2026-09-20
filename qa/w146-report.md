# W146 — сквозная проверка release 1.0.17

Проверялся `src-tauri/target/release/marknote.exe` (ProductVersion 1.0.17) с
отдельным `MARKNOTE_CONFIG_DIR` в `%TEMP%`. Перед каждым запуском release exe
вызывался `qa/Assert-NoForeignMarkNote.ps1`; чужого установленного процесса не
обнаружено. Все запущенные мной окна закрыты через `CloseMainWindow`, без
`Kill`.

## Результаты

| Что мерил/проверял | Чем | До/сценарий | После/результат | Доказательство |
|---|---|---|---|---|
| Acceptance smoke | `pwsh -File qa/acceptance.ps1 -Runs 1` | 9 штатных тестов | 9/9 passed: окно, Markdown, cp1251 TXT, несуществующий путь, single-instance, два окна, большой файл, binary notice, Ctrl+F | `qa/acceptance-summary.json`, `qa/shots/w146-acceptance/run_001_*.png` |
| Большой файл | CDP, `qa/w146-fixtures.mjs` | `large-5mb.md` — 5 242 880 байт | `large-5mb.md — MarkNote`; статус показывает 5 242 880 chars, 5 028 lines, 15 084 words | `qa/shots/w146/w146-large-5mb-cdp.png` |
| `.md`, `.txt`, `.py`, `.json` | release launch + CDP | открытие каждого файла | Заголовки/форматы корректны; Python и JSON подсветились, в Python видны номера строк | `w146-showcase-fresh.png`, `w146-py-before.png`, `w146-json-before.png`, acceptance `run_001_02/03` |
| Двоичный файл | acceptance | `logo.png` | Понятное binary notice, пустого редактора нет | `qa/shots/w146-acceptance/run_001_08_binary_rejected.png` |
| Preview: headings, lists, tasks, quote, callouts, table | CDP scroll + class/visual snapshot | showcase.md | Узлы `cm-marknote-heading`, bullet/ordered/checkbox, blockquote, note/warning/tip callouts и table реально присутствуют | `qa/shots/w146/w146-showcase-middle.png` |
| Preview: code, `$$`, hr, footnotes, image | CDP scroll + class/visual snapshot | showcase.md | `cm-marknote-code-block`, `cm-marknote-math cm-marknote-math-display` + KaTeX, `cm-marknote-hr`, footnotes и image присутствуют | `qa/shots/w146/w146-showcase-bottom-final.png` |
| Контекстное меню Markdown | CDP right-click + hover Formatting | до: только обычное меню; после hover | `Formatting ›` раскрывает Bold/Italic/Strikethrough/Highlight/Code/Link/Clear Formatting | `qa/shots/w146/w146-context-md.png`, `qa/shots/w146-context-md-format.png` |
| Контекстное меню Python | CDP right-click | до: Python | После меню содержит только Cut/Copy/Paste/Delete/Select All, Markdown-команд нет | `qa/shots/w146/w146-py-context.png` |
| Контекстное меню JSON | CDP right-click + hover Insert | до: JSON | После `Insert ›` содержит `Validate JSON` и `Format JSON`; Markdown-раздела нет | `qa/shots/w146/w146-json-context-insert.png` |
| Ctrl+B Markdown | CDP `Input.dispatchKeyEvent` на простой Markdown | `drag.md`, 59 chars | После выделения и Ctrl+B появились `**...**`, статус Unsaved; затем окно закрыто без сохранения | `qa/shots/w146/w146-drag-bold-after.png` |
| Ctrl+B Python | CDP `Input.dispatchKeyEvent` | `sample.py`, 66 editor chars | После Ctrl+B textLength остался 66, статус Saved, разметка не добавилась | `qa/shots/w146/w146-py-after-ctrl-b.png` |
| Вкладки и unsaved close | CDP `+`, click tabs, insertText, close | одна JSON-вкладка | Новая вкладка, переключение обратно, Unsaved и диалог Save/Discard/Cancel, Discard вернул исходную вкладку | `w146-tabs-new.png`, `w146-tabs-switched-json.png`, `w146-tabs-unsaved.png`, `w146-tabs-close-unsaved-dialog.png`, `w146-tabs-discarded.png` |
| Настройки редактора | CDP Settings → Editor | font `system-sans`, zoom 110%, line numbers off | Выбран `monospace`; checkbox line numbers переключён off→on; окно настроек открывается | `w146-settings-editor.png`, `w146-settings-font-after.png`, `w146-settings-line-numbers-toggled.png` |
| Масштаб Ctrl+`+` | CDP computed style before/after | `.cm-content`: 16px | после `Ctrl+Shift+=`: 17.6px | `w146-zoom-after-ctrl-plus.png` |
| Живой preview | CDP Settings → Preview | Live preview checked | переключён checked→unchecked, затем обратно checked; Render formulas/images остались checked | `w146-settings-preview.png`, `w146-settings-preview-off.png` |
| Поиск/замена/переход | CDP shortcuts | закрытый editor | Ctrl+F открыл find panel, Ctrl+H раскрыл Replace/Replace All, Ctrl+G открыл Go to line | `w146-find-panel.png`, `w146-replace-panel.png`, `w146-goto-fresh-python.png` |
| Build tests | Vitest/TypeScript | до прогона | `51 files, 433 tests passed`; `npx tsc --noEmit` exit 0 | консольный вывод прогона |

## Найденная поломка

Ctrl+A → Ctrl+B на полном `fixtures/showcase.md` (с таблицей, блоками кода,
формулой и hr) не ограничился оборачиванием текста: в начало документа была
вставлена длинная горизонтальная линия `────────────────…`, а редактор
пометил документ сохранённым и записал изменение в fixture. Снимок:
`qa/shots/w146/w146-markdown-bold-after-key-correct.png`; это P2 (команда
форматирования портит документ при выделении всего много-блочного Markdown и
может менять файл на диске). Fixture восстановлен до исходного состояния после
проверки; исходный код не менялся.

## Что осталось вне доказанной проверки

| Область | Причина | Статус |
|---|---|---|
| Фактический drag-and-drop файла Windows | CDP `Input.dispatchMouseEvent` не создаёт host-level Tauri file-drop payload | Не доказано; отдельный acceptance TC-06 проверил открытие второго файла и два окна, но это не заменяет drop |
| Save As и перезапись существующего файла | системный file picker находится вне WebView CDP; не трогал штатный диалог владельца | Не доказано живым UI; кнопки Save/Save As видны и существующее Save состояние проверено |
| Недавние файлы | в `qa/acceptance.ps1` нет сценария recent-files, а добавление через системный picker потребовало бы ручного OS UI | Не доказано |

Первый запуск acceptance через Windows PowerShell 5.1 завершился ошибкой
разбора UTF-8/кавычек в самом `qa/acceptance.ps1` (строки около 777), до
запуска MarkNote; повторный запуск тем же сценарием через PowerShell 7 прошёл
9/9. Это дефект harness, не release-программы.
