# W146 — end-to-end release 1.0.17 check

The checked build was `src-tauri/target/release/marknote.exe` (ProductVersion
1.0.17) with a separate `MARKNOTE_CONFIG_DIR` under `%TEMP%`. Before each
release-exe launch, `qa/Assert-NoForeignMarkNote.ps1` was called; no foreign
installed process was found. All windows launched by me were closed through
`CloseMainWindow`, without `Kill`.

## Results

| What was measured/checked | Method | Before/scenario | After/result | Evidence |
|---|---|---|---|---|
| Acceptance smoke | `pwsh -File qa/acceptance.ps1 -Runs 1` | 9 standard tests | 9/9 passed: window, Markdown, cp1251 TXT, nonexistent path, single-instance, two windows, large file, binary notice, Ctrl+F | `qa/acceptance-summary.json`, `qa/shots/w146-acceptance/run_001_*.png` |
| Large file | CDP, `qa/w146-fixtures.mjs` | `large-5mb.md` — 5 242 880 bytes | `large-5mb.md — MarkNote`; status shows 5 242 880 chars, 5 028 lines, 15 084 words | `qa/shots/w146/w146-large-5mb-cdp.png` |
| `.md`, `.txt`, `.py`, `.json` | release launch + CDP | opening each file | Titles/formats correct; Python and JSON were highlighted, and line numbers were visible in Python | `w146-showcase-fresh.png`, `w146-py-before.png`, `w146-json-before.png`, acceptance `run_001_02/03` |
| Binary file | acceptance | `logo.png` | Clear binary notice, no empty editor | `qa/shots/w146-acceptance/run_001_08_binary_rejected.png` |
| Preview: headings, lists, tasks, quote, callouts, table | CDP scroll + class/visual snapshot | showcase.md | `cm-marknote-heading`, bullet/ordered/checkbox, blockquote, note/warning/tip callouts, and table were really present | `qa/shots/w146/w146-showcase-middle.png` |
| Preview: code, `$$`, hr, footnotes, image | CDP scroll + class/visual snapshot | showcase.md | `cm-marknote-code-block`, `cm-marknote-math cm-marknote-math-display` + KaTeX, `cm-marknote-hr`, footnotes, and image were present | `qa/shots/w146/w146-showcase-bottom-final.png` |
| Markdown context menu | CDP right-click + hover Formatting | before: ordinary menu only; after hover | `Formatting ›` opens Bold/Italic/Strikethrough/Highlight/Code/Link/Clear Formatting | `qa/shots/w146/w146-context-md.png`, `qa/shots/w146-context-md-format.png` |
| Python context menu | CDP right-click | before: Python | After the menu contains only Cut/Copy/Paste/Delete/Select All; no Markdown commands | `qa/shots/w146/w146-py-context.png` |
| JSON context menu | CDP right-click + hover Insert | before: JSON | After `Insert ›` contains `Validate JSON` and `Format JSON`; no Markdown section | `qa/shots/w146/w146-json-context-insert.png` |
| Ctrl+B Markdown | CDP `Input.dispatchKeyEvent` on simple Markdown | `drag.md`, 59 chars | After selection and Ctrl+B, `**...**` appeared, status Unsaved; the window was then closed without saving | `qa/shots/w146/w146-drag-bold-after.png` |
| Ctrl+B Python | CDP `Input.dispatchKeyEvent` | `sample.py`, 66 editor chars | After Ctrl+B, textLength remained 66, status Saved, and no markup was added | `qa/shots/w146/w146-py-after-ctrl-b.png` |
| Tabs and unsaved close | CDP `+`, click tabs, insertText, close | one JSON tab | New tab, switch back, Unsaved and Save/Discard/Cancel dialog; Discard returned to the original tab | `w146-tabs-new.png`, `w146-tabs-switched-json.png`, `w146-tabs-unsaved.png`, `w146-tabs-close-unsaved-dialog.png`, `w146-tabs-discarded.png` |
| Editor settings | CDP Settings → Editor | font `system-sans`, zoom 110%, line numbers off | `monospace` selected; line-number checkbox toggled off→on; settings window opens | `w146-settings-editor.png`, `w146-settings-font-after.png`, `w146-settings-line-numbers-toggled.png` |
| Zoom Ctrl+`+` | CDP computed style before/after | `.cm-content`: 16px | after `Ctrl+Shift+=`: 17.6px | `w146-zoom-after-ctrl-plus.png` |
| Live preview | CDP Settings → Preview | Live preview checked | toggled checked→unchecked, then back to checked; Render formulas/images remained checked | `w146-settings-preview.png`, `w146-settings-preview-off.png` |
| Find/replace/go-to-line | CDP shortcuts | closed editor | Ctrl+F opened the find panel, Ctrl+H expanded Replace/Replace All, Ctrl+G opened Go to line | `w146-find-panel.png`, `w146-replace-panel.png`, `w146-goto-fresh-python.png` |
| Build tests | Vitest/TypeScript | before the run | `51 files, 433 tests passed`; `npx tsc --noEmit` exit 0 | console output from the run |

## Bug found

Ctrl+A → Ctrl+B on the full `fixtures/showcase.md` (with table, code blocks,
formula, and hr) did more than wrap the text: a long horizontal line
`────────────────…` was inserted at the beginning of the document, and the
editor marked the document as saved and wrote the change to the fixture.
Snapshot: `qa/shots/w146/w146-markdown-bold-after-key-correct.png`; this is P2
(the formatting command corrupts a document when all multi-block Markdown is
selected and can change the file on disk). The fixture was restored to its
original state after the check; source code was not changed.

## Not covered by proven checks

| Area | Reason | Status |
|---|---|---|
| Actual Windows file drag-and-drop | CDP `Input.dispatchMouseEvent` does not create a host-level Tauri file-drop payload | Not proven; separate acceptance TC-06 checked opening a second file and two windows, but this does not replace drop |
| Save As and overwriting an existing file | The system file picker is outside WebView CDP; the owner's native dialog was not touched | Not proven in live UI; Save/Save As buttons are visible and the existing Save state was checked |
| Recent files | `qa/acceptance.ps1` has no recent-files scenario, and adding one through the system picker would require manual OS UI | Not proven |

The first acceptance run through Windows PowerShell 5.1 failed while parsing
UTF-8/quotes in `qa/acceptance.ps1` itself (around line 777), before MarkNote
started; a repeat through PowerShell 7 passed 9/9. This is a harness defect, not
a release-program defect.
