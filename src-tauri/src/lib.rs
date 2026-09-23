mod atomic_write;
mod attachments;
mod binary;
mod commands;
mod config_dir;
mod encoding;
mod formats;
mod messages;
mod recent_files;
mod recovery;
mod settings;
pub mod spellcheck;
mod startup_trace;
mod watcher;
mod windows;

use tauri::{
    ipc::Invoke,
    plugin::{Plugin, TauriPlugin},
    Manager, RunEvent, Runtime, Window,
};

/// Runs the Tauri application and registers MarkNote's shared IPC contract.
pub fn run() {
    startup_trace::begin();
    startup_trace::mark("run-start");
    let attachment_registry = attachments::AttachmentRegistry::default();
    let protocol_registry = attachment_registry.clone();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            attachments::ATTACHMENT_SCHEME,
            move |_context, request, responder| {
                attachments::serve_protocol(protocol_registry.clone(), request, responder);
            },
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            windows::handle_single_instance(app, argv);
        }))
        .plugin(settings_aware_window_state_plugin())
        .setup(move |app| {
            startup_trace::mark("setup-start");
            app.manage(attachment_registry.clone());
            let config_dir = config_dir::for_app(app.handle())?;
            startup_trace::mark("config-dir-ready");
            let dictionary_dir = app.path().resource_dir()?.join("dictionaries");
            let recovery_dir = config_dir.join("recovery");
            let recovery = recovery::RecoveryStore::load(&recovery_dir)?;
            startup_trace::mark("recovery-loaded");
            let recent_files_path = config_dir.join("recent-files.json");
            let recent_files = recent_files::RecentFilesState::load(&recent_files_path)
                .unwrap_or_else(|error| {
                    eprintln!("Could not load recent files; using defaults: {error}");
                    recent_files::RecentFilesState::defaults(recent_files_path)
                });
            startup_trace::mark("recent-files-loaded");
            app.manage(recent_files);
            app.manage(recovery);
            app.manage(spellcheck::SpellcheckService::new(
                dictionary_dir,
                config_dir.clone(),
            ));
            app.manage(windows::AppState::new(app.handle().clone()));
            startup_trace::mark("app-state-ready");
            let result = windows::initialize(app);
            startup_trace::mark("windows-initialized");
            Ok(result?)
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::take_recovery_entries,
            commands::write_recovery_snapshot,
            commands::delete_recovery_snapshot,
            commands::delete_recovery_entry,
            commands::take_pending_file,
            commands::acknowledge_pending_file,
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
            commands::save_attachment,
            commands::save_attachment_from_path,
            commands::resolve_image,
            commands::promote_attachments,
            commands::attachment_cache_stats,
            commands::clear_attachment_cache,
            commands::reveal_attachment_cache,
            commands::spellcheck_languages,
            commands::spellcheck_check,
            commands::spellcheck_suggest,
            commands::spellcheck_add_word,
            commands::open_in_new_window,
            commands::open_new_window,
            commands::reveal_in_explorer,
            commands::get_settings,
            commands::get_resolved_language,
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
        startup_trace::mark("window-state-init-start");
        let config_dir = config_dir::for_app(app)?;
        startup_trace::mark("window-state-config-dir-ready");
        let settings_path = config_dir.join("settings.json");
        let settings = settings::SettingsState::load(&settings_path).unwrap_or_else(|error| {
            eprintln!("Could not load settings; using defaults: {error}");
            settings::SettingsState::defaults(settings_path)
        });
        startup_trace::mark("settings-loaded");

        // The window-state plugin captures its flags when it is built.  SIZE
        // and POSITION are omitted when geometry should not be remembered;
        // DECORATIONS stays disabled because MarkNote supplies its own title
        // bar.
        let state_flags = window_state_flags(&settings.get());
        app.manage(settings);

        let mut inner = tauri_plugin_window_state::Builder::default()
            .with_state_flags(state_flags)
            // The plugin itself always starts from app_config_dir(), but its
            // filename is joined with that path. An absolute filename makes
            // the plugin's state follow MARKNOTE_CONFIG_DIR as well.
            .with_filename(
                config_dir
                    .join(".window-state.json")
                    .to_string_lossy()
                    .into_owned(),
            )
            .build();
        inner.initialize(app, config)?;
        self.inner = Some(inner);
        startup_trace::mark("window-state-init-done");
        Ok(())
    }

    fn window_created(&mut self, window: Window<R>) {
        startup_trace::mark("window-state-window-created-start");
        if let Some(inner) = self.inner.as_mut() {
            inner.window_created(window);
        }
        startup_trace::mark("window-state-window-created-done");
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
