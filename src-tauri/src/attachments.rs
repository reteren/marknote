use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[cfg(windows)]
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeResponder};

use crate::{
    commands::{self, CommandError},
    config_dir,
    messages::UserMessage,
    windows,
};

pub(crate) const ATTACHMENT_SCHEME: &str = "marknote-attachment";
/// Link prefix for images in the image folder. Every new image gets it.
const IMAGES_PREFIX: &str = "marknote-images/";
/// Older prefix for images staged by unsaved documents; they live in the same folder.
const CACHE_PREFIX: &str = "marknote-cache/";
const MAX_REGISTRY_ID: u64 = u64::MAX;

#[derive(Clone, Default)]
pub struct AttachmentRegistry {
    inner: Arc<Mutex<RegistryInner>>,
}

#[derive(Default)]
struct RegistryInner {
    next_id: u64,
    by_path: HashMap<String, String>,
    by_id: HashMap<String, PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentRef {
    pub src: String,
    pub path: String,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CacheStats {
    pub files: usize,
    pub bytes: u64,
    pub path: String,
}

impl AttachmentRegistry {
    fn register(&self, path: &Path) -> String {
        let key = registry_key(path);
        let mut registry = self
            .inner
            .lock()
            .expect("attachment registry lock poisoned");
        if let Some(id) = registry.by_path.get(&key) {
            return id.clone();
        }

        let id = loop {
            registry.next_id = registry.next_id.wrapping_add(1);
            if registry.next_id == 0 {
                registry.next_id = 1;
            }
            let candidate = format!("{:016x}", registry.next_id);
            if !registry.by_id.contains_key(&candidate) {
                break candidate;
            }
            if registry.next_id == MAX_REGISTRY_ID {
                // An application cannot realistically exhaust this registry, but do not
                // return an ambiguous URL if an embedding ever does.
                panic!("attachment URI registry exhausted");
            }
        };
        registry.by_path.insert(key, id.clone());
        registry.by_id.insert(id.clone(), path.to_path_buf());
        id
    }

    fn path_for(&self, id: &str) -> Option<PathBuf> {
        self.inner
            .lock()
            .expect("attachment registry lock poisoned")
            .by_id
            .get(id)
            .cloned()
    }
}

/// The default image folder inside the configuration directory.
fn default_images_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    config_dir::for_app(app)
        .map(|path| path.join("attachments"))
        .map_err(|error| CommandError::InvalidPath(error.to_string()))
}

/// The folder every inserted image is stored in: the one chosen in
/// Settings -> Attachments, or the default. The caller creates it only for a write.
pub(crate) fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    let chosen = app
        .try_state::<crate::settings::SettingsState>()
        .map(|state| state.get().attachments.folder)
        .unwrap_or_default();
    let chosen = chosen.trim();
    if !chosen.is_empty() && Path::new(chosen).is_absolute() {
        return Ok(PathBuf::from(chosen));
    }
    default_images_dir(app)
}

#[allow(non_snake_case)]
pub fn save_attachment(
    app: AppHandle,
    docPath: Option<String>,
    fileName: Option<String>,
    data: Vec<u8>,
) -> Result<AttachmentRef, CommandError> {
    let cache_root = cache_dir(&app)?;
    save_bytes_in_roots(
        docPath.as_deref().map(Path::new),
        &cache_root,
        fileName.as_deref(),
        &data,
    )
}

#[allow(non_snake_case)]
pub fn save_attachment_from_path(
    app: AppHandle,
    docPath: Option<String>,
    sourcePath: String,
) -> Result<AttachmentRef, CommandError> {
    let source_input = Path::new(&sourcePath);
    if sourcePath.is_empty()
        || sourcePath.bytes().any(|byte| byte == 0)
        || commands::is_windows_device_path(source_input)
        || !source_input.is_absolute()
    {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathAbsoluteOrDevice.to_string(),
        ));
    }
    let source =
        windows::canonical_path(Path::new(&sourcePath)).map_err(CommandError::InvalidPath)?;
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(CommandError::Message(UserMessage::ImageUnsupported))?;
    sanitized_name(file_name)?;
    let metadata = fs::metadata(&source)?;
    if !metadata.is_file() {
        return Err(CommandError::Message(UserMessage::ImageNotRegularFile));
    }
    if metadata.len() > commands::MAX_IMAGE_BYTES {
        return Err(CommandError::ImageTooLarge(
            source.to_string_lossy().into_owned(),
        ));
    }
    let cache_root = cache_dir(&app)?;
    copy_source_in_roots(
        docPath.as_deref().map(Path::new),
        &cache_root,
        &source,
        file_name,
    )
}

#[allow(non_snake_case)]
pub fn resolve_image(
    app: AppHandle,
    registry: State<'_, AttachmentRegistry>,
    docPath: Option<String>,
    src: String,
) -> Result<String, CommandError> {
    resolve_image_with_registry(&app, &registry, docPath, src)
}

pub(crate) fn resolve_image_with_registry<R: Runtime>(
    app: &AppHandle<R>,
    registry: &AttachmentRegistry,
    doc_path: Option<String>,
    src: String,
) -> Result<String, CommandError> {
    if is_legacy_url(&src) {
        return Ok(src);
    }
    let cache_root = cache_dir(app)?;
    let path = validate_image_path(doc_path.as_deref(), &src, &cache_root)?;
    let id = registry.register(&path);
    Ok(attachment_url(app, &id))
}

pub fn attachment_cache_stats(app: AppHandle) -> Result<CacheStats, CommandError> {
    let cache_root = cache_dir(&app)?;
    cache_stats(&cache_root)
}

/// Result of moving the image folder: the files now in the new folder and
/// how many could not be moved because a file of that name was already there.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FolderMove {
    pub files: usize,
    pub bytes: u64,
    pub path: String,
    pub skipped: usize,
}

/// Moves the images from the current folder to `folder` (empty = the default
/// folder) so existing links keep working. The caller then stores the new
/// folder in the settings.
pub fn move_attachments_folder(app: AppHandle, folder: String) -> Result<FolderMove, CommandError> {
    let from = cache_dir(&app)?;
    let folder = folder.trim();
    let to = if folder.is_empty() {
        default_images_dir(&app)?
    } else {
        let path = PathBuf::from(folder);
        if !path.is_absolute() || commands::is_windows_device_path(&path) {
            return Err(CommandError::InvalidPath(UserMessage::ImagePathAbsoluteOrDevice.to_string()));
        }
        path
    };
    fs::create_dir_all(&to)?;
    let skipped = move_images(&from, &to)?;
    let stats = cache_stats(&to)?;
    Ok(FolderMove { files: stats.files, bytes: stats.bytes, path: stats.path, skipped })
}

/// Moves the regular files directly inside `from` into `to`, never replacing
/// a file that already exists there. Returns how many were left behind.
fn move_images(from: &Path, to: &Path) -> Result<usize, CommandError> {
    let same = match (windows::canonical_path(from), windows::canonical_path(to)) {
        (Ok(left), Ok(right)) => registry_key(&left) == registry_key(&right),
        _ => false,
    };
    if same {
        return Ok(0);
    }
    let Ok(entries) = fs::read_dir(from) else {
        return Ok(0);
    };
    let mut skipped = 0;
    for entry in entries.flatten() {
        let source = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&source) else {
            continue;
        };
        if !metadata.file_type().is_file() {
            continue;
        }
        let target = to.join(entry.file_name());
        if target.exists() {
            skipped += 1;
            continue;
        }
        if fs::rename(&source, &target).is_err() {
            // Another drive: copy without overwriting, then remove the original.
            copy_then_delete(&source, &target)?;
        }
    }
    Ok(skipped)
}

/// What "Open Image" hands to Windows: a web address for remote images, or a
/// local image file that passed the same containment checks as rendering.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ExternalImage {
    Url(String),
    File(PathBuf),
}

/// Resolves an image reference for opening in the default Windows program.
/// Only http(s) addresses and real image files inside the document folder or
/// the attachment cache qualify, so a crafted `![](tool.exe)` cannot launch
/// anything.
pub(crate) fn external_image_target(
    doc_path: Option<&str>,
    src: &str,
    cache_root: &Path,
) -> Result<ExternalImage, CommandError> {
    if src.starts_with("http://") || src.starts_with("https://") {
        return Ok(ExternalImage::Url(src.to_owned()));
    }
    let path = validate_image_path(doc_path, src, cache_root)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !is_supported_extension(&extension) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImageNotRegularFile.to_string(),
        ));
    }
    Ok(ExternalImage::File(path))
}

/// Opens an image in the program Windows associates with its type (Photos,
/// a browser for GIF or SVG, and so on).
#[allow(non_snake_case)]
pub fn open_image(app: AppHandle, docPath: Option<String>, src: String) -> Result<(), CommandError> {
    let cache_root = cache_dir(&app)?;
    let target = external_image_target(docPath.as_deref(), &src, &cache_root)?;
    #[cfg(windows)]
    {
        let argument = match &target {
            ExternalImage::Url(url) => std::ffi::OsString::from(url),
            ExternalImage::File(path) => path.as_os_str().to_owned(),
        };
        Command::new("explorer")
            .arg(argument)
            .spawn()
            .map_err(CommandError::Io)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err(CommandError::Message(UserMessage::ExplorerWindowsOnly))
    }
}

pub fn reveal_attachment_cache(app: AppHandle) -> Result<(), CommandError> {
    let cache_root = cache_dir(&app)?;
    #[cfg(windows)]
    {
        fs::create_dir_all(&cache_root)?;
        Command::new("explorer")
            .arg(&cache_root)
            .spawn()
            .map_err(CommandError::Io)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, cache_root);
        Err(CommandError::Message(UserMessage::ExplorerWindowsOnly))
    }
}


/// Tauri invokes this handler on a webview request thread; file I/O is moved to
/// a worker so a large GIF cannot stall the UI thread while its bytes are read.
pub(crate) fn serve_protocol(
    registry: AttachmentRegistry,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let id = request.uri().path().trim_start_matches('/').to_owned();
    let method = request.method().clone();
    std::thread::spawn(move || {
        let response = if method != tauri::http::Method::GET && method != tauri::http::Method::HEAD
        {
            response_error(
                tauri::http::StatusCode::METHOD_NOT_ALLOWED,
                "method not allowed",
            )
        } else {
            match registry.path_for(&id) {
                Some(path) => serve_registered_path(&path, method == tauri::http::Method::HEAD),
                None => response_error(tauri::http::StatusCode::NOT_FOUND, "attachment not found"),
            }
        };
        responder.respond(response);
    });
}

fn serve_registered_path(path: &Path, head_only: bool) -> tauri::http::Response<Vec<u8>> {
    let canonical = match windows::canonical_path(path) {
        Ok(canonical) if registry_key(&canonical) == registry_key(path) => canonical,
        _ => return response_error(tauri::http::StatusCode::NOT_FOUND, "attachment not found"),
    };
    let metadata = match fs::metadata(&canonical) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= commands::MAX_IMAGE_BYTES => {
            metadata
        }
        _ => return response_error(tauri::http::StatusCode::NOT_FOUND, "attachment not found"),
    };
    let mime = commands::image_mime(&canonical);
    if head_only {
        return tauri::http::Response::builder()
            .status(tauri::http::StatusCode::OK)
            .header(tauri::http::header::CONTENT_TYPE, mime)
            .header(tauri::http::header::CONTENT_LENGTH, metadata.len())
            .body(Vec::new())
            .unwrap();
    }
    match fs::read(&canonical) {
        Ok(bytes) if bytes.len() as u64 <= commands::MAX_IMAGE_BYTES => {
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, mime)
                .header(tauri::http::header::CONTENT_LENGTH, bytes.len())
                .body(bytes)
                .unwrap()
        }
        Err(_) => response_error(tauri::http::StatusCode::NOT_FOUND, "attachment not found"),
        Ok(_) => response_error(tauri::http::StatusCode::NOT_FOUND, "attachment not found"),
    }
}

fn response_error(
    status: tauri::http::StatusCode,
    message: &str,
) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(
            tauri::http::header::CONTENT_TYPE,
            "text/plain; charset=utf-8",
        )
        .body(message.as_bytes().to_vec())
        .unwrap()
}

fn attachment_url<R: Runtime>(app: &AppHandle<R>, id: &str) -> String {
    attachment_url_for_scheme(id, configured_use_https_scheme(app))
}

fn configured_use_https_scheme<R: Runtime>(app: &AppHandle<R>) -> bool {
    #[cfg(any(windows, target_os = "android"))]
    {
        app.config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .or_else(|| app.config().app.windows.first())
            .is_some_and(|window| window.use_https_scheme)
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = app;
        false
    }
}

fn attachment_url_for_scheme(id: &str, use_https_scheme: bool) -> String {
    if cfg!(any(windows, target_os = "android")) {
        let protocol = if use_https_scheme { "https" } else { "http" };
        format!("{protocol}://{ATTACHMENT_SCHEME}.localhost/{id}")
    } else {
        format!("{ATTACHMENT_SCHEME}://localhost/{id}")
    }
}

fn save_bytes_in_roots(
    doc_path: Option<&Path>,
    cache_root: &Path,
    file_name: Option<&str>,
    data: &[u8],
) -> Result<AttachmentRef, CommandError> {
    if data.len() as u64 > commands::MAX_IMAGE_BYTES {
        return Err(CommandError::ImageTooLarge(data.len().to_string()));
    }
    let file_name = file_name.unwrap_or("image.png");
    let (stem, extension) = sanitized_name(file_name)?;
    let (root, src_prefix, cached) = destination_root(doc_path, cache_root)?;
    fs::create_dir_all(&root)?;
    let root = windows::canonical_path(&root).map_err(CommandError::InvalidPath)?;
    let target = create_unique(&root, &stem, &extension, |file| file.write_all(data))?;
    Ok(attachment_ref(target, src_prefix, cached))
}

fn copy_source_in_roots(
    doc_path: Option<&Path>,
    cache_root: &Path,
    source: &Path,
    file_name: &str,
) -> Result<AttachmentRef, CommandError> {
    let (stem, extension) = sanitized_name(file_name)?;
    let data = fs::read(source)?;
    if data.len() as u64 > commands::MAX_IMAGE_BYTES {
        return Err(CommandError::ImageTooLarge(
            source.to_string_lossy().into_owned(),
        ));
    }
    let (root, src_prefix, cached) = destination_root(doc_path, cache_root)?;
    fs::create_dir_all(&root)?;
    let root = windows::canonical_path(&root).map_err(CommandError::InvalidPath)?;
    let target = create_unique(&root, &stem, &extension, |file| file.write_all(&data))?;
    Ok(attachment_ref(target, src_prefix, cached))
}

fn attachment_ref(path: PathBuf, src_prefix: String, cached: bool) -> AttachmentRef {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image.png");
    AttachmentRef {
        src: format!("{src_prefix}{name}"),
        path: path.to_string_lossy().into_owned(),
        cached,
    }
}

fn destination_root(
    doc_path: Option<&Path>,
    cache_root: &Path,
) -> Result<(PathBuf, String, bool), CommandError> {
    // Every image lives in the one image folder, whatever the document: links
    // do not depend on the document's name or place, so renaming, moving or
    // copying text between documents keeps them working, and saving never
    // has to move files or rewrite links.
    let _ = doc_path;
    Ok((cache_root.to_path_buf(), IMAGES_PREFIX.to_owned(), false))
}

fn canonical_document(path: &Path) -> Result<PathBuf, CommandError> {
    if path.as_os_str().is_empty() || commands::is_windows_device_path(path) || !path.is_absolute()
    {
        return Err(CommandError::Message(UserMessage::DeviceDocumentPath));
    }
    windows::canonical_path(path).map_err(CommandError::InvalidPath)
}

fn ensure_cache_root(cache_root: &Path) -> Result<PathBuf, CommandError> {
    fs::create_dir_all(cache_root)?;
    windows::canonical_path(cache_root).map_err(CommandError::InvalidPath)
}

/// Links are written percent-encoded ("my%20pic.png"); files are not.
pub(crate) fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_owned())
}

pub(crate) fn validate_image_path(
    doc_path: Option<&str>,
    src: &str,
    cache_root: &Path,
) -> Result<PathBuf, CommandError> {
    match validate_image_path_exact(doc_path, src, cache_root) {
        Ok(path) => Ok(path),
        Err(error) => {
            let decoded = percent_decode(src);
            if decoded == src {
                return Err(error);
            }
            validate_image_path_exact(doc_path, &decoded, cache_root).map_err(|_| error)
        }
    }
}

fn validate_image_path_exact(
    doc_path: Option<&str>,
    src: &str,
    cache_root: &Path,
) -> Result<PathBuf, CommandError> {
    if src.is_empty() {
        return Err(CommandError::Message(UserMessage::InvalidPath));
    }
    if src.bytes().any(|byte| byte == 0) || commands::has_uri_scheme(src) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathMustBeRelative.to_string(),
        ));
    }
    let source_path = PathBuf::from(src);
    if source_path.is_absolute() || commands::is_windows_device_path(&source_path) {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathAbsoluteOrDevice.to_string(),
        ));
    }

    let store_relative = src.strip_prefix(IMAGES_PREFIX).or_else(|| src.strip_prefix(CACHE_PREFIX));
    let (root, candidate) = if let Some(relative) = store_relative {
        if relative.is_empty() {
            return Err(CommandError::Message(UserMessage::InvalidPath));
        }
        let root = ensure_cache_root(cache_root)?;
        let candidate =
            windows::canonical_path(&root.join(relative)).map_err(CommandError::InvalidPath)?;
        (root, candidate)
    } else {
        let document_path =
            doc_path.ok_or(CommandError::Message(UserMessage::DocumentPathRequired))?;
        let document = canonical_document(Path::new(document_path))?;
        let root = document
            .parent()
            .ok_or(CommandError::Message(UserMessage::DocumentFolderRequired))?;
        let candidate =
            windows::canonical_path(&root.join(source_path)).map_err(CommandError::InvalidPath)?;
        (root.to_path_buf(), candidate)
    };
    if !commands::path_is_within(&root, &candidate) || commands::is_windows_device_path(&candidate)
    {
        return Err(CommandError::InvalidPath(
            UserMessage::ImagePathOutsideDocument.to_string(),
        ));
    }
    let metadata = fs::metadata(&candidate)?;
    if !metadata.is_file() {
        return Err(CommandError::InvalidPath(
            UserMessage::ImageNotRegularFile.to_string(),
        ));
    }
    if metadata.len() > commands::MAX_IMAGE_BYTES {
        return Err(CommandError::ImageTooLarge(
            candidate.to_string_lossy().into_owned(),
        ));
    }
    Ok(candidate)
}

fn sanitized_name(file_name: &str) -> Result<(String, String), CommandError> {
    let file_name = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(CommandError::Message(UserMessage::ImageUnsupported))?;
    if !is_supported_extension(&extension) {
        return Err(CommandError::Message(UserMessage::ImageUnsupported));
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let sanitized: String = stem
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
        .collect();
    let stem = if sanitized.is_empty() {
        "image".to_owned()
    } else {
        sanitized
    };
    Ok((stem, extension))
}

fn is_supported_extension(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" | "ico"
    )
}

fn create_unique<F>(
    root: &Path,
    stem: &str,
    extension: &str,
    mut write: F,
) -> Result<PathBuf, CommandError>
where
    F: FnMut(&mut File) -> io::Result<()>,
{
    for collision in 0..=u32::MAX {
        let suffix = if collision == 0 {
            String::new()
        } else {
            format!("-{collision:06x}")
        };
        let target = root.join(format!("{stem}{suffix}.{extension}"));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target);
        let Ok(mut file) = file else {
            let error = file.expect_err("open result was checked");
            if error.kind() == io::ErrorKind::AlreadyExists {
                continue;
            }
            return Err(CommandError::Io(error));
        };
        if let Err(error) = write(&mut file) {
            let _ = fs::remove_file(&target);
            return Err(CommandError::Io(error));
        }
        return Ok(target);
    }
    Err(CommandError::InvalidPath(
        "No free attachment name available.".to_owned(),
    ))
}

fn copy_then_delete(source: &Path, target: &Path) -> io::Result<()> {
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    if let Err(error) = io::copy(&mut input, &mut output) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    output.flush()?;
    drop(output);
    fs::remove_file(source)
}

fn cache_stats(cache_root: &Path) -> Result<CacheStats, CommandError> {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return Ok(CacheStats {
            files: 0,
            bytes: 0,
            path: cache_root.to_string_lossy().into_owned(),
        });
    };
    let mut stats = CacheStats {
        files: 0,
        bytes: 0,
        path: cache_root.to_string_lossy().into_owned(),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(path) else {
            continue;
        };
        if metadata.file_type().is_file() {
            stats.files += 1;
            stats.bytes += metadata.len();
        }
    }
    Ok(stats)
}

fn registry_key(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value.into_owned()
    }
}

fn is_legacy_url(src: &str) -> bool {
    src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_image_target_accepts_web_addresses_and_images_beside_the_document() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = dir.path().join("cache");
        let document = dir.path().join("note.md");
        fs::write(&document, "text").expect("document");
        fs::write(dir.path().join("shot.PNG"), b"png").expect("image");
        let doc = document.to_string_lossy().into_owned();

        assert_eq!(
            external_image_target(Some(&doc), "https://example.com/a.gif", &cache).unwrap(),
            ExternalImage::Url("https://example.com/a.gif".to_owned())
        );
        match external_image_target(Some(&doc), "shot.PNG", &cache).unwrap() {
            ExternalImage::File(path) => assert!(path.ends_with("shot.PNG")),
            other => panic!("expected a file, got {other:?}"),
        }
    }

    #[test]
    fn external_image_target_refuses_non_images_and_paths_outside_the_document() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = dir.path().join("cache");
        let folder = dir.path().join("notes");
        fs::create_dir_all(&folder).expect("folder");
        let document = folder.join("note.md");
        fs::write(&document, "text").expect("document");
        fs::write(folder.join("tool.exe"), b"MZ").expect("program");
        fs::write(dir.path().join("outside.png"), b"png").expect("outside image");
        let doc = document.to_string_lossy().into_owned();

        assert!(external_image_target(Some(&doc), "tool.exe", &cache).is_err());
        assert!(external_image_target(Some(&doc), "../outside.png", &cache).is_err());
        assert!(external_image_target(Some(&doc), "data:image/png;base64,AAAA", &cache).is_err());
        assert!(external_image_target(None, "shot.png", &cache).is_err());
    }

    #[test]
    fn registry_deduplicates_a_canonical_path() {
        let registry = AttachmentRegistry::default();
        let path = Path::new(r"C:\notes\photo.gif");
        let first = registry.register(path);
        let second = registry.register(path);
        assert_eq!(first, second);
    }

    #[test]
    fn attachment_url_follows_window_protocol_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse app config");
        let use_https_scheme = config["app"]["windows"]
            .as_array()
            .and_then(|windows| windows.iter().find(|window| window["label"] == "main"))
            .and_then(|window| window["useHttpsScheme"].as_bool())
            .unwrap_or(false);
        let url = attachment_url_for_scheme("42", use_https_scheme);
        let expected_prefix = if cfg!(any(windows, target_os = "android")) {
            let protocol = if use_https_scheme { "https" } else { "http" };
            format!("{protocol}://{ATTACHMENT_SCHEME}.localhost/")
        } else {
            format!("{ATTACHMENT_SCHEME}://localhost/")
        };

        assert_eq!(url, format!("{expected_prefix}42"));
    }

    #[test]
    fn protocol_serves_gif_with_its_animation_mime_type() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let image = directory.path().join("animation.gif");
        fs::write(&image, b"gif bytes").expect("image");
        let canonical = windows::canonical_path(&image).expect("canonical image");
        let response = serve_registered_path(&canonical, false);

        assert_eq!(response.status(), tauri::http::StatusCode::OK);
        assert_eq!(
            response.headers().get(tauri::http::header::CONTENT_TYPE),
            Some(&tauri::http::HeaderValue::from_static("image/gif"))
        );
        assert_eq!(response.body(), b"gif bytes");
    }

    #[test]
    fn saved_document_bytes_go_to_the_image_folder() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let document = directory.path().join("note.md");
        fs::write(&document, "# Note").expect("document");
        let cache = directory.path().join("cache");
        let result =
            save_bytes_in_roots(Some(&document), &cache, Some("holiday picture.PNG"), b"png")
                .expect("save attachment");

        assert_eq!(result.src, "marknote-images/holidaypicture.png");
        assert!(!result.cached);
        assert!(Path::new(&result.path).starts_with(windows::canonical_path(&cache).unwrap()));
        assert!(!directory.path().join("note.assets").exists());
        assert_eq!(fs::read(&result.path).expect("saved bytes"), b"png");
    }

    #[test]
    fn copying_an_absolute_source_path_uses_the_same_safe_destination() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let source = directory.path().join("source.gif");
        let document = directory.path().join("note.md");
        let cache = directory.path().join("cache");
        fs::write(&source, b"gif").expect("source");
        fs::write(&document, "# Note").expect("document");

        let result = copy_source_in_roots(
            Some(&document),
            &cache,
            &windows::canonical_path(&source).expect("source path"),
            "source.gif",
        )
        .expect("copy attachment");

        assert_eq!(result.src, "marknote-images/source.gif");
        assert_eq!(fs::read(&result.path).unwrap(), b"gif");
    }

    #[test]
    fn unsaved_document_bytes_use_the_same_image_folder() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let cache = directory.path().join("cache");
        let result = save_bytes_in_roots(None, &cache, None, b"png").expect("save attachment");

        assert!(result.src.starts_with(IMAGES_PREFIX));
        assert!(!result.cached);
        assert!(Path::new(&result.path).is_file());
    }

    #[test]
    fn collisions_get_a_new_six_digit_hex_suffix_without_overwriting() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let document = directory.path().join("note.md");
        fs::write(&document, "# Note").expect("document");
        let cache = directory.path().join("cache");
        let first = save_bytes_in_roots(Some(&document), &cache, Some("photo.jpg"), b"one")
            .expect("first attachment");
        let second = save_bytes_in_roots(Some(&document), &cache, Some("photo.jpg"), b"two")
            .expect("second attachment");

        assert_ne!(first.path, second.path);
        assert_eq!(fs::read(&first.path).unwrap(), b"one");
        assert_eq!(fs::read(&second.path).unwrap(), b"two");
        assert!(second.src.ends_with("-000001.jpg"));
    }

    #[test]
    fn oversized_payload_is_rejected_before_a_file_is_created() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let cache = directory.path().join("cache");
        let data = vec![0; (commands::MAX_IMAGE_BYTES + 1) as usize];
        assert!(matches!(
            save_bytes_in_roots(None, &cache, Some("large.png"), &data),
            Err(CommandError::ImageTooLarge(_))
        ));
        assert!(!cache.exists());
    }

    #[test]
    fn disallowed_extensions_are_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let cache = directory.path().join("cache");
        assert!(matches!(
            save_bytes_in_roots(None, &cache, Some("payload.exe"), b"MZ"),
            Err(CommandError::Message(UserMessage::ImageUnsupported))
        ));
    }

    #[test]
    fn cache_stats_counts_only_direct_regular_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let cache = directory.path().join("cache");
        fs::create_dir_all(cache.join("nested")).expect("nested directory");
        fs::write(cache.join("one.png"), b"one").expect("one");
        fs::write(cache.join("two.gif"), b"two").expect("two");
        fs::write(cache.join("nested/three.png"), b"three").expect("three");
        let stats = cache_stats(&cache).expect("stats");
        assert_eq!(
            stats,
            CacheStats {
                files: 2,
                bytes: 6,
                path: cache.to_string_lossy().into_owned(),
            }
        );
    }

    #[test]
    fn moving_the_folder_takes_the_images_along_and_never_overwrites() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let from = directory.path().join("from");
        let to = directory.path().join("to");
        fs::create_dir_all(from.join("nested")).expect("nested directory");
        fs::create_dir_all(&to).expect("target");
        fs::write(from.join("one.png"), b"one").expect("one");
        fs::write(from.join("two.gif"), b"two").expect("two");
        fs::write(from.join("nested/three.png"), b"three").expect("three");
        fs::write(to.join("two.gif"), b"kept").expect("existing");

        assert_eq!(move_images(&from, &to).expect("move"), 1);
        assert_eq!(fs::read(to.join("one.png")).unwrap(), b"one");
        assert_eq!(fs::read(to.join("two.gif")).unwrap(), b"kept");
        assert!(from.join("two.gif").is_file());
        assert!(!from.join("one.png").exists());
        assert!(from.join("nested/three.png").is_file());
        assert_eq!(move_images(&to, &to).expect("same folder"), 0);
    }

    #[test]
    fn percent_encoded_links_find_files_with_spaces() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let assets = directory.path().join("debug 9.assets");
        fs::create_dir_all(&assets).expect("assets");
        fs::write(assets.join("my pic.png"), b"png").expect("image");
        let document = directory.path().join("debug 9.md");
        fs::write(&document, "x").expect("document");
        let cache = directory.path().join("images");
        fs::create_dir_all(&cache).expect("images");
        fs::write(cache.join("shot 1.png"), b"png").expect("stored");
        let doc = document.to_string_lossy().into_owned();

        let found = validate_image_path(Some(&doc), "debug%209.assets/my%20pic.png", &cache).expect("encoded relative link");
        assert!(found.ends_with("my pic.png"));
        assert!(validate_image_path(Some(&doc), "debug 9.assets/my pic.png", &cache).is_ok());
        assert!(validate_image_path(None, "marknote-images/shot%201.png", &cache).is_ok());
        assert!(validate_image_path(None, "marknote-cache/shot%201.png", &cache).is_ok());
    }

    #[test]
    fn cache_stats_always_reports_the_absolute_cache_path() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let cache = directory.path().join("cache");
        let stats = cache_stats(&cache).expect("stats");

        assert_eq!(stats.files, 0);
        assert_eq!(stats.bytes, 0);
        assert_eq!(stats.path, cache.to_string_lossy());
        assert!(Path::new(&stats.path).is_absolute());
    }

    #[test]
    fn image_resolution_rejects_escape_outside_document_directory() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let outside = tempfile::tempdir().expect("outside directory");
        let document = directory.path().join("note.md");
        fs::write(&document, "# Note").expect("document");
        fs::write(outside.path().join("secret.png"), b"secret").expect("secret");
        let cache = directory.path().join("cache");
        let escaped = format!(
            "../{}/secret.png",
            outside.path().file_name().unwrap().to_string_lossy()
        );
        assert!(matches!(
            validate_image_path(Some(document.to_str().unwrap()), &escaped, &cache),
            Err(CommandError::InvalidPath(_))
        ));
    }
}
