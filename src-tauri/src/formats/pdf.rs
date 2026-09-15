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
}
