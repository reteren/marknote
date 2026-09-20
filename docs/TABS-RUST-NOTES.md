# W102 report

## The owner's decision

The minimal option from `docs/TABS-NOTES.md` was chosen: IPC was not changed to
carry a `tabId`, because Rust already receives only the window label, the event
payload already contains the path, and the frontend matches it against a tab.
`FileWatcher` now keeps a set of paths per window label (`HashMap<String,
HashSet<PathBuf>>`), so adding a second tab does not displace the first;
registering a path again is idempotent. The `roots` counter still keeps one
system watcher per directory, and event deduplication takes the path into
account so that two changes inside one debounce batch do not merge into a
single event.

`AppState.open_files` now keeps a set of window labels per path
(`HashMap<PathBuf, HashSet<String>>`). That preserves what is known about a
file while the same path is open in several windows (for example with
`raiseExistingWindow` off), and closing one window removes only that window's
ownership; the file snapshot is dropped only once the last owner is gone.
Opening from Explorer and the routing still pick or create a window according
to `raiseExistingWindow`; the tab id stays a frontend detail.

## Checks

- `cargo test`: 82 unit + 56 disk tests passed, including the test with two
  files in one window and separate events for each path.
- `cargo build`: covered by a successful compilation of the test profile; the
  coordinator is advised to run an ordinary build separately before the report.
- `cargo fmt --check`: passed.
