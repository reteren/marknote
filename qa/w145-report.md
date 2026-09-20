# W145 — WebView2 memory

## Summary

No WebView2 arguments were added to the production configuration: none of the
individually tested safe switches delivered the required 30 MB reduction, and
`--disable-gpu` left a software GPU process and requires a separate smoothness
check. This is a negative measurement result, not a guess-based optimization.

Measurements used `qa/measure-memory.ps1 -SettleSeconds 6` on one release
`target/release/marknote.exe`, with a temporary `MARKNOTE_CONFIG_DIR`. The
script now accepts `-AdditionalBrowserArgs` for A/B trials and `-OutputPath`
to save complete command lines and process roles.

## Processes and numbers

| Process / argument | Role | Working set |
|---|---|---:|
| `marknote.exe` | application | 25.8 MB |
| `msedgewebview2.exe` without `--type` | browser | 125.3 MB |
| `--type=renderer` | renderer | 84.2 MB |
| `--type=gpu-process` | GPU | 72.3 MB |
| `--type=utility --utility-sub-type=network.mojom.NetworkService` | network | 36.8 MB |
| `--type=utility --utility-sub-type=storage.mojom.StorageService` | storage | 19.6 MB |
| `--type=crashpad-handler` (1) | crash reports | 11.4 MB |
| `--type=crashpad-handler` (2) | crash reports | 10.2 MB |
| **Total** | **8 processes** | **385.6 MB** |

Full command lines are saved in `qa/w145-baseline.json`.

| Variant | Processes | Before | After | Difference | Arguments |
|---|---:|---:|---:|---:|---|
| baseline | 8 | — | 385.6 MB | — | wry defaults |
| crash reporter | 7 | 385.6 MB | 375.0 MB | −10.6 MB | `--disable-crash-reporter` |
| GPU | 8 | 385.6 MB | 360.7 MB | −24.9 MB | `--disable-gpu` |

Both A/B runs explicitly passed the saved set of wry defaults:
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. The
`--disable-crash-reporter` variant removed only one of the two crashpad
processes, so the saving was 10.6 MB rather than the expected 20–23 MB. The
`--disable-gpu` variant did not disable the process completely: it became a
software process using 46.8 MB, so the saving was 24.9 MB and did not reach the
30 MB criterion; it was not added to the configuration.

The network and storage utility processes are needed by WebView2 itself to load
the application, handle IPC, and store data. There is no separate audio
utility in the baseline, so service processes must not be disabled without a
proven switch and regression check.

The combined experiment was discarded: during a repeat run, another QA agent
occupied the single-instance release process with its `w146-fixtures`
document, and the launch received an empty process tree. Zero is not a
measurement; no production change was made based on it.

## Configuration and windows

Tauri 2 documents `app.windows[].additionalBrowserArgs` as a string field:
<https://v2.tauri.app/reference/config/#windowconfig>. The documentation
separately warns that this field replaces wry arguments and that, when set, you
must preserve `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
yourself. This matches local
`wry-0.55.1/src/webview2/mod.rs:294-327`.

Dynamic windows in `src-tauri/src/windows.rs:create_window` copy the main-window
configuration and change only label/title/visibility;
`additionalBrowserArgs` and the data directory remain the same. Therefore they
use the same WebView2 environment rather than a second set of arguments/data.
Because another QA process was active, a separate live measurement of the
second window was not performed in this task; window creation was not changed.

## Tested but unchanged

- Crashpad: measured separately, −10.6 MB — below the threshold.
- GPU: measured separately, −24.9 MB, but software GPU remained; without a
  live test of long scrolling, KaTeX, images, tables, and save dialogs, the
  change is not accepted.
- Network/storage/audio: network and storage were found in the tree; audio was
  not found. Disabling required utility processes was not attempted.
- Default wry features: preserved in both A/B argument sets and not overridden
  in production.
- Second window: the code copies one configuration; a separate process-tree A/B
  result was not obtained because of the concurrent single-instance QA launch.

## Checks

- `cargo test -j 2`: 94 + 56 tests passed.
- `cargo fmt --check`: clean.
- `npx tsc --noEmit`: clean.
- `npx vitest run --poolOptions.threads.maxThreads=3`: 51 files, 433 tests
  passed.

## W147 — accepted decision

By the owner's decision, disabling the crash reporter was accepted despite the
30 MB threshold: MarkNote neither collects nor reads these reports, so the
risk is absent. `src-tauri/tauri.conf.json` now contains
`app.windows[0].additionalBrowserArgs` with `--disable-crash-reporter` and the
full set of wry defaults. The post-rebuild number and the two-window check must
be added after the W146 native slot is available; do not launch before then.

## Coordinator addendum, 20.09.2026

The decision was made as follows: do not touch the graphics process (a 24.9 MB
saving with 46.8 MB of software rendering and a risk of jerky scrolling);
disable crash reporting because there is no risk and the reports are not
collected anywhere.

Change: `additionalBrowserArgs` in `src-tauri/tauri.conf.json`; the standard wry
arguments are preserved.

| Measurement | Before | After |
|---|---:|---:|
| Clean launch without a file | 8 processes, 385.6 MB | 7 processes, 376.2 MB |

A live check on the built application with crash reporting disabled confirmed:
the KaTeX formula rendered, code blocks and footnotes were present, scrolling
worked, and there were no page errors (snapshot
`qa/shots/crashoff-check.png`).

### The second window shares the engine

| State | Processes | Subtree memory |
|---|---:|---:|
| One window with a document | 8 | 399.1 MB |
| Two windows | 9 | 487.7 MB |

The second window costs about 89 MB: only a renderer is added, while the main
process, graphics, and utility processes are shared. This answers the task's
main question: the process set does not double.
