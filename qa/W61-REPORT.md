# W61 — UI Automation and TC-09/TC-10

## The actual UI Automation tree

The captured UIA tree is saved in [ui-automation-tree-1.0.4.txt](ui-automation-tree-1.0.4.txt). The capture of the start screen waited until the web content was available: the root window has type `ControlType.Window`; the `Markdown .md` tile shows up as a `ControlType.DataItem` whose class starts with `tile` and whose bounds are `(578, 627, 140, 77)`. After `Ctrl+F` the panel is a `ControlType.Window` named `Find and replace` with the class `find-panel…`; the input is a `ControlType.Edit` named `Search query`.

On that evidence `qa/acceptance.ps1` now looks elements up by a substring of the name together with the type and the class. The tile has a fallback for an empty UIA name: the first `DataItem` of class `tile` in screen order, which is Markdown in the format grid we observed. TC-10 now waits for the CodeMirror `Edit` element of class `cm-content…` to appear before sending `Ctrl+F`, and then checks both the panel and the search field.

## The single full run

One full run of the ten scenarios as they stood then was performed. It finished `8/10`: TC-01 through TC-08 passed, TC-09 and TC-10 failed.

| Scenario | Result | Observation |
| --- | --- | --- |
| TC-01 | PASS | A window with no arguments and the title `MarkNote`. |
| TC-02 | PASS | `showcase.md` opened. |
| TC-03 | PASS | `cp1251.txt` opened. |
| TC-04 | PASS | A path that does not exist did not end the process; the window stayed visible. |
| TC-05 | PASS | Starting again with the same file exited, leaving one process. |
| TC-06 | PASS | Separate windows opened for `showcase.md` and `crlf.md`. |
| TC-07 | PASS | `big-10k.md` opened and the process responded. |
| TC-08 | PASS | `logo.png` was refused with a message about opening a binary file as text. |
| TC-09 | FAIL | The start screen closed and the editor appeared, but after Ctrl+V the counter stayed at `0 chars`; the scenario therefore never reached the close dialog. |
| TC-10 | FAIL | The `showcase.md` title appeared, but the scenario checked for the editor before it was mounted and ended before sending `Ctrl+F`. |

After the run a separate diagnostic attempt at typing also left `0 chars`, both with Ctrl+V and with `SendKeys`. Another live diagnostic capture showed that once the editor has focus, `Ctrl+F` opens the panel with an accessible UIA `Search query` field. That points at synthetic input being unreliable for TC-09, and at a race over editor readiness in the old TC-10.

TC-09 was dropped from the future automatic set and moved to [CHECKLIST.md](CHECKLIST.md), with steps for checking a non-zero counter, the `Save changes?` dialog, the text surviving `Cancel`, and closing through `Discard`. The future set therefore holds nine automatic scenarios; after the single permitted full run, the updated nine scenarios and the editor wait in TC-10 were not run again. The historical 8/10 result and the detailed journal live in the run output, `acceptance-summary.json` and `acceptance-journal.jsonl`, which are kept outside the repository.

W61 made four direct diagnostic launches of the application; one stopped on an error in a diagnostic PowerShell helper before reading UIA, the rest were used for the tree and for checking input and search. Exactly one full acceptance run was performed; it opened 11 visible windows across its scenarios. Every `marknote` process was ended after the check.
