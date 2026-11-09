//! "Markdown with images" (`.mdz`): one file that carries a Markdown document
//! together with every picture it shows, so it can be sent on like a PDF.
//!
//! The file is an ordinary ZIP archive:
//!
//! ```text
//! note.mdz
//! ├─ note.md          the text; image links point into images/
//! └─ images/
//!    ├─ shot.png
//!    └─ diagram.gif
//! ```
//!
//! Unpacked by hand, it is a normal Markdown folder that any editor shows with
//! its pictures. Opened in MarkNote, the text keeps the archive's short links
//! (`images/image-1.png`, never a path on this computer); the pictures are
//! copied into a folder of their own inside the image folder (Settings ->
//! Attachments), where the editor finds them. A picture pasted into the
//! document goes there too as the next `image-<n>`. Saving packs every local
//! image the text references back into the archive; one linked from elsewhere
//! (a real path) is packed under the next free `image-<n>` name.

use std::{
    collections::HashSet,
    io::{Cursor, Read, Write},
    path::Path,
};

use anyhow::{anyhow, bail, Context};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use super::{
    image_links::{percent_decode, rewrite_image_links},
    FormatAdapter, FormatCapabilities, FormatContext, ImageStore,
};
use crate::encoding;

pub const ID: &str = "mdz";
pub const EXTENSION: &str = "mdz";

/// Folder inside the archive that holds the pictures.
const IMAGES_DIR: &str = "images/";
/// Guards against a hostile archive that inflates to gigabytes of text.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;
/// The same per-image limit the image folder applies to pasted pictures.
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

pub struct PackageAdapter;

impl FormatAdapter for PackageAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: ID.to_owned(),
            label: "Markdown with Images".to_owned(),
            default_extension: EXTENSION.to_owned(),
            extensions: vec![EXTENSION.to_owned()],
            editable: true,
            creatable: true,
            live_preview: true,
            autosave: true,
            lossy: false,
            syntax_mode: None,
            template: String::new(),
        }
    }

    // Without the image folder a package can be neither opened nor saved
    // without losing its pictures, so these refuse rather than guess.
    fn decode(&self, _bytes: &[u8]) -> anyhow::Result<encoding::Decoded> {
        bail!("a Markdown package needs the image folder to be opened")
    }

    fn encode(&self, _text: &str, _src: &encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        bail!("a Markdown package needs the image folder to be saved")
    }

    fn decode_in(&self, bytes: &[u8], context: &FormatContext<'_>) -> anyhow::Result<encoding::Decoded> {
        unpack(bytes, context.doc_path, context.images)
    }

    fn encode_in(
        &self,
        text: &str,
        src: &encoding::Decoded,
        context: &FormatContext<'_>,
    ) -> anyhow::Result<Vec<u8>> {
        pack(text, src.line_ending, context)
    }
}

/// Reads the archive: copies its images into the package's folder and returns
/// the text as it is, with its short `images/` links.
fn unpack(bytes: &[u8], doc_path: Option<&Path>, images: &dyn ImageStore) -> anyhow::Result<encoding::Decoded> {
    // A file made empty outside the program opens as an empty document
    // rather than as a broken archive.
    if bytes.is_empty() {
        return Ok(encoding::decode(bytes));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).context("the file is not a Markdown package")?;

    let markdown_name = (0..archive.len())
        .filter_map(|index| archive.name_for_index(index).map(str::to_owned))
        .find(|name| !name.contains('/') && name.to_ascii_lowercase().ends_with(".md"))
        .ok_or_else(|| anyhow!("the package has no Markdown document inside"))?;
    let text_bytes = read_limited(&mut archive.by_name(&markdown_name)?, MAX_TEXT_BYTES)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_owned();
        let Some(file_name) = name.strip_prefix(IMAGES_DIR) else {
            continue;
        };
        if file_name.is_empty()
            || file_name.contains('/')
            || file_name.contains('\\')
            || entry.size() > MAX_IMAGE_BYTES
        {
            continue;
        }
        let image = read_limited(&mut entry, MAX_IMAGE_BYTES)?;
        // An entry that is not a supported picture is skipped: its link
        // simply shows nothing, as a missing file would.
        let _ = images.store(doc_path, file_name, &image);
    }

    let mut decoded = encoding::decode(&text_bytes);
    // The archive is always written as UTF-8 without a BOM.
    decoded.encoding = "utf-8".to_owned();
    decoded.bom = false;
    Ok(decoded)
}

/// Writes the archive: the text with its local images packed into `images/`.
fn pack(text: &str, line_ending: encoding::LineEnding, context: &FormatContext<'_>) -> anyhow::Result<Vec<u8>> {
    let is_remote = |src: &str| src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://");
    // Pictures already in the package keep their names, so their links stay
    // as they are; they are reserved before any new picture is numbered.
    let mut used = HashSet::new();
    let _ = rewrite_image_links(text, |src| {
        if let Some(name) = percent_decode(src).strip_prefix(IMAGES_DIR) {
            used.insert(name.to_lowercase());
        }
        None
    });

    let mut packed: Vec<(String, String, Vec<u8>)> = Vec::new();
    let mut named: HashSet<String> = HashSet::new();
    let rewritten = rewrite_image_links(text, |src| {
        if is_remote(src) {
            return None;
        }
        if let Some((_, name, _)) = packed.iter().find(|(known, _, _)| known == src) {
            return Some(link_to(name));
        }
        // An image that cannot be read keeps its link: the text is never
        // changed into something that points nowhere.
        let (original, bytes) = context.images.load(src)?;
        let decoded = percent_decode(src);
        let name = match decoded.strip_prefix(IMAGES_DIR) {
            Some(own) if named.insert(own.to_lowercase()) => own.to_owned(),
            _ => next_number(&original, &mut used, |name| context.images.taken(context.doc_path, name)),
        };
        named.insert(name.to_lowercase());
        let link = link_to(&name);
        packed.push((src.to_owned(), name, bytes));
        Some(link)
    });

    let markdown_name = context
        .doc_path
        .and_then(Path::file_stem)
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map_or_else(|| "document.md".to_owned(), |stem| format!("{stem}.md"));

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    writer.start_file(markdown_name, deflated)?;
    writer.write_all(&encoding::encode(&rewritten, "utf-8", false, line_ending))?;
    for (_, name, bytes) in &packed {
        // Pictures are already compressed; storing them saves the work.
        writer.start_file(format!("{IMAGES_DIR}{name}"), stored)?;
        writer.write_all(bytes)?;
    }
    Ok(writer.finish()?.into_inner())
}

/// A Markdown link to a packed image. Spaces, brackets and non-ASCII letters
/// are percent-encoded so the link stays valid Markdown in every editor.
fn link_to(file_name: &str) -> String {
    let mut link = String::from(IMAGES_DIR);
    for byte in file_name.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~') {
            link.push(byte as char);
        } else {
            link.push_str(&format!("%{byte:02X}"));
        }
    }
    link
}

fn read_limited(reader: &mut impl Read, limit: u64) -> anyhow::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        bail!("an entry of the package is too large");
    }
    Ok(bytes)
}

/// The next `image-<n>` number free in this archive under any extension, and
/// free in the package's folder (compared case-insensitively, as Windows would).
fn next_number(original: &str, used: &mut HashSet<String>, taken: impl Fn(&str) -> bool) -> String {
    let extension = Path::new(original)
        .extension()
        .and_then(|value| value.to_str())
        .map_or_else(|| "png".to_owned(), str::to_ascii_lowercase);
    for number in 1u32.. {
        let candidate = format!("image-{number}.{extension}");
        let stem = format!("image-{number}.");
        if !used.iter().any(|name| name.starts_with(&stem)) && !taken(&candidate) {
            used.insert(candidate.clone());
            return candidate;
        }
    }
    unreachable!("the image counter is unbounded")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap};

    const PNG: [u8; 4] = [0x89, b'P', b'N', b'G'];

    /// The image folder in memory: `marknote-images/<name>` is the shared
    /// folder, `images/<name>` the folder of the package being worked on.
    #[derive(Default)]
    struct Folder {
        shared: RefCell<BTreeMap<String, Vec<u8>>>,
        package: RefCell<BTreeMap<String, Vec<u8>>>,
    }

    impl Folder {
        fn with(files: &[(&str, &[u8])]) -> Self {
            let folder = Self::default();
            for (name, bytes) in files {
                folder.shared.borrow_mut().insert((*name).to_owned(), bytes.to_vec());
            }
            folder
        }

        fn get(&self, name: &str) -> Option<Vec<u8>> {
            self.package.borrow().get(name).cloned()
        }
    }

    impl ImageStore for Folder {
        fn load(&self, src: &str) -> Option<(String, Vec<u8>)> {
            let decoded = percent_decode(src);
            let (map, name) = match decoded.strip_prefix("marknote-images/") {
                Some(name) => (&self.shared, name),
                None => (&self.package, decoded.strip_prefix("images/")?),
            };
            map.borrow().get(name).map(|bytes| (name.to_owned(), bytes.clone()))
        }

        fn store(&self, _package: Option<&Path>, file_name: &str, bytes: &[u8]) -> anyhow::Result<()> {
            if !file_name.ends_with(".png") {
                bail!("unsupported");
            }
            self.package.borrow_mut().insert(file_name.to_owned(), bytes.to_vec());
            Ok(())
        }

        fn taken(&self, _package: Option<&Path>, file_name: &str) -> bool {
            self.package.borrow().contains_key(file_name)
        }
    }

    fn lf() -> encoding::Decoded {
        encoding::decode(b"")
    }

    fn entries(bytes: &[u8]) -> Vec<String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("zip");
        (0..archive.len())
            .map(|index| archive.by_index(index).expect("entry").name().to_owned())
            .collect()
    }

    fn entry_text(bytes: &[u8], name: &str) -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let mut text = String::new();
        archive.by_name(name).expect("entry").read_to_string(&mut text).expect("read");
        text
    }

    #[test]
    fn mdz_is_registered_and_markdown_keeps_md() {
        assert_eq!(crate::formats::for_extension("mdz").id, ID);
        assert_eq!(crate::formats::for_extension("md").id, "markdown");
        assert!(crate::formats::by_id(ID).expect("registered").live_preview);
    }

    #[test]
    fn plain_decode_and_encode_refuse_instead_of_losing_images() {
        assert!(PackageAdapter.decode(b"").is_err());
        assert!(PackageAdapter.encode("x", &lf()).is_err());
    }

    #[test]
    fn pictures_from_elsewhere_are_numbered_and_package_pictures_keep_their_names() {
        let folder = Folder::with(&[("shot.png", &PNG), ("café 1.gif", &[1, 2])]);
        folder.package.borrow_mut().insert("image-1.png".to_owned(), vec![7]);
        folder.package.borrow_mut().insert("café.png".to_owned(), vec![8]);
        let doc = Path::new("C:/notes/Note.mdz");
        let text = "# T

![a|400](marknote-images/shot.png)

![b](marknote-images/shot.png)

![c](marknote-images/caf%C3%A9%201.gif)

![d](images/image-1.png)

![e](images/caf%C3%A9.png)

![web](https://e/f.png)

![gone](marknote-images/missing.png)
";

        let bytes = PackageAdapter
            .encode_in(text, &lf(), &FormatContext { doc_path: Some(doc), images: &folder })
            .expect("pack");

        assert_eq!(
            entries(&bytes),
            ["Note.md", "images/image-2.png", "images/image-3.gif", "images/image-1.png", "images/café.png"]
        );
        let markdown = entry_text(&bytes, "Note.md");
        assert!(markdown.contains("![a|400](images/image-2.png)"));
        assert!(markdown.contains("![b](images/image-2.png)"));
        assert!(markdown.contains("![c](images/image-3.gif)"));
        assert!(markdown.contains("![d](images/image-1.png)"));
        assert!(markdown.contains("![e](images/caf%C3%A9.png)"));
        assert!(markdown.contains("![web](https://e/f.png)"));
        assert!(markdown.contains("![gone](marknote-images/missing.png)"));
    }

    #[test]
    fn a_saved_package_opens_on_another_computer_with_short_links() {
        let here = Folder::with(&[("shot.png", &PNG)]);
        let text = "![a|400](marknote-images/shot.png)
";
        let bytes = PackageAdapter
            .encode_in(text, &lf(), &FormatContext { doc_path: None, images: &here })
            .expect("pack");
        assert_eq!(entries(&bytes)[0], "document.md");

        let there = Folder::default();
        let opened = PackageAdapter
            .decode_in(&bytes, &FormatContext { doc_path: None, images: &there })
            .expect("unpack");
        assert_eq!(opened.text, "![a|400](images/image-1.png)
");
        assert_eq!(there.get("image-1.png"), Some(PNG.to_vec()));

        // Saved again, nothing is renamed.
        let again = PackageAdapter
            .encode_in(&opened.text, &lf(), &FormatContext { doc_path: None, images: &there })
            .expect("pack again");
        assert_eq!(entries(&again), ["document.md", "images/image-1.png"]);
        assert_eq!(entry_text(&again, "document.md"), opened.text);
    }

    #[test]
    fn a_crlf_document_keeps_its_line_endings() {
        let folder = Folder::default();
        let crlf = encoding::decode(b"a\r\nb\r\n");
        let bytes = PackageAdapter
            .encode_in("a\nb\n", &crlf, &FormatContext { doc_path: None, images: &folder })
            .expect("pack");
        assert_eq!(entry_text(&bytes, "document.md"), "a\r\nb\r\n");
        let opened = PackageAdapter
            .decode_in(&bytes, &FormatContext { doc_path: None, images: &folder })
            .expect("unpack");
        assert_eq!(opened.text, "a\nb\n");
        assert_eq!(opened.line_ending, encoding::LineEnding::Crlf);
    }

    #[test]
    fn hostile_entries_are_ignored() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer.start_file("doc.md", options).expect("md");
        writer
            .write_all(b"![x](images/evil.exe)\n![y](images/../up.png)\n![z](images/a/b.png)\n")
            .expect("text");
        writer.start_file("images/evil.exe", options).expect("exe");
        writer.write_all(b"MZ").expect("exe body");
        writer.start_file("images/../up.png", options).expect("traversal");
        writer.write_all(&PNG).expect("png body");
        writer.start_file("images/a/b.png", options).expect("nested");
        writer.write_all(&PNG).expect("png body");
        let bytes = writer.finish().expect("finish").into_inner();

        let folder = Folder::default();
        let opened = PackageAdapter
            .decode_in(&bytes, &FormatContext { doc_path: None, images: &folder })
            .expect("unpack");
        assert_eq!(
            opened.text,
            "![x](images/evil.exe)\n![y](images/../up.png)\n![z](images/a/b.png)\n"
        );
        assert!(folder.package.borrow().is_empty());
    }

    #[test]
    fn a_file_that_is_not_a_package_is_reported_and_an_empty_one_opens_empty() {
        let folder = Folder::default();
        let context = FormatContext { doc_path: None, images: &folder };
        assert!(PackageAdapter.decode_in(b"# just text", &context).is_err());
        assert_eq!(PackageAdapter.decode_in(b"", &context).expect("empty").text, "");
    }
}
