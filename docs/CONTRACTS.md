# Внутренние контракты модулей

Документ фиксирует границы между параллельно разрабатываемыми модулями.
**Сигнатуры менять нельзя.** Если сигнатура не подходит — сообщить координатору,
а не править в одностороннем порядке.

Владение файлами (никто не трогает чужие файлы):

| Владелец | Файлы |
| --- | --- |
| W1 · Rust core | `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/windows.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/**` |
| W2 · Rust formats/IO | `src-tauri/src/formats/**`, `src-tauri/src/encoding.rs`, `src-tauri/src/atomic_write.rs`, `src-tauri/src/watcher.rs` |
| W3 · Frontend shell | `index.html`, `tsconfig.json`, `svelte.config.js`, `src/main.ts`, `src/App.svelte`, `src/editor/createEditor.ts`, `src/editor/keymap.ts`, `src/editor/theme.ts`, `src/state/**`, `src/ui/**`, `src/styles/**` |
| W4 · Разметка и предпросмотр | `src/editor/markdownExtensions.ts`, `src/editor/livePreview/**`, `tests/**`, `vitest.config.ts` |
| Координатор | `package.json`, `vite.config.ts`, `docs/**`, `README.md`, `ROADMAP.md` |

Нужна новая зависимость в `package.json` — не добавлять самостоятельно,
написать координатору в `worker_done`.

---

## 1. Rust: `formats`

```rust
// src-tauri/src/formats/mod.rs
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCapabilities {
    pub id: String,                  // "markdown", "plain", "json"
    pub label: String,               // "Markdown"
    pub default_extension: String,   // "md"  (без точки)
    pub extensions: Vec<String>,     // ["md", "markdown", "mdown", "mkd"]
    pub editable: bool,
    pub creatable: bool,
    pub live_preview: bool,
    pub autosave: bool,
    pub lossy: bool,
    pub syntax_mode: Option<String>, // "json" | "yaml" | ... | None
    pub template: String,            // заготовка нового документа
}

/// Все зарегистрированные форматы.
pub fn all() -> Vec<FormatCapabilities>;
/// Только те, у которых creatable == true. Порядок — как на стартовом экране.
pub fn creatable() -> Vec<FormatCapabilities>;
pub fn by_id(id: &str) -> Option<FormatCapabilities>;
/// Расширение без точки, регистр не важен. Неизвестное — формат "plain".
pub fn for_extension(ext: &str) -> FormatCapabilities;
pub fn for_path(path: &Path) -> FormatCapabilities;
```

В M3 в реестре ровно два формата: `markdown` и `plain`. Структура полей
закладывается целиком — M6 только дописывает записи реестра.

## 2. Rust: `encoding`

```rust
// src-tauri/src/encoding.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding { Lf, Crlf }

#[derive(Debug, Clone)]
pub struct Decoded {
    pub text: String,          // всегда с \n внутри
    pub encoding: String,      // "utf-8", "utf-16le", "windows-1251", ...
    pub bom: bool,
    pub line_ending: LineEnding,
}

/// UTF-8/UTF-16 BOM → по BOM; иначе chardetng. Переводы строк нормализуются в \n.
pub fn decode(bytes: &[u8]) -> Decoded;

/// Обратная операция: \n разворачивается в line_ending, BOM дописывается если был.
pub fn encode(text: &str, encoding: &str, bom: bool, line_ending: LineEnding) -> Vec<u8>;
```

## 3. Rust: `atomic_write`

```rust
// src-tauri/src/atomic_write.rs
/// Пишет во временный файл в той же папке, затем fs::rename поверх цели.
/// Никогда не открывает целевой файл на запись напрямую.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> anyhow::Result<()>;
```

## 4. Rust: `watcher`

```rust
// src-tauri/src/watcher.rs
pub struct FileWatcher { /* ... */ }

impl FileWatcher {
    pub fn new(app: tauri::AppHandle) -> Self;
    /// Начать следить за path, события адресуются окну window_label.
    pub fn watch(&self, window_label: &str, path: &std::path::Path);
    pub fn unwatch(&self, window_label: &str);
    /// Подавить события по пути на ~1.5 с — вызывается перед собственной записью.
    pub fn suppress(&self, path: &std::path::Path);
}
```

События в окно: `file-changed-externally` (payload `{ "path": String }`),
`file-deleted` (payload `{ "path": String }`).

## 5. IPC-команды (владелец — W1)

| Команда | Аргументы | Возвращает |
| --- | --- | --- |
| `open_file` | `path: String` | `OpenedFile` |
| `save_file` | `path, text, encoding, bom, lineEnding` | `SaveResult`; отказ с ошибкой, если `format.editable == false` |
| `save_as` | `text, formatId, suggestedName` | `Option<SaveResult>` (None — отмена) |
| `pick_file` | — | `Option<String>` |
| `new_document` | `formatId: String` | `NewDocument` |
| `list_creatable_formats` | — | `Vec<FormatCapabilities>` |
| `format_for_extension` | `ext: String` | `FormatCapabilities` |
| `read_image` | `docPath: Option<String>, src: String` | `String` (data-URL) |
| `open_in_new_window` | `path: String` | `()` |
| `reveal_in_explorer` | `path: String` | `()` |
| `take_pending_file` | — | `Option<String>` — путь, отложенный для этого окна |
| `respond_to_close` | `allow: bool` | `()` — ответ на `save-before-close` |

```ts
// то, что видит фронтенд (serde camelCase)
type OpenedFile = {
  path: string;
  text: string;
  encoding: string;
  bom: boolean;
  lineEnding: "lf" | "crlf";
  format: FormatCapabilities;
  readonly: boolean;
};
type SaveResult = {
  path: string;
  savedAt: string /* ISO */;
  format: FormatCapabilities;
  /** true — формат сохраняется с потерями и пользователя нужно предупредить
   *  (SPEC раздел 3.2). Для Markdown и простого текста всегда false. */
  lossyWarning: boolean;
};
type NewDocument = { text: string; format: FormatCapabilities };
```

Событие `open-file-request` с payload `{ "path": String }` — окно просят
открыть файл (аргумент командной строки, второй запуск, проводник).

**Важно про старт.** Событием пользоваться можно только для окон, которые
уже живут. При первом запуске `setup` отрабатывает раньше, чем webview
загрузит Svelte, а события Tauri не буферизуются — отправленное в этот
момент событие теряется, и файл из аргумента не открывается. Поэтому путь,
предназначенный окну, складывается на стороне Rust, а фронтенд забирает его
командой `take_pending_file` сразу после того, как подписался на событие.
Открытие обязано быть идемпотентным: если путь придёт и событием, и
командой, файл открывается один раз.

**Закрытие окна.** Окно не закрывается само: Rust перехватывает
`CloseRequested`, отменяет закрытие и шлёт в окно `save-before-close`.
Фронтенд обязан ответить командой `respond_to_close`: `true` после
сохранения, автосохранения или явного «Discard», `false` на «Cancel».
Если ответа нет пять секунд, окно закрывается принудительно — зависший
webview не должен делать окно неубиваемым. Это единственный модальный
диалог во всей программе (SPEC раздел 2.3).

## 6. Frontend: границы W3 ↔ W4

W4 отдаёт, W3 потребляет:

```ts
// src/editor/markdownExtensions.ts
import type { MarkdownExtension } from "@lezer/markdown";
/** ==подсветка==, %%комментарий%%, $формула$, $$блок$$, > [!NOTE], [^1] */
export const marknoteMarkdown: MarkdownExtension[];

// src/editor/livePreview/index.ts
import type { Extension } from "@codemirror/state";
export function livePreview(opts?: {
  /** Выше этого размера документа предпросмотр выключается. По умолчанию 5 МБ. */
  maxBytes?: number;
  /** Отдаёт data-URL для картинки, относительной к документу. */
  resolveImage?: (src: string) => Promise<string>;
}): Extension;
```

W3 отдаёт, W4 потребляет (только типы, не реализацию):

```ts
// src/state/formats.svelte.ts
export type FormatCapabilities = { /* см. раздел 1, camelCase */ };
```

`createEditor` — владение W3:

```ts
// src/editor/createEditor.ts
export type EditorStats = {
  line: number; col: number;
  lines: number; words: number; chars: number;
  selection: null | { fromLine: number; toLine: number; words: number; chars: number };
};

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  format: FormatCapabilities;
  /** Нужен для разрешения относительных ссылок на картинки. null — документ
   *  ещё не сохранён, относительные ссылки разрешить нельзя. */
  path?: string | null;
  onChange: (doc: string) => void;
  onStats: (stats: EditorStats) => void;
}): import("@codemirror/view").EditorView;

/** Меняет путь у живого редактора без пересборки расширений: после
 *  «Сохранить как» ссылки должны разрешаться относительно новой папки. */
export function setEditorDocumentPath(
  view: import("@codemirror/view").EditorView,
  path: string | null,
): void;

// src/editor/imageResolver.ts
/** data: и http(s) отдаются как есть; относительный путь читается командой
 *  read_image. Кэш по паре «путь документа + ссылка», сбрасывается при
 *  смене документа. */
export function createImageResolver(
  docPath: string | null,
): (src: string) => Promise<string>;
```

## 7. Общие правила

- Никаких заглушек и `todo!()` в путях, которые обещаны как готовые.
- Rust: `cargo check` без ошибок перед завершением (варнинги допустимы).
- TypeScript: `npx tsc --noEmit` / `npm run check` без ошибок по своим файлам.
- Комментарии по-русски, как в остальном проекте.
- Тёмная тема одна; токены берутся из `src/styles/theme.css`, новых цветов
  «от себя» не вводить.

## 8. Порядок работ и заглушки

В каталоге одновременно работают четыре агента. Чтобы никто не ждал:

**Поставщик API создаёт заглушки первым делом.** W2 и W4 в первые минуты
создают все свои файлы с финальными сигнатурами из этого документа и
тривиальным телом (`unimplemented!()` / пустой `Extension`), сразу проверяют,
что проект компилируется, и только потом наполняют их. Потребители (W1 и W3) к
этому моменту ещё пишут свой каркас.

Правила совместной работы в одном каталоге:

- Чужие файлы не редактировать и не удалять — даже чтобы «быстро починить».
- `git commit`, `git add`, любые команды git — не запускать, коммитит координатор.
- `package.json`, `vite.config.ts` — не трогать, нужна зависимость → в `worker_done`.
- `npm run tauri dev` и `npm run dev` не запускать: порт 1420 один на всех.
  Проверки: `cargo check`, `npx tsc --noEmit`, `npm run build`, `npx vitest run`.
- Ошибка компиляции в чужом файле — это не твоя задача. Убедись, что твои файлы
  чисты, и упомяни чужую ошибку в отчёте.

## 9. Подключаемые построители декораций (веха M4)

Блочные элементы M4 пишутся отдельными модулями параллельно с плагином M2.
Общий тип — в `src/editor/livePreview/types.ts` (владелец: координатор).

```ts
export type DecoSink = (deco: Range<Decoration>) => void;
export type BuilderContext = {
  view: EditorView;
  node: SyntaxNode;
  active: boolean;   // результат isNodeActive, своего правила не изобретать
  add: DecoSink;     // replace / mark / widget
  atomic: DecoSink;  // диапазоны для EditorView.atomicRanges
};
export type BlockBuilder = (ctx: BuilderContext) => boolean; // true — узел обработан
```

Модули и их владельцы:

| Файл | Экспорт | Владелец |
| --- | --- | --- |
| `src/editor/livePreview/tables.ts` | `tableBuilder: BlockBuilder` | W5 |
| `src/editor/livePreview/codeBlocks.ts` | `codeBlockBuilder: BlockBuilder` | W5 |
| `src/editor/livePreview/callouts.ts` | `calloutBuilder: BlockBuilder` | W6 |
| `src/editor/livePreview/footnotes.ts` | `footnoteBuilder: BlockBuilder` | W6 |

`plugin.ts` (владелец W4) при обходе дерева зовёт построители по порядку и
останавливается на первом, вернувшем `true`. Если построитель ещё не создан —
его просто нет в списке; сборка от этого не ломается.

## 10. Поиск и замена (веха M5)

| Файл | Экспорт | Владелец |
| --- | --- | --- |
| `src/editor/search.ts` | `marknoteSearch(): Extension`, `searchCommands` | W7 |
| `src/ui/FindPanel.svelte` | компонент панели | W7 |

Исключение из владения W3: эти два файла его не касаются, остальной `src/ui/**`
по-прежнему за ним.

## 11. Адаптеры форматов сверх реестра M3 (веха M6)

| Файл | Экспорт | Владелец |
| --- | --- | --- |
| `src-tauri/src/formats/extra.rs` | `pub fn adapters() -> Vec<Box<dyn FormatAdapter>>` | W8 |
| `src-tauri/src/formats/code.rs` | адаптер «код и данные» | W8 |
| `src-tauri/src/formats/json.rs` | адаптер JSON | W8 |

Реестр в `formats/mod.rs` (владелец W2) подмешивает `extra::adapters()` к своим
двум встроенным адаптерам. Пока файла нет — реестр работает на двух форматах.
