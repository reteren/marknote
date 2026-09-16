# W99 report

## State API

**Статус W104:** состояние вкладок и прокси `documentState` подключены (W99),
а сохранение `EditorState` при переключении реализовано (W101). Ниже оставлены
рабочие детали контракта; новые хранилища для текста не заводятся.

`src/state/workspace.svelte.ts` owns one reactive workspace with a stable
one-or-more-tab invariant, lifecycle operations, and display labels.  `documentState`
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

**Статус W104:** инвариант последней вкладки и запрос решения для одной грязной
вкладки подключены; сводный протокол для нескольких грязных вкладок остаётся в
работе у App/UI.

`closeTab` refuses to remove the final tab, preserving the contract that a
window never has zero tabs.  The tab UI should run the existing save/discard/
cancel close protocol for a dirty tab before calling it; when the final tab is
accepted, the UI should request native window close.  Closing a window with
multiple dirty tabs should present one aggregated decision listing each dirty
tab, then flush or discard all selected tabs before native close; this remains
an App/UI responsibility so no policy is silently changed in state.

## Rust watcher and open-file registry

**Статус W104:** структура многовкладочного наблюдения уже переведена на наборы
путей (`watched: HashMap<String, HashSet<PathBuf>>`) и реестр владельцев файла
(`open_files: HashMap<PathBuf, HashSet<String>>`). Окончательная маршрутизация и
приёмка событий между вкладками всё ещё в работе, поэтому пункт не считается
закрытым.

`src-tauri/src/watcher.rs` keeps one native watch per directory root and emits
the changed path; the autosave layer matches it against tab documents, while
final integration and acceptance remain in work. `src-tauri/src/windows.rs`
keeps tab/window ownership in the open-file registry. Explorer opens are routed
outside the current tab set: a free startup window is reused when available,
otherwise a new window is created. This differs from the contract's
unconditional «new window» wording
and remains to be reconciled.
