//! Read-only EPUB adapter. Chapters follow the OPF spine and XHTML is reduced
//! to Markdown without loading the book into a browser.

use super::{FormatAdapter, FormatCapabilities};
use quick_xml::XmlVersion;
use quick_xml::{
    events::{BytesStart, Event},
    Decoder, Reader,
};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
    panic::{catch_unwind, AssertUnwindSafe},
};
use zip::ZipArchive;

const INVALID_EPUB: &str =
    "Could not read this EPUB file. Check that it is a valid EPUB and try again.";

pub struct EpubAdapter;

/// Returns the EPUB adapter for the M6 registry owner.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(EpubAdapter)]
}

impl FormatAdapter for EpubAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "epub".to_owned(),
            label: "EPUB Book".to_owned(),
            default_extension: "epub".to_owned(),
            extensions: vec!["epub".to_owned()],
            editable: false,
            creatable: false,
            live_preview: false,
            autosave: false,
            lossy: true,
            syntax_mode: None,
            template: String::new(),
        }
    }

    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
        match catch_unwind(AssertUnwindSafe(|| decode_epub(bytes))) {
            Ok(result) => result,
            Err(_) => Err(invalid_epub()),
        }
    }

    fn encode(&self, _text: &str, _src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Err(anyhow::anyhow!(
            "EPUB files are read-only. Use Save As to create a Markdown copy."
        ))
    }
}

#[derive(Debug)]
struct ManifestItem {
    href: String,
    media_type: String,
}

#[derive(Debug)]
enum ListKind {
    Unordered,
    Ordered(usize),
}

fn decode_epub(bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid_epub())?;
    let mimetype = read_entry(&mut archive, "mimetype")?;
    if mimetype != b"application/epub+zip" {
        return Err(invalid_epub());
    }

    let container = read_entry(&mut archive, "META-INF/container.xml")?;
    let package_path = parse_container(&container)?;
    let package = read_entry(&mut archive, &package_path)?;
    let (manifest, spine) = parse_package(&package)?;
    if spine.is_empty() {
        return Err(invalid_epub());
    }

    let mut chapters = Vec::new();
    for id in spine {
        let Some(item) = manifest.get(&id) else {
            return Err(invalid_epub());
        };
        if item.media_type != "application/xhtml+xml" && item.media_type != "text/html" {
            continue;
        }

        let chapter_path = resolve_chapter_path(&package_path, &item.href)?;
        let chapter = read_entry(&mut archive, &chapter_path)?;
        let text = xhtml_to_markdown(&chapter)?;
        if !text.trim().is_empty() {
            chapters.push(text);
        }
    }
    if chapters.is_empty() {
        return Err(invalid_epub());
    }

    Ok(crate::encoding::Decoded {
        text: chapters.join("\n\n"),
        encoding: "utf-8".to_owned(),
        bom: false,
        line_ending: crate::encoding::LineEnding::Lf,
    })
}

fn read_entry(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str) -> anyhow::Result<Vec<u8>> {
    let mut entry = archive.by_name(path).map_err(|_| invalid_epub())?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).map_err(|_| invalid_epub())?;
    Ok(bytes)
}

fn parse_container(bytes: &[u8]) -> anyhow::Result<String> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    let mut buffer = Vec::new();

    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| invalid_epub())?;
        match event {
            Event::Start(element) | Event::Empty(element)
                if local_name(element.name().as_ref()) == b"rootfile" =>
            {
                let attributes = read_attributes(&element, reader.decoder())?;
                let Some(path) = attributes.get("full-path") else {
                    return Err(invalid_epub());
                };
                let path = percent_decode_path(path)?;
                return normalize_entry_path(&path);
            }
            Event::Eof => return Err(invalid_epub()),
            _ => {}
        }
        buffer.clear();
    }
}

fn parse_package(bytes: &[u8]) -> anyhow::Result<(HashMap<String, ManifestItem>, Vec<String>)> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    let mut buffer = Vec::new();
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();

    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| invalid_epub())?;
        match event {
            Event::Start(element) => {
                let qualified_name = element.name();
                let name = local_name(qualified_name.as_ref());
                if name == b"manifest" {
                    in_manifest = true;
                } else if name == b"spine" {
                    in_spine = true;
                } else if name == b"item" && in_manifest {
                    let attributes = read_attributes(&element, reader.decoder())?;
                    add_manifest_item(&mut manifest, attributes)?;
                } else if name == b"itemref" && in_spine {
                    let attributes = read_attributes(&element, reader.decoder())?;
                    add_spine_item(&mut spine, attributes)?;
                }
            }
            Event::Empty(element) => {
                let qualified_name = element.name();
                let name = local_name(qualified_name.as_ref());
                if name == b"item" && in_manifest {
                    let attributes = read_attributes(&element, reader.decoder())?;
                    add_manifest_item(&mut manifest, attributes)?;
                } else if name == b"itemref" && in_spine {
                    let attributes = read_attributes(&element, reader.decoder())?;
                    add_spine_item(&mut spine, attributes)?;
                }
            }
            Event::End(element) => match local_name(element.name().as_ref()) {
                b"manifest" => in_manifest = false,
                b"spine" => in_spine = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    if manifest.is_empty() || spine.is_empty() {
        return Err(invalid_epub());
    }
    Ok((manifest, spine))
}

fn read_attributes(
    element: &BytesStart<'_>,
    decoder: Decoder,
) -> anyhow::Result<HashMap<String, String>> {
    let mut values = HashMap::new();
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|_| invalid_epub())?;
        let key_bytes = local_name(attribute.key.as_ref());
        let key = std::str::from_utf8(key_bytes).map_err(|_| invalid_epub())?;
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)
            .map_err(|_| invalid_epub())?;
        values.insert(key.to_owned(), value.into_owned());
    }
    Ok(values)
}

fn add_manifest_item(
    manifest: &mut HashMap<String, ManifestItem>,
    attributes: HashMap<String, String>,
) -> anyhow::Result<()> {
    let (Some(id), Some(href), Some(media_type)) = (
        attributes.get("id"),
        attributes.get("href"),
        attributes.get("media-type"),
    ) else {
        return Err(invalid_epub());
    };
    manifest.insert(
        id.clone(),
        ManifestItem {
            href: href.clone(),
            media_type: media_type.clone(),
        },
    );
    Ok(())
}

fn add_spine_item(
    spine: &mut Vec<String>,
    attributes: HashMap<String, String>,
) -> anyhow::Result<()> {
    let Some(id) = attributes.get("idref") else {
        return Err(invalid_epub());
    };
    spine.push(id.clone());
    Ok(())
}

fn resolve_chapter_path(package_path: &str, href: &str) -> anyhow::Result<String> {
    let href = href.split(['#', '?']).next().ok_or_else(invalid_epub)?;
    let href = percent_decode_path(href)?;
    let parent = package_path
        .rsplit_once('/')
        .map_or("", |(parent, _)| parent);
    let combined = if parent.is_empty() {
        href
    } else {
        format!("{parent}/{href}")
    };
    normalize_entry_path(&combined)
}

fn normalize_entry_path(path: &str) -> anyhow::Result<String> {
    if path.starts_with('/') || path.contains('\\') || path.bytes().any(|byte| byte == 0) {
        return Err(invalid_epub());
    }

    let mut components: Vec<&str> = Vec::new();
    for component in path.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(invalid_epub());
                }
            }
            _ => components.push(component),
        }
    }
    if components.is_empty() {
        return Err(invalid_epub());
    }
    Ok(components.join("/"))
}

fn percent_decode_path(path: &str) -> anyhow::Result<String> {
    let input = path.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;

    while index < input.len() {
        if input[index] == b'%' {
            let high = input
                .get(index + 1)
                .copied()
                .and_then(hex_value)
                .ok_or_else(invalid_epub)?;
            let low = input
                .get(index + 2)
                .copied()
                .and_then(hex_value)
                .ok_or_else(invalid_epub)?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(input[index]);
            index += 1;
        }
    }

    String::from_utf8(output).map_err(|_| invalid_epub())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn local_name(qualified: &[u8]) -> &[u8] {
    qualified
        .iter()
        .rposition(|byte| *byte == b':')
        .map_or(qualified, |index| &qualified[index + 1..])
}

fn xhtml_to_markdown(bytes: &[u8]) -> anyhow::Result<String> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut output = String::new();
    let mut in_head = false;
    let mut in_preformatted = false;
    let mut ignored_depth = 0usize;
    let mut lists = Vec::new();

    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| invalid_epub())?;
        match event {
            Event::Start(element) => {
                let name = tag_name(element.name().as_ref());
                if ignored_depth > 0 {
                    ignored_depth += 1;
                } else if name == "script" || name == "style" {
                    ignored_depth = 1;
                } else if name == "head" {
                    in_head = true;
                } else if !in_head {
                    let attributes = if name == "ol" {
                        read_attributes(&element, reader.decoder())?
                    } else {
                        HashMap::new()
                    };
                    append_start_tag(
                        &name,
                        &attributes,
                        &mut output,
                        &mut lists,
                        &mut in_preformatted,
                    );
                }
            }
            Event::Empty(element) => {
                if !in_head && ignored_depth == 0 {
                    let name = tag_name(element.name().as_ref());
                    let attributes = if name == "ol" {
                        read_attributes(&element, reader.decoder())?
                    } else {
                        HashMap::new()
                    };
                    append_start_tag(
                        &name,
                        &attributes,
                        &mut output,
                        &mut lists,
                        &mut in_preformatted,
                    );
                    append_end_tag(&name, &mut output, &mut lists, &mut in_preformatted);
                }
            }
            Event::End(element) => {
                let name = tag_name(element.name().as_ref());
                if ignored_depth > 0 {
                    ignored_depth -= 1;
                } else if name == "head" {
                    in_head = false;
                } else if !in_head {
                    append_end_tag(&name, &mut output, &mut lists, &mut in_preformatted);
                }
            }
            Event::Text(text) if !in_head && ignored_depth == 0 => {
                let decoded = text
                    .xml_content(XmlVersion::Implicit1_0)
                    .map_err(|_| invalid_epub())?;
                let unescaped =
                    quick_xml::escape::unescape(&decoded).map_err(|_| invalid_epub())?;
                append_text(&mut output, &unescaped);
            }
            Event::CData(text) if !in_head && ignored_depth == 0 => {
                let decoded = text
                    .xml_content(XmlVersion::Implicit1_0)
                    .map_err(|_| invalid_epub())?;
                append_text(&mut output, &decoded);
            }
            Event::GeneralRef(reference) if !in_head && ignored_depth == 0 => {
                let value = if let Some(character) =
                    reference.resolve_char_ref().map_err(|_| invalid_epub())?
                {
                    character.to_string()
                } else {
                    let name = reference.decode().map_err(|_| invalid_epub())?;
                    match named_entity(&name) {
                        Some(value) => value,
                        None => format!("&{name};"),
                    }
                };
                output.push_str(&value);
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    Ok(normalize_markdown(&output))
}

fn tag_name(name: &[u8]) -> String {
    String::from_utf8_lossy(local_name(name)).to_ascii_lowercase()
}

fn append_start_tag(
    name: &str,
    attributes: &HashMap<String, String>,
    output: &mut String,
    lists: &mut Vec<ListKind>,
    in_preformatted: &mut bool,
) {
    match name {
        "p" | "section" | "article" | "div" => ensure_blank_line(output),
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            ensure_blank_line(output);
            let level = match name {
                "h1" => 1,
                "h2" => 2,
                "h3" => 3,
                "h4" => 4,
                "h5" => 5,
                _ => 6,
            };
            for _ in 0..level {
                output.push('#');
            }
            output.push(' ');
        }
        "ul" => {
            ensure_blank_line(output);
            lists.push(ListKind::Unordered);
        }
        "ol" => {
            ensure_blank_line(output);
            let start = attributes
                .get("start")
                .and_then(|value| value.parse::<usize>().ok())
                .filter(|value| *value > 0)
                .map_or(1, |value| value);
            lists.push(ListKind::Ordered(start));
        }
        "li" => {
            ensure_line_break(output);
            for _ in 0..lists.len().saturating_sub(1) {
                output.push_str("  ");
            }
            match lists.last_mut() {
                Some(ListKind::Ordered(next)) => {
                    output.push_str(&format!("{next}. "));
                    *next = next.saturating_add(1);
                }
                Some(ListKind::Unordered) | None => output.push_str("- "),
            }
        }
        "blockquote" => {
            ensure_blank_line(output);
            output.push_str("> ");
        }
        "pre" => {
            ensure_blank_line(output);
            output.push_str("```\n");
            *in_preformatted = true;
        }
        "br" => ensure_line_break(output),
        "hr" => {
            ensure_blank_line(output);
            output.push_str("---\n");
        }
        "strong" | "b" => output.push_str("**"),
        "em" | "i" => output.push('*'),
        "del" | "s" | "strike" => output.push_str("~~"),
        "code" if !*in_preformatted => output.push('`'),
        _ => {}
    }
}

fn append_end_tag(
    name: &str,
    output: &mut String,
    lists: &mut Vec<ListKind>,
    in_preformatted: &mut bool,
) {
    match name {
        "p" | "section" | "article" | "div" | "blockquote" => ensure_blank_line(output),
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => ensure_blank_line(output),
        "ul" | "ol" => {
            lists.pop();
            ensure_blank_line(output);
        }
        "li" => ensure_line_break(output),
        "pre" => {
            ensure_line_break(output);
            output.push_str("```\n");
            *in_preformatted = false;
            ensure_blank_line(output);
        }
        "strong" | "b" => output.push_str("**"),
        "em" | "i" => output.push('*'),
        "del" | "s" | "strike" => output.push_str("~~"),
        "code" if !*in_preformatted => output.push('`'),
        _ => {}
    }
}

fn append_text(output: &mut String, text: &str) {
    // Пробелы между тегами сохраняем, а переносы строк из разметки — нет:
    // в HTML они значения не имеют, а в тексте дали бы рваные абзацы.
    let meaningful = !text.chars().all(char::is_whitespace);
    let inline_spacing = !text.contains(['\n', '\r']);
    if meaningful || inline_spacing {
        output.push_str(text);
    }
}

fn ensure_line_break(output: &mut String) {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

fn ensure_blank_line(output: &mut String) {
    while output.ends_with('\n') {
        output.pop();
    }
    if !output.is_empty() {
        output.push_str("\n\n");
    }
}

fn normalize_markdown(markdown: &str) -> String {
    let mut output = String::new();
    let mut pending_blank = false;

    for line in markdown.split('\n') {
        let line = line.trim_end();
        if line.trim().is_empty() {
            pending_blank = !output.is_empty();
            continue;
        }

        if !output.is_empty() {
            if pending_blank {
                while output.ends_with('\n') {
                    output.pop();
                }
                output.push_str("\n\n");
            } else if !output.ends_with('\n') {
                output.push('\n');
            }
        }
        output.push_str(line);
        pending_blank = false;
    }

    output
}

fn named_entity(name: &str) -> Option<String> {
    let character = match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "apos" => '\'',
        "quot" => '"',
        "nbsp" => '\u{00a0}',
        "ndash" => '–',
        "mdash" => '—',
        "hellip" => '…',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "euro" => '€',
        "bull" => '•',
        "laquo" => '«',
        "raquo" => '»',
        _ => return None,
    };
    Some(character.to_string())
}

fn invalid_epub() -> anyhow::Error {
    anyhow::anyhow!(INVALID_EPUB)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod};

    #[test]
    fn capabilities_match_read_only_class_e() {
        let caps = EpubAdapter.caps();
        assert_eq!(caps.extensions, ["epub"]);
        assert!(!caps.editable);
        assert!(!caps.creatable);
        assert!(!caps.live_preview);
        assert!(!caps.autosave);
        assert!(caps.lossy);
    }

    #[test]
    fn malformed_bytes_return_a_friendly_error() {
        let error = EpubAdapter
            .decode(b"not a zip archive")
            .expect_err("invalid archive must fail");
        assert!(error.to_string().contains("Could not read this EPUB file"));
    }

    #[test]
    fn extracts_xhtml_and_decodes_the_xml_declared_cyrillic_encoding() {
        let xhtml = r#"<?xml version="1.0" encoding="windows-1251"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Скрытый заголовок</title></head>
<body><h1>Привет, мир</h1><p>Текст <strong>важен</strong> &amp; читается.</p>
<ol><li>Первый пункт</li><li>Второй пункт</li></ol></body></html>"#;
        let (xhtml, _, had_errors) = encoding_rs::WINDOWS_1251.encode(xhtml);
        assert!(!had_errors);
        let epub = make_epub(
            &[("chapter", "Text/chapter.xhtml", xhtml.as_ref())],
            &["chapter"],
        );

        let decoded = EpubAdapter.decode(&epub).expect("valid generated EPUB");
        assert!(decoded.text.contains("# Привет, мир"));
        assert!(decoded.text.contains("Текст **важен** & читается."));
        assert!(decoded.text.contains("1. Первый пункт"));
        assert!(decoded.text.contains("2. Второй пункт"));
        assert!(!decoded.text.contains("Скрытый заголовок"));
    }

    #[test]
    fn chapters_follow_spine_order_instead_of_manifest_order() {
        let first = br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter from first manifest item</h1></body></html>"#;
        let second = br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter from second manifest item</h1></body></html>"#;
        let epub = make_epub(
            &[
                ("first", "Text/first.xhtml", first),
                ("second", "Text/second.xhtml", second),
            ],
            &["second", "first"],
        );

        let decoded = EpubAdapter.decode(&epub).expect("valid generated EPUB");
        let first_position = decoded
            .text
            .find("Chapter from first manifest item")
            .expect("first chapter text");
        let second_position = decoded
            .text
            .find("Chapter from second manifest item")
            .expect("second chapter text");
        assert!(second_position < first_position);
    }

    #[test]
    fn epub_extension_is_registered_without_conflicts() {
        let caps = crate::formats::for_extension("epub");
        assert_eq!(caps.id, "epub");
        let mut extensions = std::collections::HashSet::new();
        for format in crate::formats::all() {
            for extension in format.extensions {
                assert!(extensions.insert(extension.to_ascii_lowercase()));
            }
        }
    }

    fn make_epub(chapters: &[(&str, &str, &[u8])], spine: &[&str]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        writer
            .start_file("mimetype", stored)
            .expect("mimetype entry");
        writer
            .write_all(b"application/epub+zip")
            .expect("mimetype content");
        writer
            .start_file("META-INF/container.xml", SimpleFileOptions::default())
            .expect("container entry");
        writer
            .write_all(
                br#"<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
            )
            .expect("container content");

        let manifest = chapters
            .iter()
            .map(|(id, href, _)| {
                format!("<item id=\"{id}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>")
            })
            .collect::<String>();
        let spine_items = spine
            .iter()
            .map(|id| format!("<itemref idref=\"{id}\"/>"))
            .collect::<String>();
        writer
            .start_file("OPS/package.opf", SimpleFileOptions::default())
            .expect("package entry");
        write!(
            writer,
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\"><manifest>{manifest}</manifest><spine>{spine_items}</spine></package>"
        )
        .expect("package content");

        for (_, href, content) in chapters {
            let path = format!("OPS/{href}");
            writer
                .start_file(path, SimpleFileOptions::default())
                .expect("chapter entry");
            writer.write_all(content).expect("chapter content");
        }

        writer.finish().expect("finish EPUB archive").into_inner()
    }
}
