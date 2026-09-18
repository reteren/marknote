mod atomic_write;
mod binary;
mod commands;
mod encoding;
mod formats;
mod messages;
mod recent_files;
mod settings;
mod spellcheck;
mod watcher;
mod windows;

use tauri::{
    ipc::Invoke,
    plugin::{Plugin, TauriPlugin},
    Manager, RunEvent, Runtime, Window,
};

/// Запускает приложение Tauri и регистрирует общий IPC-контракт MarkNote.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            windows::handle_single_instance(app, argv);
        }))
        .plugin(settings_aware_window_state_plugin())
        .setup(|app| {
            let recent_files_path = app
                .path()
                .app_config_dir()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?
                .join("recent-files.json");
            let recent_files = recent_files::RecentFilesState::load(&recent_files_path)
                .unwrap_or_else(|error| {
                    eprintln!("Could not load recent files; using defaults: {error}");
                    recent_files::RecentFilesState::defaults(recent_files_path)
                });
            app.manage(recent_files);
            app.manage(windows::AppState::new(app.handle().clone()));
            Ok(windows::initialize(app)?)
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::take_pending_file,
            commands::take_pending_format,
            commands::respond_to_close,
            commands::save_file,
            commands::save_as,
            commands::pick_file,
            commands::new_document,
            commands::list_creatable_formats,
            commands::format_for_extension,
            commands::validate_json,
            commands::format_json,
            commands::read_image,
            commands::open_in_new_window,
            commands::open_new_window,
            commands::reveal_in_explorer,
            commands::get_settings,
            commands::get_resolved_language,
            commands::list_spellcheck_languages,
            commands::save_settings,
            commands::reset_settings,
            commands::reveal_settings_file,
            commands::get_recent_files,
            commands::add_recent_file,
            commands::clear_recent_files,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Application startup failed: {error}");
            panic!("{}", messages::UserMessage::StartupFailure);
        });
}

/// Builds the window-state plugin after loading settings during plugin
/// initialization, before Tauri creates the configured windows.  This keeps
/// the plugin's `on_window_ready` hook active for the main window as well as
/// dynamically created document windows.
fn settings_aware_window_state_plugin<R: Runtime>() -> SettingsAwareWindowState<R> {
    SettingsAwareWindowState { inner: None }
}

struct SettingsAwareWindowState<R: Runtime> {
    inner: Option<TauriPlugin<R>>,
}

impl<R: Runtime> Plugin<R> for SettingsAwareWindowState<R> {
    fn name(&self) -> &'static str {
        "window-state"
    }

    fn initialize(
        &mut self,
        app: &tauri::AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let settings_path = app
            .path()
            .app_config_dir()
            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?
            .join("settings.json");
        let settings = settings::SettingsState::load(&settings_path).unwrap_or_else(|error| {
            eprintln!("Could not load settings; using defaults: {error}");
            settings::SettingsState::defaults(settings_path)
        });

        // The window-state plugin captures its flags when it is built.  SIZE
        // and POSITION are omitted when geometry should not be remembered;
        // DECORATIONS stays disabled because MarkNote supplies its own title
        // bar.
        let state_flags = window_state_flags(&settings.get());
        app.manage(settings);

        let mut inner = tauri_plugin_window_state::Builder::default()
            .with_state_flags(state_flags)
            .build();
        inner.initialize(app, config)?;
        self.inner = Some(inner);
        Ok(())
    }

    fn window_created(&mut self, window: Window<R>) {
        if let Some(inner) = self.inner.as_mut() {
            inner.window_created(window);
        }
    }

    fn on_event(&mut self, app: &tauri::AppHandle<R>, event: &RunEvent) {
        if let Some(inner) = self.inner.as_mut() {
            inner.on_event(app, event);
        }
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.inner
            .as_mut()
            .is_some_and(|inner| inner.extend_api(invoke))
    }
}

fn window_state_flags(settings: &settings::Settings) -> tauri_plugin_window_state::StateFlags {
    let mut flags = tauri_plugin_window_state::StateFlags::MAXIMIZED
        | tauri_plugin_window_state::StateFlags::VISIBLE
        | tauri_plugin_window_state::StateFlags::FULLSCREEN;
    if settings.windows.remember_size_and_position {
        flags |= tauri_plugin_window_state::StateFlags::SIZE
            | tauri_plugin_window_state::StateFlags::POSITION;
    }
    flags
}

#[cfg(test)]
mod tests {
    use super::window_state_flags;
    use crate::settings::Settings;
    use tauri_plugin_window_state::StateFlags;

    #[test]
    fn remember_size_and_position_controls_plugin_geometry_flags() {
        let mut settings = Settings::default();
        settings.windows.remember_size_and_position = false;
        let flags = window_state_flags(&settings);
        assert!(!flags.intersects(StateFlags::SIZE | StateFlags::POSITION));
        assert!(!flags.contains(StateFlags::DECORATIONS));

        settings.windows.remember_size_and_position = true;
        let flags = window_state_flags(&settings);
        assert!(flags.contains(StateFlags::SIZE | StateFlags::POSITION));
    }
}
