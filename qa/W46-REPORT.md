# W46 — build and acceptance of 1.0.3

## The build and the sizes

`npm run tauri build` finished with code 0. It produced
`src-tauri/target/release/bundle/nsis/MarkNote_1.0.3_x64-setup.exe` and
`src-tauri/target/release/marknote.exe`; the EXE has `FileVersion` and
`ProductVersion` equal to `1.0.3`. `package.json` was not touched: the build
still prints its version as `1.0.2`, as expected while that file was left to
the coordinator.

| Artifact | Before the build | After the build | Change |
| --- | ---: | ---: | ---: |
| NSIS 1.0.2 → 1.0.3 | 2,183,394 B | 3,028,411 B | +845,017 B (+38.70%) |
| `target/release/marknote.exe` | 6,642,176 B | 6,899,712 B | +257,536 B (+3.88%) |

The "before" size of the EXE is the binary that was sitting in the working
directory, dated 2026-09-14 19:53; this compares against that older EXE, not
against a control build of 1.0.2. The sizes of the dependencies' own release
archives after the build:

| Crate | `.rlib` | `.rmeta` |
| --- | ---: | ---: |
| `pdf-extract` | 3,934,002 B | 905,109 B |
| `docx-rs` | 21,680,064 B | 8,511,346 B |

Those are the sizes of Cargo's input archives, not of the bytes that ended up
in the application. `[profile.release]` turns on LTO, a single codegen unit and
stripping; the linker drops and merges code. From a single built configuration
the growth of the EXE and the installer cannot honestly be split between these
two crates: it also contains changes to the application itself. Only the total
growth of the installer and the EXE given above is measured reliably; telling
what each crate costs would need control builds without each of them.

## Acceptance

Two runs of `pwsh ... qa/acceptance.ps1 -Runs 1` were made against the new EXE.
The first was polluted by another agent launching the program in parallel and
does not count as acceptance; the coordinator reported the interference was
stopped, after which one clean repeat run was made. Its journal is
[`w46-clean-acceptance-1.0.3.jsonl`](w46-clean-acceptance-1.0.3.jsonl), the
screenshots are in [`shots/w46-clean`](shots/w46-clean). The clean result is
8/10, with 0/1 fully green runs.

| Test | Result | Observation |
| --- | --- | --- |
| TC-01 | PASS | Window `MarkNote`, 916×739, visible |
| TC-02 | PASS | `showcase.md — MarkNote`, 916×739, visible |
| TC-03 | PASS | `cp1251.txt — MarkNote`, 916×739, visible |
| TC-04 | PASS | The window stays responsive for a path that does not exist |
| TC-05 | PASS | Starting the same file again left one process and one window |
| TC-06 | PASS | A second file opened a second window in the same process |
| TC-07 | PASS | `big-10k.md` opened; the process responded |
| TC-08 | FAIL | The application refused the PNG and showed the toast `This file appears to be binary and cannot be opened as text.`; the test still looks for the old Russian string. Confirmed by the screenshot from the clean run: [binary rejection](shots/w46-clean/run_001_08_binary_rejected.png). The failure is a stale expectation in the acceptance script, not a fault in the product. |
| TC-09 | FAIL | The Markdown tile was clicked, `qa-unsaved` was found in the document, then `Alt+F4` was sent; `Save changes?` did not appear within 5 seconds and the process and window disappeared (`processCount=0`). In the clean run an unsaved document closed without a dialog; that is a defect in the close behaviour, and the product was not fixed here. |
| TC-10 | PASS | On the clean run `Ctrl+F` opened the search panel (`searchPanel=True`), the process stayed alive, and there was one window. |

TC-10, red in the polluted run, passed once the outside acceptance run was
stopped; the earlier red result is not trustworthy. The clean run proves the
TC-09 defect, but one repetition is not enough to judge how stable it is.

The first (polluted) run created 10 visible windows; the clean one, 11 (TC-06
creates two). Across both acceptance runs there were 24 launches of the EXE and
21 visible windows. No extra manual launch was made. After the clean run there
are no `marknote.exe` processes left.

## Checklist

In [`CHECKLIST.md`](CHECKLIST.md) the close dialog, the search and the start
screen were brought in line with the current English labels, and manual
scenarios were added for changing the file type while keeping text, cursor and
undo, for the file shortcuts while the editor has focus, for the title update,
the zoom, the three Help items and the refusal of a binary file.
