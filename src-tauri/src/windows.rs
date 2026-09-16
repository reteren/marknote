use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Mutex,
    },
    time::SystemTime,
};

use tauri::{
    webview::{PageLoadEvent, WebviewWindowBuilder},
    Emitter, EventTarget, Manager, WebviewWindow, WindowEvent,
};

use crate::{
    messages::UserMessage,
    settings::{Settings, SettingsState},
    watcher::FileWatcher,
};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_LABEL_PREFIX: &str = "win-";
const CLOSE_RESPONSE_TIMEOUT_SECS: u64 = 5;

/// Общее состояние процесса: реестр файлов, свободные стартовые окна и watcher.
pub struct AppState {
    pub(crate) open_files: Mutex<HashMap<PathBuf, String>>,
    pub(crate) empty_windows: Mutex<HashSet<String>>,
    pending_files: Mutex<HashMap<String, PathBuf>>,
    pending_formats: Mutex<HashMap<String, String>>,
    file_snapshots: Mutex<HashMap<PathBuf, FileSnapshot>>,
    pending_closes: Mutex<HashMap<String, u64>>,
    approved_closes: Mutex<HashSet<String>>,
    pub(crate) next_window_id: AtomicUsize,
    next_close_id: AtomicU64,
    pub(crate) watcher: FileWatcher,
}

/// The on-disk state observed when a document was opened or last saved.
/// mtime plus size catches ordinary external edits without hashing every save.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileSnapshot {
    pub(crate) modified: Option<SystemTime>,
    pub(crate) len: u64,
}

impl FileSnapshot {
    pub(crate) fn from_metadata(metadata: &std::fs::Metadata) -> Self {
        Self {
            modified: metadata.modified().ok(),
            len: metadata.len(),
        }
    }
}

impl AppState {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            open_files: Mutex::new(HashMap::new()),
            empty_windows: Mutex::new(HashSet::new()),
            pending_files: Mutex::new(HashMap::new()),
            pending_formats: Mutex::new(HashMap::new()),
            file_snapshots: Mutex::new(HashMap::new()),
            pending_closes: Mutex::new(HashMap::new()),
            approved_closes: Mutex::new(HashSet::new()),
            next_window_id: AtomicUsize::new(1),
            next_close_id: AtomicU64::new(1),
            watcher: FileWatcher::new(app),
        }
    }

    fn mark_empty(&self, label: &str) {
        if let Ok(mut empty) = self.empty_windows.lock() {
            empty.insert(label.to_owned());
        }
    }

    fn take_empty(&self) -> Option<String> {
        let mut empty = self.empty_windows.lock().ok()?;
        let label = empty.iter().next()?.clone();
        empty.remove(&label);
        Some(label)
    }

    fn reserve_file(&self, key: PathBuf, label: &str) {
        if let Ok(mut open_files) = self.open_files.lock() {
            open_files.insert(key, label.to_owned());
        }
        if let Ok(mut empty) = self.empty_windows.lock() {
            empty.remove(label);
        }
    }

    /// Stores a file until the webview has installed its event listener and
    /// asks for the initial route through IPC.
    pub(crate) fn set_pending_file(&self, label: &str, path: PathBuf) {
        if let Ok(mut pending) = self.pending_files.lock() {
            pending.insert(label.to_owned(), path);
        }
    }

    /// Takes the pending file exactly once.  This makes the startup handoff
    /// safe even when the event and the IPC fallback race each other.
    pub(crate) fn take_pending_file(&self, label: &str) -> Option<PathBuf> {
        self.pending_files.lock().ok()?.remove(label)
    }

    pub(crate) fn forget_pending_file(&self, label: &str) {
        if let Ok(mut pending) = self.pending_files.lock() {
            pending.remove(label);
        }
    }

    pub(crate) fn set_pending_format(&self, label: &str, format_id: String) {
        if let Ok(mut pending) = self.pending_formats.lock() {
            pending.insert(label.to_owned(), format_id);
        }
    }

    pub(crate) fn take_pending_format(&self, label: &str) -> Option<String> {
        self.pending_formats.lock().ok()?.remove(label)
    }

    /// Starts one close handshake for a window.  A second native close while
    /// the first one is awaiting the frontend response is deliberately
    /// ignored; the original request remains authoritative.
    fn begin_close(&self, label: &str) -> Option<u64> {
        let mut pending = self.pending_closes.lock().ok()?;
        if pending.contains_key(label) {
            return None;
        }
        let request_id = self.next_close_id.fetch_add(1, Ordering::Relaxed);
        pending.insert(label.to_owned(), request_id);
        Some(request_id)
    }

    /// Resolves a close request if it is still current.  The timeout path
    /// supplies its request id so an old watchdog cannot close a later request.
    pub(crate) fn resolve_close(&self, label: &str, request_id: Option<u64>, allow: bool) -> bool {
        let mut pending = match self.pending_closes.lock() {
            Ok(pending) => pending,
            Err(_) => return false,
        };
        let Some(current_id) = pending.get(label).copied() else {
            return false;
        };
        if request_id.is_some_and(|request_id| request_id != current_id) {
            return false;
        }
        pending.remove(label);
        drop(pending);

        if allow {
            if let Ok(mut approved) = self.approved_closes.lock() {
                approved.insert(label.to_owned());
            }
        }
        true
    }

    fn consume_approved_close(&self, label: &str) -> bool {
        self.approved_closes
            .lock()
            .map(|mut approved| approved.remove(label))
            .unwrap_or(false)
    }

    pub(crate) fn clear_approved_close(&self, label: &str) {
        if let Ok(mut approved) = self.approved_closes.lock() {
            approved.remove(label);
        }
    }

    pub(crate) fn track_file(&self, path: &Path, label: &str) {
        self.reserve_file(registry_key(path), label);
    }

    pub(crate) fn remember_file_snapshot(&self, path: &Path, metadata: &std::fs::Metadata) {
        if let Ok(mut snapshots) = self.file_snapshots.lock() {
            snapshots.insert(registry_key(path), FileSnapshot::from_metadata(metadata));
        }
    }

    pub(crate) fn file_snapshot(&self, path: &Path) -> Option<FileSnapshot> {
        self.file_snapshots
            .lock()
            .ok()
            .and_then(|snapshots| snapshots.get(&registry_key(path)).copied())
    }

    fn forget_window(&self, label: &str) {
        let owned_paths = self
            .open_files
            .lock()
            .map(|open_files| {
                open_files
                    .iter()
                    .filter(|(_, owner)| owner.as_str() == label)
                    .map(|(path, _)| path.clone())
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();
        if let Ok(mut open_files) = self.open_files.lock() {
            open_files.retain(|_, owner| owner != label);
        }
        if let Ok(mut snapshots) = self.file_snapshots.lock() {
            snapshots.retain(|path, _| !owned_paths.contains(path));
        }
        if let Ok(mut empty) = self.empty_windows.lock() {
            empty.remove(label);
        }
        if let Ok(mut pending) = self.pending_files.lock() {
            pending.remove(label);
        }
        if let Ok(mut pending) = self.pending_formats.lock() {
            pending.remove(label);
        }
        if let Ok(mut pending) = self.pending_closes.lock() {
            pending.remove(label);
        }
        self.clear_approved_close(label);
        self.watcher.unwatch(label);
    }

    fn forget_file(&self, key: &Path, label: &str) {
        if let Ok(mut open_files) = self.open_files.lock() {
            if open_files.get(key).is_some_and(|owner| owner == label) {
                open_files.remove(key);
                if let Ok(mut snapshots) = self.file_snapshots.lock() {
                    snapshots.remove(key);
                }
            }
        }
    }

    fn allocate_window_label(&self) -> String {
        let id = self.next_window_id.fetch_add(1, Ordering::Relaxed);
        format!("{WINDOW_LABEL_PREFIX}{id}")
    }
}

/// Инициализирует главное окно, применяет системные настройки и открывает
/// файлы, переданные первому запуску.
pub fn initialize(app: &mut tauri::App) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    state.mark_empty(MAIN_WINDOW_LABEL);

    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        disable_browser_accelerator_keys(&main);
        install_window_handlers(&main, app.handle());
        apply_dark_titlebar(&main);
        let _ = main.set_title(INITIAL_WINDOW_TITLE);

        // В конфигурации окно скрыто, чтобы не показывать белый webview до
        // загрузки Svelte. Показ выполняется сразу после создания webview.
        let _ = main.show();
        let _ = main.set_focus();
    }

    for path in env::args().skip(1).map(PathBuf::from) {
        if path.is_file() {
            if let Err(error) = route_file(app.handle(), &path) {
                eprintln!("Could not open startup file: {error}");
            }
        }
    }

    Ok(())
}

/// Обработчик аргументов, которые single-instance передал уже работающему
/// процессу.
pub fn handle_single_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    let handle = app.clone();
    let result = std::thread::Builder::new()
        .name("marknote-single-instance-route".to_owned())
        .spawn(move || {
            let mut opened = false;

            for path in argv.into_iter().skip(1).map(PathBuf::from) {
                if path.is_file() {
                    opened = true;
                    if let Err(error) = route_file(&handle, &path) {
                        eprintln!("Could not open requested file: {error}");
                    }
                }
            }

            if !opened {
                if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    raise_window(&window);
                }
            }
        });
    if let Err(error) = result {
        eprintln!("Could not start single-instance file routing: {error}");
    }
}

/// Выбирает окно по реестру и отправляет ему запрос на открытие файла.
/// Если свободного стартового окна нет, создаёт новое окно из конфигурации
/// `main`, сохраняя те же размеры, тему и политики webview.
pub fn route_file(app: &tauri::AppHandle, path: impl AsRef<Path>) -> Result<(), String> {
    let canonical = canonical_path(path.as_ref())?;
    let key = registry_key(&canonical);
    let settings = app.state::<SettingsState>().get();

    let target = {
        let state = app.state::<AppState>();
        let open_files = state.open_files.lock().map_err(|error| {
            eprintln!("Could not lock the open-file registry: {error}");
            UserMessage::WindowRouting.to_string()
        })?;
        let existing = existing_window_label(&settings, &open_files, &key);

        if let Some(label) = existing {
            state.set_pending_file(&label, canonical.clone());
            RouteTarget::Existing(label)
        } else if let Some(label) = state.take_empty() {
            state.reserve_file(key.clone(), &label);
            state.set_pending_file(&label, canonical.clone());
            RouteTarget::Existing(label)
        } else {
            let label = state.allocate_window_label();
            state.reserve_file(key.clone(), &label);
            state.set_pending_file(&label, canonical.clone());
            RouteTarget::New(label)
        }
    };

    let window = match target {
        RouteTarget::Existing(label) => match app.get_webview_window(&label) {
            Some(window) => window,
            None => {
                // Окно могло закрыться между чтением реестра и маршрутизацией.
                app.state::<AppState>().forget_file(&key, &label);
                app.state::<AppState>().forget_pending_file(&label);
                return route_file(app, canonical);
            }
        },
        RouteTarget::New(label) => match create_window(app, &label) {
            Ok(window) => window,
            Err(error) => {
                app.state::<AppState>().forget_file(&key, &label);
                app.state::<AppState>().forget_pending_file(&label);
                return Err(error);
            }
        },
    };

    raise_window(&window);
    // Keep the event path for already-live windows (single-instance and
    // subsequent opens). For a window whose webview is still loading this
    // may be missed, but the pending IPC value above remains available.
    window
        .emit_to(
            EventTarget::webview_window(window.label()),
            "open-file-request",
            serde_json::json!({ "path": canonical.to_string_lossy().into_owned() }),
        )
        .map_err(|error| {
            eprintln!(
                "Could not notify window {} about the requested file: {error}",
                window.label()
            );
            UserMessage::WindowRouting.to_string()
        })
}

/// Creates a fresh untitled window and hands its requested format to the
/// frontend during startup. Unlike file routing, this never reuses an empty
/// window, so the current document remains untouched.
pub fn open_empty_window(app: &tauri::AppHandle, format_id: String) -> Result<(), String> {
    let label = {
        let state = app.state::<AppState>();
        let label = state.allocate_window_label();
        state.mark_empty(&label);
        state.set_pending_format(&label, format_id);
        label
    };

    match create_window(app, &label) {
        Ok(window) => {
            raise_window(&window);
            Ok(())
        }
        Err(error) => {
            app.state::<AppState>().forget_window(&label);
            Err(error)
        }
    }
}

enum RouteTarget {
    Existing(String),
    New(String),
}

fn existing_window_label(
    settings: &Settings,
    open_files: &HashMap<PathBuf, String>,
    key: &Path,
) -> Option<String> {
    settings
        .windows
        .raise_existing_window
        .then(|| open_files.get(key).cloned())
        .flatten()
}

fn create_window(app: &tauri::AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| UserMessage::MainWindowUnavailable.to_string())?;
    config.label = label.to_owned();
    config.title = INITIAL_WINDOW_TITLE.to_owned();
    config.visible = false;

    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| {
            eprintln!("Could not configure a new application window: {error}");
            UserMessage::MainWindowUnavailable.to_string()
        })?
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map_err(|error| {
            eprintln!("Could not create a new application window: {error}");
            UserMessage::MainWindowUnavailable.to_string()
        })?;

    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&window);

    install_window_handlers(&window, app);
    apply_dark_titlebar(&window);
    Ok(window)
}

#[cfg(target_os = "windows")]
fn disable_browser_accelerator_keys(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    if let Err(error) = window.with_webview(|webview| {
        let result: windows::core::Result<()> = unsafe {
            (|| {
                let settings = webview.controller().CoreWebView2()?.Settings()?;
                let settings3 = settings.cast::<ICoreWebView2Settings3>()?;
                settings3.SetAreBrowserAcceleratorKeysEnabled(false)
            })()
        };

        if let Err(error) = result {
            eprintln!("Could not disable WebView2 browser accelerator keys: {error}");
        }
    }) {
        eprintln!("Could not access WebView2 controller to disable browser accelerators: {error}");
    }
}

fn install_window_handlers(window: &WebviewWindow, app: &tauri::AppHandle) {
    let label = window.label().to_owned();
    let app = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                let state = app.state::<AppState>();
                // `window.close()` below causes another CloseRequested on
                // Windows.  Consume the approval token to let that event
                // through instead of starting the handshake again.
                if state.consume_approved_close(&label) {
                    return;
                }

                api.prevent_close();
                let Some(request_id) = state.begin_close(&label) else {
                    return;
                };

                // The frontend owns the dirty/autosave policy and decides
                // whether to call `respond_to_close(allow = true/false)`.
                // An unresponsive webview must not make its native window
                // impossible to close, so arm a bounded fallback as well.
                let _ = event_window.emit_to(
                    EventTarget::webview_window(&label),
                    "save-before-close",
                    serde_json::json!({}),
                );
                let timeout_window = event_window.clone();
                let timeout_app = app.clone();
                let timeout_label = label.clone();
                let _ = std::thread::Builder::new()
                    .name(format!("marknote-close-timeout-{label}"))
                    .spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(
                            CLOSE_RESPONSE_TIMEOUT_SECS,
                        ));
                        let state = timeout_app.state::<AppState>();
                        if state.resolve_close(&timeout_label, Some(request_id), true) {
                            let _ = timeout_window.close();
                        }
                    });
            }
            WindowEvent::Destroyed => {
                app.state::<AppState>().forget_window(&label);
            }
            _ => {}
        }
    });
}

fn raise_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Начальный заголовок окна до передачи заголовка документа фронтендом.
pub const INITIAL_WINDOW_TITLE: &str = "MarkNote";

/// Применяет готовый заголовок к окну.
pub(crate) fn apply_document_title(window: &WebviewWindow, title: &str) -> Result<(), String> {
    window.set_title(title).map_err(|error| error.to_string())
}

pub(crate) fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map(preserve_extended_path)
        .map_err(|error| {
            eprintln!("Could not resolve path {}: {error}", path.display());
            UserMessage::path_resolution(&path.display().to_string())
        })
}

/// `canonicalize` already returns the Win32 extended form when needed.  Keep
/// it intact: stripping `\\?\` breaks long local paths and `\\?\UNC\...`.
fn preserve_extended_path(path: PathBuf) -> PathBuf {
    path
}

fn registry_key(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

#[cfg(windows)]
pub fn apply_dark_titlebar(window: &WebviewWindow) {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::{
        Graphics::Dwm::DwmSetWindowAttribute,
        System::SystemInformation::{GetVersionExW, OSVERSIONINFOW},
    };

    let mut version: OSVERSIONINFOW = unsafe { zeroed() };
    version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;

    let supported = unsafe { GetVersionExW(&mut version) != 0 }
        && version.dwMajorVersion >= 10
        && (version.dwMajorVersion > 10 || version.dwBuildNumber >= 17763);
    if !supported {
        return;
    }

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let dark_mode: i32 = 1;
    unsafe {
        // DWMWA_USE_IMMERSIVE_DARK_MODE = 20. Старые Windows уже отфильтрованы.
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            20,
            (&dark_mode as *const i32).cast(),
            size_of::<i32>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn apply_dark_titlebar(_window: &WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::{existing_window_label, preserve_extended_path, INITIAL_WINDOW_TITLE};
    use crate::settings::Settings;
    use std::{collections::HashMap, path::PathBuf};

    #[test]
    fn extended_unc_path_keeps_unc_prefix() {
        let path = PathBuf::from(r"\\?\UNC\server\share\folder\note.md");
        assert_eq!(preserve_extended_path(path.clone()), path);
    }

    #[test]
    fn extended_long_local_path_keeps_prefix() {
        let path = PathBuf::from(format!(r"\\?\C:\{}\note.md", "nested\\".repeat(80)));
        assert!(path.to_string_lossy().starts_with(r"\\?\C:\"));
        assert_eq!(preserve_extended_path(path.clone()), path);
    }

    #[test]
    fn initial_window_title_is_plain_app_name() {
        assert_eq!(INITIAL_WINDOW_TITLE, "MarkNote");
    }

    #[test]
    fn raise_existing_window_setting_controls_registry_reuse() {
        let key = PathBuf::from(r"c:\notes\one.md");
        let mut open_files = HashMap::new();
        open_files.insert(key.clone(), "win-1".to_owned());

        let settings = Settings::default();
        assert_eq!(
            existing_window_label(&settings, &open_files, &key),
            Some("win-1".to_owned())
        );

        let mut settings = settings;
        settings.windows.raise_existing_window = false;
        assert_eq!(existing_window_label(&settings, &open_files, &key), None);
    }
}
