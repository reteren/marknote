use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use notify_debouncer_full::notify::{event::ModifyKind, EventKind, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter};

type DebouncerHandle =
    Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

const SUPPRESS_DURATION: Duration = Duration::from_millis(1_500);

struct WatcherState {
    app: AppHandle,
    /// Все файлы, открытые в каждом окне.  Раньше здесь был один PathBuf на
    /// метку окна, поэтому открытие второй вкладки затирало наблюдение за
    /// первой.  Идентификатор вкладки не нужен: путь уже приходит в payload,
    /// а фронтенд сопоставляет его со своей вкладкой.
    watched: Mutex<HashMap<String, HashSet<PathBuf>>>,
    roots: Mutex<HashMap<PathBuf, usize>>,
    suppressed: Mutex<HashMap<PathBuf, Instant>>,
    debouncer: Mutex<Option<DebouncerHandle>>,
}

#[derive(Clone)]
pub struct FileWatcher {
    state: Arc<WatcherState>,
}

impl FileWatcher {
    pub fn new(app: tauri::AppHandle) -> Self {
        let state = Arc::new_cyclic(|weak| {
            let callback_state = weak.clone();
            let debouncer = match new_debouncer(Duration::from_millis(200), None, move |result| {
                handle_events(&callback_state, result)
            }) {
                Ok(debouncer) => Some(debouncer),
                Err(error) => {
                    eprintln!("Could not start file monitoring: {error}");
                    None
                }
            };

            WatcherState {
                app: app.clone(),
                watched: Mutex::new(HashMap::new()),
                roots: Mutex::new(HashMap::new()),
                suppressed: Mutex::new(HashMap::new()),
                debouncer: Mutex::new(debouncer),
            }
        });

        Self { state }
    }

    pub fn watch(&self, window_label: &str, path: &std::path::Path) {
        let normalized = normalize_path(path);
        let root = watch_root(&normalized);

        let inserted = self
            .state
            .watched
            .lock()
            .expect("file watcher map poisoned")
            .entry(window_label.to_owned())
            .or_default()
            .insert(normalized);

        // Repeatedly opening the same path in one window is idempotent and
        // must not inflate the directory root reference count.
        if inserted {
            acquire_root(&self.state, root);
        }
    }

    pub fn unwatch(&self, window_label: &str) {
        let removed = self
            .state
            .watched
            .lock()
            .expect("file watcher map poisoned")
            .remove(window_label);

        let Some(paths) = removed else {
            return;
        };

        for path in paths {
            release_root(&self.state, watch_root(&path));
        }
    }

    pub fn suppress(&self, path: &std::path::Path) {
        let path = normalize_path(path);
        let expires_at = Instant::now() + SUPPRESS_DURATION;
        let mut suppressed = self
            .state
            .suppressed
            .lock()
            .expect("suppressed paths poisoned");
        let now = Instant::now();
        suppressed.retain(|_, expiry| *expiry > now);
        suppressed.insert(path, expires_at);
    }
}

fn handle_events(state: &Weak<WatcherState>, result: DebounceEventResult) {
    let Some(state) = state.upgrade() else {
        return;
    };

    let events = match result {
        Ok(events) => events,
        Err(errors) => {
            for error in errors {
                eprintln!("File monitoring error: {error}");
            }
            return;
        }
    };

    let mut emitted = HashSet::new();
    for event in events {
        let deleted = matches!(
            event.kind,
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        );
        let changed = deleted || matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_));
        if !changed {
            continue;
        }

        let event_name = if deleted {
            "file-deleted"
        } else {
            "file-changed-externally"
        };

        for event_path in event.paths.iter() {
            let normalized = normalize_path(event_path);
            if is_suppressed(&state, &normalized) {
                continue;
            }

            let labels = state
                .watched
                .lock()
                .expect("file watcher map poisoned")
                .iter()
                .filter(|(_, watched_paths)| {
                    watched_paths
                        .iter()
                        .any(|watched_path| same_path(watched_path, &normalized))
                })
                .map(|(label, _)| label.clone())
                .collect::<Vec<_>>();

            for label in labels {
                if !emitted.insert((label.clone(), event_name, normalized.clone())) {
                    continue;
                }
                let payload = serde_json::json!({
                    "path": event_path.to_string_lossy().into_owned(),
                });
                if let Err(error) = state.app.emit_to(&label, event_name, payload) {
                    eprintln!("Could not notify window {label} about a file change: {error}");
                }
            }
        }
    }
}

fn is_suppressed(state: &WatcherState, path: &Path) -> bool {
    let now = Instant::now();
    let mut suppressed = state.suppressed.lock().expect("suppressed paths poisoned");
    suppressed.retain(|_, expiry| *expiry > now);
    suppressed
        .iter()
        .any(|(suppressed_path, _)| same_path(suppressed_path, path))
}

fn acquire_root(state: &WatcherState, root: PathBuf) {
    let first_root = {
        let mut roots = state.roots.lock().expect("watcher roots poisoned");
        let count = roots.entry(root.clone()).or_insert(0);
        let first = *count == 0;
        *count += 1;
        first
    };

    if first_root {
        if let Some(debouncer) = state
            .debouncer
            .lock()
            .expect("file debouncer poisoned")
            .as_mut()
        {
            if let Err(error) = debouncer.watch(&root, RecursiveMode::NonRecursive) {
                eprintln!("Could not monitor {}: {error}", root.display());
            }
        }
    }
}

fn release_root(state: &WatcherState, root: PathBuf) {
    let last_root = {
        let mut roots = state.roots.lock().expect("watcher roots poisoned");
        let Some(count) = roots.get_mut(&root) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            roots.remove(&root);
            true
        } else {
            false
        }
    };

    if last_root {
        if let Some(debouncer) = state
            .debouncer
            .lock()
            .expect("file debouncer poisoned")
            .as_mut()
        {
            if let Err(error) = debouncer.unwatch(&root) {
                eprintln!("Could not stop monitoring {}: {error}", root.display());
            }
        }
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn watch_root(path: &Path) -> PathBuf {
    path.parent()
        .map(normalize_path)
        .unwrap_or_else(|| path.to_path_buf())
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}
