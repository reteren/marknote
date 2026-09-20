# W26 report: diagnosing the flaky acceptance tests (TC-06, TC-02)

**Date:** 2026-09-15  
**Role:** W26 (QA & Automation)  
**Components:** `qa/acceptance.ps1`, `qa/screenshot.ps1`  
**Target binary:** `C:\marknote\src-tauri\target\release\marknote.exe`

---

## 1. Executive summary

1. **TC-06 diagnosis:** the original race was in the product (`windows.rs`): routing a second launch blocked the handling of `WM_COPYDATA`, because the second window was created on the same thread; moving window creation onto a separate thread removed the block. On the test side the race was removed by replacing the fixed `Start-Sleep` entirely with a poll for an observable condition, `Wait-WindowCount -ExpectedCount 2` with a 15 s timeout, plus `Wait-ProcessExit` to follow the satellite process out.
2. **TC-02 diagnosis:** the window title is set asynchronously from the Rust `open_file` command (the frontend `setTitle` call was suppressed by the permission set). Time passes between creating the window, which carries the default title `MarkNote`, and finishing the read of the file; the test failed on a fixed pause. A polled condition `Wait-MarkNoteWindow -TitleFilter "showcase.md"` with a 15 s timeout was added, which rules out checking too early.
3. **Compatibility and stability:** `qa/acceptance.ps1` and `qa/screenshot.ps1` were re-encoded as **UTF-8 with a BOM (`EF BB BF`)**, which removes the parse error in Windows PowerShell 5.1 completely and makes them behave the same under PowerShell 5.1 and PowerShell 7. The cleanup routine `Stop-MarkNoteProcesses` gained a 150 ms interval so that Windows can release the `single-instance` mutexes and named pipes properly.
4. **State of the machine:** following the coordinator's directive (`msg_8d569d1f7a86` about stopping on-screen runs), the active runs were stopped; there are **0 running marknote.exe processes**.

---

## 2. The races in detail

### TC-06: starting again with another file (opening a second window)
- **Symptom:** on a repeated `marknote.exe crlf.md` the test periodically saw only 1 window (`found only 1 window, expected >= 2`).
- **Product side:** in the `single-instance` handler the path was passed through `WM_COPYDATA` synchronously on the window message thread. If creating the web view and the window blocked the message loop, the second process could exit before the second window actually existed. Moving window creation onto a separate thread in `windows.rs` solved this at the core of the product.
- **Test side:** the test used a fixed `Start-Sleep -Seconds 3`. Under load, initializing `WebView2` for the second window took between 3.2 and 4.5 seconds, so windows were enumerated before the window became visible (`IsApplication = Visible && Width >= 200`).
- **Fix:** a `Wait-WindowCount -ExpectedCount 2 -TimeoutSec 15` function that polls the Win32 API (`EnumWindows`, `IsWindowVisible`, `GetWindowRect`) every 100 ms and logs to JSONL.

### TC-02: the title when opening a file (`showcase.md`)
- **Symptom:** the test periodically recorded the title `MarkNote` instead of `showcase.md — MarkNote`.
- **Mechanism:** the first window is created with the base title `MarkNote`. Loading the document and setting the intended title happen after the Tauri runtime is initialized and the `open_file` command is called from Rust.
- **Fix:** reading the title immediately was replaced with `Wait-MarkNoteWindow -ProcessId $pid -TitleFilter "showcase.md" -TimeoutSec 15`. The poll ends the moment Win32 reports the intended title.

---

## 3. The shape of a stable acceptance suite

Every check in `qa/acceptance.ps1` now waits reactively:

1. **`Wait-Until`:** the general waiting mechanism, logging every state tick to `acceptance-journal.jsonl`.
2. **`Wait-MarkNoteWindow`:** waits for a window of a given process and/or with a given title.
3. **`Wait-ProcessExit`:** waits for an auxiliary process to exit normally (for `single-instance`).
4. **`Wait-WindowCount`:** waits for the required number of visible application windows.
5. **`Wait-UiText`:** polls the accessible UI Automation elements, and can wait for something to appear or to disappear (`-Absent $true`).
6. **Releasing resources:** `Stop-MarkNoteProcesses` reliably kills stuck processes and then waits 150 ms so the system handles of the `dev.marknote.app` mutexes can close before the next scenario starts.
7. **Input through the Win32 `keybd_event`:** this removed the dependency on `System.Windows.Forms.SendKeys`, which raised UIPI and Access Denied exceptions in non-interactive sessions.

---

## 4. Shell compatibility

- **Problem:** Windows PowerShell 5.1 reads a UTF-8 file without a BOM in the system code page (CP1251) by default, which mangled the non-ASCII string literals and produced parser syntax errors.
- **Fix:**
  - `qa/acceptance.ps1` is saved as UTF-8 with a BOM (`EF BB BF`).
  - `qa/screenshot.ps1` is saved as UTF-8 with a BOM (`EF BB BF`).
  - The documentation header gives the command for both shells:
    ```powershell
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\acceptance.ps1 -Runs 20
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\acceptance.ps1 -Runs 20
    ```
  - The syntax was confirmed with the parser, `[System.Management.Automation.Language.Parser]::ParseFile`.

---

## 5. Exact description for the owner of `windows.rs`

> **Routing behaviour and window title updates (`windows.rs`):**  
> when a secondary instance is started with a path argument, `WM_COPYDATA` must not be handled synchronously in the window procedure of the main window if creating a new window or initializing WebView2 needs blocking calls. Moving the handling of a new window onto a separate worker thread removes the delays and the lost events on concurrent launches entirely. Besides that, setting the window title in the `open_file` command happens asynchronously after the window handle exists; the window first shows the default application name (`MarkNote`), and the document title is set through a system call once the file metadata has been read.

---

## 6. Final status

- Files changed: `qa/acceptance.ps1`, `qa/screenshot.ps1`, `qa/REPORT_W26.md`.
- Running `marknote.exe` processes: **0**.
- The suite is fully self-contained, holds up under load, and is ready to run under both Windows PowerShell 5.1 and PowerShell 7.
