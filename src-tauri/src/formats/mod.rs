use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCapabilities {
    pub id: String,
    pub label: String,
    pub default_extension: String,
    pub extensions: Vec<String>,
    pub editable: bool,
    pub creatable: bool,
    pub live_preview: bool,
    pub autosave: bool,
    pub lossy: bool,
    pub syntax_mode: Option<String>,
    pub template: String,
}

/// The shared image folder, as seen by a format that carries its own images.
/// Implemented outside this module, so the format code needs no file system
/// policy of its own (and stays testable without the application).
pub trait ImageStore {
    /// Reads the image a link in the document points to: its file name and bytes.
    fn load(&self, src: &str) -> Option<(String, Vec<u8>)>;
    /// Keeps a picture of the package at `package` under its archive name.
    fn store(&self, package: Option<&Path>, file_name: &str, bytes: &[u8]) -> anyhow::Result<()>;
    /// Whether that package already keeps a picture under this name, with any extension.
    fn taken(&self, package: Option<&Path>, file_name: &str) -> bool;
}

/// What an adapter may need besides the bytes: where the document lives and
/// the image folder. Only container formats look at it.
pub struct FormatContext<'a> {
    pub doc_path: Option<&'a Path>,
    pub images: &'a dyn ImageStore,
}

pub trait FormatAdapter: Send + Sync {
    fn caps(&self) -> FormatCapabilities;
    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded>;
    fn encode(&self, text: &str, src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>>;

    /// Opening a file: the commands always call this one.
    fn decode_in(&self, bytes: &[u8], _context: &FormatContext<'_>) -> anyhow::Result<crate::encoding::Decoded> {
        self.decode(bytes)
    }

    /// Saving a file: the commands always call this one.
    fn encode_in(
        &self,
        text: &str,
        src: &crate::encoding::Decoded,
        _context: &FormatContext<'_>,
    ) -> anyhow::Result<Vec<u8>> {
        self.encode(text, src)
    }
}

pub mod code;
pub mod docx;
pub mod epub;
pub mod extra;
pub mod image_links;
pub mod json;
pub mod markdown;
pub mod package;
pub mod pdf;
pub mod plain;
pub mod rtf;

fn adapters() -> &'static [Box<dyn FormatAdapter>] {
    static ADAPTERS: OnceLock<Vec<Box<dyn FormatAdapter>>> = OnceLock::new();
    ADAPTERS
        .get_or_init(|| {
            // Order matters: it also determines start-screen tiles and File / New
            // menu items. The native format comes first, plain text second, and
            // the rest come from the milestone M6 registry.
            let mut list: Vec<Box<dyn FormatAdapter>> = vec![
                Box::new(markdown::MarkdownAdapter),
                Box::new(plain::PlainAdapter),
            ];
            list.extend(extra::adapters());
            // Markdown with its images packed into one file comes last, so
            // the long-standing order of the other tiles does not move.
            list.push(Box::new(package::PackageAdapter));
            list
        })
        .as_slice()
}

/// Returns an adapter by format identifier.
pub fn adapter_by_id(id: &str) -> Option<&'static dyn FormatAdapter> {
    adapters()
        .iter()
        .find(|adapter| adapter.caps().id == id)
        .map(|adapter| adapter.as_ref())
}

/// Returns an adapter by extension; an unknown extension is treated as plain.
pub fn adapter_for_extension(ext: &str) -> &'static dyn FormatAdapter {
    let normalized = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    adapters()
        .iter()
        .find(|adapter| {
            adapter
                .caps()
                .extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&normalized))
        })
        .map(|adapter| adapter.as_ref())
        .unwrap_or_else(|| {
            adapters()
                .iter()
                .find(|adapter| adapter.caps().id == "plain")
                .expect("format registry must contain the plain text adapter")
                .as_ref()
        })
}

/// Returns an adapter by path; a missing extension also means plain.
pub fn adapter_for_path(path: &Path) -> &'static dyn FormatAdapter {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map_or_else(|| adapter_for_extension(""), adapter_for_extension)
}

pub fn all() -> Vec<FormatCapabilities> {
    adapters().iter().map(|adapter| adapter.caps()).collect()
}

pub fn creatable() -> Vec<FormatCapabilities> {
    all().into_iter().filter(|caps| caps.creatable).collect()
}

pub fn by_id(id: &str) -> Option<FormatCapabilities> {
    adapter_by_id(id).map(FormatAdapter::caps)
}

pub fn for_extension(ext: &str) -> FormatCapabilities {
    adapter_for_extension(ext).caps()
}

pub fn for_path(path: &Path) -> FormatCapabilities {
    adapter_for_path(path).caps()
}
