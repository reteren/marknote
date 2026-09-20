# Behavior specification

This is the single source of truth for MarkNote behavior. If code and this
specification differ, one of them is wrong and the team must decide which.
The reference behavior is Obsidian with its default settings; where this
specification is silent, follow Obsidian.

## 1. Core principles

One window is a workspace with one or more tabs, each containing a document.
At startup the window shows one tab with the start screen or the supplied file.
The plus button creates a tab with the start screen, and the tab bar is always
visible. There are no vaults or sidebars.

English is the default interface language. Supported languages and direction
are described in SETTINGS.md. The documentation itself is in English. The
theme is one dark Obsidian-style theme and has no switch. Settings exist, but
they may not change the core principles: tabs inside a window, no plugins or
vaults, and the single dark theme.

## 2. Launching and opening files

### 2.1 Double-click

The installer associates Markdown extensions with MarkNote. A double-click
passes the file to MarkNote, which uses a free start window or creates a new
window. There is always one process: the single-instance plugin forwards
arguments to the running process. When raiseExistingWindow is enabled, an
already open file raises and focuses its existing window; otherwise a new
window is created.

### 2.2 Start screen

Launching without a file shows a start screen. It can create every editable,
creatable format. The first tiles are Markdown, Plain Text, JSON, YAML, TOML,
CSV, and common code/data formats; More… reveals the rest. RTF is editable
after opening but is not creatable. PDF, DOCX, and EPUB are read-only and are
not offered as new files.

Selecting a tile closes the start screen and creates an empty document with
the selected extension, such as Untitled.json — MarkNote. Typing before
selecting a tile creates Markdown and dismisses the screen.

### 2.3 Unsaved documents

An unsaved document has no disk path. Autosave is disabled, the menu shows
Unsaved, and Save and Save as are available. Closing a non-empty unsaved
document asks Save, Discard, or Cancel. A multi-dirty-tab close protocol must
treat all dirty tabs before closing the window. The first save opens the system
dialog with the selected format as its default.

### 2.4 Changing document type

The type in the status bar is clickable. Changing it keeps text, cursor, and
undo history but changes preview, syntax highlighting, and saving policy. For
an unsaved document it changes the proposed extension. For a saved document
it is Save as with a new extension; the original is untouched. Read-only
types do not appear in the picker.

### 2.5 Drop and title

Dropping a file into an empty untouched window reuses it; otherwise a new
window opens. Multiple files use one window each. Saved titles are
name.ext — MarkNote. Unsaved titles are Untitled.ext — MarkNote; save state
appears in the menu, not the native title.

## 3. Saving

### 3.1 Autosave

Autosave applies only to a document with a disk path and a lossless format
(classes A, B, and C). It runs two seconds after the last keystroke, on window
blur, while closing the active tab, and before reloading an external change.
Closing a saved clean tab does not ask. A non-empty untitled document does ask.

### 3.2 Save controls

Save and Save as live in the menu beside the state indicator. States are:

| State | Indicator | Buttons |
| --- | --- | --- |
| Unsaved with text | Unsaved | Save and Save as enabled |
| Unsaved and empty | muted Unsaved | both disabled |
| Saved with autosave | Saved with time | Save disabled, Save as enabled |
| Pending edits | Saving… | Save enabled |
| Lossy RTF | Unsaved changes | Save enabled after warning |
| Read-only PDF/DOCX/EPUB | Read-only | Save as Markdown only |

Save without a path opens Save as. Save with a path writes immediately.
Lossy formats require a formatting-loss confirmation. Save as always opens the
dialog, and the chosen extension changes the document type while leaving the
original untouched. File menu entries and Ctrl+S/Ctrl+Shift+S provide the same
actions.

### 3.3 File writes

Writes are atomic: content goes to a temporary sibling and then replaces the
original. Original encoding and line endings are preserved. Lossy formats are
never written by autosave.

### 3.4 External changes

Every open file is watched with notify, and own writes are suppressed. A clean
buffer reloads quietly while preserving cursor and scroll. A dirty buffer
shows File changed on disk with Reload and Keep mine; autosave pauses until a
choice. A deleted or renamed file shows File no longer exists, keeps text in
memory, and allows the next explicit save to recreate it.

## 4. Editor

### 4.1 Live preview

Live preview is the only reading mode. Markup is hidden until the cursor or
selection intersects its syntax node; then the whole node becomes editable.
Only the affected node is revealed, except heading, list, and quote markers,
which reveal with their line.

### 4.2 Width and wrapping

The text column is centered and limited to 81ch. Longer lines wrap visually.
No line breaks are inserted into the file; a paragraph remains one disk line,
as in Obsidian.

### 4.3 Undo and redo

History is unlimited. Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo. Continuous
typing is grouped as one action and line deletion is one action.

### 4.4 Tab and Enter

Inside a list, Tab indents and Shift+Tab outdents. Inside a table they move
between cells. Elsewhere Tab inserts four spaces. Enter continues a list with
the next marker or number, exits on an empty item, keeps code blocks open, and
continues quotes.

### 4.5 Pairing and wrappers

Typing pairs for emphasis, code, highlight, strike, links, and parentheses
inserts the closing delimiter. With a selection, the delimiter wraps it.
Ctrl+B, Ctrl+I, and Ctrl+E wrap the word or selection; pressing again unwraps.

## 5. Markdown support

### 5.1 Inline

| Markup | Result | Shortcut |
| --- | --- | --- |
| **text** | bold | Ctrl+B |
| *text* | italic | Ctrl+I |
| ~~text~~ | strikethrough | — |
| ==text== | highlight | — |
| inline code | code | Ctrl+E |
| $formula$ | inline KaTeX | — |
| %%text%% | muted comment | — |
| [text](address) | link opened with Ctrl-click | Ctrl+K |
| image syntax | image | — |
| footnote syntax | footnote | — |

Comments are visible but muted while editing and are not exported.

### 5.2 Blocks

Supported blocks are six heading levels, bulleted and numbered lists, tasks
with clickable checkboxes, quotes, callouts, horizontal rules, fenced code,
math blocks, tables, and footnotes. Callout types are note, tip, info, success,
question, warning, danger, example, and quote; unknown types render as note.
Checkbox changes are document edits and enter undo history. Images resolve
relative to the open file, respect column width, and show a named fallback
when broken.

## 6. Interface

The shell contains a title bar, menu row, Save controls, permanent tab bar,
editor, search panel, and status bar. Each tab has a close button and the plus
button at the right. Ctrl+T creates a new start-screen tab. Explorer opening
still routes to a free or new window rather than adding a tab.

There is no formatting toolbar. Bold, italic, code, links, headings, lists,
tasks, quotes, tables, callouts, code blocks, math blocks, horizontal rules,
and clear-formatting are available from the context menu and editor shortcuts.
Text editing commands remain available in every editable format. Save and
Save as remain visible because their state is not constant.

The File menu contains New, New Window, Open, Save, Save as, Settings, and
recent files. Edit contains undo, redo, clipboard, line, find, replace, and
go-to-line commands. View contains zoom and display options. Help contains
shortcuts, Markdown reference, and About. Formatting is grouped in the custom
context menu, not a top-level Format menu.

The context menu replaces WebView2’s native menu. It adapts to selection,
empty space, links, and images and supports keyboard navigation, Escape, and
inward expansion at the window edge.

The status bar shows the document type, constraints, line and column, line
count, word count, and character count. Lines count file line endings, not
visual wraps. Characters include spaces and markup. Words are runs of
non-whitespace characters, and partial selected words are not counted.

## 7. Find and replace

Ctrl+F opens Find in the upper-right corner. Matches are highlighted and the
current match is brighter. Enter and Shift+Enter navigate, Escape closes, and
case, whole-word, and regular-expression switches are available. Ctrl+H adds
Replace and Replace All. Search uses source text, including hidden markup.

## 8. Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N | New Markdown document in a new window |
| Ctrl+Shift+N | New document with type picker |
| Ctrl+T | New tab with start screen |
| Ctrl+, | Open settings |
| Ctrl+O | Open |
| Ctrl+S | Save now, or Save as without a path |
| Ctrl+Shift+S | Save as |
| Ctrl+W | Close window |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+X / C / V | Cut, copy, paste |
| Ctrl+Shift+V | Paste as plain text |
| Ctrl+A | Select all |
| Ctrl+D | Delete line |
| Alt+Up / Alt+Down | Move line |
| Ctrl+B / Ctrl+I / Ctrl+E | Bold / italic / code |
| Ctrl+K | Link |
| Ctrl+1 … Ctrl+6 | Heading level |
| Ctrl+0 | Remove heading, otherwise reset zoom |
| Ctrl+Shift+K | Code block |
| Tab / Shift+Tab | List indentation or table-cell movement |
| Ctrl+F / Ctrl+H | Find / replace |
| F3 / Shift+F3 | Next / previous match |
| Ctrl+G | Go to line |
| Ctrl+Home / Ctrl+End | Document start / end |
| Ctrl+plus / Ctrl-minus | Zoom |
| Ctrl+0 | Reset zoom when not removing a heading |

## 9. Limits

Tabs live inside one window and the bar is always visible. Multi-tab external
watching and the aggregate close protocol remain areas for runtime acceptance.
Files over 5 MiB disable live preview and use plain text with syntax
highlighting; the status bar should report the reason. Binary files are
rejected with a clear message. HTTP images are allowed; file URLs outside the
document folder are not. Spellchecking is supplied by WebView2 and Windows
chooses the dictionary from installed system languages.
