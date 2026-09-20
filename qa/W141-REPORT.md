# W141: startup and Rust measurements

All executable measurements used `target/release/marknote.exe`, an isolated
`MARKNOTE_CONFIG_DIR` under `%TEMP%`, and a fresh WebView2 remote-debugging
port. `qa/measure-startup.ps1` waits for an actual editable `.cm-content`,
not merely a window or DevTools target; file fixtures are generated at exactly
10 KiB, 1 MiB, and 10 MiB. `MARKNOTE_STARTUP_TRACE=1` enables the opt-in Rust
stage lines captured in the JSON reports.

## Startup after the change

Times are process start to the editor containing the expected fixture text;
three runs are cold, warm, warm. The no-file row measures the editor becoming
editable (there is no expected file text).

| launch | run 1 ms | run 2 ms | run 3 ms | average ms |
| --- | ---: | ---: | ---: | ---: |
| no file | 463.5 | 507.2 | 454.0 | 474.9 |
| 10 KiB argument | 490.5 | 499.2 | 478.8 | 489.5 |
| 1 MiB argument | 735.1 | 729.9 | 852.4 | 772.5 |
| 10 MiB argument | 1890.1 | 1832.5 | 1876.1 | 1866.2 |

Source: `qa/w141-after.json`. The large-file time is primarily the WebView2 /
CodeMirror content path, not Rust setup: the 10 MiB Rust trace reaches
`open-file-done` at 446.7, 441.7, and 450.0 ms respectively, while the real
editable editor appears around 1.8–1.9 s.

## Rust stage measurements

Across the startup traces, settings loading takes 0.5–1.0 ms, recent-files
loading 0.5–1.1 ms, and window-state restoration 12.6–16.4 ms in the current
run. The main-window setup and show calls are also sub-millisecond; the
variable 275–329 ms interval before `setup-start` is WebView2/Tauri native
environment creation. No startup optimization was applied to those native
stages because they are outside the app's Rust work and no safe deferral was
measured.

## File handoff and the actual Rust optimization

`open_in_new_window` used to validate by reading and decoding a file, then the
new webview called `open_file` and read/decoded the same file again. With a
10 MiB fixture, the before trace measured validation `504.151 -> 542.608 ms`
(38.5 ms) and the second `open_file` `719.657 -> 759.380 ms` (39.7 ms),
including two reads and two encoding decodes. `PendingOpenData` now carries the
validated decoded text and metadata through `AppState`; the after trace shows
validation `507.760 -> 545.486 ms` (37.7 ms), then
`open-file-prepared-data-reused` and `open_file` `733.613 -> 737.589 ms`
(4.0 ms). The measured invoke-to-`open-file-done` interval fell from 255.2 ms
to 229.8 ms in these runs; the frontend still spends about 1.6 s rendering
the 10 MiB document.

The validation is still performed, so binary/format errors still prevent a
new window from being routed. A pending payload is keyed by destination window
and canonical path, consumed once, and removed when that window is forgotten.

Native empty “New window” measured 96.8 ms for the command and 232.7 ms from
invoke to the second editable editor; frontend “New tab” measured 13.1 ms.
These are recorded by `qa/measure-actions.ps1` and
`qa/measure-actions-cdp.mjs` using CDP and real mouse input for the tab.

## Release profile comparison

The configured release profile (`opt-level = "s"`) was restored after the
comparison. Three no-file startup runs gave 476.4, 455.1, and 463.5 ms
(average 465.0 ms) with a 7,249,408-byte executable. A temporary
`opt-level = 3` build gave 498.3, 485.7, and 455.0 ms (average 479.7 ms) and a
9,275,904-byte executable. `opt-level = 3` is about 3% slower in this sample
and 28% larger, so changing the profile would not be a justified startup fix.

## Checked but not optimized

- Settings and recent-files parsing: measured below 1.1 ms; no repeated
  migration or write appeared on fresh isolated settings, so no change.
- Window-state restoration: measured roughly 13–25 ms; deferring it would
  visibly move the window and is not worth the small gain.
- `adapter_for_path` and format selection: sub-millisecond in the traces;
  the lazy registry is not a startup bottleneck.
- Encoding detection: a few milliseconds for 10 MiB; not the source of the
  1.8–1.9 s editable-editor time.
- WebView2 environment and frontend/editor parsing: dominant, but outside the
  safe Rust deferral scope; no speculative change was made.

Verification: `cargo fmt --check`, `cargo test -j 2`,
`npx vitest run --poolOptions.threads.maxThreads=3`, and `npx tsc --noEmit`.
