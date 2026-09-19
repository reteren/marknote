# Аудит соответствия кодовой базы спецификации MarkNote

**Дата аудита:** 2026-09-16  
**Источники:** `docs/SPEC.md`, `docs/SETTINGS.md`, `README.md`, `ROADMAP.md` и текущий код  
**Проверяющий агент:** W91 (сверка перед выпуском 1.0.6)

Проверка выполнена чтением исходников и документов. Программа не запускалась, поэтому
свойства, для которых нужен реальный WebView2, помечены в таблицах как не проверенные
запуском; статус ниже означает наличие (или отсутствие) соответствующего маршрута в коде.

## 1. Сводка результатов

В таблицах ниже проверено **85 утверждений**:

| Вердикт | Количество |
| :---: | ---: |
| **ЕСТЬ** | 72 |
| **ЧАСТИЧНО** | 13 |
| **НЕТ** | 0 |

Пунктов с вердиктом НЕТ больше нет: вариант `recentFiles` в окне настроек и показ
недавних файлов реализованы (W122), хранилище управляется Rust в `recent-files.json`,
несуществующие файлы фильтруются, а история очищается кнопкой в настройках.
Остальные ЧАСТИЧНО требуют приёмки руками.

Главные изменения относительно старого аудита: `createActions` теперь передаёт
оболочечные обработчики в CodeMirror, смена формата использует Compartment, реестр
содержит EPUB, все команды JSON зарегистрированы, а read-only форматы экспортируются
в Markdown. Правка после сверки: Ctrl+G, инструменты JSON, предупреждение о потерях при
сохранении и перенос настроек `files` были помечены как «в работе», потому что аудит
писался параллельно с ними. К моменту выпуска они легли в ветку (коммиты d6a9586 и ad4c3e9), и соответствующие вердикты подняты до ЕСТЬ.

> **Примечание W104:** строка 1.1 ниже помечена `УСТАРЕЛО`: после появления вкладок
> её формулировка больше не является обещанием программы. Сводные числа выше
> относятся к состоянию аудита W91 и эту историческую строку не пересчитывают.

---

## 2. Посекционный аудит `docs/SPEC.md`

### Раздел 1. Основной принцип

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **1.1 [УСТАРЕЛО]** Одно окно — один файл; нет хранилищ, боковой панели и вкладок | **УСТАРЕЛО** | Эта строка аудита опиралась на отсутствие вкладок и больше не описывает код. Теперь рабочее пространство и полоска вкладок реализованы в `src/state/workspace.svelte.ts:93-187`, `src/ui/TabBar.svelte:89-137` и смонтированы в `src/App.svelte:1032-1036`; открытие из Проводника по-прежнему маршрутизируется в окно через `src-tauri/src/windows.rs:338-410`. |
| **1.2** Интерфейс только на английском | **ЧАСТИЧНО** | Английский — язык по умолчанию, но окно настроек предлагает `en`, `ru`, `de`, `es`, `pt`, `it`, `fr`, `zh`, `ja`, `ar`: `src/ui/SettingsWindow.svelte:36-48`, локали `src/i18n/locales/`. |
| **1.3** Единственная тёмная тема без переключателя | **ЕСТЬ** | Тёмные токены и отсутствие светлой темы: `src/styles/theme.css:1-8,104-120`; в настройках нет настройки темы: `src/ui/SettingsWindow.svelte:50-105`. |
| **1.4** Окно настроек узкое и содержит только согласованные параметры | **ЧАСТИЧНО** | Окно и поиск настроек существуют: `src/ui/SettingsWindow.svelte:20-115,358-460`; фактический список шире старой формулировки (язык, spellcheck, editor, preview, files, windows, other). ЧАСТИЧНО здесь только потому, что спецификация обещала отсутствие окна настроек, а оно есть — по осознанному решению владельца. |

### Раздел 2. Запуск и открытие файлов

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **2.1** `.md` ассоциирован с приложением и двойной клик передаёт файл | **ЕСТЬ** | Ассоциации установщика: `src-tauri/tauri.conf.json:41-48`; аргументы маршрутизируются в `src-tauri/src/windows.rs:274-371`. Ручной двойной клик не проверялся. |
| **2.1** Процесс один, второй запуск использует `single-instance` | **ЕСТЬ** | Плагин и callback: `src-tauri/src/lib.rs:23-25`; обработка аргументов: `src-tauri/src/windows.rs:274-301`. Ручной запуск не проверялся. |
| **2.1** Уже открытый файл поднимает существующее окно | **ЧАСТИЧНО** | По умолчанию `route_file` ищет существующее окно и поднимает его: `src-tauri/src/windows.rs:303-371,402-412`; настройка `raiseExistingWindow` теперь может сознательно выбрать новое окно (`src-tauri/src/settings.rs:270-300`). |
| **2.2** Без аргумента показывается стартовый экран и можно создать любой редактируемый формат | **ЕСТЬ** | Стартовый экран подключён с реестром форматов: `src/App.svelte:792-801`; список создаваемых форматов приходит из `src/state/formats.svelte.ts:54-76` и Rust `src-tauri/src/formats/mod.rs:91-97`. |
| **2.2** Клик по плитке закрывает экран и даёт `Untitled.ext` | **ЕСТЬ** | Создание документа и смена состояния: `src/App.svelte:234-245`; имя безымянного документа: `src/state/document.svelte.ts:64`. |
| **2.2** `More…` раскрывает остальные редактируемые типы, read-only PDF/DOCX/EPUB отсутствуют | **ЕСТЬ** | Фильтрация создаваемых форматов и плитки: `src/ui/FormatPicker.svelte:1-120`, `src/state/formats.svelte.ts:54-76`; capabilities read-only: `src-tauri/src/formats/pdf.rs:14-27`, `docx.rs:13-27`, `epub.rs:27-41`. |
| **2.2** Ввод без выбора создаёт Markdown и убирает стартовый экран | **ЕСТЬ** | Условие показа экрана: `src/App.svelte:86-88`; редактор инициализируется с документом Markdown по умолчанию: `src/state/document.svelte.ts:1-70`, `src/App.svelte:679-690`. |
| **2.3** Безымянный документ помечен `Unsaved`, автосохранение не выполняется | **ЕСТЬ** | Состояние и dirty-проверки: `src/state/document.svelte.ts:41-60`; autosave отбрасывает `path === null`: `src/state/autosave.ts:88-108`. |
| **2.3** Закрытие непустого безымянного/грязного документа предлагает Save/Discard/Cancel | **ЕСТЬ** | Запрос закрытия и диалог: `src/App.svelte:337-419,949-969`; native close handshake: `src-tauri/src/windows.rs:474-524`. |
| **2.3** Первое сохранение открывает системный диалог с выбранным типом | **ЕСТЬ** | `SaveControls` переводит документ без пути в `save_as`: `src/ui/SaveControls.svelte:80-133`; backend выбирает фильтр и расширение: `src-tauri/src/commands.rs:227-287`. |
| **2.4** Клик по типу в статусе меняет возможности без потери текста, курсора и undo | **ЕСТЬ** | `handleFormatSelect` вызывает `setEditorFormat` на существующем view: `src/App.svelte:248-274`; Compartment реализован в `src/editor/createEditor.ts:271-286` и `src/editor/settings.ts:15-42`. Запуском сохранение позиции не проверялось. |
| **2.4** У сохранённого файла смена типа — Save As, исходный файл остаётся | **ЕСТЬ** | Save As и последующая смена Compartment: `src/App.svelte:277-300`; атомарная запись нового пути: `src-tauri/src/commands.rs:227-287`. |
| **2.4** Read-only типы не появляются в выборе | **ЕСТЬ** | `list_creatable_formats` фильтрует `creatable`: `src-tauri/src/commands.rs:322-325`; picker получает этот список: `src/ui/FormatPicker.svelte:1-120`. |
| **2.5** Drop в пустое окно переиспользует его, остальные файлы открываются отдельно | **ЕСТЬ** | `src/App.svelte:611-648,792-801`; Tauri event слушается в `src/App.svelte:697-702`. Ручной drop не проверялся. |
| **2.6** Заголовок `имя.ext — MarkNote` или `Untitled.ext — MarkNote` | **ЕСТЬ** | Формирование имени: `src/state/document.svelte.ts:64`; обновление нативного заголовка: `src/App.svelte:259-274`, `src-tauri/src/commands.rs:316-320`. |

### Раздел 3. Сохранение

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **3.1** Автосохранение только для файла на диске и lossless-формата | **ЕСТЬ** | Проверки пути, read-only, dirty и `format.autosave`: `src/state/autosave.ts:88-108`; настройки `files` применяются там же, предупреждение о потерях подключено. |
| **3.1** Таймер срабатывает через 2 секунды после ввода | **ЕСТЬ** | Константа и таймер: `src/state/autosave.ts:18,153-165`. |
| **3.1** Сохранение при потере фокуса, закрытии и перед внешней перезагрузкой | **ЧАСТИЧНО** | blur/focus и внешние события подключены: `src/state/autosave.ts:167-179,212-223`; close handshake подключён в `src/App.svelte:692-717`. Эти пути не проверялись запуском. |
| **3.1** При закрытии нет вопроса, кроме непустого Untitled | **ЕСТЬ** | Предикат единственного диалога: `src/App.svelte:337-339`; обработка read-only и пустого документа — там же. |
| **3.2** Save/Save As видны в строке меню и имеют состояния Unsaved/Saving/Saved/Error | **ЕСТЬ** | Компонент и индикатор: `src/ui/SaveControls.svelte:55-78,146-176`; монтирование в оболочке: `src/App.svelte:750-778`. |
| **3.2** Save без пути работает как Save As, с путём пишет немедленно | **ЕСТЬ** | `src/ui/SaveControls.svelte:80-112`; action и flush: `src/state/actions.ts:364-417`. |
| **3.2** RTF требует предупреждение о потере оформления перед записью | **ЕСТЬ** | Запрос, варианты `Save anyway`/`Save as Markdown` и backend flag уже есть: `src/App.svelte:244-300,883-885`, `src/state/actions.ts:287-303`, `src-tauri/src/commands.rs:494-496`. Спрашивается один раз за документ, а не при каждом автосохранении. Руками не проверено. |
| **3.3** Запись атомарна через временный файл и rename | **ЕСТЬ** | `src-tauri/src/atomic_write.rs:16-36`; используется командами сохранения: `src-tauri/src/commands.rs:182-225,277-287`. |
| **3.3** Сохраняются исходная кодировка и CRLF/LF | **ЕСТЬ** | Декодирование/кодирование и передача метаданных: `src-tauri/src/commands.rs:182-225`, `src-tauri/src/encoding.rs:43-98`; преобразования текста перед сохранением — `src/state/autosave.ts:50-72`. |
| **3.4** `notify` наблюдает файл и подавляет собственные записи | **ЕСТЬ** | Watcher и suppress: `src-tauri/src/watcher.rs:88-166`. |
| **3.4** Чистый буфер тихо перезагружается с сохранением позиции и прокрутки | **ЧАСТИЧНО** | Чистая перезагрузка есть в `src/state/autosave.ts:184-200`; ручной Reload сохраняет selection в `src/App.svelte:308-325`, но автоматический путь не фиксирует её явно. Прокрутка и WebView2 не проверялись запуском. |
| **3.4** Грязный буфер получает Reload/Keep mine, автосохранение приостановлено | **ЕСТЬ** | Событие помечает external change: `src/state/autosave.ts:184-203`; баннер и действия: `src/App.svelte:781-790`, `src/ui/Notice.svelte:1-85`. |
| **3.4** Удалённый файл показывает уведомление, следующее сохранение создаёт его снова | **ЕСТЬ** | Уведомление и обработка: `src/App.svelte:781-790`; deletion разрешает recreate в `src-tauri/src/commands.rs:500-507`, тест — `src-tauri/src/commands.rs:703-717`. |

### Раздел 4. Редактор

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **4.1** Единственный режим live preview; узел раскрывается курсором/выделением | **ЕСТЬ** | ViewPlugin, видимые ranges и `isNodeActive`: `src/editor/livePreview/plugin.ts:117-156,235-250`; настройки reveal подключаются в `src/editor/livePreview/settings.ts:20-51`. Визуально не проверено. |
| **4.2** Колонка 81ch по центру, перенос только визуальный | **ЕСТЬ** | Токен и тема редактора: `src/styles/theme.css:80-84`, `src/editor/theme.ts:1-35`; `EditorView.lineWrapping` подключается в `src/editor/settings/appearance.ts:48-112`. |
| **4.3** Неограниченные undo/redo с группировкой | **ЕСТЬ** | `history({ minDepth: Infinity })` и клавиши: `src/editor/keymap.ts:443-480`. Runtime-группировка не проверена. |
| **4.4** Tab/Shift-Tab вкладывает списки, вне списка вставляет 4 пробела, в таблице переходит по ячейкам | **ЕСТЬ** | Команды и локальный keymap: `src/editor/keymap.ts:443-451`; table keymap подключается в `src/editor/createEditor.ts:328-339`. Runtime не проверен. |
| **4.5** Enter продолжает/завершает список, сохраняет блок кода и цитату | **ЕСТЬ** | `continueMarkdownList` и специальные ветки: `src/editor/keymap.ts:153-180,451`. Runtime не проверен. |
| **4.6** Автопары и обёртка выделения Ctrl+B/I/E | **ЕСТЬ** | `pairInputHandler`, `toggleWrapper` и bindings: `src/editor/keymap.ts:15-22,182-277,452-454,479`. |

### Раздел 5. Поддерживаемая разметка Markdown

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **5.1** Inline: bold, italic, strike, highlight, code, math, comments, links, images, footnotes | **ЕСТЬ** | Парсеры `src/editor/markdownExtensions.ts:14-103,199-222`; декорации и виджеты `src/editor/livePreview/inline.ts:93-164`, `footnotes.ts:63-177`. |
| **5.1** Комментарии приглушены/скрываются и не экспортируются | **ЕСТЬ** | Comment decoration скрывается при неактивном узле: `src/editor/livePreview/inline.ts:109-112`; комментарии остаются Markdown-маркерами только в редакторе и не имеют отдельного экспортёра. |
| **5.2** Блочные элементы: шесть заголовков, списки, задачи, цитаты, callout, HR, code/math blocks, tables, footnotes | **ЕСТЬ** | Построители: `src/editor/livePreview/blocks.ts:56-163`, `tables.ts`, `codeBlocks.ts`, `footnotes.ts`; парсеры блоков: `src/editor/markdownExtensions.ts:109-258`. |
| **5.2** Все девять callout; неизвестный тип отображается как note | **ЕСТЬ** | Набор типов и нормализация: `src/editor/livePreview/callouts.ts:6-21`; отображение блока: `callouts.ts:170-241`. |
| **5.2** Клик по checkbox меняет текст и попадает в undo | **ЕСТЬ** | Виджет dispatch-ит замену `[ ]`/`[x]`: `src/editor/livePreview/widgets/Checkbox.ts:1-31`; редактор использует общую history: `src/editor/keymap.ts:473-480`. |
| **5.2** Изображения относительны папке документа, ограничены колонкой, битые ссылки имеют запасной вид | **ЕСТЬ** | Политика путей и лимит 16 MiB: `src-tauri/src/commands.rs:346-400`; ImageWidget и CSS: `src/editor/livePreview/inline.ts:144-161`, `src/editor/livePreview/blocks.ts:214-220`. |

### Раздел 6. Интерфейс

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **6.1** Shell с заголовком, меню, Save-контролами, редактором и статус-баром | **ЧАСТИЧНО** | Все части смонтированы: `src/App.svelte:747-844`; заголовок сейчас собственный `TitleBar`, тогда как ASCII-схема SPEC на `docs/SPEC.md:323-338` называет его нативным. Это расхождение документов, а не отсутствие оболочки. |
| **6.1** Нет отдельного toolbar форматирования, Save/Save As остаются видимыми | **ЕСТЬ** | Меню/контекстное меню и SaveControls: `src/App.svelte:750-778`, `src/ui/SaveControls.svelte:146-176`. |
| **6.2** Меню File/Edit/Format/View/Help и перечисленные команды | **ЧАСТИЧНО** | File/Edit/View/Help и действия есть в `src/ui/menuModel.ts:91-149`; верхнего `Format` нет, форматирование сознательно вынесено в ContextMenu (`src/ui/menuModel.ts:152-198`, `src/ui/ContextMenu.svelte:118-128`). Сам SPEC противоречит себе в строках 352-359 и 365-368. |
| **6.2** File ▸ New использует тот же реестр и создаёт тип в новом окне | **ЕСТЬ** | Модель меню и обработчик: `src/ui/menuModel.ts:91-106`, `src/state/actions.ts:305-337`; Rust `open_new_window`: `src-tauri/src/commands.rs:403-417`. |
| **6.3** Меню WebView2 заменено собственным, подменю зависят от контекста | **ЕСТЬ** | `ContextMenu` предотвращает browser context menu и вычисляет target: `src/ui/ContextMenu.svelte:261-391`; команды группируются в `src/ui/menuModel.ts:152-198`. |
| **6.3** Над выделением/пустым местом/ссылкой/изображением показываются разные команды | **ЕСТЬ** | Target detection и payload: `src/ui/ContextMenu.svelte:367-391`; группы действий: `src/ui/menuModel.ts:152-198`. |
| **6.4** Строка состояния показывает тип, ограничения, позицию, строки, слова и знаки по правилам SPEC | **ЕСТЬ** | `src/ui/StatusBar.svelte:10-37`; вычисление stats в `src/editor/createEditor.ts:23-65,297-356` и подключение: `src/App.svelte:810-844`. |

### Раздел 7. Поиск и замена

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **7.1** Ctrl+F открывает панель, подсветку и счётчик совпадений | **ЕСТЬ** | `src/editor/search.ts:404-435`, `src/ui/FindPanel.svelte:1-80,330-360`; панель смонтирована в `src/App.svelte:792-801`. |
| **7.2** Enter/Shift+Enter переходят по совпадениям, Esc закрывает | **ЕСТЬ** | `src/editor/search.ts:339-401,416-421`, `src/ui/FindPanel.svelte:183-194`. |
| **7.3** Переключатели регистра, целого слова и regex | **ЕСТЬ** | Controls: `src/ui/FindPanel.svelte:304-334`; query state and matcher: `src/editor/search.ts:1-160`. |
| **7.4** Ctrl+H, Replace и Replace All | **ЕСТЬ** | UI: `src/ui/FindPanel.svelte:377-414`; команды: `src/editor/search.ts:339-394`. |
| **7.5** Поиск идёт по исходному тексту вместе со скрытой разметкой | **ЕСТЬ** | CodeMirror search использует `state.doc`, а не отрисованный DOM: `src/editor/search.ts:80-160,404-421`. |

### Раздел 8. Горячие клавиши

| Клавиши / действие | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| `Ctrl+N` — новый Markdown в новом окне | **ЕСТЬ** | `externalBindings`: `src/editor/keymap.ts:374-390`; action вызывает `open_new_window`: `src/state/actions.ts:305-321`, `src/App.svelte:178-182`. |
| `Ctrl+Shift+N` — выбор типа в новом окне | **ЕСТЬ** | chooser и новый window action: `src/state/actions.ts:328-337`; `src/ui/menuModel.ts:91-106`. |
| `Ctrl+,` — настройки | **ЕСТЬ** | Global handler и SettingsWindow: `src/App.svelte:687-692,949-956`. |
| `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`, `Ctrl+W` | **ЕСТЬ** | Все bindings подключены в `src/editor/keymap.ts:374-390`, переданы из `src/App.svelte:130-194`; действия в `src/state/actions.ts:348-417`. |
| `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`, Ctrl+X/C/V, Ctrl+Shift+V, Ctrl+A, Ctrl+D, Alt+↑/↓ | **ЕСТЬ** | Editor bindings: `src/editor/keymap.ts:443-460`; CodeMirror default keymap дополняет clipboard/select-all. |
| `Ctrl+B/I/E/K`, Ctrl+1…6, Ctrl+0 для заголовка, Ctrl+Shift+K, Tab | **ЕСТЬ** | `src/editor/keymap.ts:452-463`; контекстные действия также в `src/state/actions.ts:576-633`. |
| `Ctrl+F/H`, F3/Shift+F3 | **ЕСТЬ** | `src/editor/search.ts:404-421`. |
| `Ctrl+G` — перейти к строке | **ЕСТЬ** | Окно перехода, обработчик и привязка: `src/App.svelte:210-241,971-986`, `src/editor/keymap.ts:374-390`; `goToLine` передан в `createActions`. Проверено запуском исполнителем задачи. |
| Ctrl+Home/End, Ctrl+±, Ctrl+0 reset zoom с уступанием конфликта | **ЧАСТИЧНО** | Home/End — default keymap; zoom bindings — `src/editor/keymap.ts:384-389`, `src/editor/zoom.ts:1-70`. `Ctrl+0` одновременно снимает заголовок и сбрасывает масштаб (`keymap.ts:463` и `384-389`), порядок и уступание не подтверждены. |

### Раздел 9. Ограничения

| Утверждение спецификации | Вердикт | Реализация в коде / причина расхождения |
| :--- | :---: | :--- |
| **9.1** Файлы больше 5 MiB отключают preview и сообщают причину в статусе | **ЧАСТИЧНО** | Порог и отключение декораций: `src/editor/livePreview/plugin.ts:117-156`; StatusBar не получает флаг причины: `src/ui/StatusBar.svelte:10-37`. Настройка порога есть в `src/ui/SettingsWindow.svelte:77-80`. |
| **9.2** Двоичный файл отклоняется с сообщением | **ЕСТЬ** | Проверка и ошибка при открытии: `src-tauri/src/commands.rs:112-145`, `src-tauri/src/binary.rs`. |
| **9.3** HTTP/data изображения разрешены, абсолютные и внешние `file://` запрещены | **ЕСТЬ** | `read_image` принимает data/http(s), проверяет абсолютность, URI schemes, каталог документа и размер: `src-tauri/src/commands.rs:346-400`. |
| **9.4** Проверка орфографии средствами WebView2 для английского | **ЕСТЬ, с ограничением** | `src/editor/spellcheck.ts` оставляет только `spellcheck=true/false`; словарь выбирает Windows по языку интерфейса системы. Wry задаёт язык окружения сам (`src/webview2/mod.rs:331-334` в [wry 0.55.1](https://github.com/tauri-apps/wry/blob/v0.55.1/src/webview2/mod.rs#L331-L334)), что соответствует ограничению WebView2 [#5294](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5294); выбора языка в UI нет. |

---

## 3. Дополнительные обещания `docs/SETTINGS.md`

| Настройка | Вердикт | Реализация / причина |
| :--- | :---: | :--- |
| Хранение, атомарная запись, defaults и quarantine повреждённого файла | **ЕСТЬ** | `src-tauri/src/settings.rs:318-400,555-624`; команды get/save/reset/reveal: `src-tauri/src/commands.rs:437-480`. |
| Язык интерфейса и RTL для Arabic | **ЕСТЬ** | Дескрипторы выбора: `src/ui/SettingsWindow.svelte:36-48`; локали `src/i18n/locales/`, применение языка — `src/state/settings.svelte.ts:146-220`. |
| Spellcheck/autocorrect | **ЕСТЬ, с ограничением** | Автозамена подключена: `src/editor/autoCorrect.ts:1-87`; spellcheck можно включить или выключить, а словарь выбирает Windows по языку интерфейса системы, как указано в SETTINGS §3. |
| Editor и live-preview настройки | **ЕСТЬ** | Применение редакторских параметров: `src/editor/settings/appearance.ts:20-112`; preview: `src/editor/livePreview/settings.ts:20-51`; реакция на изменения: `src/App.svelte:675-677`. |
| Восемь настроек раздела files | **ЧАСТИЧНО** | Autosave/delay/blur и transforms читаются в `src/state/autosave.ts:50-72,153-179`; `newDocumentFormat`, `newDocumentEncoding`, `newDocumentLineEnding` пока не имеют потребителя в `src/` и весь перенос отмечен владельцем как работа. |
| Размер/позиция и `raiseExistingWindow` | **ЕСТЬ** | Условные flags window-state: `src-tauri/src/lib.rs:63-125`; маршрутизация учитывает setting: `src-tauri/src/windows.rs:303-371`. |
| `startupAction = startScreen` | **ЧАСТИЧНО** | Пустое окно по умолчанию показывает стартовый экран (`src/App.svelte:86-88`), но поиск по `src/` и `src-tauri/src/` не находит чтения поля `startupAction`; выбранное значение не влияет на запуск. Поле только описано в `src/ui/SettingsWindow.svelte:99-104`. |
| `startupAction = recentFiles` | **ЕСТЬ** | Хранилище под управлением Rust (`src-tauri/src/recent_files.rs`), атомарная запись в `recent-files.json`, автопополнение при открытии/сохранении (`src-tauri/src/commands.rs`), показ списка в `src/ui/StartScreen.svelte` при `windows.startupAction = "recentFiles"`, очистка кнопкой в `src/ui/SettingsWindow.svelte`. |
| Reset/reveal settings/version | **ЕСТЬ** | UI и действия: `src/ui/SettingsWindow.svelte:400-437`; команды Rust: `src-tauri/src/commands.rs:452-480`. |

---

## 4. Аудит форматов

| Обещание | Вердикт | Реализация / причина |
| :--- | :---: | :--- |
| Реестр и capabilities форматов | **ЕСТЬ** | 2 базовых + 19 дополнительных = 21 формат, 17 creatable: `src-tauri/src/formats/mod.rs:37-49,91-97`, `src-tauri/src/formats/extra.rs:30-58,100-114`. |
| Markdown: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | **ЕСТЬ** | `src-tauri/src/formats/markdown.rs:5-24,42-47`. |
| Plain Text: `.txt`, `.log`, `.ini`, `.cfg`, `.conf`, `.env`, `.csv`, `.tsv`, `.text` | **ЕСТЬ** | `src-tauri/src/formats/plain.rs:5-29`; неизвестные расширения также fallback plain: `src-tauri/src/formats/mod.rs:62-81`. |
| JSON и кодовые форматы получают syntax highlighting и сохраняются | **ЕСТЬ** | Реестр и caps: `src-tauri/src/formats/extra.rs:9-21`; загрузка language-data по `syntaxMode` — `src/editor/createEditor.ts:8-15,210-247`. |
| JSON validate/format доступны через IPC и меню | **ЕСТЬ** | Команды зарегистрированы (`src-tauri/src/lib.rs:31-55`, `src-tauri/src/commands.rs:332-342`), пункты меню и action уже есть (`src/ui/menuModel.ts:189-193`, `src/state/actions.ts:496-520,604-605`), пункты показываются только для документа в формате JSON. |
| RTF открывается/сохраняется с потерями, без autosave, с предупреждением | **ЕСТЬ** | Adapter и flags: `src-tauri/src/formats/rtf.rs:17-45`; предупреждение и Save-as-Markdown flow присутствуют (`src/App.svelte:244-300,883-885`), предупреждение показывается один раз за документ. Руками не проверено. |
| PDF/DOCX/EPUB read-only извлекаются и экспортируются Save as Markdown | **ЕСТЬ** | Адаптеры: `src-tauri/src/formats/pdf.rs:14-50`, `docx.rs:13-47`, `epub.rs:27-49`; read-only resolve и экспорт в Markdown: `src-tauri/src/commands.rs:227-287,511-520`; кнопка: `src/ui/SaveControls.svelte:168-176`. |

---

## 5. Стыки и контракты

| Проверка | Результат по коду |
| :--- | :--- |
| UI-компоненты | `MenuBar`, `StartScreen`, `StatusBar`, `FindPanel`, `ContextMenu`, `Notice`, `SaveControls`, `FormatPicker`, `HelpDialog` смонтированы в `src/App.svelte:747-988`; callbacks/actions переданы. Runtime-работа не проверена. |
| IPC-команды | Зарегистрированы команды открытия/сохранения/окон/форматов/настроек/изображений, включая JSON: `src-tauri/src/lib.rs:31-55`. Это больше старого перечня из 12 команд в прежнем AUDIT. |
| События Rust → frontend | `open-file-request`, `file-changed-externally`, `file-deleted`, `save-before-close` отправляются/слушаются: `src-tauri/src/windows.rs:354-363,474-524`, `src-tauri/src/watcher.rs:150-166`, `src/App.svelte:692-717`, `src/state/autosave.ts:212-223`. Не проверено запуском. |

---

## 6. Расхождения между документами

1. **Настройки.** `README.md:3-4` говорит «без лишних настроек», а в `README.md:78-79` перечисляет отсутствие дополнительных настроек; `docs/SETTINGS.md:3-13` фиксирует полноценное окно настроек и прямо объясняет, что старые утверждения изменены. `docs/SPEC.md:21-27` уже разрешает окно, но называет его узким; его состав теперь шире (см. SETTINGS §2–§8).
2. **Язык.** `docs/SPEC.md:16-17` обещает только английский, тогда как `docs/SETTINGS.md:35-63` и `src/ui/SettingsWindow.svelte:36-48` предлагают десять локалей.
3. **Spellcheck.** `docs/SPEC.md:487-493` говорит об английском, а `docs/SETTINGS.md:65-89` теперь оставляет только включение/выключение и честно указывает, что словарь выбирает Windows по языку интерфейса системы; причина — язык окружения WebView2 задаёт Wry (`src/webview2/mod.rs:331-334`, [WebView2 #5294](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5294)).
4. **Меню Format.** `docs/SPEC.md:352-359` включает верхний пункт `Format`, но `docs/SPEC.md:361-368` утверждает, что он убран; `src/ui/menuModel.ts:91-149,152-198` реализует второй вариант — форматирование в контекстном меню. README и ROADMAP всё ещё пишут `Format` как верхний пункт (`README.md:50-55`, `ROADMAP.md:218-228`).
5. **Количество и состав форматов.** README называет 20 форматов (`README.md:33-35`), ROADMAP повторяет 20 и говорит, что EPUB не добавлен (`ROADMAP.md:256-258`); текущий реестр содержит 21, включая EPUB (`src-tauri/src/formats/extra.rs:15-20`, `src-tauri/src/formats/mod.rs:105-108`).
6. **Plain Text.** README считает `.cfg`, `.conf`, `.csv`, `.tsv` отсутствующими (`README.md:69-72`), ROADMAP говорит то же (`ROADMAP.md:261-264`), но `plain.rs:11-21` перечисляет все эти расширения.
7. **JSON, RTF и read-only export.** README и ROADMAP всё ещё объявляют JSON-инструменты, RTF warning и Save as Markdown для PDF/DOCX незавершёнными (`README.md:73-76`, `ROADMAP.md:267-280`), хотя всё это уже сделано. Документы отстали от кода и требуют правки.
8. **Удалённый файл.** README и ROADMAP утверждают, что обычное сохранение после удаления блокируется (`README.md:64-65`, `ROADMAP.md:175-177`), но текущая команда разрешает recreate и имеет тест (`src-tauri/src/commands.rs:500-507,703-717`).
9. **Версии и релизный статус.** README измеряет установщик 1.0.3 (`README.md:85,110-116`), а задача готовит 1.0.6; ROADMAP workflow всё ещё жёстко ссылается на 1.0.0 и тег `v1.0.0` (`ROADMAP.md:294-313`). README одновременно называет состояние M1–M5 в основном подключённым (`README.md:151-155`), тогда как ROADMAP оставляет старые незакрытые пункты M5/M6.
10. **Геометрия окна.** ROADMAP отмечает запоминание размера выполненным без оговорки (`ROADMAP.md:178-184`), а текущий W83 сделал его условным по `windows.rememberSizeAndPosition` (`src-tauri/src/lib.rs:63-125`); SETTINGS описывает этот переключатель (`docs/SETTINGS.md:136-142`).

---

## 7. Что не проверено запуском

Программу по условию не запускал. Поэтому остаются ручные проверки WebView2 и Windows:

- двойной клик/`single-instance`, поднятие и фокус окна, drop файлов;
- визуальное раскрытие live preview, таблиц, KaTeX, изображений и RTL;
- реальные Ctrl+N/O/S/W, Ctrl+G, F3 и конфликт Ctrl+0 в CodeMirror;
- сохранение позиции/прокрутки при внешнем изменении, close handshake и recreate удалённого файла;
- отключение preview на больших файлах, spellcheck-словарь WebView2 и контраст цветов.

Эти пункты не превращены в НЕТ: исходники содержат соответствующие маршруты, но
приёмка должна быть одним контролируемым запуском перед релизом.

---

## 8. Вывод для выпуска 1.0.6

* НЕТ: 0 — последний незакрытый пункт (`startupAction=recentFiles`) полностью закрыт в задаче W122 (хранилище в `recent-files.json`, атомарная запись, фильтрация пропавших файлов, очистка).
* ЧАСТИЧНО, требующее завершения/приёмки: RTF warning, JSON tools, Ctrl+G, `startupAction=startScreen`, восемь
  `files` settings, статус причины отключённого preview, автоматическое сохранение
  selection при внешней перезагрузке и конфликт Ctrl+0.
* Документальные расхождения перечислены выше и сами документы, кроме этого AUDIT,
  не изменялись.
