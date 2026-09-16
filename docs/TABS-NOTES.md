# W99 report

## State API

`src/state/workspace.svelte.ts` owns one reactive workspace with a stable
one-tab invariant, lifecycle operations, and display labels.  `documentState`
in `document.svelte.ts` remains the same exported object and is a Proxy view;
reads and writes are forwarded to the active tab document, so existing callers
do not need to know about tabs.

`createAutosave` keeps a timer and in-flight/queued save state per tab id.  The
workspace change subscription schedules edits on the owning tab and preserves
an existing timer when another tab is activated.  External file events are
matched against every tab in the window, so a clean inactive tab can reload and
a dirty inactive tab records its conflict.  `flushAll` is available for a
future close-all flow while the legacy `flush` continues to target the active
tab.

## Closing dirty tabs

`closeTab` refuses to remove the final tab, preserving the contract that a
window never has zero tabs.  The tab UI should run the existing save/discard/
cancel close protocol for a dirty tab before calling it; when the final tab is
accepted, the UI should request native window close.  Closing a window with
multiple dirty tabs should present one aggregated decision listing each dirty
tab, then flush or discard all selected tabs before native close; this remains
an App/UI responsibility so no policy is silently changed in state.

## Rust watcher and open-file registry

`src-tauri/src/watcher.rs` currently keys `watched` by window label and replaces
the previous path for that label.  With tabs it must key watches by a stable
`(window_label, tab_id)` (or keep a path-to-tab set) while retaining one native
watch per directory root; emitted payloads already include the path and can be
routed to the matching tab in the frontend.  `src-tauri/src/windows.rs` has the
same shape in `AppState.open_files: HashMap<PathBuf, String>` and
`track_file`/`forget_file`: those entries need tab ownership for in-window
deduplication, while explorer opens can continue to resolve a file to a new
window as required by the contract.

