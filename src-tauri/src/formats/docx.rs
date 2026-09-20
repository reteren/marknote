//! Read-only DOCX adapter backed by `docx-rs`'s reader.

use super::{FormatAdapter, FormatCapabilities};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub struct DocxAdapter;

/// Returns the DOCX adapter for the M6 registry owner.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(DocxAdapter)]
}

impl FormatAdapter for DocxAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "docx".to_owned(),
            label: "Word Document".to_owned(),
            default_extension: "docx".to_owned(),
            extensions: vec!["docx".to_owned()],
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
        let document = catch_unwind(AssertUnwindSafe(|| docx_rs::read_docx(bytes)))
            .map_err(|_| {
                anyhow::anyhow!(
                    "Could not read this Word document. Check that it is a valid DOCX file and try again."
                )
            })?
            .map_err(|_| {
                anyhow::anyhow!(
                    "Could not read this Word document. Check that it is a valid DOCX file and try again."
                )
            })?;
        Ok(crate::encoding::Decoded {
            text: document_to_markdown(&document.document),
            encoding: "utf-8".to_owned(),
            bom: false,
            line_ending: crate::encoding::LineEnding::Lf,
        })
    }

    fn encode(&self, _text: &str, _src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Err(anyhow::anyhow!(
            "Word documents are read-only. Use Save As to create a Markdown copy."
        ))
    }
}

fn document_to_markdown(document: &docx_rs::Document) -> String {
    let mut blocks = Vec::new();
    append_document_children(&document.children, &mut blocks);
    blocks.join("\n\n")
}

fn append_document_children(children: &[docx_rs::DocumentChild], blocks: &mut Vec<String>) {
    for child in children {
        match child {
            docx_rs::DocumentChild::Paragraph(paragraph) => {
                push_nonempty(blocks, paragraph_to_markdown(paragraph));
            }
            docx_rs::DocumentChild::Table(table) => {
                push_nonempty(blocks, table_to_markdown(table));
            }
            docx_rs::DocumentChild::Section(section) => {
                append_section_children(section.children(), blocks);
            }
            _ => {}
        }
    }
}

fn append_section_children(children: &[docx_rs::SectionChild], blocks: &mut Vec<String>) {
    for child in children {
        match child {
            docx_rs::SectionChild::Paragraph(paragraph) => {
                push_nonempty(blocks, paragraph_to_markdown(paragraph));
            }
            docx_rs::SectionChild::Table(table) => {
                push_nonempty(blocks, table_to_markdown(table));
            }
            _ => {}
        }
    }
}

fn paragraph_to_markdown(paragraph: &docx_rs::Paragraph) -> String {
    let text = paragraph
        .raw_text()
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if text.trim().is_empty() {
        return String::new();
    }
    if let Some(style) = paragraph.property.style.as_ref() {
        if let Some(level) = heading_level(&style.val) {
            return format!("{} {}", "#".repeat(level), text.trim());
        }
    }
    if paragraph.has_numbering {
        return format!("- {}", text.trim());
    }
    text.trim().to_owned()
}

fn heading_level(style: &str) -> Option<usize> {
    let style = style.to_ascii_lowercase();
    let suffix = style.strip_prefix("heading")?;
    let level = suffix.parse::<usize>().ok()?;
    (1..=6).contains(&level).then_some(level)
}

fn table_to_markdown(table: &docx_rs::Table) -> String {
    let mut rows = Vec::new();
    for row in &table.rows {
        let docx_rs::TableChild::TableRow(row) = row;
        let mut cells = Vec::new();
        for cell in &row.cells {
            let docx_rs::TableRowChild::TableCell(cell) = cell;
            let text = cell
                .children
                .iter()
                .filter_map(|content| match content {
                    docx_rs::TableCellContent::Paragraph(paragraph) => {
                        let text = paragraph.raw_text();
                        (!text.trim().is_empty()).then_some(text.trim().to_owned())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ")
                .replace('|', "\\|");
            cells.push(text);
        }
        if !cells.is_empty() {
            rows.push(cells);
        }
    }
    if rows.is_empty() {
        return String::new();
    }
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut result = String::new();
    for (index, row) in rows.iter().enumerate() {
        result.push('|');
        for cell in row {
            result.push(' ');
            result.push_str(cell);
            result.push_str(" | ");
        }
        for _ in row.len()..width {
            result.push_str(" | ");
        }
        result.push('\n');
        if index == 0 {
            result.push('|');
            for _ in 0..width {
                result.push_str(" --- | ");
            }
            result.push('\n');
        }
    }
    result.trim_end().to_owned()
}

fn push_nonempty(blocks: &mut Vec<String>, block: String) {
    if !block.trim().is_empty() {
        blocks.push(block);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_read_only() {
        let caps = DocxAdapter.caps();
        assert!(!caps.editable);
        assert!(!caps.creatable);
        assert!(!caps.live_preview);
        assert!(!caps.autosave);
        assert!(caps.lossy);
    }

    #[test]
    fn malformed_bytes_return_an_error() {
        let result = DocxAdapter.decode(b"not a DOCX archive");
        assert!(result.is_err());
    }

    #[test]
    fn reads_a_docx_archive_into_markdown_text() {
        let mut archive = std::io::Cursor::new(Vec::new());
        let write_result = docx_rs::Docx::new()
            .add_paragraph(
                docx_rs::Paragraph::new()
                    .style("Heading1")
                    .add_run(docx_rs::Run::new().add_text("Heading")),
            )
            .add_paragraph(
                docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text("Document text")),
            )
            .pack(&mut archive);
        assert!(write_result.is_ok());

        let decoded = DocxAdapter
            .decode(archive.get_ref())
            .expect("valid generated DOCX");
        assert!(decoded.text.contains("# Heading"));
        assert!(decoded.text.contains("Document text"));
    }
}
