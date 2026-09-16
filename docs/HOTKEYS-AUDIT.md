# Аудит горячих клавиш MarkNote

Аудит соответствия реализации горячих клавиш спецификации (`docs/SPEC.md`, раздел 8), коду редактора (`src/editor/keymap.ts`, `src/editor/livePreview/tables.ts`, `src/editor/search.ts`), модели меню (`src/ui/menuModel.ts`) и обработчикам действий (`src/state/actions.ts`, `src/App.svelte`).

---

## 1. Сводная таблица сверки

| Сочетание | SPEC (раздел 8) | Редактор (keymap.ts / tables.ts / search.ts) | Меню (menuModel.ts / actions.ts / App.svelte) | Вердикт |
| :--- | :--- | :--- | :--- | :--- |
| **Ctrl+N** | Новый документ в новом окне, Markdown (`SPEC.md:443`) | `Mod-n` → `handlers.newDocument` (`keymap.ts:376`). Вызывает `actions.newDocument`: заменяет документ в **текущем** окне (`actions.ts:285, 547`) | `file.newWindow` («New Window»), подпись `Ctrl+N` (`menuModel.ts:97`). В `App.svelte:523-530` открывает дубликат текущего файла в новом окне, либо заменяет текущий несохранённый | **РАСХОЖДЕНИЕ**: Пункт меню и клавиша делают разное. Ни клавиша, ни меню не создают новый пустой документ в новом окне. |
| **Ctrl+Shift+N** | Новый документ с выбором типа (`SPEC.md:444`) | `Mod-Shift-n` → `handlers.newDocumentWithPicker` (`keymap.ts:377`). Вызывает `actions.newDocumentWithPicker` (`actions.ts:298, 551`). В `App.svelte:133` не передан `dialogs.chooseFormat` → ошибка | `file.new` («New ▸»), подпись `Ctrl+Shift+N` (`menuModel.ts:96`), раскрывает подменю форматов. Клик заменяет документ в текущем окне (`App.svelte:517`) | **РАСХОЖДЕНИЕ**: Клавиша в редакторе падает с ошибкой («Format picker is unavailable»); в меню открывает выпадающий список и заменяет текущий файл. Потенциальный перехват в WebView2 (InPrivate). |
| **Ctrl+O** | Открыть файл (`SPEC.md:445`) | `Mod-o` → `handlers.openFile` (`keymap.ts:378`, `actions.ts:318, 555`) | `file.open` («Open…»), подпись `Ctrl+O` (`menuModel.ts:99`, `App.svelte:531`) | **Совпадает** (`SPEC.md:445`, `keymap.ts:378`, `menuModel.ts:99`) |
| **Ctrl+S** | Сохранить немедленно (`SPEC.md:446`) | `Mod-s` → `handlers.save` (`keymap.ts:379`, `actions.ts:348, 559`) | `file.save` («Save»), подпись `Ctrl+S` (`menuModel.ts:101`, `App.svelte:532`) | **Совпадает** (`SPEC.md:446`, `keymap.ts:379`, `menuModel.ts:101`) |
| **Ctrl+Shift+S** | Сохранить как (`SPEC.md:447`) | `Mod-Shift-s` → `handlers.saveAs` (`keymap.ts:380`, `actions.ts:333, 563`) | `file.saveAs` («Save As…»), подпись `Ctrl+Shift+S` (`menuModel.ts:102`, `App.svelte:533`) | **Совпадает** (`SPEC.md:447`, `keymap.ts:380`, `menuModel.ts:102`) |
| **Ctrl+W** | Закрыть окно (`SPEC.md:448`) | `Mod-w` → `handlers.closeWindow` (`keymap.ts:381`, `actions.ts:567`) | `file.close` («Close»), подпись `Ctrl+W` (`menuModel.ts:104`, `App.svelte:534`) | **Совпадает** (`SPEC.md:448`, `keymap.ts:381`, `menuModel.ts:104`) |
| **Ctrl+Z** | Отменить (`SPEC.md:453`) | `Mod-z` → `undo` (`keymap.ts:446`) | `edit.undo` («Undo»), подпись `Ctrl+Z` (`menuModel.ts:113`, `App.svelte:536`) | **Совпадает** (`SPEC.md:453`, `keymap.ts:446`, `menuModel.ts:113`) |
| **Ctrl+Shift+Z** | Повторить (`SPEC.md:454`) | `Mod-Shift-z` → `redo` (`keymap.ts:447`) | `edit.redo` («Redo»), подпись `Ctrl+Shift+Z / Ctrl+Y` (`menuModel.ts:114`, `App.svelte:537`) | **Совпадает** (`SPEC.md:454`, `keymap.ts:447`, `menuModel.ts:114`) |
| **Ctrl+Y** | Повторить (`SPEC.md:454`) | `Mod-y` → `redo` (`keymap.ts:448`) | `edit.redo` («Redo»), подпись `Ctrl+Shift+Z / Ctrl+Y` (`menuModel.ts:114`, `App.svelte:537`) | **Совпадает** (`SPEC.md:454`, `keymap.ts:448`, `menuModel.ts:114`) |
| **Ctrl+X** | Вырезать (`SPEC.md:455`) | Встроено в CodeMirror / Webview clipboard (`keymap.ts:478`) | `edit.cut` («Cut»), подпись `Ctrl+X` (`menuModel.ts:116`, `App.svelte:538`) | **Совпадает** (`SPEC.md:455`, `keymap.ts:478`, `menuModel.ts:116`) |
| **Ctrl+C** | Копировать (`SPEC.md:455`) | Встроено в CodeMirror / Webview clipboard (`keymap.ts:478`) | `edit.copy` («Copy»), подпись `Ctrl+C` (`menuModel.ts:117`, `App.svelte:539`) | **Совпадает** (`SPEC.md:455`, `keymap.ts:478`, `menuModel.ts:117`) |
| **Ctrl+V** | Вставить (`SPEC.md:455`) | Встроено в CodeMirror / Webview clipboard (`keymap.ts:478`) | `edit.paste` («Paste»), подпись `Ctrl+V` (`menuModel.ts:118`, `App.svelte:540`) | **Совпадает** (`SPEC.md:455`, `keymap.ts:478`, `menuModel.ts:118`) |
| **Ctrl+Shift+V** | Вставить как простой текст (`SPEC.md:456`) | `Mod-Shift-v` → `pastePlainText` (`keymap.ts:460`) | `edit.pastePlainText` («Paste as Plain Text»), подпись `Ctrl+Shift+V` (`menuModel.ts:119`, `App.svelte:547`) | **Совпадает** (`SPEC.md:456`, `keymap.ts:460`, `menuModel.ts:119`) |
| **Ctrl+A** | Выделить всё (`SPEC.md:457`) | Встроено в `defaultKeymap` CodeMirror (`keymap.ts:478`) | `edit.selectAll` («Select All»), подпись `Ctrl+A` (`menuModel.ts:120`, `App.svelte:541`) | **Совпадает** (`SPEC.md:457`, `keymap.ts:478`, `menuModel.ts:120`) |
| **Ctrl+D** | Удалить строку (`SPEC.md:458`) | `Mod-d` → `deleteLine` (`keymap.ts:455`) | `edit.deleteLine` («Delete Line»), подпись `Ctrl+D` (`menuModel.ts:125`, `App.svelte:542`) | **Совпадает** (`SPEC.md:458`, `keymap.ts:455`, `menuModel.ts:125`) |
| **Alt+↑** | Переместить строку вверх (`SPEC.md:459`) | `Alt-ArrowUp` → `moveLineUp` (`keymap.ts:456`) | `edit.moveLineUp` («Move Line Up»), подпись `Alt+↑` (`menuModel.ts:126`, `App.svelte:543`) | **Совпадает** (`SPEC.md:459`, `keymap.ts:456`, `menuModel.ts:126`) |
| **Alt+↓** | Переместить строку вниз (`SPEC.md:459`) | `Alt-ArrowDown` → `moveLineDown` (`keymap.ts:457`) | `edit.moveLineDown` («Move Line Down»), подпись `Alt+↓` (`menuModel.ts:127`, `App.svelte:544`) | **Совпадает** (`SPEC.md:459`, `keymap.ts:457`, `menuModel.ts:127`) |
| **Ctrl+B** | Жирный (`SPEC.md:464`) | `Mod-b` → `toggleWrapper("**", "**")` (`keymap.ts:452`) | `format.bold` в контекстном меню, подпись `Ctrl+B` (`menuModel.ts:158`, `App.svelte:548`) | **Совпадает** (в keymap есть toggle/снятие, в меню — только оборачивание) |
| **Ctrl+I** | Курсив (`SPEC.md:465`) | `Mod-i` → `toggleWrapper("*", "*")` (`keymap.ts:453`) | `format.italic` в контекстном меню, подпись `Ctrl+I` (`menuModel.ts:159`, `App.svelte:549`) | **Совпадает** (в keymap есть toggle/снятие, в меню — только оборачивание) |
| **Ctrl+E** | Код (`SPEC.md:466`) | `Mod-e` → `toggleWrapper("`", "`")` (`keymap.ts:454`) | `format.code` в контекстном меню, подпись `Ctrl+E` (`menuModel.ts:163`, `App.svelte:552`) | **Совпадает** (в keymap есть toggle/снятие, в меню — только оборачивание) |
| **Ctrl+K** | Ссылка (`SPEC.md:467`) | `Mod-k` → `toggleLink` (`keymap.ts:458`) | `format.link` в контекстном меню, подпись `Ctrl+K` (`menuModel.ts:164`, `App.svelte:553`) | **Совпадает** (`SPEC.md:467`, `keymap.ts:458`, `menuModel.ts:164`) |
| **Ctrl+1 … Ctrl+6** | Заголовок уровня 1..6 (`SPEC.md:468`) | `Mod-1` … `Mod-6` → `headingCommand(1..6)` (`keymap.ts:462`) | `format.heading1..6` в контекстном меню, подписи `Ctrl+1` … `Ctrl+6` (`menuModel.ts:172`, `App.svelte:554-559`) | **Совпадает** (`SPEC.md:468`, `keymap.ts:462`, `menuModel.ts:172`) |
| **Ctrl+0** (Заголовок) | Убрать заголовок (`SPEC.md:469`) | `Mod-0` → `headingCommand(0)` (`keymap.ts:463`). При наличии заголовка снимает `#` и перехватывает событие (`keymap.ts:325`) | `format.clearHeading` в контекстном меню, подпись `Ctrl+0` (`menuModel.ts:175`, `App.svelte:560`) | **Совпадает** (приоритет над масштабом соблюдён в keymap) |
| **Ctrl+Shift+K** | Блок кода (`SPEC.md:470`) | `Mod-Shift-k` → `toggleCodeBlock` (`keymap.ts:459`), оборачивает или разворачивает выделение | `format.codeBlock` в контекстном меню, подпись `Ctrl+Shift+K` (`menuModel.ts:185`). В `App.svelte:564` просто вставляет пустой шаблон без выделения | **РАСХОЖДЕНИЕ В ПОВЕДЕНИИ**: Клавиша умно оборачивает выделение, пункт меню статически вставляет пустой блок ```` ``` ```` |
| **Tab** | Уровень вложенности списка (`SPEC.md:471`) | Вне таблицы: `indent` списка на 4 пробела (`keymap.ts:449`). В таблице: перехватывается `tableKeymap` (`tables.ts:136`, `createEditor.ts:328`) → переход к следующей ячейке | В меню отсутствует (в контекстном меню есть `format.list` без сочетания, `menuModel.ts:177`) | **РАСХОЖДЕНИЕ СО SPEC**: Переход по ячейкам таблицы перехватывает Tab раньше списка, но не описан в разделе 8 SPEC. |
| **Shift+Tab** | Уровень вложенности списка (`SPEC.md:471`) | Вне таблицы: `outdent` списка (`keymap.ts:450`). В таблице: перехватывается `tableKeymap` (`tables.ts:137`, `createEditor.ts:328`) → переход к предыдущей ячейке | В меню отсутствует | **РАСХОЖДЕНИЕ СО SPEC**: Переход к предыдущей ячейке таблицы не задокументирован в разделе 8 SPEC. |
| **Ctrl+F** | Поиск (`SPEC.md:476`) | `Mod-f` → `handlers.openSearch` (`keymap.ts:382`), `searchCommands.openSearch` (`search.ts:417`), глобально в `FindPanel.svelte:229` | `edit.find` («Find…»), подпись `Ctrl+F` (`menuModel.ts:122`, `App.svelte:545`) | **Совпадает** (`SPEC.md:476`, `keymap.ts:382`, `menuModel.ts:122`) |
| **Ctrl+H** | Замена (`SPEC.md:477`) | `Mod-h` → `handlers.openReplace` (`keymap.ts:383`), `searchCommands.openReplace` (`search.ts:418`), глобально в `FindPanel.svelte:233` | `edit.replace` («Replace…»), подпись `Ctrl+H` (`menuModel.ts:123`, `App.svelte:546`) | **Совпадает** (`SPEC.md:477`, `keymap.ts:383`, `menuModel.ts:123`) |
| **Ctrl+G** | Перейти к строке (`SPEC.md:478`) | `Mod-g` → `handlers.goToLine` (`keymap.ts:384`, `actions.ts:570`). Но в `App.svelte:128-161` `goToLine` не передан | Отсутствует в `menuModel.ts`. Упомянут в справке `HelpDialog.svelte:43` | **НЕ РЕАЛИЗОВАНО**: Обещано в SPEC и справке, но UI и обработчик отсутствуют. Клавиша не работает. |
| **Ctrl+Home / Ctrl+End** | В начало и конец документа (`SPEC.md:479`) | Встроено в CodeMirror `defaultKeymap` (`Mod-Home` / `Mod-End`) + физические коды (`keymap.ts:420-421, 478`) | Отсутствует в меню; есть в справке `HelpDialog.svelte:35` | **Совпадает** (`SPEC.md:479`, `keymap.ts:478`) |
| **Ctrl+± (Ctrl++ / Ctrl+=)** | Масштаб (увеличение) (`SPEC.md:480`) | `Mod-+` и `Mod-=` → `handlers.zoomIn` (`keymap.ts:385-386`, `App.svelte:152`) | `view.zoomIn` («Zoom In»), подпись `Ctrl+±` (`menuModel.ts:134`, `App.svelte:567`) | **Совпадает** (`SPEC.md:480`, `keymap.ts:385`, `menuModel.ts:134`) |
| **Ctrl+-** | Масштаб (уменьшение) (входит в `Ctrl+±`, `SPEC.md:480`) | `Mod--` → `handlers.zoomOut` (`keymap.ts:387`, `App.svelte:155`) | `view.zoomOut` («Zoom Out») ошибочно подписан как `Ctrl+±` (`menuModel.ts:135`) | **ОШИБКА ПОДПИСИ В МЕНЮ**: В меню Zoom Out подписан как `Ctrl+±` вместо `Ctrl+-`. |
| **Ctrl+0** (Масштаб) | Сброс масштаба, уступает заголовку (`SPEC.md:481`) | `Mod-0` → `handlers.resetZoom` (`keymap.ts:388`). Срабатывает, только если строка не является заголовком (`keymap.ts:325`) | `view.resetZoom` («Reset Zoom»), подпись `Ctrl+0` (`menuModel.ts:136`, `App.svelte:569`) | **Совпадает** (конфликт разрешён в пользу заголовка) |
| **Ctrl+,** | В SPEC отсутствует (окно настроек упомянуто в SPEC 1 и `SETTINGS.md`) | В CodeMirror keymap отсутствует (`keymap.ts:375-391`) | `file.settings` («Settings…»), подпись `Ctrl+,` (`menuModel.ts:106`). Ловится через `App.svelte:582` (`handleWindowKeydown`) | **РАСХОЖДЕНИЕ**: Реализовано в меню и окне, но не описано в SPEC. Не ловится в keymap, не работает на русской раскладке. |
| **F3 / Shift-F3** | В SPEC отсутствует (SPEC 7 упоминает только `Enter`/`Shift+Enter`) | Зарегистрированы в `search.ts:419-420` (`searchCommands.findNext / findPrevious`) | Отсутствует в меню | **РАСХОЖДЕНИЕ**: Реализовано в поиске редактора, но не описано в SPEC. |
| **Ctrl+P** | В SPEC отсутствует | В keymap и коде приложения отсутствует | В меню отсутствует | **КОНФЛИКТ С WEBVIEW2**: По умолчанию перехватывается WebView2 и открывает окно печати Windows / Chromium. |

---

## 2. Список расхождений (отсортирован по вероятности столкновения)

### 1. Критическое: `Ctrl+N` и пункт меню «New Window» ведут себя по-разному и нарушают SPEC
- **Вероятность столкновения:** 100% (базовое действие любого текстового редактора).
- **Файлы и строки:**
  - `docs/SPEC.md:443`, `docs/SPEC.md:352-355` — обещано: создание нового пустого документа в **новом окне**, Markdown по умолчанию.
  - `src/ui/menuModel.ts:97` — пункт меню `file.newWindow` («New Window») подписан горячей клавишей `Ctrl+N`.
  - `src/editor/keymap.ts:376` — сочетание `Mod-n` привязано к `handlers.newDocument`.
  - `src/state/actions.ts:285-296, 547-550` — `handlers.newDocument` вызывает `actions.newDocument(markdownFormat.id)`, которая вызывает IPC `new_document` и перезаписывает текст в **текущем окне** (`replaceEditorText`), уничтожая открытый несохранённый документ или заменяя его без открытия нового окна.
  - `src/App.svelte:523-530` — по клику на пункт меню `file.newWindow` выполняется `handleMenuAction`:
    - если у текущего документа есть путь (`documentState.path`), вызывается `open_in_new_window` с путём **текущего файла** (открывается дубликат текущего документа в новом окне, а не новый пустой документ);
    - если документ несохранён (`!documentState.path`), вызывается `createNewDocument(markdown)` в **текущем окне**.
- **Суть проблемы:** Нажатие `Ctrl+N` затирает текущий документ вместо открытия нового окна. Клик по меню «New Window» открывает копию текущего файла. Пункт меню и сочетание клавиш рассинхронизированы между собой и оба расходятся со спецификацией.

---

### 2. Критическое: `Ctrl+Shift+N` падает с ошибкой в редакторе, а в меню ведёт себя иначе
- **Вероятность столкновения:** Очень высокая (пользователь нажимает сочетание, указанное прямо напротив «File ▸ New»).
- **Файлы и строки:**
  - `docs/SPEC.md:444` — обещано: «Новый документ с выбором типа» (в новом окне согласно п. 6.2).
  - `src/ui/menuModel.ts:96` — пункт `file.new` («New ▸») подписан как `Ctrl+Shift+N` и содержит подменю типов файлов `newFormats`.
  - `src/editor/keymap.ts:377` — сочетание `Mod-Shift-n` привязано к `handlers.newDocumentWithPicker`.
  - `src/state/actions.ts:298-307, 551-554` — `newDocumentWithPicker` проверяет `if (!dialogs.chooseFormat) return unavailable("Format picker is unavailable")`.
  - `src/App.svelte:128-161` — фабрика `createActions({...})` передаёт `dialogs: { showHelp, openLink, openImage }`, но **не передаёт `chooseFormat`**.
  - `src/App.svelte:517-521` — клик мышью по подпункту меню `file.new.<format>` создаёт документ в **текущем окне** (`createNewDocument(format)`), а не в новом.
- **Суть проблемы:** При нажатии `Ctrl+Shift+N` в фокусе редактора пользователь получает всплывающее уведомление об ошибке: *"Format picker is unavailable"*. При клике мышью в меню документ создаётся в текущем окне, а не в новом. Кроме того, в среде WebView2 `Ctrl+Shift+N` является системным сочетанием вызова окна InPrivate.

---

### 3. Высокая: `Ctrl+G` («Перейти к строке») не реализован нигде
- **Вероятность столкновения:** Высокая (стандартное сочетание для перехода по коду/заметке, явно обещанное в SPEC и справочном окне).
- **Файлы и строки:**
  - `docs/SPEC.md:478` — обещано в таблице: `Ctrl+G` — «Перейти к строке».
  - `src/ui/HelpDialog.svelte:43` — включено в список пользовательской справки: `{ keys: "Ctrl+G", actionKey: "help.action.goToLine" }`.
  - `src/editor/keymap.ts:384` — `["Mod-g", handlers.goToLine]` зарегистрировано в `externalBindings`.
  - `src/state/actions.ts:51, 570` — `goToLine: () => invokeUi(dependencies.goToLine, notify)`.
  - `src/App.svelte:128-161` — в `createActions` аргумент `goToLine` **не передан**.
  - `src/ui/menuModel.ts` — пункт в меню полностью отсутствует.
- **Суть проблемы:** Команда ни к чему не подключена, UI диалога перехода к строке в приложении отсутствует. Нажатие `Ctrl+G` молча игнорируется.

---

### 4. Высокая: Опечатка подписи в меню для `View ▸ Zoom Out` (`Ctrl+±` вместо `Ctrl+-`)
- **Вероятность столкновения:** Высокая (любой пользователь, открывший меню View).
- **Файлы и строки:**
  - `docs/SPEC.md:480` — `Ctrl+±` — общее обозначение масштабирования (увеличение `+`, уменьшение `-`).
  - `src/editor/keymap.ts:385-387` — `Mod-+` и `Mod-=` вызывают `zoomIn`, а `Mod--` вызывает `zoomOut`.
  - `src/ui/menuModel.ts:134-135`:
    - `item("view.zoomIn", t("menu.zoomIn"), "Ctrl+±")`
    - `item("view.zoomOut", t("menu.zoomOut"), "Ctrl+±")`
- **Суть проблемы:** Пункт «Zoom Out» в меню подписан как `Ctrl+±` вместо `Ctrl+-`. Пользователь дезориентирован, видя одинаковый хоткей на увеличение и уменьшение.

---

### 5. Средняя: Перехват системного диалога печати `Ctrl+P` в WebView2
- **Вероятность столкновения:** Средняя (привычка пользователей Obsidian вызывать Quick Switcher по `Ctrl+P` или печать документа).
- **Файлы и строки:**
  - `docs/SPEC.md` — печать не предусмотрена и в горячих клавишах отсутствует.
  - `src/editor/keymap.ts` — сочетание `Ctrl+P` никак не перехватывается и не блокируется.
  - `src-tauri/src/windows.rs:360-394` — акселераторы WebView2 не фильтруются.
- **Суть проблемы:** При нажатии `Ctrl+P` браузерный движок WebView2 открывает стандартный диалог печати Chromium/Windows прямо поверх приложения, что выглядит как дефект сборки оболочки.

---

### 6. Средняя: Горячая клавиша `Ctrl+,` (Настройки) не описана в SPEC и не работает на русской раскладке
- **Вероятность столкновения:** Средняя (часто используется для открытия настроек).
- **Файлы и строки:**
  - `docs/SPEC.md:352-360, 438-483` — пункт настроек и сочетание `Ctrl+,` не упоминаются ни в составе меню File (п. 6.2), ни в горячих клавишах (раздел 8).
  - `src/ui/menuModel.ts:106` — пункт `file.settings` подписан как `Ctrl+,`.
  - `src/editor/keymap.ts:375-391, 393-422` — в keymap редактора `Mod-,` не зарегистрирован, в `physicalCodeNames` физический код `Comma` отсутствует.
  - `src/App.svelte:582-587`:
    ```ts
    function handleWindowKeydown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        settingsOpen = true;
      }
    }
    ```
- **Суть проблемы:**
  1. Реализация есть, но спецификация о ней умалчивает.
  2. Проверка завязана на `event.key === ","`. На нелатинских раскладках клавиатуры (например, русская раскладка, где на этой клавише находится буква «Б») сочетание `Ctrl+,` не срабатывает.

---

### 7. Средняя: Не описанные в спецификации клавиши поиска `F3` / `Shift-F3`
- **Вероятность столкновения:** Средняя (типичный хоткей навигации по совпадениям поиска в Windows).
- **Файлы и строки:**
  - `docs/SPEC.md:427, 476-477` — описаны только `Enter` и `Shift+Enter` внутри поисковой панели.
  - `src/editor/search.ts:419-420` — в `marknoteSearch` зарегистрированы:
    - `{ key: "F3", run: searchCommands.findNext }`
    - `{ key: "Shift-F3", run: searchCommands.findPrevious }`
- **Суть проблемы:** Поведение полезное и рабочее, но отсутствует в `docs/SPEC.md`.

---

### 8. Низкая: Различие логики `Ctrl+Shift+K` в меню и по клавише
- **Вероятность столкновения:** Низкая-средняя (при форматировании блоков кода через контекстное меню).
- **Файлы и строки:**
  - `docs/SPEC.md:470` — `Ctrl+Shift+K` — «Блок кода».
  - `src/editor/keymap.ts:343-360, 459` — функция `toggleCodeBlock`: оборачивает текущее выделение строками с тройными обратными кавычками ```` ``` ````, а если блок уже обёрнут — снимает обрамление.
  - `src/App.svelte:510, 564` — обработчик контекстного меню `format.codeBlock` вызывает `insertText("```\n\n```\n")`: просто вставляет пустой блок кода, игнорируя выделенный пользователем текст.
- **Суть проблемы:** Горячая клавиша выполняет умный toggle вокруг выделения, а пункт контекстного меню просто вставляет пустую заготовку.

---

### 9. Низкая: Различие `Ctrl+B`, `Ctrl+I`, `Ctrl+E` в меню и по клавише (unwrap toggle)
- **Вероятность столкновения:** Низкая.
- **Файлы и строки:**
  - `src/editor/keymap.ts:274-291, 452-454` — `toggleWrapper`: повторное нажатие хоткея на слове или выделении с маркерами снимает жирный/курсив/код (unwrap).
  - `src/App.svelte:548-552` — `wrapSelection`: повторный клик в контекстном меню не снимает маркеры, а вкладывает их ещё раз (`****слово****`).
- **Суть проблемы:** Рассинхронизация логики меню и keymap.

---

### 10. Информационное: Приоритет `Tab` / `Shift-Tab` в таблицах скрыт от Section 8
- **Вероятность столкновения:** Постоянно при редактировании таблиц.
- **Файлы и строки:**
  - `docs/SPEC.md:471` — заявлено только: `Tab / Shift+Tab` — «Уровень вложенности списка».
  - `src/editor/livePreview/tables.ts:135-138` — `tableKeymap` перехватывает `Tab` и `Shift-Tab` для перемещения между ячейками (`moveToCell`).
  - `src/editor/createEditor.ts:328-329` — `keymap.of(tableKeymap)` смонтирован **перед** общим keymap.
- **Суть проблемы:** Поведение правильное и удобное, но раздел 8 спецификации утверждает, что `Tab` управляет исключительно списками.

---

## 3. Анализ конфликтов обработчиков и платформенных перехватов

### 3.1. Внутренние конфликты сочетаний

1. **`Ctrl+0`: «Убрать заголовок» vs «Сброс масштаба»**
   - **Конфликт:** На одно сочетание претендуют две разные функции (`format.clearHeading` и `view.resetZoom`).
   - **Разрешение в коде:** В `src/editor/keymap.ts:313-327, 463-466` локальный обработчик `headingCommand(0)` проверяет, была ли строка заголовком (`#`). Если заголовок был удалён, команда возвращает `true` (событие поглощено). Если строка не была заголовком, команда возвращает `false`, и CodeMirror передаёт `Mod-0` следующему обработчику — `handlers.resetZoom` (`keymap.ts:388`).
   - **Оценка:** Реализация точно следует требованию `docs/SPEC.md:481` («Сброс масштаба — конфликт с „убрать заголовок“, масштаб уступает»). Однако в `menuModel.ts` оба пункта (`menuModel.ts:136` и `menuModel.ts:175`) подписаны как `Ctrl+0`.

2. **`Tab` / `Shift-Tab`: «Ячейка таблицы» vs «Отступ списка»**
   - **Конфликт:** Внутри таблицы нажатие Tab должно переходить к следующей ячейке, а не сдвигать строку вправо как список.
   - **Разрешение в коде:** В `src/editor/createEditor.ts:328-329` массив `keymap.of(tableKeymap)` зарегистрирован перед основным keymap. Функция `moveToCell` возвращает `false`, если курсор не находится в таблице (`tables.ts:115`), передавая обработку в `indent` (`keymap.ts:124`), который дополнительно проверяет `isInTable`.
   - **Оценка:** Конфликт разрешён надёжно и без багов, требуется лишь отразить это поведение в спецификации.

---

### 3.2. Конфликты со средой исполнения (Windows и WebView2)

1. **`Ctrl+P` (Печать Chromium)**:
   - WebView2 по умолчанию перехватывает `Ctrl+P` как системный акселератор браузера.
   - В MarkNote нет обработчика печати. Нажатие `Ctrl+P` в открытом окне приводит к неконтролируемому вызову системного окна предварительного просмотра печати Edge/Chromium.
   - Решение для будущего исправления: блокировать в `ICoreWebView2Controller::put_IsAcceleratorKeyEnabled` или через `event.preventDefault()` на уровне окна.

2. **`Ctrl+Shift+N` (InPrivate / Новое окно)**:
   - В стандартном Chromium это хоткей открытия окна в режиме Инкогнито. В некоторых сборках WebView2 он может перехватываться до того, как событие дойдёт до DOM-дерева, если акселераторы веб-вью не подавлены на стороне хоста.

3. **`Ctrl+Plus`, `Ctrl+Minus`, `Ctrl+0`, `Ctrl+Колёсико мыши` (Масштаб страницы WebView2)**:
   - В MarkNote масштабирование реализовано через размер шрифта в CodeMirror (`src/editor/zoom.ts:46-53`).
   - Однако WebView2 по умолчанию масштабирует весь viewport (включая шапку `TitleBar`, меню и статус-бар), если сочетания зума нажимаются вне фокуса редактора или если пользователь крутит колёсико мыши с зажатым `Ctrl`. `Ctrl+MouseWheel` в приложении сейчас не перехвачен.

4. **Системные клавиши отладки и обновления (`F5`, `Ctrl+R`, `F12`)**:
   - `F5` и `Ctrl+R` в незащищённом WebView2 вызывают перезагрузку страницы, что приведёт к мгновенной потере несохранённого документа в памяти.
   - `F12` / `Ctrl+Shift+I` открывают DevTools (если включены в сборке).

5. **Физические коды клавиш на нелатинских раскладках**:
   - В `src/editor/keymap.ts:393-431` реализован механизм `physicalShortcutName`, преобразующий `event.code` (`KeyB`, `KeyZ` и т.д.) в `Mod-b`, `Mod-z`. Это гарантирует работу хоткеев в редакторе на русской раскладке.
   - Однако глобальный обработчик `handleWindowKeydown` в `src/App.svelte:583` проверяет `event.key === ","`. На русской раскладке `event.key` равен `"б"` или `"?"`, из-за чего открытие настроек по `Ctrl+,` с клавиатуры не работает.
