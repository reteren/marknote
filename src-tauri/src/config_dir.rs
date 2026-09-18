use std::{env, ffi::OsString, fs, io, path::PathBuf};

use tauri::{AppHandle, Manager, Runtime};

/// Optional directory used by automated runs and isolated test launches.
///
/// The override is deliberately an absolute directory path.  A relative value
/// would depend on the caller's working directory, which is easy to get wrong
/// for a GUI executable launched from Explorer.
pub(crate) const CONFIG_DIR_ENV: &str = "MARKNOTE_CONFIG_DIR";

pub(crate) fn for_app<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    let default_dir = app.path().app_config_dir()?;
    let Some(raw) = env::var_os(CONFIG_DIR_ENV) else {
        return Ok(default_dir);
    };

    match resolve_override(default_dir.clone(), Some(raw)) {
        Ok(path) => Ok(path),
        Err(error) => {
            eprintln!(
                "Could not use {CONFIG_DIR_ENV}; using the default config directory: {error}"
            );
            Ok(default_dir)
        }
    }
}

/// Resolves and prepares an override without requiring a Tauri runtime.
/// `None` preserves the default path and does not create it, matching the old
/// startup behavior.
fn resolve_override(default_dir: PathBuf, raw: Option<OsString>) -> io::Result<PathBuf> {
    let Some(raw) = raw else {
        return Ok(default_dir);
    };
    let text = raw.to_string_lossy();
    let text = text.trim();
    if text.is_empty() {
        return Ok(default_dir);
    }

    // Keep the original OsString for the actual filesystem operation so a
    // valid Windows path is not damaged by lossy UTF-16/UTF-8 conversion.
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "config directory must be an absolute path",
        ));
    }
    fs::create_dir_all(&path)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, fs};

    use tempfile::tempdir;

    use super::resolve_override;
    use crate::settings::{Settings, SettingsState};

    #[test]
    fn override_directory_is_created_and_settings_are_written_there() {
        let root = tempdir().unwrap();
        let default_dir = root.path().join("default");
        let override_dir = root.path().join("isolated");
        let selected = resolve_override(
            default_dir.clone(),
            Some(OsString::from(override_dir.to_string_lossy().to_string())),
        )
        .unwrap();

        let state = SettingsState::load(selected.join("settings.json")).unwrap();
        state.save(Settings::default()).unwrap();

        assert!(selected.join("settings.json").is_file());
        assert!(!default_dir.join("settings.json").exists());
    }

    #[test]
    fn missing_override_directory_is_created_without_failing() {
        let root = tempdir().unwrap();
        let path = root.path().join("nested").join("config");
        let selected = resolve_override(
            root.path().join("default"),
            Some(OsString::from(path.to_string_lossy().to_string())),
        )
        .unwrap();
        assert_eq!(selected, path);
        assert!(selected.is_dir());
    }

    #[test]
    fn relative_or_empty_override_keeps_default() {
        let root = tempdir().unwrap();
        let default_dir = root.path().join("default");
        assert_eq!(
            resolve_override(default_dir.clone(), Some(OsString::from("relative"))).is_err(),
            true
        );
        assert_eq!(
            resolve_override(default_dir.clone(), Some(OsString::new())).unwrap(),
            default_dir
        );
        assert!(fs::read_dir(root.path())
            .unwrap()
            .all(|entry| entry.is_ok()));
    }
}
