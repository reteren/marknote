//! Read-only PDF adapter.  PDF has no reliable lossless Markdown mapping, so
//! the adapter exposes extracted text and never offers an encoder.

use super::{FormatAdapter, FormatCapabilities};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub struct PdfAdapter;

/// Returns the PDF adapter for the M6 registry owner.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(PdfAdapter)]
}

impl FormatAdapter for PdfAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "pdf".to_owned(),
            label: "PDF Document".to_owned(),
            default_extension: "pdf".to_owned(),
            extensions: vec!["pdf".to_owned()],
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
        let extracted = catch_unwind(AssertUnwindSafe(|| {
            pdf_extract::extract_text_from_mem(bytes)
        }))
        .map_err(|_| {
            anyhow::anyhow!(
                "Could not read this PDF file. Check that it is a valid PDF and try again."
            )
        })?
        .map_err(|_| {
            anyhow::anyhow!(
                "Could not read this PDF file. Check that it is a valid PDF and try again."
            )
        })?;
        Ok(crate::encoding::Decoded {
            text: extracted.replace("\r\n", "\n").replace('\r', "\n"),
            encoding: "utf-8".to_owned(),
            bom: false,
            line_ending: crate::encoding::LineEnding::Lf,
        })
    }

    fn encode(&self, _text: &str, _src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Err(anyhow::anyhow!(
            "PDF files are read-only. Use Save As to create a Markdown copy."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_read_only() {
        let caps = PdfAdapter.caps();
        assert!(!caps.editable);
        assert!(!caps.creatable);
        assert!(!caps.live_preview);
        assert!(!caps.autosave);
        assert!(caps.lossy);
    }

    #[test]
    fn malformed_bytes_return_an_error() {
        let result = PdfAdapter.decode(b"not a PDF");
        assert!(result.is_err());
    }

    #[test]
    fn decodes_real_pdf_fixture_extracting_plain_text() {
        // Load the real, reproducible PDF fixture (src-tauri/tests/fixtures/sample.pdf).
        // The document was generated without third-party libraries by generate_sample_pdf.py.
        let bytes = include_bytes!("../../tests/fixtures/sample.pdf");
        let decoded = PdfAdapter
            .decode(bytes)
            .expect("the valid PDF fixture must decode successfully");

        let text = &decoded.text;

        // 1. Verify that all semantic document elements are present:
        // - Document heading
        assert!(
            text.contains("MarkNote PDF Extraction Test"),
            "the document heading must be extracted"
        );
        // - First paragraph with a line break
        assert!(
            text.contains("This is the first paragraph of the test document."),
            "the first line of the first paragraph must be extracted"
        );
        assert!(
            text.contains("It has a line break inside the paragraph to verify extraction."),
            "the second line of the first paragraph must be extracted"
        );
        // - Second paragraph
        assert!(
            text.contains("The second paragraph introduces an itemized list below:"),
            "the second paragraph must be present"
        );
        // - List items
        assert!(
            text.contains("- First item in the list"),
            "the first list item must be extracted"
        );
        assert!(
            text.contains("- Second item in the list"),
            "the second list item must be extracted"
        );
        assert!(
            text.contains("- Third item with additional text"),
            "the third list item must be extracted"
        );
        // - Final paragraph
        assert!(
            text.contains("Final conclusion paragraph verifying text flow and ordering."),
            "the final paragraph must be present"
        );

        // 2. Verify the strict text order (the order must not change):
        let pos_heading = text.find("MarkNote PDF Extraction Test").unwrap();
        let pos_p1_l1 = text.find("This is the first paragraph").unwrap();
        let pos_p1_l2 = text.find("It has a line break inside").unwrap();
        let pos_p2 = text.find("The second paragraph introduces").unwrap();
        let pos_item1 = text.find("- First item").unwrap();
        let pos_item2 = text.find("- Second item").unwrap();
        let pos_item3 = text.find("- Third item").unwrap();
        let pos_conclusion = text.find("Final conclusion paragraph").unwrap();

        assert!(pos_heading < pos_p1_l1);
        assert!(pos_p1_l1 < pos_p1_l2);
        assert!(pos_p1_l2 < pos_p2);
        assert!(pos_p2 < pos_item1);
        assert!(pos_item1 < pos_item2);
        assert!(pos_item2 < pos_item3);
        assert!(pos_item3 < pos_conclusion);

        // 3. Honestly record what is LOST when extracting from PDF:
        // - PDF is a print format, not a markup format. Its heading is only text
        //   rendered in a larger font (18pt rather than 12pt).
        // - Markdown semantics (#, ##) are absent; extraction returns plain text.
        assert!(
            !text.contains("# MarkNote PDF Extraction Test"),
            "the PDF adapter returns plain text without inventing headings"
        );
        // - Font formatting (18pt/12pt size, Helvetica family) is lost entirely.
        // - Lists survive as text only through '-' characters, not markup tags.
        // - Layout coordinates and geometry collapse into ordinary line breaks '\\n'.
        //
        // This test does NOT prove more than stated: the fixture is a simple,
        // uncompressed PDF 1.4 with one Helvetica font and text in Tj operators.
        // Real Word and typeset documents use compressed streams (FlateDecode),
        // embedded font subsets, and kerning through TJ arrays, where words may
        // merge. Such a document must be tested separately with a real file.
    }
}
