//! "Export as ZIP" for Markdown documents with images.
//!
//! The archive holds `<name>.md` with every local image embedded as a data
//! URI, so the document shows its pictures wherever it is opened: straight
//! from the archive (Explorer extracts only the clicked file), after
//! unpacking, or sent on as a single file. The original image files travel
//! beside it in `images/` for anyone who wants them separately. Remote
//! http(s) images stay links; a local image that cannot be read is left as
//! it was and reported, never silently dropped.

use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{attachments, atomic_write, commands::CommandError};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZipExportResult {
    pub path: String,
    pub embedded: usize,
    /// Image references that could not be read and were left unchanged.
    pub skipped: Vec<String>,
}

/// One `![alt](src)` found in the text: byte range of `src` and its value.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ImageRef {
    pub start: usize,
    pub end: usize,
    pub src: String,
}

/// Finds Markdown image destinations, including `<angle bracket>` ones and an
/// optional title. Code spans and fenced blocks are not excluded: an image
/// written inside code is rare, and embedding it there is harmless.
pub(crate) fn image_refs(text: &str) -> Vec<ImageRef> {
    let bytes = text.as_bytes();
    let mut refs = Vec::new();
    let mut index = 0;
    while let Some(offset) = text[index..].find("![") {
        let open = index + offset;
        let Some(close_alt) = text[open + 2..].find("](").map(|value| open + 2 + value) else {
            break;
        };
        if text[open + 2..close_alt].contains('\n') {
            index = open + 2;
            continue;
        }
        let mut start = close_alt + 2;
        while start < bytes.len() && bytes[start] == b' ' {
            start += 1;
        }
        let (src_start, src_end, after) = if bytes.get(start) == Some(&b'<') {
            match text[start + 1..].find('>') {
                Some(length) => (start + 1, start + 1 + length, start + 2 + length),
                None => {
                    index = start;
                    continue;
                }
            }
        } else {
            let length = text[start..]
                .find(|character: char| character == ')' || character.is_whitespace())
                .unwrap_or(text.len() - start);
            (start, start + length, start + length)
        };
        let Some(close) = text[after..].find(')').map(|value| after + value) else {
            break;
        };
        if src_end > src_start && !text[after..close].contains('\n') {
            refs.push(ImageRef {
                start: src_start,
                end: src_end,
                src: text[src_start..src_end].to_owned(),
            });
        }
        index = close + 1;
    }
    refs
}

fn percent_decode(value: &str) -> String {
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

fn mime_for(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        _ => return None,
    })
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(TABLE[(value >> 18) as usize & 63] as char);
        out.push(TABLE[(value >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(value >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[value as usize & 63] as char } else { '=' });
    }
    out
}

/// A local image read for the archive.
struct Embedded {
    src: String,
    file_name: String,
    bytes: Vec<u8>,
    data_uri: String,
}

fn load_image(doc_path: Option<&str>, src: &str, cache_root: &Path) -> Option<(PathBuf, Vec<u8>, &'static str)> {
    let candidates = [src.to_owned(), percent_decode(src)];
    for candidate in candidates.iter() {
        if let Ok(path) = attachments::validate_image_path(doc_path, candidate, cache_root) {
            let mime = mime_for(&path)?;
            let bytes = fs::read(&path).ok()?;
            return Some((path, bytes, mime));
        }
    }
    None
}

fn unique_name(name: &str, used: &mut HashSet<String>) -> String {
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("image");
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("png");
    let mut candidate = format!("{stem}.{extension}");
    let mut counter = 2;
    while !used.insert(candidate.to_ascii_lowercase()) {
        candidate = format!("{stem}-{counter}.{extension}");
        counter += 1;
    }
    candidate
}

/// Builds the archive in memory. Returns the bytes, the number of embedded
/// images and the references that were left unchanged.
pub(crate) fn build_archive(
    doc_path: Option<&str>,
    text: &str,
    markdown_name: &str,
    cache_root: &Path,
) -> Result<(Vec<u8>, usize, Vec<String>), CommandError> {
    let mut rewritten = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut embedded: Vec<Embedded> = Vec::new();
    let mut skipped = Vec::new();
    let mut used = HashSet::new();

    for image in image_refs(text) {
        rewritten.push_str(&text[cursor..image.start]);
        cursor = image.end;
        let src = image.src.as_str();
        if src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://") {
            rewritten.push_str(src);
            continue;
        }
        if let Some(existing) = embedded.iter().find(|item| item.src == src) {
            rewritten.push_str(&existing.data_uri);
            continue;
        }
        match load_image(doc_path, src, cache_root) {
            Some((path, bytes, mime)) => {
                let original = path.file_name().and_then(|value| value.to_str()).unwrap_or("image.png");
                let data_uri = format!("data:{mime};base64,{}", base64(&bytes));
                rewritten.push_str(&data_uri);
                embedded.push(Embedded {
                    src: src.to_owned(),
                    file_name: unique_name(original, &mut used),
                    bytes,
                    data_uri,
                });
            }
            None => {
                rewritten.push_str(src);
                skipped.push(src.to_owned());
            }
        }
    }
    rewritten.push_str(&text[cursor..]);

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let zip_error = |error: zip::result::ZipError| CommandError::Format(anyhow::Error::new(error));
    writer.start_file(markdown_name, deflated).map_err(zip_error)?;
    writer.write_all(rewritten.as_bytes())?;
    for image in &embedded {
        // Images are already compressed; storing them avoids wasted work.
        writer.start_file(format!("images/{}", image.file_name), stored).map_err(zip_error)?;
        writer.write_all(&image.bytes)?;
    }
    let bytes = writer.finish().map_err(zip_error)?.into_inner();
    Ok((bytes, embedded.len(), skipped))
}

fn markdown_file_name(suggested: &str) -> String {
    let stem = Path::new(suggested)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document");
    format!("{stem}.md")
}

/// Asks where to save and writes the archive. `None` when the dialog was cancelled.
pub fn export_markdown_zip<R: Runtime>(
    app: &AppHandle<R>,
    doc_path: Option<String>,
    text: String,
    suggested_name: String,
) -> Result<Option<ZipExportResult>, CommandError> {
    let markdown_name = markdown_file_name(&suggested_name);
    let zip_name = format!("{}.zip", markdown_name.trim_end_matches(".md"));
    let Some(selected) = app
        .dialog()
        .file()
        .set_file_name(zip_name)
        .add_filter("ZIP", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = selected
        .into_path()
        .map_err(|error| CommandError::Dialog(error.to_string()))?;
    if path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("zip") {
        path.set_extension("zip");
    }
    let cache_root = attachments::cache_dir(app)?;
    let (bytes, embedded, skipped) = build_archive(doc_path.as_deref(), &text, &markdown_name, &cache_root)?;
    atomic_write::write_atomic(&path, &bytes).map_err(CommandError::AtomicWrite)?;
    Ok(Some(ZipExportResult { path: path.to_string_lossy().into_owned(), embedded, skipped }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn finds_plain_angle_and_titled_image_destinations() {
        let text = "a ![x|400](note.assets/a%20b.png) b ![y](<note.assets/c d.gif> \"t\") ![z](https://e/f.png)\n![broken\nline](g.png)";
        let srcs: Vec<String> = image_refs(text).into_iter().map(|item| item.src).collect();
        assert_eq!(srcs, ["note.assets/a%20b.png", "note.assets/c d.gif", "https://e/f.png"]);
    }

    #[test]
    fn embeds_local_images_and_packs_the_originals() {
        let dir = tempfile::tempdir().expect("temp dir");
        let assets = dir.path().join("note.assets");
        fs::create_dir_all(&assets).expect("assets");
        fs::write(assets.join("a b.png"), [1u8, 2, 3]).expect("image");
        let document = dir.path().join("note.md");
        let text = "# T\n![x|400](note.assets/a%20b.png)\n![again](note.assets/a%20b.png)\n![web](https://e/f.png)\n![gone](note.assets/missing.png)\n";
        fs::write(&document, text).expect("document");
        let cache = dir.path().join("cache");

        let (bytes, embedded, skipped) =
            build_archive(Some(document.to_str().unwrap()), text, "note.md", &cache).expect("archive");
        assert_eq!(embedded, 1);
        assert_eq!(skipped, ["note.assets/missing.png"]);

        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let mut markdown = String::new();
        archive.by_name("note.md").expect("md").read_to_string(&mut markdown).expect("read");
        assert!(markdown.contains("![x|400](data:image/png;base64,AQID)"));
        assert!(markdown.contains("![again](data:image/png;base64,AQID)"));
        assert!(markdown.contains("![web](https://e/f.png)"));
        assert!(markdown.contains("![gone](note.assets/missing.png)"));
        let mut image = Vec::new();
        archive.by_name("images/a b.png").expect("image entry").read_to_end(&mut image).expect("read");
        assert_eq!(image, [1, 2, 3]);
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
    }
}
