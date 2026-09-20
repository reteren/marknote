# MarkNote 1.0.0

First public release. Versions 1.0.1–1.0.18 in the history were internal
development builds and were not published.

MarkNote is a Windows Markdown editor with live preview, tabs, and text/code
formats. It combines Notepad and Obsidian: files open on double-click, markup
does not interfere with reading, and there are no vaults or plugins.

Highlights:

- live preview hides markup until the cursor enters a node;
- tabs, file drop, and Explorer opening;
- 21 formats: Markdown, plain text, validated JSON, 14 highlighted code
  formats, lossy RTF, and read-only PDF, DOCX, and EPUB;
- tables with edge controls and row/column dragging;
- KaTeX formulas, callouts, footnotes, and task checkboxes;
- atomic saving and autosave;
- settings for ten interface languages, font, size, column width, line numbers,
  preview, and autocorrect.

Installer size: 3.15 MB, with no administrator rights. MarkNote uses the
system WebView2 rather than shipping its own browser.

# MarkNote 1.0.18

This release focuses on speed, memory, and code hygiene. Measurements were made
on the built application; measurement scripts remain in qa/.

## Speed

- Editing a 5 MB document no longer recalculates the entire text on each key:
  one keypress fell from 99.8 to 15.3 ms and applying the edit from 87.7 to
  7.2 ms. The status word counter and preview-size check were both scanning the
  whole document.
- Cursor movement in a 1 MB document fell from 19.2 to 9.4 ms; first render
  fell from 181.8 to 107.1 ms.
- A file opened in a new window is read and parsed once rather than twice:
  repeated parsing on a 10 MB file fell from 39.7 to 4.1 ms.

## Memory

- WebView2 crash reporting that was never collected is disabled: clean startup
  fell from 385.6 to 376.2 MB, with seven processes instead of eight.
- The rendered-formula cache is capped at 256 entries: page memory after a 1 MB
  document fell from 37.4 to 30.7 MB.
- Settings loads on first open rather than every launch.

## Hygiene

- Rust clippy produces no suggestions.
- README now describes capabilities, shortcuts, measured values, and unfinished
  work honestly.
- The fixture showcase.md no longer contains accidental sample debris.

# MarkNote 1.0.17

This release focuses on speed and memory. Measurements and their method were
recorded during development and are intentionally not shipped as working-note
reports.

## Editor

- Live preview no longer recalculates the whole document on each cursor move.
  On a 1 MB document cursor movement fell from 19.2 to 9.4 ms and first render
  from 181.8 to 107.1 ms; on 5 MB, cursor movement fell from 75.3 to 62.9 ms
  and viewport change from 47.9 to 35.5 ms.
- Indentation guides for nested lists are built only for the visible range.

## Memory

- The rendered-formula cache keeps the latest 256 entries. Page memory after a
  1 MB document fell from 37.4 to 30.7 MB, and after 200 tab open/close cycles
  from 39.2 to 32.5 MB.
- Settings loads on first open; the main chunk fell from 558 to 539 KB.

## Opening files

- A file opened in a new window is read and parsed once. On a 10 MB file,
  repeated parsing fell from 39.7 to 4.1 ms. If the file changes between the
  initial check and opening, it is read again.

# MarkNote 1.0.16

## Code formats

- Line numbers appear in JSON, Python, CSS, and other syntax-highlighted
  formats. The line-number setting remains and now means “show numbers
  everywhere, including Markdown”.
- Markdown formatting, paragraph, and insertion commands are removed from
  non-Markdown menus. Text editing, search, and JSON actions remain. Those
  formatting shortcuts are also silent there, while Ctrl+0 still resets zoom.

## File drop

- A dropped file opens as a tab in the same window. The empty tab takes the
  first file; each additional file gets its own tab, and an already open file
  is shown.

## Appearance

- The dark track behind the scrollbar is removed; only the thumb is visible.

# MarkNote 1.0.15

- Equals and tilde are no longer doubled while typing: two typed characters
  remain two, rather than becoming four with the cursor in the middle.
  Selected text is still wrapped in highlight or strikethrough markers.

# MarkNote 1.0.14

- A single or double equals line under text no longer creates a heading or
  hides itself; it is ordinary text. Setext underlines of three or more marks
  keep their previous heading behavior.

# MarkNote 1.0.13

## Cursor after menu commands

- After Bold, Italic, Strikethrough, Highlight, and heading insertion, the
  cursor remains where the command placed it instead of jumping to the start.
- A heading inserted on an empty line leaves the cursor after its marker.

## Equals sign

- A single equals sign remains one sign. A second consecutive equals closes a
  highlight pair; tilde behaves the same way.

## Formulas and horizontal rules

- Display math blocks render again instead of freezing editor updates. Clicking
  a formula reveals its source; while the cursor is anywhere in the block, the
  source remains visible.

# MarkNote 1.0.12

## Formatting

- Bold, italic, strikethrough, and highlight leave the cursor after the closing
  markers.
- Heading insertion leaves the cursor after the heading marker.
- Bulleted lists show a bullet immediately.
- After a horizontal rule, the cursor moves exactly one line down.
- One or two hyphens under text start a list rather than creating a heading;
  three or more still create a Setext heading.

## Tables

- A selected column and a dragged row use one outline.
- The row handle is visible on hover at the left.
- The add-column bar is exactly the table height.
- Other handles and plus controls stay hidden during a drag.
- Text immediately below a table remains ordinary text; paste directly below a
  table still needs separate acceptance.

## Formulas

- A display block renders immediately after text without a blank line and at the
  end of a document.

# MarkNote 1.0.11

## Tables

- Add-row and add-column bars appear only near the bottom and right table edges.
- Bar lines use the normal table-border gray.
- Column handle hit areas are larger than the visible handle.
- Rows can be dragged from the left handle.
- Remaining visual work at that time was a single column/row outline and exact
  handle/bar geometry.

## Spell checking

- The ineffective language selector was removed. Windows chooses the dictionary
  from its system interface language; MarkNote still offers spellcheck and
  skip-code/formula/link settings.

# MarkNote 1.0.10

Same product as 1.0.9; no code changed. A new version was required because
1.0.9 had already been distributed and one number cannot identify two installers.

If tables show raw pipes and headings show hashes, live preview is disabled in
Settings → Preview → Live preview. Reinstalling does not change that setting.

# MarkNote 1.0.9

## Windows

- MarkNote is listed in Windows Default Apps for its supported extensions.
  MarkNote never assigns itself as the default; Windows requires a person to
  choose the association.

## Tables

- A table is an object, not a collection of drawing characters. Inserting one
  creates a four-cell grid.
- Hover controls provide a full-width add-row bar at the bottom, a full-height
  add-column bar at the right, and handles above the active column and left of
  rows.
- Tables scale with editor text zoom and controls do not intercept clicks below
  the table.

## Keys and lists

- Tab indents and Shift+Enter creates a soft line break without changing list
  level; Backspace exits the indent. Ctrl+Enter no longer creates a line.
- Numbering starts only after a separator and space. A bare number remains text.
- Indentation guides are visible on the left.
- The context menu includes bulleted, numbered, and task lists.
- Task checkboxes and Clear formatting are available.
- Horizontal-rule insertion works without losing the cursor.

## Other

- Recent files lists ten existing files and has a clear button.
- Spellchecking uses one Windows-selected dictionary.

# MarkNote 1.0.8

- Closing now asks about unsaved text instead of waiting for a five-second
  watchdog timeout.
- Long documents can be scrolled.
- Numbered lists follow Obsidian-style renumbering, Enter continuation,
  empty-item exit, Tab/Shift+Tab nesting, Shift+Enter soft breaks, heading
  interruption, and indentation guides.

# MarkNote 1.0.7

Tabs were added inside the window. Each tab preserves undo history, cursor
position, and scroll; autosave belongs to the tab. A plus button opens the start
screen, and closing a dirty tab asks the same Save/Discard/Cancel question.
Explorer opening still uses a new window except for an empty start window.

The release also fixed deadlocks during double-click launch and New Window,
browser print/reload accelerators, native window titles, editor zoom, and
single-file watcher state in a tabbed workspace.

The tab bar has no glow, the current-line outline is gone, scrollbars and
checkboxes use quiet theme tokens, and the View menu shows the active zoom.

Known limitations were unsigned installers and WebView2 spellcheck language
selection; Windows SmartScreen may warn and WebView2 uses the system dictionary.
