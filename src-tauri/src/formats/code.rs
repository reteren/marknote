use super::{FormatAdapter, FormatCapabilities};

const HTML_TEMPLATE: &str = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <title>Document</title>\n</head>\n<body>\n\n</body>\n</html>\n";

/// Universal adapter for “Code and data” formats.
/// Preserves files byte-for-byte without changing their markup.
#[derive(Debug, Clone)]
pub struct CodeAdapter {
    caps: FormatCapabilities,
}

impl CodeAdapter {
    pub fn new(caps: FormatCapabilities) -> Self {
        Self { caps }
    }

    pub fn yaml() -> Self {
        Self::new(FormatCapabilities {
            id: "yaml".to_owned(),
            label: "YAML".to_owned(),
            default_extension: "yaml".to_owned(),
            extensions: vec!["yaml".to_owned(), "yml".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("yaml".to_owned()),
            template: String::new(),
        })
    }

    pub fn toml() -> Self {
        Self::new(FormatCapabilities {
            id: "toml".to_owned(),
            label: "TOML".to_owned(),
            default_extension: "toml".to_owned(),
            extensions: vec!["toml".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("toml".to_owned()),
            template: String::new(),
        })
    }

    pub fn html() -> Self {
        Self::new(FormatCapabilities {
            id: "html".to_owned(),
            label: "HTML".to_owned(),
            default_extension: "html".to_owned(),
            extensions: vec!["html".to_owned(), "htm".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("html".to_owned()),
            template: HTML_TEMPLATE.to_owned(),
        })
    }

    pub fn xml() -> Self {
        Self::new(FormatCapabilities {
            id: "xml".to_owned(),
            label: "XML".to_owned(),
            default_extension: "xml".to_owned(),
            extensions: vec!["xml".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("xml".to_owned()),
            template: String::new(),
        })
    }

    pub fn css() -> Self {
        Self::new(FormatCapabilities {
            id: "css".to_owned(),
            label: "CSS".to_owned(),
            default_extension: "css".to_owned(),
            extensions: vec!["css".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("css".to_owned()),
            template: String::new(),
        })
    }

    pub fn javascript() -> Self {
        Self::new(FormatCapabilities {
            id: "javascript".to_owned(),
            label: "JavaScript".to_owned(),
            default_extension: "js".to_owned(),
            extensions: vec!["js".to_owned(), "mjs".to_owned(), "cjs".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("javascript".to_owned()),
            template: String::new(),
        })
    }

    pub fn typescript() -> Self {
        Self::new(FormatCapabilities {
            id: "typescript".to_owned(),
            label: "TypeScript".to_owned(),
            default_extension: "ts".to_owned(),
            extensions: vec!["ts".to_owned(), "mts".to_owned(), "cts".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("typescript".to_owned()),
            template: String::new(),
        })
    }

    pub fn python() -> Self {
        Self::new(FormatCapabilities {
            id: "python".to_owned(),
            label: "Python".to_owned(),
            default_extension: "py".to_owned(),
            extensions: vec!["py".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("python".to_owned()),
            template: String::new(),
        })
    }

    pub fn rust() -> Self {
        Self::new(FormatCapabilities {
            id: "rust".to_owned(),
            label: "Rust".to_owned(),
            default_extension: "rs".to_owned(),
            extensions: vec!["rs".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("rust".to_owned()),
            template: String::new(),
        })
    }

    pub fn go() -> Self {
        Self::new(FormatCapabilities {
            id: "go".to_owned(),
            label: "Go".to_owned(),
            default_extension: "go".to_owned(),
            extensions: vec!["go".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("go".to_owned()),
            template: String::new(),
        })
    }

    pub fn c() -> Self {
        Self::new(FormatCapabilities {
            id: "c".to_owned(),
            label: "C".to_owned(),
            default_extension: "c".to_owned(),
            extensions: vec!["c".to_owned(), "h".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("c".to_owned()),
            template: String::new(),
        })
    }

    pub fn cpp() -> Self {
        Self::new(FormatCapabilities {
            id: "cpp".to_owned(),
            label: "C++".to_owned(),
            default_extension: "cpp".to_owned(),
            extensions: vec![
                "cpp".to_owned(),
                "cc".to_owned(),
                "cxx".to_owned(),
                "hpp".to_owned(),
                "hh".to_owned(),
                "hxx".to_owned(),
            ],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("cpp".to_owned()),
            template: String::new(),
        })
    }

    pub fn shell() -> Self {
        Self::new(FormatCapabilities {
            id: "shell".to_owned(),
            label: "Shell".to_owned(),
            default_extension: "sh".to_owned(),
            extensions: vec!["sh".to_owned(), "bash".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("shell".to_owned()),
            template: String::new(),
        })
    }

    pub fn jsonc() -> Self {
        Self::new(FormatCapabilities {
            id: "jsonc".to_owned(),
            label: "JSON with Comments".to_owned(),
            default_extension: "jsonc".to_owned(),
            extensions: vec!["jsonc".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("json".to_owned()),
            template: String::new(),
        })
    }
}

impl FormatAdapter for CodeAdapter {
    fn caps(&self) -> FormatCapabilities {
        self.caps.clone()
    }

    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
        Ok(crate::encoding::decode(bytes))
    }

    fn encode(&self, text: &str, src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Ok(crate::encoding::encode(
            text,
            &src.encoding,
            src.bom,
            src.line_ending,
        ))
    }
}

/// Returns all “Code and data” adapters in start-screen order.
pub fn code_adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![
        Box::new(CodeAdapter::yaml()),
        Box::new(CodeAdapter::toml()),
        Box::new(CodeAdapter::html()),
        Box::new(CodeAdapter::xml()),
        Box::new(CodeAdapter::css()),
        Box::new(CodeAdapter::javascript()),
        Box::new(CodeAdapter::typescript()),
        Box::new(CodeAdapter::python()),
        Box::new(CodeAdapter::rust()),
        Box::new(CodeAdapter::go()),
        Box::new(CodeAdapter::c()),
        Box::new(CodeAdapter::cpp()),
        Box::new(CodeAdapter::shell()),
        Box::new(CodeAdapter::jsonc()),
    ]
}

/// Finds a code adapter by extension, case-insensitively.
#[allow(dead_code)]
pub fn find_code_adapter(ext: &str) -> Option<CodeAdapter> {
    let normalized = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    let adapters = [
        CodeAdapter::yaml(),
        CodeAdapter::toml(),
        CodeAdapter::html(),
        CodeAdapter::xml(),
        CodeAdapter::css(),
        CodeAdapter::javascript(),
        CodeAdapter::typescript(),
        CodeAdapter::python(),
        CodeAdapter::rust(),
        CodeAdapter::go(),
        CodeAdapter::c(),
        CodeAdapter::cpp(),
        CodeAdapter::shell(),
        CodeAdapter::jsonc(),
    ];

    adapters.into_iter().find(|adapter| {
        adapter
            .caps
            .extensions
            .iter()
            .any(|cand| cand.eq_ignore_ascii_case(&normalized))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_lookup_case_insensitive() {
        let cases = [
            ("yaml", "yaml"),
            ("YAML", "yaml"),
            ("yml", "yaml"),
            ("toml", "toml"),
            ("TOML", "toml"),
            ("html", "html"),
            ("HTML", "html"),
            ("htm", "html"),
            ("xml", "xml"),
            ("css", "css"),
            ("js", "javascript"),
            ("mjs", "javascript"),
            ("cjs", "javascript"),
            ("ts", "typescript"),
            ("mts", "typescript"),
            ("cts", "typescript"),
            ("py", "python"),
            ("PY", "python"),
            ("rs", "rust"),
            ("RS", "rust"),
            ("go", "go"),
            ("GO", "go"),
            ("c", "c"),
            ("h", "c"),
            ("cpp", "cpp"),
            ("CPP", "cpp"),
            ("hpp", "cpp"),
            ("cc", "cpp"),
            ("sh", "shell"),
            ("bash", "shell"),
            ("jsonc", "jsonc"),
        ];

        for (ext, expected_id) in cases {
            let found = find_code_adapter(ext);
            assert!(
                found.is_some(),
                "A format for extension '{}' must be found",
                ext
            );
            assert_eq!(
                found.unwrap().caps().id,
                expected_id,
                "Extension '{}' was expected to resolve to id '{}'",
                ext,
                expected_id
            );
        }
    }

    #[test]
    fn test_html_template() {
        let adapter = CodeAdapter::html();
        let caps = adapter.caps();
        assert!(caps.template.contains("<!DOCTYPE html>"));
        assert!(caps.template.contains("<html"));
        assert!(caps.template.contains("<head>"));
        assert!(caps.template.contains("<body>"));
    }

    #[test]
    fn test_empty_templates_for_other_code_formats() {
        let non_html = [
            CodeAdapter::yaml(),
            CodeAdapter::toml(),
            CodeAdapter::xml(),
            CodeAdapter::css(),
            CodeAdapter::javascript(),
            CodeAdapter::typescript(),
            CodeAdapter::python(),
            CodeAdapter::rust(),
            CodeAdapter::go(),
            CodeAdapter::c(),
            CodeAdapter::cpp(),
            CodeAdapter::shell(),
            CodeAdapter::jsonc(),
        ];
        for adapter in non_html {
            assert!(
                adapter.caps().template.is_empty(),
                "The template for format {} must be empty",
                adapter.caps().id
            );
        }
    }

    #[test]
    fn test_code_adapter_capabilities_flags() {
        for adapter in code_adapters() {
            let caps = adapter.caps();
            assert!(caps.editable, "{}: editable must be true", caps.id);
            assert!(caps.creatable, "{}: creatable must be true", caps.id);
            assert!(
                !caps.live_preview,
                "{}: live_preview must be false",
                caps.id
            );
            assert!(caps.autosave, "{}: autosave must be true", caps.id);
            assert!(!caps.lossy, "{}: lossy must be false", caps.id);
            assert!(
                caps.syntax_mode.is_some(),
                "{}: syntax_mode must be set",
                caps.id
            );
        }
    }

    #[test]
    fn test_decode_encode_roundtrip_bytes() {
        let adapter = CodeAdapter::rust();
        let raw_bytes = b"fn main() {\r\n    println!(\"\xd0\x9f\xd1\x80\xd0\xb8\xd0\xb2\xd0\xb5\xd1\x82\");\r\n}\r\n";
        let decoded = adapter.decode(raw_bytes).expect("decoding must succeed");
        assert_eq!(decoded.line_ending, crate::encoding::LineEnding::Crlf);

        let encoded = adapter
            .encode(&decoded.text, &decoded)
            .expect("encoding must succeed");
        assert_eq!(
            encoded, raw_bytes,
            "Bytes must remain identical after a round trip"
        );
    }
}
