# MarkNote keyboard shortcut audit

This audit compares the implemented shortcuts with the specification
(`docs/SPEC.md`, section 8), editor code (`src/editor/keymap.ts`,
`src/editor/livePreview/tables.ts`, `src/editor/search.ts`), the menu model
(`src/ui/menuModel.ts`), and action handlers (`src/state/actions.ts`,
`src/App.svelte`).

---

## 1. Comparison summary

| Shortcut | Specification | Editor implementation | Menu / action implementation | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Ctrl+N** | New Markdown document in a new window | `Mod-n` → `handlers.newDocument` → `open_new_window` | `file.newWindow`, label `Ctrl+N` | **Fixed (2026-09-16):** both create a new empty Markdown window without changing the current document. |
| **Ctrl+Shift+N** | New document with type picker | `Mod-Shift-n` → `newDocumentWithPicker` | `file.new` / `Ctrl+Shift+N` and its format submenu | **Fixed (2026-09-16):** the picker and new-window path are shared; WebView2 interception remains platform-dependent. |
| **Ctrl+O** | Open a file | `Mod-o` → `handlers.openFile` | `file.open` / `Ctrl+O` | **Matches** the specification and source locations. |
| **Ctrl+S** | Save immediately | `Mod-s` → `handlers.save` | `file.save` / `Ctrl+S` | **Matches.** |
| **Ctrl+Shift+S** | Save as | `Mod-Shift-s` → `handlers.saveAs` | `file.saveAs` / `Ctrl+Shift+S` | **Matches.** |
| **Ctrl+W** | Close the window | `Mod-w` → `handlers.closeWindow` | `file.close` / `Ctrl+W` | **Matches.** |
| **Ctrl+Z** | Undo | `Mod-z` → `undo` | `edit.undo` / `Ctrl+Z` | **Matches.** |
| **Ctrl+Shift+Z**, **Ctrl+Y** | Redo | `Mod-Shift-z` and `Mod-y` → `redo` | `edit.redo` / both labels | **Matches.** |
| **Ctrl+X**, **Ctrl+C**, **Ctrl+V** | Cut, copy, paste | CodeMirror/WebView clipboard | Corresponding Edit menu entries | **Matches.** |
| **Ctrl+Shift+V** | Paste as plain text | `pastePlainText` | `edit.pastePlainText` / `Ctrl+Shift+V` | **Matches.** |
| **Ctrl+A** | Select all | CodeMirror default keymap | `edit.selectAll` / `Ctrl+A` | **Matches.** |
| **Ctrl+D** | Delete line | `deleteLine` | `edit.deleteLine` / `Ctrl+D` | **Matches.** |
| **Alt+↑**, **Alt+↓** | Move line up/down | `moveLineUp` / `moveLineDown` | Corresponding Edit menu entries | **Matches.** |
| **Ctrl+B**, **Ctrl+I**, **Ctrl+E** | Bold, italic, code | `toggleWrapper` for each delimiter | Context-menu actions use the same toggle | **Fixed (2026-09-16):** menu actions also unwrap existing markers. |
| **Ctrl+K** | Link | `toggleLink` | `format.link` / `Ctrl+K` | **Matches.** |
| **Ctrl+1 … Ctrl+6** | Heading levels 1–6 | `headingCommand(1..6)` | Heading context-menu entries | **Matches.** |
| **Ctrl+0** (heading) | Remove heading | `headingCommand(0)` consumes the event only when a heading is removed | `format.clearHeading` / `Ctrl+0` | **Matches:** heading removal takes priority over zoom reset. |
| **Ctrl+Shift+K** | Code block | `toggleCodeBlock` | `format.codeBlock` uses the shared action | **Fixed (2026-09-16):** menu and keyboard wrap or unwrap the same selection. |
| **Tab**, **Shift+Tab** | List indentation | List indent/outdent outside tables; table keymap moves between cells | No global menu shortcut | **Specification gap:** table-cell movement is not described in section 8. |
| **Ctrl+F**, **Ctrl+H** | Find, replace | Search commands and global FindPanel handlers | `edit.find` / `edit.replace` | **Matches.** |
| **Ctrl+G** | Go to line | `handlers.goToLine` | Dialog is wired through `App.svelte` | **Fixed (2026-09-16):** Enter moves to the beginning of the requested line and centers it. |
| **Ctrl+Home**, **Ctrl+End** | Document start/end | CodeMirror default keymap | Not in the menu; present in Help | **Matches.** |
| **Ctrl++**, **Ctrl+=** | Zoom in | `handlers.zoomIn` | `view.zoomIn` | **Matches.** |
| **Ctrl+-** | Zoom out | `handlers.zoomOut` | `view.zoomOut` / `Ctrl+-` | **Fixed (2026-09-16):** the label reflects the physical key. |
| **Ctrl+0** (zoom) | Reset zoom, after heading removal | `handlers.resetZoom` runs when heading removal returns false | `view.resetZoom` / `Ctrl+0` | **Matches:** the heading conflict is resolved in favor of heading removal. |
| **Ctrl+,** | Open settings | Window-level handler uses physical code `Comma` | `file.settings` / `Ctrl+,` | **Fixed (2026-09-16):** added to the specification and layout-independent. |
| **F3**, **Shift+F3** | Not in the specification | Registered by `search.ts` as next/previous match | Not in the menu | **Specification gap:** useful search navigation exists but is undocumented. |
| **Ctrl+P** | Not in the specification | Not intercepted | Not in the menu | **WebView2 conflict:** Chromium/WebView2 may open the Windows print dialog. |

---

## 2. Findings, ordered by collision likelihood

### 1. Ctrl+N and “New Window”

This was formerly a critical mismatch: the keyboard command replaced the
current document, while the menu opened a copy of the current file or reused
the current window for an unsaved document. It was fixed on 2026-09-16.
Both paths now use the common action to open a new empty Markdown window, and
the current document remains unchanged.

### 2. Ctrl+Shift+N and the format picker

This was formerly a critical mismatch: the keyboard path reported “Format
picker is unavailable” because the picker was not passed to the action factory,
while a menu click created the document in the current window. It was fixed on
2026-09-16 by passing the picker and sharing the new-window IPC path.
WebView2 may still reserve this combination for an InPrivate window before the
DOM receives it.

### 3. Ctrl+G

The go-to-line action was formerly missing from the editor wiring. It was
fixed on 2026-09-16: `HelpDialog.svelte`, `keymap.ts`, `actions.ts`, and the
line-number dialog now share the command. Out-of-range numbers are clamped to
the last line.

### 4. View → Zoom Out label

The menu formerly showed `Ctrl+±` for both zoom directions even though the
implementation uses `Mod--` for zoom out. The label was corrected to
`Ctrl+-` on 2026-09-16.

### 5. Ctrl+P

Printing is not a MarkNote feature and is absent from the specification and
keymap. An unfiltered WebView2 accelerator can nevertheless open the Chromium
or Windows print dialog. The host should eventually disable this accelerator
through `ICoreWebView2Controller::put_IsAcceleratorKeyEnabled` or a window-level
`preventDefault()`.

### 6. Ctrl+,

The setting shortcut was formerly absent from the specification and depended
on the keyboard layout. It was fixed on 2026-09-16 by using
`event.code === "Comma"` and documenting the shortcut.

### 7. F3 and Shift+F3

`src/editor/search.ts` registers F3 for the next match and Shift+F3 for the
previous match, while the specification only documents Enter and
Shift+Enter inside the search panel. The behavior is useful and working, but
the specification should mention it.

### 8. Ctrl+Shift+K toggle behavior

The shared `toggleCodeBlock` implementation wraps selected lines in triple
backticks and removes the wrapper when it is already present. Menu and keyboard
commands use this same function; the mismatch was fixed on 2026-09-16.

### 9. Ctrl+B, Ctrl+I, and Ctrl+E toggle behavior

`toggleWrapper` removes existing bold, italic, or code markers when the
shortcut is applied again. Menu actions and the editor keymap use the same
implementation; this was fixed on 2026-09-16.

### 10. Tab priority inside tables

The table keymap is mounted before the general keymap. Inside a table,
`moveToCell` handles Tab and Shift+Tab; outside a table, list indent/outdent
handles them. The behavior is intentional, but section 8 currently describes
Tab only as list indentation.

---

## 3. Handler conflicts and platform accelerators

### 3.1 Internal conflicts

**Ctrl+0 — remove heading versus reset zoom.** The local
`headingCommand(0)` handler consumes the event only when the current line is a
heading and a marker was removed. Otherwise it returns false, allowing the
next handler, `handlers.resetZoom`, to run. This follows the specification:
heading removal has priority and zoom reset is the fallback. Both menu entries
are necessarily labelled `Ctrl+0`.

**Tab / Shift+Tab — table cell versus list indentation.** The table keymap is
registered before the main keymap. `moveToCell` returns false outside a table,
so the normal list command then runs. This resolves the conflict reliably and
should be documented in the specification.

### 3.2 Runtime conflicts

1. **Ctrl+P (Chromium print):** WebView2 can intercept this unhandled
   accelerator and open its print preview.
2. **Ctrl+Shift+N (InPrivate):** Chromium may reserve this shortcut before the
   DOM receives it when host accelerators are not suppressed.
3. **Ctrl+plus, Ctrl-minus, Ctrl+0, and Ctrl+mouse-wheel:** MarkNote changes
   the CodeMirror font size, but WebView2 can zoom the entire viewport when
   focus is outside the editor or Ctrl+mouse-wheel is used.
4. **F5, Ctrl+R, and F12:** an unprotected WebView2 may reload the page or open
   developer tools; a reload can discard an unsaved in-memory document.
5. **Non-Latin keyboard layouts:** editor shortcuts use physical key codes
   such as `KeyB` and `KeyZ`, which keeps them working on non-Latin layouts.
   Global handlers must likewise use physical codes when the shortcut is
   layout-independent.
