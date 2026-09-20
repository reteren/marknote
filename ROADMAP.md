# Roadmap

Eight milestones build on one another. Estimates are hours of focused work for
one developer familiar with Rust but new to CodeMirror. The original estimate
to v1.0 was about 166 hours, with roughly one third spent on live preview.

| Milestone | Result | Hours |
| --- | --- | ---: |
| M0 | Shell: window opens and reads a file | 6 |
| M1 | Editor core: editing, undo, wrapping | 12 |
| M2 | Live preview | 45 |
| M3 | Files, windows, tabs, creation, saving | 28 |
| M4 | Blocks: tables, callouts, formulas, images | 25 |
| M5 | UI shell, start screen, status bar, search, tabs | 22 |
| M6 | Additional formats | 18 |
| M7 | Build, associations, release | 10 |

The format registry appears in M3 because the start screen, save controls, and
type switching depend on it. It began with Markdown and plain text and is now
expanded by the M6 adapters; the interface remains generated from the Rust
registry.

## M0 — Shell · 6 h

Goal: tauri dev opens a dark window showing the command-line file.

- [x] Initialize Tauri 2, Svelte 5, TypeScript, and Vite.
- [x] Connect theme.css and the dark native title bar.
- [x] Embed plain CodeMirror 6.
- [x] Add the open_file IPC command.
- [x] Read process arguments and load a file.
- [x] Add Git and .gitignore.
- [ ] Confirm the first commit and repeat launch acceptance in one controlled
      run; old reports describe different sessions.

Done means marknote.exe test.md displays the file contents.

## M1 — Editor core · 12 h

- [x] Markdown syntax highlighting.
- [x] Unlimited undo/redo and Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y.
- [x] Centered 81ch visual wrapping; disk text never receives hard breaks.
- [x] Tab indents lists, Shift+Tab outdents, and ordinary text receives four
      spaces.
- [x] Enter continues a list and exits on an empty item.
- [x] Auto-pairing for emphasis, code, highlight, strike, links, and brackets.
- [x] Ctrl+B/I/E wraps and unwraps selected text.
- [x] Select all, cut, copy, and paste.

## M2 — Live preview · 45 h

The main milestone: markup is hidden until the cursor or selection intersects
its syntax node. ViewPlugin walks visible Lezer nodes and updates only affected
decorations.

- [x] ViewPlugin recalculation on document and selection changes.
- [x] isNodeActive and atomic ranges for hidden markers.
- [x] Bold, italic, strike, highlight, code, comments, inline math, nesting,
      and links.
- [x] Six headings, bulleted and numbered lists, and task checkboxes.
- [x] KaTeX is lazy and cached by source formula.
- [x] Cursor, mouse selection, Home/End, and word navigation remain stable.
- [x] The 10,000-line test reached a 3.43 ms median and 5.97 ms worst case
      against a 16 ms target.
- [ ] Profile decoration recalculation and decide whether a line-number cache
      is worthwhile.

Done means mixed Markdown looks like Obsidian and the cursor remains predictable.

## M3 — Files, windows, and saving · 28 h

### Format registry and document state

- [x] FormatCapabilities and Rust registry.
- [x] list_creatable_formats, new_document, and format_for_extension.
- [x] Registry contains 21 formats, 17 creatable.
- [x] Frontend DocumentState tracks path, type, and save state.
- [x] A null path is the single source of truth for disabling autosave.

### Document creation

- [x] Start screen tiles, Open file, and file drop.
- [x] Typing without selecting a type creates Markdown.
- [x] Templates: {} for JSON, an HTML skeleton, and empty for other formats.
- [x] Untitled.ext native titles.
- [x] Ctrl+N opens a new window; Ctrl+Shift+N opens the format picker.
- [x] Type changes preserve text and editor capabilities.
- [x] Tabs, plus button, Ctrl+T, names, formats, and close buttons.

### Saving

- [x] Save and Save as controls with Unsaved, Saving, Saved, and Read-only.
- [x] Save without a path opens the save dialog.
- [x] Save As chooses a format from the extension.
- [x] Rust detects external metadata changes and returns a conflict.
- [x] Autosave after two seconds and on focus loss.
- [x] Atomic sibling write followed by rename.
- [x] Unsaved close asks Save, Discard, or Cancel.
- [x] Dropped files open in the window.

### Windows and disk

- [ ] Complete multi-tab file watching and acceptance.
- [ ] Confirm Explorer routing, external reload/Keep mine, deletion/recreate,
      rename, and multi-dirty-tab close.
- [x] Single-instance routing.
- [x] raiseExistingWindow and rememberSizeAndPosition settings.

Done means opening and editing three files does not lose data, and a newly
created file can be saved, closed, and reopened intact.

## M4 — Block elements · 25 h

- [x] Fenced code with language highlighting loaded on demand.
- [x] Display math blocks with KaTeX.
- [x] Tables with aligned columns and cell navigation.
- [x] Nested quotes with a quiet vertical rule.
- [x] Obsidian-style callouts with icon, color, and title.
- [x] Footnotes with hover text.
- [x] Horizontal rules.
- [x] Images relative to the document, data/http URLs, width limits, and a
      broken-image fallback.
- [ ] Repeat visual acceptance of table and formula geometry.

## M5 — UI shell and tabs · 22 h

- [x] File, Edit, View, and Help menus; formatting in ContextMenu.
- [x] File/New uses the registry and start screen.
- [x] Permanent TabBar with switching and per-document state.
- [x] Start screen formats, Open file, and drop.
- [x] Status-bar type picker, Read-only and Lossy markers.
- [x] Context menu adapts to selection, blank space, links, and images.
- [x] Status statistics for cursor, lines, words, and characters.
- [x] Find/replace, counts, navigation, case, whole-word, and regex options.
- [x] Keyboard shortcuts route file actions through App; Ctrl+G opens go-to-line.
- [x] Ctrl+0 resolves heading removal before zoom reset.
- [ ] Repeat manual acceptance of search and menus without competing processes.

## M6 — Additional formats · 18 h

- [x] FormatAdapter registry with 21 formats, including EPUB; 17 creatable.
- [x] JSON and HTML templates; plain text extensions.
- [x] JSON, JSONC, YAML, TOML, XML, HTML, CSS, JavaScript, TypeScript, Rust,
      Python, Go, C/C++, and Shell highlighting.
- [x] JSON validation and formatting through IPC and context menu.
- [x] UTF-8, BOM, UTF-16, and CP1251 detection with original encoding on save.
- [x] CRLF preservation.
- [x] Lossy RTF conversion, disabled autosave, and warning.
- [x] PDF, DOCX, and EPUB read-only extraction with Save as Markdown.
- [x] Status marks for Read-only and Lossy.
- [ ] Add positive extraction tests and repeat conversion acceptance.

## M7 — Build and release · 10 h

- [x] Application icons in the bundle.
- [x] NSIS installation without administrator rights.
- [x] WebView2 bootstrapper for clean Windows 10.
- [ ] Per-file icons for associated types.
- [ ] Verify Windows associations and default-app registration.
- [ ] Test a clean Windows 10 VM without WebView2.
- [ ] Measure cold start to first text.
- [ ] Update tag and workflow paths for the selected release version.
- [ ] Sign the installer if a certificate becomes available.
- [ ] Keep release notes and tag aligned with the release version.

## Practical lessons

Wiring tests catch routes between components and commands, but they do not prove
runtime behavior after the call. Integration and acceptance scenarios are
required. Red acceptance tests can be defects in the test itself: prove that
input reached the editor before fixing the product. Earlier sessions found that
Rust events were broadcast globally instead of targeted to one window; events
are now addressed to the specific WebViewWindow.

## After v1.0

Possible growth, not a promise: PDF/HTML export through WebView printing,
Ctrl+P printing, an outline panel, improved WebView2 spellchecking, and
tauri-plugin-updater.

## Risks

| Risk | Rating | Mitigation |
| --- | --- | --- |
| Live preview is more complex than expected | High | Split M2 into submilestones and trim comments/nesting if needed |
| Cursor behaves strangely around hidden markers | High | Use atomicRanges rather than custom key handling |
| RTF conversion loses formatting | Medium | Disable autosave and warn before the first save |
| Complex PDF layouts extract poorly | Medium | Keep read-only mode and explain the limitation |
| Registry is too small for future formats | Medium | Preserve FormatCapabilities for every adapter |
| Large files become slow | Low | Decorate visible ranges only; disable preview above 5 MiB |
| SmartScreen flags an unsigned installer | Certain | Provide a certificate or release instructions |

## Open visual and release checks

PDF/DOCX dependencies affect installer size and need a fresh measurement. A
single controlled acceptance run must cover file opening, close flows, search,
and external changes without competing processes. The release checklist should
preserve the run log and distinguish application failures from harness failures.
