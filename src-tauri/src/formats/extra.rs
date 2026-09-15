use super::code;
use super::docx;
use super::json;
use super::pdf;
use super::rtf;
use super::FormatAdapter;

/// Возвращает все дополнительные адаптеры форматов вехи M6 (JSON и класс «Код и данные»)
/// в порядке их отображения на стартовом экране.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    let mut list: Vec<Box<dyn FormatAdapter>> = Vec::new();
    list.push(Box::new(json::JsonAdapter));
    list.extend(code::code_adapters());
    // Классы D и E из docs/FORMATS.md идут последними: RTF сохраняется с
    // потерями, PDF и DOCX открываются только на чтение.
    list.extend(rtf::adapters());
    list.extend(pdf::adapters());
    list.extend(docx::adapters());
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
        // 1 (JSON) + 14 (код и данные) + 3 (RTF, PDF, DOCX) = 18 адаптеров
        assert_eq!(all.len(), 18);

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
        // Классы D и E идут последними: сначала всё, что редактируется без
        // потерь, затем конвертируемый RTF и форматы только для чтения.
        assert_eq!(ids[15], "rtf");
        assert_eq!(ids[16], "pdf");
        assert_eq!(ids[17], "docx");
    }

    #[test]
    fn test_all_adapters_have_valid_capabilities() {
        for adapter in adapters() {
            let caps = adapter.caps();
            assert!(!caps.id.is_empty());
            assert!(!caps.label.is_empty());
            assert!(!caps.default_extension.is_empty());
            assert!(!caps.extensions.is_empty());

            // Требования зависят от класса формата (docs/FORMATS.md).
            match caps.id.as_str() {
                // Класс E: только чтение. Сохранять нельзя, создавать нечего,
                // автосохранение бессмысленно, содержимое приходит с потерями.
                "pdf" | "docx" => {
                    assert!(!caps.editable, "{} обязан быть только для чтения", caps.id);
                    assert!(!caps.creatable);
                    assert!(!caps.autosave);
                    assert!(caps.lossy);
                }
                // Класс D: правится, но сохраняется с потерями оформления,
                // поэтому автосохранение выключено — ROADMAP числит это риском.
                "rtf" => {
                    assert!(caps.editable);
                    assert!(!caps.creatable);
                    assert!(!caps.autosave, "автосохранение RTF обязано быть выключено");
                    assert!(caps.lossy);
                }
                // Классы B и C: правятся и сохраняются байт в байт.
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

        // 2 встроенных (markdown, plain) + 18 из extra = 20 форматов
        assert_eq!(all.len(), 20);
        // PDF, DOCX и RTF с нуля не создаются: их нет на стартовом экране.
        assert_eq!(creatable.len(), 17);

        // Первым должен идти markdown, вторым plain, третьим json
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
                    "Обнаружен конфликт: расширение '{}' дублируется в формате '{}'",
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
                "Расширение '{}' должно принадлежать формату markdown",
                ext
            );
        }

        for ext in reserved_plain {
            let caps = crate::formats::for_extension(ext);
            assert_eq!(
                caps.id, "plain",
                "Расширение '{}' должно принадлежать формату plain",
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
                "Расширение '{}' должно разрешаться в '{}'",
                ext,
                expected_id
            );
            let path_str = format!("test/file.{}", ext);
            assert_eq!(
                crate::formats::for_path(Path::new(&path_str)).id,
                expected_id,
                "Путь '{}' должен разрешаться в '{}'",
                path_str,
                expected_id
            );
        }
    }
}
