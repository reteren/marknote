use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{
    ser::{SerializeMap, Serializer},
    Serialize,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use thiserror::Error;

use crate::{
    atomic_write, binary, encoding as text_encoding,
    formats::{self, FormatCapabilities},
    messages::UserMessage,
    settings::{Settings, SettingsError, SettingsState},
    spellcheck,
    windows::{self, AppState, FileSnapshot},
};

const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("{message}", message = UserMessage::FileIo)]
    Io(#[from] std::io::Error),
    #[error("{message}", message = UserMessage::AtomicWrite)]
    AtomicWrite(#[source] anyhow::Error),
    #[error("{message}", message = UserMessage::FormatConversion)]
    Format(#[source] anyhow::Error),
    #[error("{message}", message = UserMessage::Dialog)]
    Dialog(String),
    #[error("{message}", message = UserMessage::UnknownFormat)]
    UnknownFormat(String),
    #[error("{message}", message = UserMessage::ReadOnlyFormat)]
    ReadOnlyFormat(String),
    #[error("{message}", message = UserMessage::BinaryFile)]
    BinaryFile(String),
    #[error("{message}", message = UserMessage::FileConflict)]
    FileConflict(String),
    #[error("{message}", message = UserMessage::ImageTooLarge)]
    ImageTooLarge(String),
    #[error("{0}")]
    InvalidPath(String),
    #[error("{message}", message = UserMessage::Window)]
    Window(String),
    #[error("{0}")]
    WindowRouting(String),
    #[error("{0}")]
    Message(UserMessage),
}

impl CommandError {
    fn log_internal_details(&self) {
        match self {
            Self::Io(error) => eprintln!("File I/O failure: {error}"),
            Self::AtomicWrite(error) => eprintln!("Atomic save failure: {error:#}"),
            Self::Format(error) => eprintln!("Format processing failure: {error:#}"),
            Self::Dialog(error) => eprintln!("File dialog failure: {error}"),
            Self::Window(error) => eprintln!("Window operation failure: {error}"),
            _ => {}
        }
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.log_internal_details();
        if let Self::FileConflict(path) = self {
            let mut map = serializer.serialize_map(Some(3))?;
            map.serialize_entry("code", "file-conflict")?;
            map.serialize_entry("path", path)?;
            map.serialize_entry("message", &self.to_string())?;
            return map.end();
        }
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub line_ending: text_encoding::LineEnding,
    pub format: FormatCapabilities,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub saved_at: String,
    pub format: FormatCapabilities,
    pub lossy_warning: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDocument {
    pub text: String,
    pub format: FormatCapabilities,
}

#[tauri::command]
pub fn open_file(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<OpenedFile, CommandError> {
    let input_path = PathBuf::from(&path);
    let canonical = windows::canonical_path(&input_path).map_err(CommandError::InvalidPath)?;
    let metadata = fs::metadata(&canonical)?;
    let bytes = fs::read(&canonical)?;
    let adapter = formats::adapter_for_path(&canonical);
    let format = adapter.caps();
    if format.id == "plain" && binary::is_binary_sample(&bytes) {
        return Err(CommandError::BinaryFile(
            canonical.to_string_lossy().into_owned(),
        ));
    }
    let decoded = adapter.decode(&bytes).map_err(CommandError::Format)?;
    let readonly = metadata.permissions().readonly() || !format.editable;

    state.watcher.watch(window.label(), &canonical);
    state.track_file(&canonical, window.label());
    state.remember_file_snapshot(&canonical, &metadata);

    Ok(OpenedFile {
        path: canonical.to_string_lossy().into_owned(),
        text: decoded.text,
        encoding: decoded.encoding,
        bom: decoded.bom,
        line_ending: decoded.line_ending,
        format,
        readonly,
    })
}

/// Returns the file queued for this window during startup, consuming it so a
/// simultaneous event and IPC fallback cannot open it twice.
#[tauri::command]
pub fn take_pending_file(window: WebviewWindow, state: State<'_, AppState>) -> Option<String> {
    state
        .take_pending_file(window.label())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Completes the native close handshake for this window.  `allow = false`
/// cancels the close (the frontend's Cancel action); a stale response after
/// the watchdog has already closed the window is intentionally ignored.
#[tauri::command]
pub fn respond_to_close(
    window: WebviewWindow,
    state: State<'_, AppState>,
    allow: bool,
) -> Result<(), CommandError> {
    if !state.resolve_close(window.label(), None, allow) {
        return Ok(());
    }
    if allow {
        if let Err(error) = window.close() {
            state.clear_approved_close(window.label());
            return Err(CommandError::Window(error.to_string()));
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn save_file(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    text: String,
    encoding: String,
    bom: bool,
    lineEnding: text_encoding::LineEnding,
) -> Result<SaveResult, CommandError> {
    let path = PathBuf::from(&path);
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.permissions().readonly() {
            return Err(CommandError::Message(UserMessage::FileReadOnly));
        }
    }

    if let Some(expected) = state.file_snapshot(&path) {
        ensure_snapshot_current(&path, expected)?;
    }

    let adapter = formats::adapter_for_path(&path);
    let format = formats::for_path(&path);
    ensure_editable(&format)?;

    state.watcher.suppress(&path);
    let source = text_encoding::Decoded {
        text: text.clone(),
        encoding,
        bom,
        line_ending: lineEnding,
    };
    let bytes = adapter
        .encode(&text, &source)
        .map_err(CommandError::Format)?;
    atomic_write::write_atomic(&path, &bytes).map_err(CommandError::AtomicWrite)?;
    state.track_file(&path, window.label());
    if let Ok(metadata) = fs::metadata(&path) {
        state.remember_file_snapshot(&path, &metadata);
    }

    Ok(save_result(path, format))
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn save_as(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    text: String,
    formatId: String,
    suggestedName: String,
) -> Result<Option<SaveResult>, CommandError> {
    let (requested_format, export_as_markdown) = resolve_save_as_format(&formatId)?;

    let suggested_name = if export_as_markdown {
        with_forced_extension(&suggestedName, &requested_format)
    } else {
        with_default_extension(&suggestedName, &requested_format)
    };
    let extensions: Vec<String> = requested_format.extensions.clone();
    let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let selected = app
        .dialog()
        .file()
        .set_file_name(suggested_name)
        .add_filter(&requested_format.label, &extension_refs)
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut path = selected
        .into_path()
        .map_err(|error| CommandError::Dialog(error.to_string()))?;
    if export_as_markdown {
        path.set_extension(&requested_format.default_extension);
    }
    let adapter = if export_as_markdown {
        formats::adapter_by_id("markdown").expect("markdown adapter must be registered")
    } else if path.extension().is_some() {
        formats::adapter_for_path(&path)
    } else {
        formats::adapter_by_id(&requested_format.id).expect("requested format must be registered")
    };
    let format = adapter.caps();
    ensure_editable(&format)?;
    let source = text_encoding::Decoded {
        text: text.clone(),
        encoding: "utf-8".to_owned(),
        bom: false,
        line_ending: text_encoding::LineEnding::Lf,
    };
    let bytes = adapter
        .encode(&text, &source)
        .map_err(CommandError::Format)?;
    atomic_write::write_atomic(&path, &bytes).map_err(CommandError::AtomicWrite)?;
    state.watcher.watch(window.label(), &path);
    state.track_file(&path, window.label());
    if let Ok(metadata) = fs::metadata(&path) {
        state.remember_file_snapshot(&path, &metadata);
    }

    Ok(Some(save_result(path, format)))
}

#[tauri::command]
pub async fn pick_file(app: AppHandle) -> Result<Option<String>, CommandError> {
    let selected = app.dialog().file().blocking_pick_file();
    selected
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| CommandError::Dialog(error.to_string()))
        })
        .transpose()
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn new_document(formatId: String) -> Result<NewDocument, CommandError> {
    let format =
        formats::by_id(&formatId).ok_or_else(|| CommandError::UnknownFormat(formatId.clone()))?;
    if !format.creatable {
        return Err(CommandError::Message(UserMessage::FormatCannotCreate));
    }
    Ok(NewDocument {
        text: format.template.clone(),
        format,
    })
}

/// Устанавливает готовый заголовок окна, переданный фронтендом.
#[tauri::command]
pub fn set_document_title(window: WebviewWindow, title: String) -> Result<(), CommandError> {
    windows::apply_document_title(&window, &title).map_err(CommandError::Window)
}

#[tauri::command]
pub fn list_creatable_formats() -> Vec<FormatCapabilities> {
    formats::creatable()
}

#[tauri::command]
pub fn format_for_extension(ext: String) -> FormatCapabilities {
    formats::for_extension(&ext)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn read_image(docPath: Option<String>, src: String) -> Result<String, CommandError> {
    if src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://") {
        return Ok(src);
    }

    if src.is_empty() {
        return Err(CommandError::Message(UserMessage::InvalidPath));
    }
    if src.bytes().any(|byte| byte == 0) || has_uri_scheme(&src) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathMustBeRelative.to_string(),
        ));
    }

    let source_path = PathBuf::from(&src);
    if source_path.is_absolute() || is_windows_device_path(&source_path) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathAbsoluteOrDevice.to_string(),
        ));
    }

    let document_path = docPath.ok_or(CommandError::Message(UserMessage::DocumentPathRequired))?;
    let document_path =
        windows::canonical_path(Path::new(&document_path)).map_err(CommandError::InvalidPath)?;
    if is_windows_device_path(&document_path) {
        return Err(CommandError::InvalidPath(
            UserMessage::DeviceDocumentPath.to_string(),
        ));
    }
    let document_directory = document_path
        .parent()
        .ok_or(CommandError::Message(UserMessage::DocumentFolderRequired))?;
    let path = windows::canonical_path(&document_directory.join(source_path))
        .map_err(CommandError::InvalidPath)?;
    if !path_is_within(document_directory, &path) || is_windows_device_path(&path) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathOutsideDocument.to_string(),
        ));
    }

    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(CommandError::InvalidPath(
            UserMessage::ImageNotRegularFile.to_string(),
        ));
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::ImageTooLarge(
            path.to_string_lossy().into_owned(),
        ));
    }

    let bytes = fs::read(&path)?;
    let mime = image_mime(&path);
    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

#[tauri::command]
pub fn open_in_new_window(app: AppHandle, path: String) -> Result<(), CommandError> {
    windows::route_file(&app, path).map_err(CommandError::WindowRouting)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), CommandError> {
    #[cfg(windows)]
    {
        let select_argument = format!("/select,\"{path}\"");
        Command::new("explorer")
            .arg(select_argument)
            .spawn()
            .map_err(CommandError::Io)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(CommandError::Message(UserMessage::ExplorerWindowsOnly))
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Settings {
    state.get()
}

#[tauri::command]
pub fn get_resolved_language(state: State<'_, SettingsState>) -> String {
    state.get().resolved_language()
}

#[tauri::command]
pub fn list_spellcheck_languages() -> Vec<String> {
    spellcheck::available_language_codes()
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Result<Settings, CommandError> {
    state.save(settings).map_err(map_settings_error)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, SettingsState>) -> Result<Settings, CommandError> {
    state.reset().map_err(map_settings_error)
}

#[tauri::command]
pub fn reveal_settings_file(state: State<'_, SettingsState>) -> Result<(), CommandError> {
    #[cfg(windows)]
    {
        let path = state.ensure_file_exists().map_err(map_settings_error)?;
        let select_argument = format!("/select,\"{}\"", path.display());
        Command::new("explorer")
            .arg(select_argument)
            .spawn()
            .map_err(CommandError::Io)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err(CommandError::Message(UserMessage::ExplorerWindowsOnly))
    }
}

fn map_settings_error(error: SettingsError) -> CommandError {
    match error {
        SettingsError::Io(error) => CommandError::Io(error),
        SettingsError::AtomicWrite(error) => CommandError::AtomicWrite(error),
        SettingsError::Json(error) => CommandError::AtomicWrite(anyhow::anyhow!(error)),
    }
}

fn save_result(path: PathBuf, format: FormatCapabilities) -> SaveResult {
    SaveResult {
        path: path.to_string_lossy().into_owned(),
        saved_at: now_iso8601(),
        lossy_warning: format.lossy,
        format,
    }
}

fn ensure_editable(format: &FormatCapabilities) -> Result<(), CommandError> {
    if format.editable {
        Ok(())
    } else {
        Err(CommandError::ReadOnlyFormat(format.label.clone()))
    }
}

fn ensure_snapshot_current(path: &Path, expected: FileSnapshot) -> Result<(), CommandError> {
    match fs::metadata(path) {
        Ok(metadata) if FileSnapshot::from_metadata(&metadata) != expected => Err(
            CommandError::FileConflict(path.to_string_lossy().into_owned()),
        ),
        Ok(_) => Ok(()),
        // A deleted or renamed source is an expected external change. The
        // atomic save below recreates it, while any replacement file that
        // already exists is still checked against the recorded snapshot.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::Io(error)),
    }
}

fn resolve_save_as_format(format_id: &str) -> Result<(FormatCapabilities, bool), CommandError> {
    let requested = formats::by_id(format_id)
        .ok_or_else(|| CommandError::UnknownFormat(format_id.to_owned()))?;
    if requested.editable {
        return Ok((requested, false));
    }

    let markdown = formats::by_id("markdown").expect("markdown adapter must be registered");
    Ok((markdown, true))
}

fn with_default_extension(name: &str, format: &FormatCapabilities) -> String {
    if Path::new(name).extension().is_some() {
        name.to_owned()
    } else {
        format!("{name}.{}", format.default_extension)
    }
}

fn with_forced_extension(name: &str, format: &FormatCapabilities) -> String {
    let mut path = PathBuf::from(name);
    path.set_extension(&format.default_extension);
    path.to_string_lossy().into_owned()
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "apng" => "image/apng",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "svg" | "svgz" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn has_uri_scheme(value: &str) -> bool {
    let Some((scheme, _)) = value.split_once(':') else {
        return false;
    };
    !scheme.is_empty()
        && scheme.chars().enumerate().all(|(index, character)| {
            if index == 0 {
                character.is_ascii_alphabetic()
            } else {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
            }
        })
}

fn is_windows_device_path(path: &Path) -> bool {
    let value = path.to_string_lossy();
    let normalized = value.replace('/', "\\").to_ascii_lowercase();
    if normalized.starts_with(r"\\.\") || normalized.starts_with(r"\\?\globalroot\") {
        return true;
    }

    let component = normalized
        .trim_start_matches('\\')
        .split('\\')
        .next()
        .unwrap_or_default()
        .trim_end_matches('.')
        .split(':')
        .next()
        .unwrap_or_default();
    let device_name = component.split('.').next().unwrap_or_default();
    matches!(device_name, "con" | "prn" | "aux" | "nul")
        || (device_name.len() == 4
            && (device_name.starts_with("com") || device_name.starts_with("lpt"))
            && device_name.as_bytes()[3].is_ascii_digit())
}

fn path_is_within(root: &Path, candidate: &Path) -> bool {
    let root = root.to_string_lossy().replace('/', "\\");
    let candidate = candidate.to_string_lossy().replace('/', "\\");
    let root = root.trim_end_matches('\\').to_ascii_lowercase();
    let candidate = candidate.to_ascii_lowercase();
    candidate == root || candidate.starts_with(&(root + "\\"))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0] as u32;
        let second = chunk.get(1).copied().unwrap_or_default() as u32;
        let third = chunk.get(2).copied().unwrap_or_default() as u32;
        let value = (first << 16) | (second << 8) | third;

        output.push(TABLE[((value >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((value >> 12) & 0x3f) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((value >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(value & 0x3f) as usize] as char
        } else {
            '='
        });
    }

    output
}

fn now_iso8601() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

// Преобразование количества дней от Unix epoch в григорианскую дату.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted / 146_097
    } else {
        (shifted - 146_096) / 146_097
    };
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn read_only_format_is_rejected_before_writing() {
        let format = FormatCapabilities {
            id: "pdf".to_owned(),
            label: "PDF".to_owned(),
            default_extension: "pdf".to_owned(),
            extensions: vec!["pdf".to_owned()],
            editable: false,
            creatable: false,
            live_preview: true,
            autosave: false,
            lossy: false,
            syntax_mode: None,
            template: String::new(),
        };

        assert!(matches!(
            ensure_editable(&format),
            Err(CommandError::ReadOnlyFormat(label)) if label == "PDF"
        ));
    }

    #[test]
    fn read_only_save_as_exports_to_markdown_and_changes_the_extension() {
        for format_id in ["pdf", "docx"] {
            let (format, export_as_markdown) =
                resolve_save_as_format(format_id).expect("registered read-only format");
            assert!(export_as_markdown);
            assert_eq!(format.id, "markdown");
            assert_eq!(with_forced_extension("report.pdf", &format), "report.md");
        }
    }

    #[test]
    fn saving_after_external_deletion_is_allowed_to_recreate_the_file() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("note.md");
        fs::write(&path, "original").expect("initial file");
        let expected = FileSnapshot::from_metadata(&fs::metadata(&path).expect("metadata"));
        fs::remove_file(&path).expect("simulate external deletion");

        ensure_snapshot_current(&path, expected).expect("deleted source should be recreated");
        crate::atomic_write::write_atomic(&path, b"saved again")
            .expect("atomic write target can be recreated");
        assert_eq!(
            fs::read_to_string(&path).expect("recreated file"),
            "saved again"
        );
    }

    #[test]
    fn external_modification_still_blocks_save() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("note.md");
        fs::write(&path, "original").expect("initial file");
        let expected = FileSnapshot::from_metadata(&fs::metadata(&path).expect("metadata"));
        fs::write(&path, "changed outside").expect("external edit");

        assert!(matches!(
            ensure_snapshot_current(&path, expected),
            Err(CommandError::FileConflict(_))
        ));
    }

    #[test]
    fn unknown_extension_uses_plain_adapter() {
        let adapter = formats::adapter_for_path(Path::new("note.unknown-extension"));
        assert_eq!(adapter.caps().id, "plain");
        assert_eq!(
            formats::for_path(Path::new("note.unknown-extension")).id,
            "plain"
        );
    }

    #[test]
    fn cp1251_crlf_round_trip_uses_format_adapter() {
        let path = Path::new("note.unknown-extension");
        let input = b"\xCF\xF0\xE8\xE2\xE5\xF2\r\n";
        let adapter = formats::adapter_for_path(path);
        let decoded = adapter.decode(input).expect("plain adapter must decode");

        assert_eq!(decoded.text, "Привет\n");
        assert_eq!(decoded.encoding, "windows-1251");
        assert_eq!(decoded.line_ending, text_encoding::LineEnding::Crlf);

        let encoded = adapter
            .encode(&decoded.text, &decoded)
            .expect("plain adapter must encode");
        assert_eq!(encoded, input);
    }

    #[test]
    fn image_path_helpers_reject_escape_and_devices() {
        assert!(path_is_within(
            Path::new(r"C:\docs"),
            Path::new(r"C:\docs\images\logo.png")
        ));
        assert!(!path_is_within(
            Path::new(r"C:\docs"),
            Path::new(r"C:\docs-other\logo.png")
        ));
        assert!(is_windows_device_path(Path::new("NUL")));
        assert!(is_windows_device_path(Path::new("COM1.png")));
        assert!(!is_windows_device_path(Path::new(r"C:\docs\logo.png")));
        assert!(has_uri_scheme("file://C:/secret.txt"));
        assert!(!has_uri_scheme("images/logo.png"));
    }

    #[test]
    fn read_image_stays_inside_document_directory() {
        let directory = tempfile::tempdir().expect("temp directory");
        let outside = tempfile::tempdir().expect("outside directory");
        let document = directory.path().join("note.md");
        let image = directory.path().join("logo.png");
        let secret = outside.path().join("secret.png");
        fs::write(&document, b"![](logo.png)").expect("document");
        fs::write(&image, [0x89, b'P', b'N', b'G']).expect("image");
        fs::write(&secret, b"secret").expect("outside image");

        let image_url = read_image(
            Some(document.to_string_lossy().into_owned()),
            "logo.png".to_owned(),
        )
        .expect("image inside document directory");
        assert!(image_url.starts_with("data:image/png;base64,"));

        let escaped = read_image(
            Some(document.to_string_lossy().into_owned()),
            format!(
                "../{}/secret.png",
                outside.path().file_name().unwrap().to_string_lossy()
            ),
        );
        assert!(matches!(escaped, Err(CommandError::InvalidPath(_))));
    }

    #[test]
    fn read_image_rejects_files_over_limit_before_reading() {
        let directory = tempfile::tempdir().expect("temp directory");
        let document = directory.path().join("note.md");
        let image = directory.path().join("huge.png");
        fs::write(&document, b"![](huge.png)").expect("document");
        let file = fs::File::create(&image).expect("image");
        file.set_len(MAX_IMAGE_BYTES + 1).expect("sparse image");

        assert!(matches!(
            read_image(
                Some(document.to_string_lossy().into_owned()),
                "huge.png".to_owned(),
            ),
            Err(CommandError::ImageTooLarge(_))
        ));
    }

    #[test]
    fn conflict_error_has_machine_readable_code() {
        let value = serde_json::to_value(CommandError::FileConflict("note.md".to_owned()))
            .expect("serializable conflict");
        assert_eq!(value["code"], "file-conflict");
        assert_eq!(value["path"], "note.md");
    }
}
