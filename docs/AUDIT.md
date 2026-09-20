# MarkNote codebase/specification conformance audit

**Audit date:** 2026-09-16
**Sources:** `docs/SPEC.md`, `docs/SETTINGS.md`, `README.md`, `ROADMAP.md`,
and the current source
**Reviewing agent:** W91 (pre-release review for 1.0.6)

This review was performed by reading source and documentation. The application
was not launched, so properties requiring a real WebView2 are marked as not
runtime-verified; the status below describes whether the corresponding route
exists in the code.

## 1. Results summary

The audit checked **85 claims**:

| Verdict | Count |
| :---: | ---: |
| **PRESENT** | 72 |
| **PARTIAL** | 13 |
| **ABSENT** | 0 |

There are no remaining ABSENT items. The `recentFiles` option and recent-file
display are implemented (W122), Rust owns `recent-files.json`, missing files
are filtered, and the settings window can clear the history. The remaining
PARTIAL items require manual acceptance.

Compared with the old audit, `createActions` now passes shell handlers to
CodeMirror, format changes use a Compartment, the registry includes EPUB, JSON
commands are registered, and read-only formats can be exported to Markdown.
Ctrl+G, JSON tools, the loss warning, and the `files` settings were marked
in-progress while the audit was being written; commits d6a9586 and ad4c3e9
landed them before release and their verdicts were raised to PRESENT.

> **W104 note:** old item 1.1 was marked OBSOLETE after tabs appeared. The
> summary counts describe the historical W91 state and do not recalculate that
> line.

---

## 2. Section-by-section audit of `docs/SPEC.md`

### Sections 1–2: principles, launch, and opening files

- English remains the default language, but Settings offers ten locales:
  `en`, `ru`, `de`, `es`, `pt`, `it`, `fr`, `zh`, `ja`, and `ar`.
- The single dark theme and absence of a theme selector match the code.
- The settings window exists and is intentionally broader than the original
  “no settings window” wording; `SettingsWindow.svelte` contains language,
  spellcheck, editor, preview, files, window, and other settings.
- Markdown file associations and single-instance routing are implemented.
  Existing-window raising is configurable through `raiseExistingWindow`.
- The empty-window start screen lists creatable formats. `More…` reveals
  additional editable types; PDF, DOCX, and EPUB remain read-only.
- Creating a file produces `Untitled.ext` and a new document defaults to
  Markdown. Save and Save As preserve the selected type.
- Selecting a type in the status bar preserves text, cursor, and undo history
  through the editor Compartment.
- Dropping a file into an empty window reuses that window; additional files
  route separately. Native titles are `name.ext — MarkNote` or
  `Untitled.ext — MarkNote`.

### Section 3: saving

- Autosave applies only to saved, writable, lossless formats and waits two
  seconds after input.
- Blur, close, and external events have autosave routes, but they require
  runtime verification.
- Dirty or non-empty untitled documents offer Save / Discard / Cancel.
- Save and Save As expose Unsaved / Saving / Saved / Error states.
- RTF warns about formatting loss before writing and offers Save anyway or Save
  as Markdown; the warning is shown once per document.
- Writes use a temporary file and atomic replacement, preserve encoding and
  CRLF/LF, and suppress the file watcher’s own writes.
- Clean-buffer reload, dirty-buffer Reload/Keep mine, and deleted-file notice
  are implemented. Automatic cursor/scroll preservation and WebView2 behavior
  still need runtime acceptance.

### Section 4: editor

- Live preview, cursor/selection reveal, the centered 81ch column, and visual
  wrapping are implemented.
- Undo/redo uses unlimited history. Tab/Shift+Tab indent lists, insert four
  spaces outside lists, and move between table cells.
- Enter continues or exits lists and preserves code blocks and quotes.
- Auto-pairing and Ctrl+B/I/E wrappers use the shared editor keymap.

### Section 5: supported Markdown

- Inline bold, italic, strike, highlight, code, math, comments, links,
  images, and footnotes have parser/decorator/widget routes.
- Block headings, lists, tasks, quotes, callouts, horizontal rules, code and
  math blocks, tables, and footnotes are implemented.
- All nine callout types are normalized, with unknown types rendered as Note.
- Checkbox clicks dispatch a document replacement and enter editor history.
- Images use document-relative paths, column limits, and a broken-image
  fallback; the Rust command enforces a 16 MiB limit.

### Sections 6–8: interface, search, and shortcuts

- The shell mounts the title bar, menus, Save controls, editor, status bar,
  FindPanel, ContextMenu, notices, format picker, and Help dialog.
- File/Edit/View/Help menus and context formatting are implemented. The
  specification still contains conflicting wording about a top-level Format
  menu; the current UI intentionally keeps formatting in ContextMenu.
- The custom context menu prevents the native WebView2 menu and selects
  commands by target (selection, link, image, or empty area).
- StatusBar reports format, constraints, cursor position, lines, words, and
  characters according to the specification.
- Ctrl+F/H, Enter/Shift+Enter, Escape, case/whole-word/regex options, Replace,
  and Replace All are wired to the CodeMirror document.
- Ctrl+N, Ctrl+Shift+N, Ctrl+G, Ctrl+, and the format toggles are now wired.
  F3/Shift+F3 work in search but are not yet listed in the specification.
  Ctrl+0 deliberately gives heading removal priority and falls back to zoom.

### Section 9: limits

- Preview is disabled above 5 MiB, but the status bar does not yet display the
  reason.
- Binary files are rejected before opening.
- Data and HTTP(S) images are allowed under the image contract; absolute and
  external file URLs are rejected.
- WebView2 supplies spellchecking and Windows chooses its dictionary from the
  system interface language; there is no effective per-document dictionary
  selector.

---

## 3. Additional promises from `docs/SETTINGS.md`

Storage, atomic writes, defaults, damaged-file quarantine, interface language,
RTL layout, spellcheck/autocorrect, editor appearance, live preview, size and
position, and `raiseExistingWindow` are implemented. Autosave and file
transforms are wired to the settings state.

The startup action is still PARTIAL: the empty window shows the start screen,
and recent files are stored and displayed, but the generic `startupAction`
field must be checked in a complete runtime launch. Reset, reveal-settings,
and version controls are implemented.

---

## 4. Format audit

The registry contains two base formats plus nineteen additional formats, with
seventeen creatable types. Markdown supports `.md`, `.markdown`, `.mdown`,
`.mkd`, and `.mdx`. Plain text includes `.txt`, `.log`, `.ini`, `.cfg`,
`.conf`, `.env`, `.csv`, `.tsv`, and `.text`. JSON and code formats load
syntax highlighting on demand and preserve their text.

JSON validation/format commands are registered in Rust and shown only for JSON.
RTF uses the lossy adapter and warning flow. PDF, DOCX, and EPUB extract
read-only Markdown and offer Save as Markdown.

---

## 5. Cross-layer contracts

The UI mounts MenuBar, StartScreen, StatusBar, FindPanel, ContextMenu, Notice,
SaveControls, FormatPicker, and HelpDialog in `App.svelte` and passes their
callbacks/actions. Rust registers file, window, format, settings, image, and
JSON commands. Open-file, external-change, deletion, and save-before-close
events are emitted and consumed by the corresponding frontend state.
These paths were not runtime-verified in this audit.

---

## 6. Documentation discrepancies

1. README still says “without unnecessary settings”, while SETTINGS documents
   the deliberate full settings window.
2. SPEC says the interface is English-only, while SETTINGS and the UI expose
   ten locales.
3. SPEC describes English spellchecking, while SETTINGS correctly explains
   that Windows/WebView2 chooses the dictionary.
4. SPEC contains contradictory top-level Format-menu wording; the source uses
   context formatting.
5. README and ROADMAP count twenty formats and omit EPUB; the current registry
   contains twenty-one, including EPUB.
6. README and ROADMAP omit several plain-text extensions that `plain.rs`
   supports.
7. README and ROADMAP still call JSON tools, RTF warnings, and read-only
   Markdown export unfinished even though they are implemented.
8. README and ROADMAP say saving a deleted file is blocked; the current command
   allows recreation and has a test.
9. README and ROADMAP contain stale version and release-status references.
10. ROADMAP describes window-size persistence without mentioning the
    `windows.rememberSizeAndPosition` setting.

---

## 7. Not runtime-verified

The application was not launched. The remaining manual checks are:

- double-click/single-instance routing, window raising, focus, and file drop;
- visual live preview, tables, KaTeX, images, and RTL;
- Ctrl+N/O/S/W, Ctrl+G, F3, and the Ctrl+0 CodeMirror conflict;
- cursor/scroll preservation on external changes, close handshake, and
  recreation of a deleted file;
- large-file preview disabling, WebView2 spellcheck dictionary, and color
  contrast.

These are not marked ABSENT because the corresponding source routes exist;
they need one controlled pre-release run.

## 8. Release conclusion

No items are ABSENT. Remaining PARTIAL items are the RTF warning, JSON tools,
Ctrl+G acceptance, startup-action coverage, file settings, the large-preview
reason in StatusBar, automatic selection preservation, and the Ctrl+0 runtime
conflict. Documentation discrepancies above should be resolved before release.
