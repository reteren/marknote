use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

use tauri::{
    webview::{PageLoadEvent, WebviewWindowBuilder},
    Emitter, Manager, WebviewWindow, WindowEvent,
};

use crate::watcher::FileWatcher;

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_LABEL_PREFIX: &str = "win-";

/// Общее состояние процесса: реестр файлов, свободные стартовые окна и watcher.
pub struct AppState {
    pub(crate) open_files: Mutex<HashMap<PathBuf, String>>,
    pub(crate) empty_windows: Mutex<HashSet<String>>,
    pending_files: Mutex<HashMap<String, PathBuf>>,
    pub(crate) next_window_id: AtomicUsize,
    pub(crate) watcher: FileWatcher,
}

impl AppState {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            open_files: Mutex::new(HashMap::new()),
            empty_windows: Mutex::new(HashSet::new()),
            pending_files: Mutex::new(HashMap::new()),
            next_window_id: AtomicUsize::new(1),
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

    pub(crate) fn track_file(&self, path: &Path, label: &str) {
        self.reserve_file(registry_key(path), label);
    }

    fn forget_window(&self, label: &str) {
        if let Ok(mut open_files) = self.open_files.lock() {
            open_files.retain(|_, owner| owner != label);
        }
        if let Ok(mut empty) = self.empty_windows.lock() {
            empty.remove(label);
        }
        if let Ok(mut pending) = self.pending_files.lock() {
            pending.remove(label);
        }
        self.watcher.unwatch(label);
    }

    fn forget_file(&self, key: &Path, label: &str) {
        if let Ok(mut open_files) = self.open_files.lock() {
            if open_files.get(key).is_some_and(|owner| owner == label) {
                open_files.remove(key);
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
        install_window_handlers(&main, app.handle());
        apply_dark_titlebar(&main);

        // В конфигурации окно скрыто, чтобы не показывать белый webview до
        // загрузки Svelte. Показ выполняется сразу после создания webview.
        let _ = main.show();
        let _ = main.set_focus();
    }

    for path in env::args().skip(1).map(PathBuf::from) {
        if path.is_file() {
            let _ = route_file(app.handle(), &path);
        }
    }

    Ok(())
}

/// Обработчик аргументов, которые single-instance передал уже работающему
/// процессу.
pub fn handle_single_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    let handle = app.clone();
    let _ = std::thread::Builder::new()
        .name("marknote-single-instance-route".to_owned())
        .spawn(move || {
            let mut opened = false;

            for path in argv.into_iter().skip(1).map(PathBuf::from) {
                if path.is_file() {
                    opened = true;
                    let _ = route_file(&handle, &path);
                }
            }

            if !opened {
                if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    raise_window(&window);
                }
            }
        });
}

/// Выбирает окно по реестру и отправляет ему запрос на открытие файла.
/// Если свободного стартового окна нет, создаёт новое окно из конфигурации
/// `main`, сохраняя те же размеры, тему и политики webview.
pub fn route_file(app: &tauri::AppHandle, path: impl AsRef<Path>) -> Result<(), String> {
    let canonical = canonical_path(path.as_ref())?;
    let key = registry_key(&canonical);

    let target = {
        let state = app.state::<AppState>();
        let existing = state
            .open_files
            .lock()
            .map_err(|_| "не удалось заблокировать реестр открытых файлов".to_owned())?
            .get(&key)
            .cloned();

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
        .emit(
            "open-file-request",
            serde_json::json!({ "path": canonical.to_string_lossy().into_owned() }),
        )
        .map_err(|error| error.to_string())
}

enum RouteTarget {
    Existing(String),
    New(String),
}

fn create_window(app: &tauri::AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| "конфигурация главного окна не найдена".to_owned())?;
    config.label = label.to_owned();
    config.visible = false;

    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map_err(|error| error.to_string())?;

    install_window_handlers(&window, app);
    apply_dark_titlebar(&window);
    Ok(window)
}

fn install_window_handlers(window: &WebviewWindow, app: &tauri::AppHandle) {
    let label = window.label().to_owned();
    let app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            app.state::<AppState>().forget_window(&label);
        }
    });
}

fn raise_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

pub(crate) fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map(strip_extended_prefix)
        .map_err(|error| format!("не удалось определить путь '{}': {error}", path.display()))
}

fn strip_extended_prefix(path: PathBuf) -> PathBuf {
    let path = path.to_string_lossy();
    match path.strip_prefix(r"\\?\") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(path.as_ref()),
    }
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
