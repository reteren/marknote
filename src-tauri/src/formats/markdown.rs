use super::{FormatAdapter, FormatCapabilities};

pub struct MarkdownAdapter;

impl FormatAdapter for MarkdownAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "markdown".to_owned(),
            label: "Markdown".to_owned(),
            default_extension: "md".to_owned(),
            extensions: vec![
                "md".to_owned(),
                "markdown".to_owned(),
                "mdown".to_owned(),
                "mkd".to_owned(),
                "mdx".to_owned(),
            ],
            editable: true,
            creatable: true,
            live_preview: true,
            autosave: true,
            lossy: false,
            syntax_mode: None,
            template: String::new(),
        }
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

#[cfg(test)]
mod tests {
    #[test]
    fn mdx_is_registered_as_markdown() {
        assert_eq!(crate::formats::for_extension("mdx").id, "markdown");
    }
}
