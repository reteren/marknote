use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{ser::Serializer, Serialize};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use thiserror::Error;

use crate::{
    atomic_write, encoding as text_encoding,
    formats::{self, FormatCapabilities},
    windows::{self, AppState},
};

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("ошибка ввода-вывода: {0}")]
    Io(#[from] std::io::Error),
    #[error("ошибка атомарной записи: {0}")]
    AtomicWrite(#[source] anyhow::Error),
    #[error("ошибка диалога: {0}")]
    Dialog(String),
    #[error("неизвестный формат: {0}")]
    UnknownFormat(String),
    #[error("формат {0} доступен только для чтения")]
    ReadOnlyFormat(String),
    #[error("недопустимый путь: {0}")]
    InvalidPath(String),
    #[error("ошибка окна: {0}")]
    Window(String),
    #[error("{0}")]
    Message(String),
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
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
    let decoded = text_encoding::decode(&bytes);
    let format = formats::for_path(&canonical);
    let readonly = metadata.permissions().readonly() || !format.editable;

    state.watcher.watch(window.label(), &canonical);
    state.track_file(&canonical, window.label());

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
            return Err(CommandError::Message(
                "файл доступен только для чтения".to_owned(),
            ));
        }
    }

    let format = formats::for_path(&path);
    if !format.editable {
        return Err(CommandError::ReadOnlyFormat(format.label));
    }

    state.watcher.suppress(&path);
    let bytes = text_encoding::encode(&text, &encoding, bom, lineEnding);
    atomic_write::write_atomic(&path, &bytes).map_err(CommandError::AtomicWrite)?;
    state.track_file(&path, window.label());

    Ok(save_result(path, format))
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn save_as(
    app: AppHandle,
    text: String,
    formatId: String,
    suggestedName: String,
) -> Result<Option<SaveResult>, CommandError> {
    let requested_format =
        formats::by_id(&formatId).ok_or_else(|| CommandError::UnknownFormat(formatId.clone()))?;
    if !requested_format.editable {
        return Err(CommandError::ReadOnlyFormat(requested_format.label));
    }

    let suggested_name = with_default_extension(&suggestedName, &requested_format);
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
    let path = selected
        .into_path()
        .map_err(|error| CommandError::Dialog(error.to_string()))?;
    let format = if path.extension().is_some() {
        formats::for_path(&path)
    } else {
        requested_format
    };
    let bytes = text_encoding::encode(&text, "utf-8", false, text_encoding::LineEnding::Lf);
    atomic_write::write_atomic(&path, &bytes).map_err(CommandError::AtomicWrite)?;

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
        return Err(CommandError::Message(format!(
            "формат {} нельзя использовать для нового документа",
            format.label
        )));
    }
    Ok(NewDocument {
        text: format.template.clone(),
        format,
    })
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

    let source_path = PathBuf::from(&src);
    let path = if source_path.is_absolute() {
        source_path
    } else {
        let document_directory = docPath
            .as_deref()
            .map(Path::new)
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new("."));
        document_directory.join(source_path)
    };

    let bytes = fs::read(&path)?;
    let mime = image_mime(&path);
    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

#[tauri::command]
pub fn open_in_new_window(app: AppHandle, path: String) -> Result<(), CommandError> {
    windows::route_file(&app, path).map_err(CommandError::Window)
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
        Err(CommandError::Message(
            "проводник доступен только в Windows".to_owned(),
        ))
    }
}

fn save_result(path: PathBuf, format: FormatCapabilities) -> SaveResult {
    SaveResult {
        path: path.to_string_lossy().into_owned(),
        saved_at: now_iso8601(),
        format,
    }
}

fn with_default_extension(name: &str, format: &FormatCapabilities) -> String {
    if Path::new(name).extension().is_some() {
        name.to_owned()
    } else {
        format!("{name}.{}", format.default_extension)
    }
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
