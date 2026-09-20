use super::code;
use super::docx;
use super::epub;
use super::json;
use super::pdf;
use super::rtf;
use super::FormatAdapter;

/// Returns all additional format adapters from milestone M6 (JSON and “Code and data”)
/// in the order shown on the start screen.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    let mut list: Vec<Box<dyn FormatAdapter>> = Vec::new();
    list.push(Box::new(json::JsonAdapter));
    list.extend(code::code_adapters());
    // Classes D and E from docs/FORMATS.md come last: RTF is saved with
    // formatting loss, while PDF, DOCX, and EPUB are read-only.
    list.extend(rtf::adapters());
    list.extend(pdf::adapters());
    list.extend(docx::adapters());
    list.extend(epub::adapters());
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn test_adapters_order_and_count() {
        let all = adapters();
        // 1 (JSON) + 14 (code and data) + 4 (RTF, PDF, DOCX, EPUB) = 19 adapters.
        assert_eq!(all.len(), 19);

        let ids: Vec<String> = all.iter().map(|a| a.caps().id).collect();
        assert_eq!(ids[0], "json");
        assert_eq!(ids[1], "yaml");
        assert_eq!(ids[2], "toml");
        assert_eq!(ids[3], "html");
        assert_eq!(ids[4], "xml");
        assert_eq!(ids[5], "css");
        assert_eq!(ids[6], "javascript");
        assert_eq!(ids[7], "typescript");
        assert_eq!(ids[8], "python");
        assert_eq!(ids[9], "rust");
        assert_eq!(ids[10], "go");
        assert_eq!(ids[11], "c");
        assert_eq!(ids[12], "cpp");
        assert_eq!(ids[13], "shell");
        assert_eq!(ids[14], "jsonc");
        // Classes D and E come last: first everything editable without loss,
        // then convertible RTF and read-only formats.
        assert_eq!(ids[15], "rtf");
        assert_eq!(ids[16], "pdf");
        assert_eq!(ids[17], "docx");
        assert_eq!(ids[18], "epub");
    }

    #[test]
    fn test_all_adapters_have_valid_capabilities() {
        for adapter in adapters() {
            let caps = adapter.caps();
            assert!(!caps.id.is_empty());
            assert!(!caps.label.is_empty());
            assert!(!caps.default_extension.is_empty());
            assert!(!caps.extensions.is_empty());

            // Requirements depend on the format class (docs/FORMATS.md).
            match caps.id.as_str() {
                // Class E: read-only. It cannot be saved or created, and
                // autosave is meaningless because content arrives lossy.
                "pdf" | "docx" | "epub" => {
                    assert!(!caps.editable, "{} must be read-only", caps.id);
                    assert!(!caps.creatable);
                    assert!(!caps.autosave);
                    assert!(caps.lossy);
                }
                // Class D: editable but saved with formatting loss, so autosave
                // is disabled; the ROADMAP lists this as a risk.
                "rtf" => {
                    assert!(caps.editable);
                    assert!(!caps.creatable);
                    assert!(!caps.autosave, "RTF autosave must be disabled");
                    assert!(caps.lossy);
                }
                // Classes B and C are editable and preserved byte-for-byte.
                _ => {
                    assert!(caps.editable);
                    assert!(caps.creatable);
                    assert!(!caps.live_preview);
                    assert!(caps.autosave);
                    assert!(!caps.lossy);
                    assert!(caps.syntax_mode.is_some());
                }
            }
        }
    }

    #[test]
    fn test_registry_integration_all_and_creatable() {
        let all = crate::formats::all();
        let creatable = crate::formats::creatable();

        // 2 built-in (markdown, plain) + 19 extra = 21 formats.
        assert_eq!(all.len(), 21);
        // PDF, DOCX, and RTF are not created from scratch: they are absent from the start screen.
        assert_eq!(creatable.len(), 17);

        // Markdown must be first, plain second, and JSON third.
        assert_eq!(all[0].id, "markdown");
        assert_eq!(all[1].id, "plain");
        assert_eq!(all[2].id, "json");
    }

    #[test]
    fn test_no_duplicate_extensions_in_registry() {
        let all = crate::formats::all();
        let mut seen = HashSet::new();

        for format in all {
            for ext in format.extensions {
                let normalized = ext.to_ascii_lowercase();
                assert!(
                    seen.insert(normalized.clone()),
                    "Conflict: extension '{}' is duplicated in format '{}'",
                    normalized,
                    format.id
                );
            }
        }
    }

    #[test]
    fn test_no_extra_format_intercepts_markdown_or_plain() {
        let reserved_markdown = ["md", "markdown", "mdown", "mkd", "mdx"];
        let reserved_plain = [
            "txt", "log", "ini", "cfg", "conf", "env", "csv", "tsv", "text",
        ];

        for ext in reserved_markdown {
            let caps = crate::formats::for_extension(ext);
            assert_eq!(
                caps.id, "markdown",
                "Extension '{}' must belong to the markdown format",
                ext
            );
        }

        for ext in reserved_plain {
            let caps = crate::formats::for_extension(ext);
            assert_eq!(
                caps.id, "plain",
                "Extension '{}' must belong to the plain format",
                ext
            );
        }
    }

    #[test]
    fn test_unknown_extension_falls_back_to_plain() {
        assert_eq!(crate::formats::for_extension("unknown_xyz").id, "plain");
        assert_eq!(crate::formats::for_extension("foo_bar_123").id, "plain");
        assert_eq!(crate::formats::for_extension("").id, "plain");

        assert_eq!(crate::formats::for_path(Path::new("Makefile")).id, "plain");
        assert_eq!(
            crate::formats::for_path(Path::new("config.unknown")).id,
            "plain"
        );
    }

    #[test]
    fn test_known_extra_extensions_resolve_via_registry() {
        let samples = [
            ("json", "json"),
            ("yaml", "yaml"),
            ("yml", "yaml"),
            ("toml", "toml"),
            ("html", "html"),
            ("htm", "html"),
            ("xml", "xml"),
            ("css", "css"),
            ("js", "javascript"),
            ("ts", "typescript"),
            ("py", "python"),
            ("rs", "rust"),
            ("go", "go"),
            ("c", "c"),
            ("cpp", "cpp"),
            ("sh", "shell"),
            ("jsonc", "jsonc"),
        ];

        for (ext, expected_id) in samples {
            assert_eq!(
                crate::formats::for_extension(ext).id,
                expected_id,
                "Extension '{}' must resolve to '{}'",
                ext,
                expected_id
            );
            let path_str = format!("test/file.{}", ext);
            assert_eq!(
                crate::formats::for_path(Path::new(&path_str)).id,
                expected_id,
                "Path '{}' must resolve to '{}'",
                path_str,
                expected_id
            );
        }
    }
}
