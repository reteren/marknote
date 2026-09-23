# Architecture

---

## 1. Overview

```
┌─────────────────────── MarkNote process ────────────────────────┐
│                                                                 │
│  Rust                                                           │
│  ├─ main.rs          entry point, single-instance, arguments    │
│  ├─ windows.rs       window creation, open routing              │
│  ├─ commands.rs      IPC commands for the frontend              │
│  ├─ watcher.rs       watching files on disk                     │
│  ├─ atomic_write.rs  writing through a temporary file           │
│  └─ formats/         format adapters                            │
│         ↕ IPC (commands and events)                             │
│  WebView2 · window 1        WebView2 · window 2                 │
│  ├─ Svelte shell             └─ same                            │
│  ├─ CodeMirror 6                                                │
│  │   ├─ live preview                                            │
│  │   ├─ markdown + lezer                                        │
│  │   └─ search, history, keybindings                            │
│  └─ menus, status bar, context menu                             │
└─────────────────────────────────────────────────────────────────┘
```

One process, multiple windows. Each window is a separate WebView2 instance, but
the runtime is shared, so the second window opens noticeably faster than the first.

---

## 2. Why this stack

### Tauri instead of Electron
The installer is about 5 MB rather than 80+. Cold start is several times faster
because WebView2 is already loaded on the system. For an application whose
purpose is opening files quickly, that is decisive.

### Tauri instead of pure Rust with egui or Win32
Live preview is text layout: mixed fonts, embedded images, formulas, and tables.
The browser already has a working layout engine; writing one would take months.

### Windows file icons
The NSIS installer bundles `icons/document.ico` as `document.ico` and sets each
Tauri file association ProgId's `DefaultIcon` to that file. Generated installer
hooks remove those overrides on uninstall and call `UPDATEFILEASSOC` so Explorer
refreshes its association cache. The app, window, installer, and uninstaller
continue to use `icons/icon.ico`.

### CodeMirror 6 instead of Monaco or a custom solution
CodeMirror builds its display through decorations. `Decoration.replace` removes a
text range from the display without touching the document, while
`EditorView.atomicRanges` makes the cursor jump over hidden content. This is the
mechanism that makes live preview honest. Monaco is optimized for code and does
not provide a way to hide parts of a line. Obsidian also uses CodeMirror 6.

### `@lezer/markdown` instead of `markdown-it` or `remark`
The parser is incremental: changing one letter rebuilds only the affected branch
of the tree rather than the whole document. When decorations are recalculated on
every keystroke, that is the difference between smooth input and lag.

### Svelte instead of React
Around CodeMirror we need only menus, the search panel, and the status bar. Svelte
compiles to direct DOM operations without a runtime or virtual tree, so there is
no unnecessary layer between input and the screen.

### KaTeX instead of MathJax
It renders synchronously and is an order of magnitude faster. Its LaTeX coverage
is sufficient for notes.

---

## 3. Live preview

The heart of the project. The entire mechanism lives on the CodeMirror side.

### Flow

```
document changed or the cursor moved
        ↓
ViewPlugin.update()
        ↓
walk syntaxTree within view.visibleRanges
        ↓
for each node: isNodeActive(node, selection)?
        ↓                              ↓
      yes                             no
        ↓                              ↓
show source text             Decoration.replace on markers
      + highlighting         + Decoration.mark on content
                             + Decoration.widget where a custom
                               element is needed (checkbox, formula,
                               image, rule)
        ↓
DecorationSet → display
```

### Three decoration types

| Type | Where it is used |
| --- | --- |
| `Decoration.replace` | Hides markers: `**`, `#`, `` ` ``, `==`, `$` |
| `Decoration.mark` | Styles content: bold, italic, heading color |
| `Decoration.widget` | Inserts a custom element: task checkbox, rendered formula, image, horizontal rule, or callout icon |

### Reveal rule

All logic lives in one function; otherwise different node types inevitably
drift in behavior:

```ts
function isNodeActive(node: SyntaxNode, sel: EditorSelection): boolean {
  return sel.ranges.some(r => r.from <= node.to && r.to >= node.from);
}
```

Both boundaries are inclusive: a cursor placed directly next to `**` already
reveals the node. This matches Obsidian and makes editing easier.

For headings, lists, and blockquotes, the check expands to the whole line because
their markers belong to the line rather than to a text fragment.

### Performance

- Walk only through `view.visibleRanges`, not the whole document.
- Cache rendered formulas by source text so KaTeX is not called again.
- Languages for code blocks load on demand through
  `@codemirror/language-data`.
- Above 5 MB, preview is disabled entirely.

Target: entering a character in a 10,000-line file fits in one frame,
16 ms.

---

## 4. IPC

Frontend commands to Rust:

| Command | Arguments | Returns |
| --- | --- | --- |
| `open_file` | `path` | text, encoding, line-ending type, format capabilities |
| `save_file` | `path`, `text` | result |
| `save_as` | `text`, `format_id`, suggested name | selected path and resulting type |
| `pick_file` | — | path or cancellation |
| `open_in_new_window` | `path` | — |
| `new_document` | `format_id` | template text and format capabilities |
| `list_creatable_formats` | — | type list for the start screen and `New` menu |
| `format_for_extension` | `ext` | `format_id` and capabilities |
| `read_image` | `path` relative to the document | data URL |
| `reveal_in_explorer` | `path` | — |

Rust events to the frontend:

| Event | Meaning |
| --- | --- |
| `file-changed-externally` | File changed on disk |
| `file-deleted` | File deleted or renamed |
| `open-file-request` | Window was asked to open a file (from arguments or Explorer) |
| `save-before-close` | Window is closing and the buffer must be written |

Format capabilities received by the frontend on open:

```ts
type FormatCapabilities = {
  id: string;                 // "markdown", "json", "rtf"
  label: string;              // "Markdown" — shown in the status bar
  defaultExtension: string;   // "md"
  extensions: string[];       // all extensions for this type
  editable: boolean;          // whether it can be edited
  creatable: boolean;         // whether it can be created from scratch
  livePreview: boolean;       // whether to enable Markdown preview
  autosave: boolean;          // whether it can be saved without prompting
  lossy: boolean;             // whether saving loses anything
  syntaxMode: string | null;  // highlighting for non-Markdown
  template: string;           // template for a new document, usually empty
};
```

The frontend knows nothing about formats beyond this structure; all logic is in
Rust. The start screen, `File ▸ New` menu, type switcher in the status bar, and
save-dialog filters are built from the same list returned by
`list_creatable_formats`. Adding a format is one registry entry on the Rust side;
the frontend does not need to change.

### Document state

```ts
type DocumentState = {
  path: string | null;        // null — the document has not been saved yet
  format: FormatCapabilities;
  saveStatus: "unsaved" | "pending" | "saved" | "readonly";
  lastSavedAt: Date | null;
};
```

`path === null` is the only condition that disables autosave regardless of format.
The same field controls the appearance of the `Save` and `Save as…` buttons.
An independent recovery journal atomically snapshots every dirty tab, including
untitled and autosave-disabled tabs, after 300 ms idle with a one-second max wait;
startup restores a matching path as a dirty file tab and opens a changed or
missing path as an untitled “(recovered)” tab. Source entries are removed only
after the replacement tab snapshot is durable; clean and closed tabs are removed
from the journal so a normal quit leaves it empty.

---

## 5. File structure

```
src/
├─ main.ts                    entry point
├─ App.svelte                 window shell
├─ editor/
│  ├─ createEditor.ts         CodeMirror instance construction
│  ├─ livePreview/
│  │  ├─ plugin.ts            ViewPlugin, decoration construction
│  │  ├─ isNodeActive.ts      reveal rule
│  │  ├─ inline.ts            bold, italic, code, highlights, comments
│  │  ├─ blocks.ts            headings, lists, blockquotes, callouts
│  │  └─ widgets/
│  │     ├─ Checkbox.ts
│  │     ├─ Math.ts
│  │     ├─ Image.ts
│  │     └─ Hr.ts
│  ├─ markdownExtensions.ts   ==highlights==, %%comments%%, callouts, footnotes
│  ├─ keymap.ts               keybindings
│  └─ theme.ts                CodeMirror theme
├─ ui/
│  ├─ MenuBar.svelte
│  ├─ SaveControls.svelte     status indicator + Save and Save as buttons
│  ├─ StartScreen.svelte      new-file type selection
│  ├─ FormatPicker.svelte     type list: start screen, menu, status bar
│  ├─ ContextMenu.svelte
│  ├─ StatusBar.svelte
│  ├─ FindPanel.svelte
│  └─ Notice.svelte           top notification strip
├─ state/
│  ├─ document.svelte.ts      path, content, type, save state
│  ├─ formats.svelte.ts       type list received from Rust
│  └─ autosave.ts             save timer and triggers
└─ styles/
   ├─ theme.css               design tokens
   └─ markdown.css            markup appearance

src-tauri/src/
├─ main.rs
├─ windows.rs
├─ commands.rs
├─ watcher.rs
├─ atomic_write.rs
├─ encoding.rs                encoding and line-ending detection
└─ formats/
   ├─ mod.rs                  FormatAdapter trait, registry, and dispatcher
   ├─ markdown.rs
   ├─ plain.rs
   ├─ code.rs
   ├─ rtf.rs
   └─ pdf.rs
```

---

## 6. Markdown syntax extensions

`@lezer/markdown` does not know some Obsidian markup. Missing syntax is described
as a `MarkdownExtension` in `markdownExtensions.ts`:

- `==highlight==` — an `InlineParser` rule modeled on strikethrough
- `%%comment%%` — the same, with a muted style
- `$formula$` and `$$block$$` — inline and block math rules
- `> [!TYPE]` — an extension over blockquote parsing: the first line is
  recognized as a callout heading
- `[^1]` and `[^1]: text` — footnotes and their definitions

Covered by the standard parser: headings, lists, tasks, tables, code blocks,
blockquotes, links, images, `**`, `*`, `~~`, and `` ` ``.

---

## 7. Window management

Command-line arguments arrive in `main.rs` on the first launch and through
`tauri-plugin-single-instance` on subsequent launches.

```
file path received
        ↓
already open in a window? ──yes──→ raise the window and focus it
        ↓ no
an empty untouched window exists? ──yes──→ load it there
        ↓ no
create a new window
```

The open-file registry lives in `Mutex<HashMap<PathBuf, WindowLabel>>`.
Paths are canonicalized before comparison; otherwise `C:\Dir\file.md` and
`c:\dir\FILE.MD` would produce two windows for one file.

Window size and position are saved through `tauri-plugin-window-state`. This is
not a setting but a memory of the last state; a settings window is still not
needed.

---

## 8. Known pitfalls

**The watcher catches its own write.** After each save, the path enters an ignore
list for one second; otherwise autosave would loop.

**The cursor gets stuck in hidden markup.** This is fixed only through
`EditorView.atomicRanges`. Hand-written arrow-key handling breaks mouse
selection, `Home`, `End`, and `Ctrl+←`.

**Widgets are recreated on every update.** `WidgetType` subclasses must implement
`eq()`, otherwise images will flicker on every keystroke.

**Image paths.** Windows separators and spaces in names break `file://`. Images
are returned from Rust as data URLs, which is both simpler and safer.

**Encoding on save.** A file opened as CP1251 and saved as UTF-8 without warning
has lost data from the user's perspective. The encoding is remembered on open and
applied on write.

**Dark title bar.** Windows 10 before 1809 does not support
`DWMWA_USE_IMMERSIVE_DARK_MODE`. The call is guarded by a version check;
otherwise the title bar remains white on older builds.
