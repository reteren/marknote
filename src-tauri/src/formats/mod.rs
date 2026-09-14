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

pub trait FormatAdapter: Send + Sync {
    fn caps(&self) -> FormatCapabilities;
    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded>;
    fn encode(&self, text: &str, src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>>;
}

pub mod markdown;
pub mod plain;

fn adapters() -> &'static [Box<dyn FormatAdapter>] {
    static ADAPTERS: OnceLock<Vec<Box<dyn FormatAdapter>>> = OnceLock::new();
    ADAPTERS
        .get_or_init(|| {
            vec![
                Box::new(markdown::MarkdownAdapter),
                Box::new(plain::PlainAdapter),
            ]
        })
        .as_slice()
}

pub fn all() -> Vec<FormatCapabilities> {
    adapters().iter().map(|adapter| adapter.caps()).collect()
}

pub fn creatable() -> Vec<FormatCapabilities> {
    all().into_iter().filter(|caps| caps.creatable).collect()
}

pub fn by_id(id: &str) -> Option<FormatCapabilities> {
    adapters()
        .iter()
        .map(|adapter| adapter.caps())
        .find(|caps| caps.id == id)
}

pub fn for_extension(ext: &str) -> FormatCapabilities {
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
        .map(|adapter| adapter.caps())
        .unwrap_or_else(|| plain::PlainAdapter.caps())
}

pub fn for_path(path: &Path) -> FormatCapabilities {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map_or_else(|| for_extension(""), for_extension)
}
