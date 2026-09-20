# Manual MarkNote acceptance checklist

This document contains scenarios and checks that require visual or interactive human participation (focus behavior, physical cursor movement, context menus, and physical rendering of formulas and animations).

---

## Milestone M0 — Shell and launch

- [ ] **M0.1 — Dark window theme at launch**
  - *Action:* Launch `marknote.exe`.
  - *Expected result:* The window opens immediately with a dark title bar (`DWMWA_USE_IMMERSIVE_DARK_MODE`), a dark `#1e1e1e` background, and no white flashes during initialization.
- [ ] **M0.2 — Opening a file from Explorer / CLI**
  - *Action:* Drag an `.md` file onto the `marknote.exe` shortcut or run `marknote.exe fixtures\showcase.md`.
  - *Expected result:* The file contents appear immediately, and the window title is `showcase.md — MarkNote`.

---

## Milestone M1 — Editor core

- [ ] **M1.1 — Line wrapping**
  - *Action:* Insert a long paragraph (more than 150 characters without line breaks).
  - *Expected result:* The text wraps smoothly at the centered `81ch` column boundary. Hard `\n` breaks are not added to the file on disk.
- [ ] **M1.2 — Undo and redo history**
  - *Action:* Type text, press `Ctrl+Z`, then `Ctrl+Y` or `Ctrl+Shift+Z`.
  - *Expected result:* The edit is undone and restored correctly. History depth is unlimited.
- [ ] **M1.3 — Tab key behavior**
  - *Action 1:* Press `Tab` in ordinary text -> four spaces are inserted.
  - *Action 2:* Press `Tab` on a list item -> the item moves right (indentation increases by one level).
  - *Action 3:* Press `Shift+Tab` on an indented item -> the item moves left (indentation decreases by one level).
- [ ] **M1.4 — Enter in lists**
  - *Action:* Press `Enter` at the end of a non-empty list item -> a new item with the same marker/number is created. Press `Enter` on an empty list item -> the marker is removed and the editor exits the list.
- [ ] **M1.5 — Auto-pairing and selection wrapping**
  - *Action 1:* Type `*`, inline-code delimiters, `[`, `(`, `==`, or `~~` -> a closing character is inserted automatically.
  - *Action 2:* Select a word and press `Ctrl+B`, `Ctrl+I`, or `Ctrl+E` -> the word is wrapped in markup; pressing again removes the markup.

---

## Milestone M2 — Live preview

- [ ] **M2.1 — Hide and reveal markup under the cursor**
  - *Action:* Type `**bold text**` and move the cursor to another line.
  - *Expected result:* The `**` markers disappear and the text is shown in bold. When the cursor returns inside the word with the arrow keys, the `**` markers reappear for editing.
- [ ] **M2.2 — Atomic hidden markers (the cursor does not get stuck)**
  - *Action:* Move the cursor with `←` and `→` across hidden-formatting boundaries (`**`, `*`, `==`, `~~`).
  - *Expected result:* The cursor does not get stuck in invisible markup characters; `Home`, `End`, `Ctrl+←`, and `Ctrl+→` move naturally as in ordinary text.
- [ ] **M2.3 — Inline markup styles**
  - [ ] `*italic*` — slanted text without the surrounding asterisks.
  - [ ] `~~strikethrough~~` — struck-through text.
  - [ ] `==highlight==` — a yellow translucent background (`var(--text-highlight-bg)`).
  - [ ] `` `code` `` — monospace font and a background.
  - [ ] `%%comment%%` — muted text color, hidden completely when the cursor leaves it.
  - [ ] Links `[text](url)` — only `text` is displayed. With `Ctrl+click`, the link opens in the default external browser.
- [ ] **M2.4 — Six heading levels (# through ######)**
  - *Action:* Enter headings from `# ` through `###### `.
  - *Expected result:* Hash marks are hidden when the cursor is outside the line. Font size and weight follow the Obsidian scale (H1 large and bold, H6 muted).
- [ ] **M2.5 — Task checkboxes (- [ ] / - [x])**
  - *Action:* Click a task checkbox.
  - *Expected result:* The checkbox toggles between completed and incomplete directly in the document (the text changes to `- [x]`); completed items become muted and struck through; the action can be undone with `Ctrl+Z`.

---

## Milestone M3 — Files, saving, and disk watching

- [ ] **M3.1 — Autosave after two seconds of idle time**
  - *Action:* Edit a previously saved file and stop typing.
  - *Expected result:* The status changes from `Unsaved` to `Saving…`, then to `Saved <time>` after two seconds. The file on disk is updated without pressing `Ctrl+S`.
- [ ] **M3.2 — Autosave when focus is lost**
  - *Action:* Make an edit and immediately switch to another window (Alt+Tab).
  - *Expected result:* The file is written to disk immediately and the status changes to `Saved`.
- [ ] **M3.3 — Warning when closing with unsaved changes**
  - *Action:* Create a new document without a path, type `unsaved check`, then click the window close button `✕`.
  - *Expected result:* A `Save changes?` dialog appears with `Save`, `Discard`, and `Cancel` buttons; the text remains until an action is selected.
  - *Cancel check:* Click `Cancel` — the dialog closes and the window and text remain.
  - *Discard check:* Repeat closing and click `Discard` — the window closes without saving.
  - *Save check:* Create another new document, type text, and choose `Save` — a location and filename picker opens; after saving, the document closes normally.
- [ ] **M3.4 — Reaction to a file changed on disk by another program**
  - *Scenario 1 (clean buffer):* Edit the file with `notepad.exe` and save it -> MarkNote quietly refreshes the text while preserving the cursor position and scroll.
  - *Scenario 2 (dirty buffer):* Make an unsaved edit in MarkNote and change the file externally -> a `File changed on disk` banner appears with `Reload` and `Keep mine` buttons.
  - *Scenario 3 (file deleted):* Delete the file from disk -> a `File no longer exists` banner appears.

---

## Milestone M4 — Block elements

- [ ] **M4.1 — GFM tables**
  - *Action:* Open or create a Markdown table `| Col 1 | Col 2 |`.
  - *Expected result:* The table is visually aligned by column; pressing `Tab` inside a cell moves the cursor to the next table cell; `|` and `-` markers are hidden in preview mode.
- [ ] **M4.2 — Callout blocks (> [!NOTE])**
  - *Action:* Insert a `> [!NOTE]` or `> [!WARNING]` block.
  - *Expected result:* A colored card with a left accent stripe, icon, and title is rendered. When the cursor is outside the block, the quote arrow `>` is hidden.
- [ ] **M4.3 — KaTeX mathematical formulas ($ and $$)**
  - *Action:* Insert an inline formula `$E = mc^2$` and a block `$$\int_0^\infty x dx$$`.
  - *Expected result:* KaTeX synchronously renders a typeset formula without flicker. Clicking inside the formula reveals the original TeX text for editing.
- [ ] **M4.4 — Images (![alt](path))**
  - *Action:* Insert an image relative to the document folder: `![Screenshot](image.png)`.
  - *Expected result:* The image appears inside the text column. For a broken path, a neat frame with the filename appears instead of a blank area or a crash.

---

## Milestone M5 — UI shell, menus, and search

- [ ] **M5.1 — Find and replace (Ctrl+F / Ctrl+H)**
  - *Action 1:* Press `Ctrl+F` -> the search panel opens smoothly in the upper-right corner.
  - *Action 2:* Enter a search query -> all matches are highlighted in orange, the current match is brighter, and the counter shows `X of Y`.
  - *Action 3:* Pressing `Enter` moves to the next match; `Shift+Enter` moves to the previous one.
  - *Action 4:* Press `Ctrl+H` -> the replace field and `Replace` / `Replace All` buttons appear.
  - *Action 5:* Press `Escape` -> the panel closes and focus immediately returns to the editor.
  - *Action 6:* Enter an invalid regular expression (for example `(` with `.*` enabled) -> the field is highlighted red, the application does not crash, and a clear error message is shown.
- [ ] **M5.2 — Main menu (File, Edit, Format, View, Help)**
  - *Action:* Click the main-menu items in the header.
  - *Expected result:* Windows/Obsidian-style dropdown menus open, and shortcuts duplicated in the menus work.
- [ ] **M5.3 — Context menu on right-click**
  - *Action 1 (over text):* Right-click -> the styled MarkNote context menu opens (`Cut`, `Copy`, `Paste`, `Bold`, `Italic`, etc.). The native WebView2 menu is disabled.
  - *Action 2 (over a link):* `Open Link`, `Copy Link Address`.
- [ ] **M5.4 — Status bar**
  - *Action:* Select a text fragment.
  - *Expected result:* The format (for example `Markdown`) appears on the left; `Ln X, Col Y · Z lines · W words · C chars` appears on the right. With a selection, line and word counts are shown only for the selected fragment (only whole words are counted).
- [ ] **M5.5 — Start screen**
  - *Action:* Launch MarkNote without a file while the buffer is empty.
  - *Expected result:* A `New file` screen appears with Markdown, Plain Text, JSON, YAML, TOML, and CSV format tiles, plus a `More…` item; less common formats appear after clicking `More…`. Selecting a tile opens an empty document of that type.

- [ ] **M5.6 — Change document type from the status bar**
  - *Action:* Create a Markdown document, enter `before middle after`, place the cursor between words, add `X`, then click `Markdown` on the left side of the status bar and choose `JSON`.
  - *Expected result:* The text stays in place, the cursor remains after `X`, and the title changes from `Untitled.md — MarkNote` to `Untitled.json — MarkNote`. Press `Ctrl+Z` — only `X` is removed; press `Ctrl+Y` — `X` returns. If the text, cursor position, or undo history resets, the check fails.

- [ ] **M5.7 — File shortcuts while the editor has focus**
  - *Action 1 (`Ctrl+S`):* Open a temporary copy of a text file, edit a line, keep focus in the text, and press `Ctrl+S`.
  - *Expected result:* The edit is written to this file; verify its contents in Notepad. The shortcut must not open a menu or change the document.
  - *Action 2 (`Ctrl+O`):* Return to MarkNote, click the text, and press `Ctrl+O`; choose `fixtures\showcase.md` in the dialog.
  - *Expected result:* The open dialog appears, and after selection `showcase.md` is displayed with the corresponding window title.
  - *Action 3 (`Ctrl+N`):* With focus in the text, press `Ctrl+N`.
  - *Expected result:* A new empty document is created; open unsaved text does not disappear without a warning.
  - *Action 4 (`Ctrl+W`):* Save or cancel the changes, click the text, and press `Ctrl+W`.
  - *Expected result:* The active window closes; if the document changed, `Save changes?` appears first with `Save`, `Discard`, and `Cancel` buttons.

- [ ] **M5.8 — Title after creation and Save As**
  - *Action 1:* With a document open, press `Ctrl+N` and choose Markdown if prompted.
  - *Expected result:* The new document title shows `Untitled.md — MarkNote`, not the previous filename.
  - *Action 2:* For the new document, invoke `Save As…` from the `File` menu and save it under the temporary name `title-check.md`.
  - *Expected result:* After saving, the title changes to `title-check.md — MarkNote`.

- [ ] **M5.9 — Text zoom and persistence**
  - *Action:* Open a document, press `Ctrl`+`+` several times, then `Ctrl`+`-` and `Ctrl`+`0`.
  - *Expected result:* The editor text increases, decreases, and returns to the original zoom respectively.
  - *Restart check:* Set a zoom different from the default, close the application, and open it again.
  - *Expected result:* The selected zoom persists after restart; `Ctrl`+`0` returns to the default.

- [ ] **M5.10 — Help sections in the Help menu**
  - *Action:* Open the `Help` menu and select `Keyboard Shortcuts`, `Markdown Reference`, and `About` in turn.
  - *Expected result:* Each item opens the corresponding help or information; the content is visible and readable, closing one section lets another open, and the application remains functional.

---

## Milestone M6 — Other formats

- [ ] **M6.1 — CP1251 (Windows-1251) encoding**
  - *Action:* Open `fixtures\cp1251.txt`.
  - *Expected result:* Cyrillic text is displayed without mojibake. When saved, the file remains encoded as CP1251.
- [ ] **M6.2 — Line-ending normalization (CRLF / LF)**
  - *Action:* Open `fixtures\crlf.md`, make an edit, and save it.
  - *Expected result:* Line endings remain `\r\n` and are not converted to `\n`.
- [ ] **M6.3 — Syntax highlighting for code and configuration files**
  - *Action:* Open a `.json`, `.yaml`, or `.toml` file.
  - *Expected result:* Markdown markup is disabled for these files, while the corresponding code syntax highlighting is active.

- [ ] **M6.4 — Rejecting a binary file**
  - *Action:* Choose `fixtures\logo.png` through `File → Open…`.
  - *Expected result:* MarkNote shows a clear message that a binary file cannot be opened as text; the contents do not turn into unreadable characters, and the application remains open.

---

## Automation exception — TC-09: input and close dialog

Text input into CodeMirror through synthetic keys or the clipboard in WebView2 UI Automation proved unreliable: the automated scenario left the counter at `0 chars` even though the editor was visible and focused. TC-09 is therefore excluded from the automated suite; check it manually:

1. Launch MarkNote without an argument and click the `Markdown .md` tile on the start screen.
2. Wait for the editor, click in its area, and type `manual-unsaved-text`.
3. Verify that the `chars` counter on the right side of the status bar is greater than zero and that the `Unsaved` status appears.
4. Press `Alt+F4`. A `Save changes?` dialog with `Save`, `Discard`, and `Cancel` buttons should open.
5. Press `Cancel`: the dialog should close, and the typed text and non-zero counter should remain.
6. Press `Alt+F4` again, then `Discard`: the window should close without saving.

The check fails if input does not change the counter, the dialog does not appear, any of the three options is missing, or the text is lost after `Cancel`. The automated report does not include TC-09; this check remains manual until a reliable WebView2 input method is available.

---

## Milestone M7 — Final build and stability

- [ ] **M7.1 — Fast launch (cold start < 1.5 s)**
  - *Action:* Launch the application after a reboot or cache clear.
  - *Expected result:* The window appears quickly, without delays or freezes.
- [ ] **M7.2 — Working with a 10,000-line file (fixtures\big-10k.md)**
  - *Action:* Open the 1 MB / 10k-line file, scroll quickly up and down, and type several characters.
  - *Expected result:* Scrolling remains smooth at 60 fps, and character-input latency does not exceed 16 ms.
