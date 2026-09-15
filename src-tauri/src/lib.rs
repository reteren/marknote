mod atomic_write;
mod binary;
mod commands;
mod encoding;
mod formats;
mod messages;
mod settings;
mod watcher;
mod windows;

use tauri::Manager;

/// Запускает приложение Tauri и регистрирует общий IPC-контракт MarkNote.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            windows::handle_single_instance(app, argv);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = settings::SettingsState::load(&settings_path).unwrap_or_else(|error| {
                eprintln!("Could not load settings; using defaults: {error}");
                settings::SettingsState::defaults(settings_path)
            });
            app.manage(settings);
            app.manage(windows::AppState::new(app.handle().clone()));
            Ok(windows::initialize(app)?)
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::take_pending_file,
            commands::respond_to_close,
            commands::save_file,
            commands::save_as,
            commands::pick_file,
            commands::new_document,
            commands::set_document_title,
            commands::list_creatable_formats,
            commands::format_for_extension,
            commands::read_image,
            commands::open_in_new_window,
            commands::reveal_in_explorer,
            commands::get_settings,
            commands::get_resolved_language,
            commands::save_settings,
            commands::reset_settings,
            commands::reveal_settings_file,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Application startup failed: {error}");
            panic!("{}", messages::UserMessage::StartupFailure);
        });
}
