# Internal module contracts

This document records boundaries between modules developed in parallel.
**Signatures must not change.** If a signature is unsuitable, tell the
coordinator instead of changing it unilaterally.

| Owner | Files |
| --- | --- |
| W1 · Rust core | src-tauri/build.rs, main.rs, lib.rs, commands.rs, windows.rs, Cargo.toml, tauri.conf.json, capabilities/** |
| W2 · Rust formats/IO | src-tauri/src/formats/**, encoding.rs, atomic_write.rs, watcher.rs |
| W3 · Frontend shell | index.html, tsconfig.json, svelte.config.js, src/main.ts, App.svelte, editor, state, ui, styles |
| W4 · Markup and preview | src/editor/markdownExtensions.ts, src/editor/livePreview/**, tests/**, vitest.config.ts |
| Coordinator | package.json, vite.config.ts, docs/**, README.md, ROADMAP.md |

Do not add a package.json dependency independently; report it to the coordinator.

## 1. Rust format contract

FormatCapabilities has id, label, default_extension, extensions, editable,
creatable, live_preview, autosave, lossy, optional syntax_mode, and a
new-document template. all() returns every registered format; creatable()
returns only formats with creatable true in start-screen order; by_id() looks up
an identifier; for_extension() is case-insensitive and falls back to plain;
for_path() selects by filename. Milestone M3 has markdown and plain; later
milestones add registry entries without changing the structure.

## 2. Encoding contract

LineEnding is either Lf or Crlf. Decoded contains normalized text (internal LF),
encoding, BOM presence, and the original line ending. decode detects UTF-8/UTF-16
BOMs or uses chardetng and normalizes endings. encode restores the requested
encoding, line ending, and BOM.

## 3. Atomic writes and watcher

write_atomic writes a temporary file in the same directory, flushes it to disk,
and replaces the target without opening the target directly for writing. FileWatcher watches
a path for a window, removes a watch, and suppresses our own write for about
1.5 seconds. Events are file-changed-externally and file-deleted, each carrying
a path string.

## 4. IPC commands (owner: W1)

open_file(path) returns OpenedFile. save_file(path, text, encoding, bom,
lineEnding) returns SaveResult and rejects non-editable formats. save_as(text,
formatId, suggestedName) returns an optional SaveResult. pick_file returns an
optional path. new_document returns NewDocument. list_creatable_formats and
format_for_extension expose the format registry. read_image(docPath, src)
returns a validated local-image URL. open_in_new_window, reveal_in_explorer, and
respond_to_close return unit. take_pending_file returns queued startup paths.
take_recovery_entries returns journal snapshots to the first window;
write_recovery_snapshot atomically persists one dirty tab; delete_recovery_snapshot
removes a clean or closed tab; delete_recovery_entry removes a restored source
after its new tab snapshot is durable. get_settings, save_settings, reset_settings,
get_resolved_language, and reveal_settings_file implement the settings contract.

| Recovery command | Result |
| --- | --- |
| `take_recovery_entries` | `()` → `[RecoveryEntry]` (first window only) |
| `write_recovery_snapshot` | `(snapshot)` → `()` |
| `delete_recovery_snapshot` | `(tabId)` → `()` |
| `delete_recovery_entry` | `(id)` → `()` |

OpenedFile contains path, text, encoding, BOM, lineEnding, the file's base
fingerprint, FormatCapabilities, and readonly. SaveResult contains path, ISO
savedAt, the post-save fingerprint, format, and lossyWarning. Recovery entries
include version, path, title, formatId, encoding, lineEnding, text, updatedAt,
and the base fingerprint used to avoid overwriting a changed file.
NewDocument contains template text and format.

The open-file-request event carries a path. During first startup events are not
buffered, so Rust queues the path and the frontend calls take_pending_file
after subscribing. Opening is idempotent when both event and command deliver it.

save_file compares timestamp and size captured at open time. A changed file
returns code file-conflict without writing; the frontend offers Reload or Keep
mine. read_image accepts a relative path inside the document folder, rejects
traversal, external symlinks, device paths, and files over 16 MiB.

Rust intercepts CloseRequested and sends save-before-close. The frontend answers
respond_to_close with true after Save, autosave, or Discard and false after
Cancel. A five-second timeout prevents a hung WebView from blocking close.

## 5. Frontend W3/W4 boundary

W4 provides the marknote Markdown extension for highlight, comments, inline and
block formulas, callouts, footnotes, and other custom nodes. It also provides
livePreview with maxBytes (default 5 MiB) and resolveImage callbacks. W3
provides FormatCapabilities.

createEditor accepts a parent element, document text, format, optional document
path, onChange, and onStats, returning an EditorView. setEditorDocumentPath
updates the live path without rebuilding extensions. createImageResolver returns
data/http URLs as-is, resolves relative paths through resolve_image, caches by
document path plus source, and clears the cache on document change.

### Attachment IPC additions

| Command | Result |
| --- | --- |
| `save_attachment` | `(docPath, fileName, data)` → `{ src, path, cached }` |
| `save_attachment_from_path` | `(docPath, sourcePath)` → `{ src, path, cached }` |
| `resolve_image` | `(docPath, src)` → `string` |
| `promote_attachments` | `(docPath, srcs)` → `[{ from, to }]` |
| `attachment_cache_stats` | `()` → `{ files, bytes, path }` |
| `clear_attachment_cache` | `()` → `{ files, bytes }` |
| `reveal_attachment_cache` | `()` → `()` |
| `open_image` | `(docPath, src)` → `()`: opens an http(s) image, or an image file inside the document folder or the attachment cache, in the default Windows program; anything else is refused |

### Spellcheck IPC additions

| Command | Result |
| --- | --- |
| `spellcheck_languages` | `()` → `[{ tag, name }]` |
| `spellcheck_check` | `(text, languages)` → `[{ from, to }]` |
| `spellcheck_suggest` | `(word, languages, limit)` → `[string]` |
| `spellcheck_add_word` | `(word, languages)` → `()` |

Spellcheck language tags are the bundled set `en`, `ru`, `de`, `es`, `fr`,
`it`, `pt`, and `ar`, in that order. Check ranges use UTF-16 code units.
Words are checked only against selected dictionaries for their script and are
correct when any such dictionary accepts them; unsupported tags are ignored.
Suggestions merge matching-script dictionaries, preserve input capitalization,
and keep candidates within the best Damerau-Levenshtein distance (plus one for
words of at least seven letters), capped at distance three and the requested
upper bound. Added words are saved in the application config directory by
language.

## 6. Shared rules

No stubs or todo implementations may remain in paths promised as complete.
cargo check and npx tsc --noEmit must pass. Product documentation and comments
are written in English. There is one dark theme; use tokens from
src/styles/theme.css and do not invent colors. Never edit another owner’s
files; the coordinator runs Git commands. Do not touch package.json or
vite.config.ts without reporting it. Do not run the shared development servers.

## 7. Decoration builders and search

W4 block builders share BuilderContext and return true when they handle a node.
Tables and code blocks belong to W5; callouts and footnotes belong to W6. W7
owns src/editor/search.ts and src/ui/FindPanel.svelte and exports the search
extension and commands.

## 8. Format adapters and settings

W8 owns extra.rs, code.rs, and json.rs adapters and exposes adapters() for the
W2 registry. Settings sections use separate files: settingsCompartment,
editorSettingsExtensions, and applyEditorSettings belong to the coordinator;
appearance belongs to W85, preview to W86, and spellcheck/autocorrect to W87.
settings.ts combines the results. A null settings value means settings are not
loaded and must preserve old hard-coded behavior. Do not add Settings fields
without updating docs/SETTINGS.md and the settings window.

## 9. Tabs

Tabs supersede the former one-window/one-file principle. Explorer opening still
uses a new window, except that an empty start window is reused. A permanent tab
bar sits between menu and editor; each tab shows its filename (or initial words
for an untitled document) and format. The plus button opens the start screen
for a new format or dropped file. Closing the last tab closes the window with
the normal unsaved-changes prompt.

workspace.svelte.ts owns tab-set state, document.svelte.ts exposes the active
documentState view, autosave is per-tab, TabBar owns the tab bar, App.svelte
places it and handles events, and createEditor owns per-tab editor state.
documentState keeps its old readable and mutable fields while becoming a view
of the active tab. Do not create a second text store, lose history or cursor
position on tab switches, autosave inactive tabs on the active timer, or hide
the tab bar when only one tab exists.
